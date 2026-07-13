// content.js - Domain Flag Extension

const PROCESSED_ATTR = 'data-df-processed';

const INTERNAL_DOMAINS = [
  'kismia.local', 'kismia.com', 'kismia.app', 'quarks.tech', 'gen.tech'
];

const PUBLIC_DOMAINS = [
  'gmail.com', 'icloud.com', 'live.com',
  'outlook.com', 'outlook.fr', 'outlook.es',
  'hotmail.com', 'hotmail.es', 'hotmail.fr', 'hotmail.com.ar',
  'yahoo.com', 'yahoo.fr', 'yahoo.es', 'yahoo.com.ar', 'yahoo.com.mx',
  'mail.ru', 'bk.ru', 'list.ru', 'inbox.ru', 'internet.ru',
  'yandex.ru', 'yandex.com', 'ya.ru',
  'rambler.ru', 'mail.com', 'email.com',
  'ukr.net', 'i.ua', 'meta.ua',
  'wp.pl', 'o2.pl', 'op.pl', 'interia.pl',
  'orange.fr', 'inbox.lv',
  'protonmail.com', 'proton.me'
];

// Pattern-based auto-whitelist: educational and government domains
// *.edu (US), *.edu.XX (country-specific: .edu.br, .edu.mx, .edu.pe, .edu.co ...)
// *.gov.XX and *.gob.XX (Latin American gov: .gob.mx, .gob.pe, .gov.br ...)
function isPatternWhitelisted(domain) {
  if (/\.(edu)(\.[a-z]{2})?$/i.test(domain)) return true;
  if (/\.(gov|gob)\.[a-z]{2}$/i.test(domain)) return true;
  return false;
}

async function getLists() {
  return new Promise(resolve => {
    chrome.storage.local.get(
      ['whitelist', 'blacklist', 'listsUpdatedAt', 'localWhitelist'],
      async data => {
        const ONE_HOUR = 60 * 60 * 1000;
        const stale = !data.listsUpdatedAt || Date.now() - data.listsUpdatedAt > ONE_HOUR;
        const localWhitelist = data.localWhitelist || [];

        if (!stale && data.whitelist && data.blacklist) {
          resolve({
            whitelist: [...data.whitelist, ...localWhitelist, ...INTERNAL_DOMAINS, ...PUBLIC_DOMAINS],
            blacklist: data.blacklist
          });
          return;
        }

        chrome.runtime.sendMessage({ action: 'fetchLists' }, response => {
          const r = response || { whitelist: [], blacklist: [] };
          resolve({
            whitelist: [...r.whitelist, ...localWhitelist, ...INTERNAL_DOMAINS, ...PUBLIC_DOMAINS],
            blacklist: r.blacklist
          });
        });
      }
    );
  });
}

function addToLocalWhitelist(domain) {
  return new Promise(resolve => {
    chrome.storage.local.get(['localWhitelist'], data => {
      const list = data.localWhitelist || [];
      if (!list.includes(domain)) list.push(domain);
      chrome.storage.local.set({ localWhitelist: list }, () => resolve());
    });
  });
}

function extractDomain(email) {
  // Split by @ and take the domain part directly - ignore everything after first non-domain char
  const atIdx = email.indexOf('@');
  if (atIdx === -1) return null;
  const afterAt = email.slice(atIdx + 1);
  // Take only valid domain characters (stop at first char that is not a-z, 0-9, dot, hyphen)
  const domainMatch = afterAt.match(/^([a-zA-Z0-9][a-zA-Z0-9.\-]*\.[a-zA-Z]{2,6})(?=[^a-zA-Z]|$)/);
  if (domainMatch) return domainMatch[1].toLowerCase();
  // Fallback: take until first uppercase letter run (site badges are uppercase)
  const parts = afterAt.split(/[A-Z]{2,}/)[0];
  const fallback = parts.match(/^([a-zA-Z0-9][a-zA-Z0-9.\-]*\.[a-zA-Z]{2,})/);
  return fallback ? fallback[1].toLowerCase() : null;
}

