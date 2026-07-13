// background.js -- Service Worker
// Zavantazhuye GitHub-spysky ta vidpravlyaye dani v Google Sheet

const DEFAULT_BLACKLIST_URL = 'https://raw.githubusercontent.com/alexey-gluhaniuk-quarks-tech/domain-lists/refs/heads/main/blacklist.txt';
const DEFAULT_WHITELIST_URL = 'https://raw.githubusercontent.com/alexey-gluhaniuk-quarks-tech/domain-lists/refs/heads/main/whitelist.txt';
const DEFAULT_SHEET_URL = 'https://script.google.com/macros/s/AKfycbxxctKhQTQ91S0Tl4f66gr_2X3Gq94IPzmGi9jZyK9nWZQzgRIWLvVMIhbqrVo2yPuf/exec';

// --- Zavantazhennya spyskiv z GitHub ---

async function fetchRawList(url) {
  if (!url) return [];
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      console.warn('[DomainFlag] Failed to fetch list:', url, response.status);
      return [];
    }
    const text = await response.text();
    return text
      .split('\n')
      .map(line => line.trim().toLowerCase())
      .filter(line => line.length > 0 && !line.startsWith('#'));
  } catch (err) {
    console.error('[DomainFlag] fetchRawList error:', err);
    return [];
  }
}

// --- Vidpravka v Google Sheet ---

async function postToSheet(sheetUrl, data) {
  if (!sheetUrl) return false;
  try {
    console.log('[DomainFlag] POST to:', sheetUrl);
    console.log('[DomainFlag] Payload:', JSON.stringify(data));
    const response = await fetch(sheetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(data)
    });
    // Vvazhaemo uspikhom bud-yakiy status -- Apps Script zavzhdy povtertaye 200
    // Yakshcho fetch ne vykynuv vynatok -- uspikh
    await response.text();
    return true;
  } catch (err) {
    console.error('[DomainFlag] postToSheet error:', err.message);
    return false;
  }
}

// --- Obrobkyk povidomlen' vid content.js ---

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {

  if (message.action === 'fetchLists') {
    chrome.storage.local.get(['blacklistUrl', 'whitelistUrl'], async settings => {
      const blacklist = await fetchRawList(settings.blacklistUrl || DEFAULT_BLACKLIST_URL);
      const whitelist = await fetchRawList(settings.whitelistUrl || DEFAULT_WHITELIST_URL);
      chrome.storage.local.set({ blacklist, whitelist, listsUpdatedAt: Date.now() });
      sendResponse({ whitelist, blacklist });
    });
    return true;
  }

  if (message.action === 'submitToSheet') {
    chrome.storage.local.get(['sheetUrl', 'moderatorName'], async settings => {
      const { domain, profileId, note, mx_hosts, pageUrl } = message.data;
      const payload = {
        domain,
        profile_id: profileId,
        flagged_by: settings.moderatorName || 'unknown',
        flagged_at: new Date().toISOString(),
        notes: note || '',
        mx_hosts: mx_hosts || '',
        pageUrl: pageUrl || ''
      };
      console.log('[DomainFlag] submitToSheet payload:', JSON.stringify(payload));
      const success = await postToSheet(settings.sheetUrl || DEFAULT_SHEET_URL, payload);
      console.log('[DomainFlag] submitToSheet success:', success);
      sendResponse({ success });
    });
    return true;
  }

});
