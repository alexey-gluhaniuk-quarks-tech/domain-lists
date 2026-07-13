const SHEET_NAME = 'new';

// Колонки (1-based): A=domain B=profile_id C=flagged_by D=flagged_at
// E=notes F=status G=page_url H=ignore_reason I=review_date J=new_flags K=mx_hosts
const COL_DOMAIN        = 1;
const COL_STATUS        = 6;
const COL_IGNORE_REASON = 8;
const COL_REVIEW_DATE   = 9;
const COL_NEW_FLAGS     = 10;

const REVIEW_DAYS          = 90;  // 3 місяці до review
const EARLY_FLAG_THRESHOLD = 5;   // дострокова перевірка
const NOTIFY_EMAIL         = 'alexey.gluhaniuk@moderation.quarks.tech';

// ── doPost: основний обробник сабмітів з розширення ────────────────────────
function doPost(e) {
  try {
    const data  = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);

    if (!sheet) {
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'error', message: 'Sheet "' + SHEET_NAME + '" not found' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const domain    = (data.domain     || '').trim().toLowerCase();
    const profileId = (data.profile_id || '').toString().trim();
    const flaggedBy = (data.flagged_by || 'unknown').trim();
    const flaggedAt =  data.flagged_at || new Date().toISOString();
    const notes     = (data.notes      || '').trim();
    const mxHosts   = (data.mx_hosts   || '').trim(); // ← NEW: MX записи з DoH

    if (!domain) {
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'error', message: 'domain is required' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const profileUrl = (profileId && profileId !== 'unknown')
      ? 'https://admin.ddkit.io/user/users-info?userId=' + profileId
      : '';

    // ← NEW: якщо домен вже має статус ignore — оновлюємо лічильник флагів
    handleIgnoredDomain(sheet, domain);

    // A           B          C          D          E      F      G           H   I   J   K
    sheet.appendRow([domain, profileId, flaggedBy, flaggedAt, notes, 'new', profileUrl, '', '', '', mxHosts]);

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── onEdit: при зміні статусу → "ignore" авто-заповнює review_date та new_flags ──
// Тригер: Edit → встанови через Triggers
function onEdit(e) {
  const sheet = e.range.getSheet();
  const row   = e.range.getRow();
  const col   = e.range.getColumn();

  if (row === 1)          return;
  if (col !== COL_STATUS) return;

  // processed_at: timestamp зміни статусу (added/rejected/ignore)
  sheet.getRange(row, 12).setValue(
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss')
  );

  // e.value ненадійний для інстальованих тригерів — читаємо з клітинки напряму
  // .trim() обов'язковий: Google Sheets додає пробіл після значення дропдауну
  const newStatus = sheet.getRange(row, col).getValue().toString().trim();
  if (newStatus !== 'ignore') return;  // далі тільки логіка ignore

  const today      = new Date();
  const reviewDate = new Date(today);
  reviewDate.setDate(reviewDate.getDate() + REVIEW_DAYS);

  sheet.getRange(row, COL_REVIEW_DATE).setValue(
    Utilities.formatDate(reviewDate, Session.getScriptTimeZone(), 'yyyy-MM-dd')
  );
  sheet.getRange(row, COL_NEW_FLAGS).setValue(0);
  // COL_IGNORE_REASON (H) — заповнює ревʼювер вручну
}

// ── handleIgnoredDomain: збільшує лічильник для вже ігнорованого домену ────
function handleIgnoredDomain(sheet, domain) {
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][COL_DOMAIN - 1]  !== domain)   continue;
    if (data[i][COL_STATUS - 1]  !== 'ignore') continue;

    const newCount = (Number(data[i][COL_NEW_FLAGS - 1]) || 0) + 1;
    sheet.getRange(i + 1, COL_NEW_FLAGS).setValue(newCount);

    // ≥5 флагів — підсвічуємо рядок оранжевим для раннього перегляду
    if (newCount >= EARLY_FLAG_THRESHOLD) {
      sheet.getRange(i + 1, 1, 1, 11).setBackground('#FFB74D');
    }
    return true;
  }
  return false;
}

// ── monthlyReviewDigest: щомісячний email з доменами на перегляд ─────────
// Тригер: Time-driven → Month timer → Day 1 → встанови через Triggers
function monthlyReviewDigest() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const data  = sheet.getDataRange().getValues();
  const today = new Date();

  const dueDomains   = [];  // термін review минув
  const earlyDomains = [];  // ≥5 нових флагів до терміну

  for (let i = 1; i < data.length; i++) {
    if (data[i][COL_STATUS - 1] !== 'ignore') continue;

    const domain     = data[i][COL_DOMAIN        - 1];
    const reason     = data[i][COL_IGNORE_REASON - 1] || '—';
    const newFlags   = Number(data[i][COL_NEW_FLAGS  - 1]) || 0;
    const reviewRaw  = data[i][COL_REVIEW_DATE   - 1];
    const reviewDate = reviewRaw ? new Date(reviewRaw) : null;

    if (reviewDate && reviewDate <= today) {
      dueDomains.push({ domain, reason, newFlags });
    } else if (newFlags >= EARLY_FLAG_THRESHOLD) {
      earlyDomains.push({ domain, reason, newFlags });
    }
  }

  if (dueDomains.length === 0 && earlyDomains.length === 0) return;

  const dateStr = Utilities.formatDate(today, Session.getScriptTimeZone(), 'dd.MM.yyyy');
  let body = `Domain Review Digest — ${dateStr}\n\n`;

  if (dueDomains.length > 0) {
    body += `=== Термін перегляду минув (${dueDomains.length}) ===\n`;
    dueDomains.forEach(d => { body += `• ${d.domain}  [${d.reason}]  нових флагів: ${d.newFlags}\n`; });
    body += '\n';
  }

  if (earlyDomains.length > 0) {
    body += `=== Дострокові — ≥${EARLY_FLAG_THRESHOLD} нових флагів (${earlyDomains.length}) ===\n`;
    earlyDomains.forEach(d => { body += `• ${d.domain}  [${d.reason}]  нових флагів: ${d.newFlags}\n`; });
    body += '\n';
  }

  body += `Таблиця: https://docs.google.com/spreadsheets/d/1-iP-d27s0a8eF8SF3ty7q8Xip4-HpMAl8Yma9_ZO_og/\n`;

  MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    subject: `[Domain Review] ${dueDomains.length + earlyDomains.length} доменів на перегляд — ${dateStr}`,
    body: body
  });
}

// ── doGet: health-check ──────────────────────────────────────────────────────
function doGet(e) {
  return ContentService.createTextOutput('Domain Flag Apps Script OK');
}