function getProfileId() {
  // 1. URL parameter (users-info page)
  const urlMatch = window.location.search.match(/userId=(\d+)/);
  if (urlMatch) return urlMatch[1];

  // 2. innerText scan -- handles split DOM elements (soft-complaints page)
  // Matches "ID" followed by 7-10 digit number
  const bodyText = document.body.innerText || '';
  const textMatch = bodyText.match(/\bID\s+(\d{7,10})\b/);
  if (textMatch) return textMatch[1];

  // 3. Walker fallback
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  let node;
  while ((node = walker.nextNode())) {
    const match = node.textContent.trim().match(/^ID\s+(\d+)$/);
    if (match) return match[1];
  }
  // 4. Photo verification: userId may appear in links on the page
  const userLink = document.querySelector('a[href*="userId="]');
  if (userLink) {
    const m = userLink.href.match(/userId=(\d+)/);
    if (m) return m[1];
  }
  return 'unknown';
}

function createBadge(type, domain) {
  const badge = document.createElement('span');
  badge.className = 'df-badge df-badge--' + type;
  badge.dataset.domain = domain;
  if (type === 'unknown') {
    badge.textContent = 'UN';
    badge.title = 'Unknown domain: ' + domain;
  } else if (type === 'blacklist') {
    badge.textContent = 'BL';
    badge.title = 'Blacklisted domain: ' + domain;
  }
  return badge;
}

function showFlagForm(badge, domain, emailHint) {
  document.querySelector('.df-form')?.remove();
  const profileId = getProfileId();
  const form = document.createElement('div');
  form.className = 'df-form';
  form.innerHTML =
    '<div class="df-form__header">' +
      '<span>Unknown domain: <strong>' + domain + '</strong></span>' +
      '<button class="df-form__close" title="Close">X</button>' +
    '</div>' +
    '<div class="df-form__body">' +
      '<div class="df-form__row">' +
        '<label class="df-form__label">Profile ID</label>' +
        '<span class="df-form__value">' + profileId + '</span>' +
      '</div>' +
      '<div class="df-form__row df-form__row--note">' +
        '<label class="df-form__label">Comment</label>' +
        '<input type="text" class="df-form__note" placeholder="for fraud domain (optional)" value="' + (emailHint || '') + '" />' +
      '</div>' +
    '</div>' +
    '<div class="df-form__footer df-form__footer--split">' +
      '<button class="df-form__btn df-form__btn--safe">Legitimate</button>' +
      '<button class="df-form__btn df-form__btn--fraud">Fraud</button>' +
    '</div>';

  const rect = badge.getBoundingClientRect();
  form.style.top = (rect.bottom + window.scrollY + 6) + 'px';
  form.style.left = Math.min(rect.left + window.scrollX, window.innerWidth - 300) + 'px';
  document.body.appendChild(form);

  form.querySelector('.df-form__close').addEventListener('click', () => form.remove());

  form.querySelector('.df-form__btn--safe').addEventListener('click', async () => {
    const btn = form.querySelector('.df-form__btn--safe');
    btn.textContent = '...';
    btn.disabled = true;
    await addToLocalWhitelist(domain);
    badge.remove();
    form.remove();
  });

  form.querySelector('.df-form__btn--fraud').addEventListener('click', async () => {
    const note = form.querySelector('.df-form__note').value.trim();
    const btn = form.querySelector('.df-form__btn--fraud');
    btn.textContent = 'Sending...';
    btn.disabled = true;
    const mxHosts = await checkMX(domain);
    const success = await submitToSheet({ domain, profileId, note, mxHosts });
    if (success) {
      btn.textContent = 'Sent!';
      btn.classList.add('df-form__btn--ok');
      setTimeout(() => form.remove(), 1500);
    } else {
      btn.textContent = 'Error';
      btn.classList.add('df-form__btn--err');
      btn.disabled = false;
    }
  });

  const noteInput = form.querySelector('.df-form__note');
  // Stop all keyboard events from bubbling to the page (prevents site hotkeys like space -> search)
  ['keydown', 'keypress', 'keyup'].forEach(evt => {
    noteInput.addEventListener(evt, e => e.stopPropagation());
  });
  noteInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') form.querySelector('.df-form__btn--fraud').click();
    if (e.key === 'Escape') form.remove();
  });

  setTimeout(() => {
    document.addEventListener('click', function outsideClick(e) {
      if (!form.contains(e.target) && e.target !== badge) {
        form.remove();
        document.removeEventListener('click', outsideClick);
      }
    });
  }, 100);
}

async function checkMX(domain) {
  try {
    const resp = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${domain}&type=MX`,
      { headers: { Accept: 'application/dns-json' }, signal: AbortSignal.timeout(3000) }
    );
    const data = await resp.json();
    if (!data.Answer || data.Answer.length === 0) return 'no-mx';
    return data.Answer
      .map(r => r.data.split(' ')[1]?.replace(/\.$/, '').toLowerCase())
      .filter(Boolean)
      .join(',');
  } catch {
    return '';
  }
}

// Надсилаємо через service worker (background.js).
// Якщо відповідь не прийшла за 30 секунд — повертаємо false (не вішає вічно).
async function submitToSheet({ domain, profileId, note, mxHosts = '' }) {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      console.error('[DomainFlag] submitToSheet: timeout 30s');
      resolve(false);
    }, 30000);

    chrome.runtime.sendMessage(
      {
        action: 'submitToSheet',
        data: {
          domain,
          profileId,
          note,
          pageUrl: window.location.href,
          mx_hosts: mxHosts
        }
      },
      response => {
        clearTimeout(timer);
        resolve(response?.success === true);
      }
    );
  });
}

async function processEmails() {
  const { whitelist, blacklist } = await getLists();
  const mailIcons = document.querySelectorAll('span[aria-label="mail"]');
  mailIcons.forEach(icon => {
    const copyableWrapper = icon.nextElementSibling;
    if (!copyableWrapper) return;
    const textSpan = copyableWrapper.querySelector('span[class*="CopyableText-module__text__"]');
    if (!textSpan) return;

    // Use textContent (handles <em> tags from highlight extensions)
    // extractDomain splits on uppercase runs to handle site's UNKNOWN badge text
    const email = textSpan.textContent.trim();
    const domain = extractDomain(email);
    if (!domain) return;

    const isWhitelisted = whitelist.some(d => d === domain) || isPatternWhitelisted(domain);
    if (isWhitelisted) {
      // Remove stale UN badge if domain is now whitelisted
      const staleBadge = copyableWrapper.nextElementSibling;
      if (staleBadge && staleBadge.classList.contains('df-badge')) staleBadge.remove();
      return;
    }
    const isBlacklisted = blacklist.some(d => d === domain);

    // Check if badge already exists next to this wrapper (survives React re-renders)
    const existingBadge = copyableWrapper.nextElementSibling;
    if (existingBadge && existingBadge.classList.contains('df-badge')) return;

    const badge = isBlacklisted ? createBadge('blacklist', domain) : createBadge('unknown', domain);
    if (!isBlacklisted) {
      badge.addEventListener('click', e => {
        e.stopPropagation();
        const existing = document.querySelector('.df-form');
        if (existing) { existing.remove(); return; }
        showFlagForm(badge, domain);
      });
    }
    copyableWrapper.after(badge);
  });
}

// --- Photo verification page handler ---
// Selector confirmed from DevTools: span.ant-tooltip-open contains truncated email

async function processPhotoVerification() {
  const { whitelist, blacklist } = await getLists();

  // Short emails render as <b> in card head; long/truncated emails use span.ant-tooltip-open
  document.querySelectorAll('div.ant-card-head-title b, div.ant-card-head-title span.ant-tooltip-open').forEach(el => {
    const text = el.textContent.trim();
    const domain = extractDomain(text);
    if (!domain) return;

    const isWhitelisted = whitelist.some(d => d === domain) || isPatternWhitelisted(domain);
    if (isWhitelisted) {
      // Remove stale UN badge if domain is now whitelisted
      const staleBadge = el.nextElementSibling;
      if (staleBadge && staleBadge.classList.contains('df-badge')) staleBadge.remove();
      return;
    }
    const isBlacklisted = blacklist.some(d => d === domain);

    // Skip if badge already injected after this element
    const next = el.nextElementSibling;
    if (next && next.classList.contains('df-badge')) return;

    const badge = isBlacklisted ? createBadge('blacklist', domain) : createBadge('unknown', domain);
    if (!isBlacklisted) {
      badge.addEventListener('click', e => {
        e.stopPropagation();
        const existing = document.querySelector('.df-form');
        if (existing) { existing.remove(); return; }
        showFlagForm(badge, domain, text);
      });
    }
    el.after(badge);
  });
}

// --- Router ---

function runProcessing() {
  if (window.location.pathname.includes('/photo-verification')) {
    processPhotoVerification();
  } else {
    processEmails();
  }
}

runProcessing();
// Extra runs to catch late React renders
setTimeout(runProcessing, 1000);
setTimeout(runProcessing, 2500);

// Interval fallback: re-check badges every 3s in case React removes them
setInterval(runProcessing, 3000);

let debounceTimer = null;
const observer = new MutationObserver(() => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runProcessing, 400);
});
observer.observe(document.body, { childList: true, subtree: true });
