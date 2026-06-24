// ==UserScript==
// @name         BruceBase Event Name Checker
// @namespace    http://brucebase.wikidot.com/
// @version      1.2
// @description  Validates event name consistency between year overview and detail pages
// @author       Dr. Volker Zell
// @include      /^https?:\/\/brucebase\.wikidot\.com\/\d{4}(-list)?$/
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      brucebase.wikidot.com
// ==/UserScript==

(async function () {
  'use strict';

  const KNOWN_EVENT_TYPES = new Set([
    'gig', 'interview', 'nogig', 'offstage', 'onstage', 'recording', 'rehearsal', 'soundcheck'
  ]);

  // Matches any wikidot path of the form /type:YYYY-MM-DD-...
  const EVENT_URL_RE = /\/([a-z]+):\d{4}-\d{2}-\d{2}/;

  // Matches a year-page anchor link: .../YYYY#DDMMYY
  const LIST_LINK_RE = /\/(\d{4})#([a-zA-Z0-9]+)$/;

  // ── Logging ───────────────────────────────────────────────────────────────

  function log(...a)     { console.log  ('[BruceBase]', ...a); }
  function logWarn(...a) { console.warn ('[BruceBase]', ...a); }
  function logErr(...a)  { console.error('[BruceBase]', ...a); }

  // ── Boot ──────────────────────────────────────────────────────────────────

  log('Script starting on', location.href);
  addStyles();
  createTooltipElement();

  const path = location.pathname.replace(/^\//, ''); // "2024" or "2024-list"
  const isListPage = /^\d{4}-list$/.test(path);
  const isYearPage = /^\d{4}$/.test(path);

  if (isListPage) {
    log('Detected YEAR OVERVIEW (list) page');
    await runListPage(path.replace('-list', ''));
  } else if (isYearPage) {
    log('Detected YEAR page');
    await runYearPage();
  } else {
    logWarn('Unrecognized page type for path:', path);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // YEAR PAGE MODE  — compare YEAR page event names with their DETAIL pages
  // ════════════════════════════════════════════════════════════════════════════

  async function runYearPage() {
    const events = extractYearPageEvents();
    log(`Found ${events.length} event link(s)`);
    if (events.length === 0) {
      logWarn('No event links found — check selector / page structure');
      return;
    }
    await processYearEvents(events);
    log('All events processed');
  }

  function extractYearPageEvents() {
    const content = document.querySelector('#page-content') || document.body;
    log('Scanning for event links inside', content.id ? '#' + content.id : content.tagName);

    const allLinks = content.querySelectorAll('a[href]');
    log(`Total <a> elements in content area: ${allLinks.length}`);

    const results = [];
    allLinks.forEach(el => {
      const m = el.href.match(EVENT_URL_RE);
      if (!m) return;

      const eventType = m[1];
      const yearName  = el.textContent.trim();
      const url       = el.href;
      const isKnown   = KNOWN_EVENT_TYPES.has(eventType);

      if (!isKnown) logWarn(`Unknown event type "${eventType}" in URL: ${url}`);
      else          log(`[${eventType}] "${yearName}" → ${url}`);

      results.push({ element: el, yearName, url, eventType, isKnown });
    });

    const byType = {};
    results.forEach(({ eventType }) => { byType[eventType] = (byType[eventType] || 0) + 1; });
    log('Event type breakdown:', byType);
    return results;
  }

  async function processYearEvents(events) {
    const BATCH_SIZE = 3;
    for (let i = 0; i < events.length; i += BATCH_SIZE) {
      const batch = events.slice(i, i + BATCH_SIZE);
      log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: events ${i + 1}–${Math.min(i + BATCH_SIZE, events.length)} of ${events.length}`);
      await Promise.allSettled(batch.map(processOneYearEvent));
      if (i + BATCH_SIZE < events.length) await delay(500);
    }
  }

  async function processOneYearEvent({ element, yearName, url, eventType, isKnown }) {
    log(`Processing [${eventType}] "${yearName}"`);
    if (!isKnown) {
      logWarn(`  Skipping comparison for unknown event type "${eventType}"`);
      addUnknownGlyph(element, eventType, url);
      return;
    }
    try {
      const doc = await fetchPage(url);
      const rawDetailName = extractDetailEventName(doc, url);
      const normalizedDetailName = normalizeDetailName(rawDetailName);
      const yearNameUpper = yearName.trim().toUpperCase();
      const match = yearNameUpper === normalizedDetailName.trim();

      log(`  YEAR   : "${yearNameUpper}"`);
      log(`  DETAIL : "${normalizedDetailName}"`);
      log(`  Result : ${match ? 'MATCH ✅' : 'MISMATCH ❌'}`);

      addYearGlyph(element, match, yearNameUpper, normalizedDetailName, rawDetailName, eventType);
    } catch (e) {
      logErr(`  Failed to process "${yearName}":`, e.message);
      addWarningGlyph(element, e.message);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // YEAR LIST PAGE MODE  — compare LIST page event names with YEAR page
  // ════════════════════════════════════════════════════════════════════════════

  async function runListPage(year) {
    const listEvents = extractListPageEvents(year);
    log(`Found ${listEvents.length} event link(s) on list page`);
    if (listEvents.length === 0) {
      logWarn('No list-page event links found — check selector / page structure');
      return;
    }

    // Fetch the YEAR page once; all list events point back to the same page.
    const yearPageUrl = `${location.protocol}//${location.host}/${year}`;
    log(`Fetching YEAR page (shared): ${yearPageUrl}`);
    let yearDoc;
    try {
      yearDoc = await fetchPage(yearPageUrl);
    } catch (e) {
      logErr('Failed to fetch YEAR page:', e.message);
      listEvents.forEach(({ element }) => addWarningGlyph(element, 'Could not fetch YEAR page: ' + e.message));
      return;
    }

    const anchorMap = buildAnchorToNameMap(yearDoc);
    log(`Anchor map built: ${anchorMap.size} entries`);
    anchorMap.forEach((name, anchor) => log(`  #${anchor} → "${name}"`));

    listEvents.forEach(ev => processOneListEvent(ev, anchorMap));
    log('All list events processed');
  }

  function extractListPageEvents(year) {
    const content = document.querySelector('#page-content') || document.body;
    log('Scanning list page for event links inside', content.id ? '#' + content.id : content.tagName);

    const allLinks = content.querySelectorAll('a[href]');
    log(`Total <a> elements in content area: ${allLinks.length}`);

    const results = [];
    allLinks.forEach(el => {
      const m = el.href.match(LIST_LINK_RE);
      if (!m || m[1] !== year) return;

      const anchor     = m[2];
      const rawName    = getLinkLineText(el);
      const stripped   = stripListSuffix(rawName);

      log(`[#${anchor}] raw="${rawName}"${rawName !== stripped ? ` stripped="${stripped}"` : ''} → ${el.href}`);
      results.push({ element: el, rawName, strippedName: stripped, anchor });
    });
    return results;
  }

  // Build a map of anchor name → YEAR page event name by pairing each
  // <a name="…"> element with the first event link that follows it in
  // document order.
  function buildAnchorToNameMap(yearDoc) {
    const content = yearDoc.querySelector('#page-content') || yearDoc.body;
    const anchorEls    = [...content.querySelectorAll('a[name]')];
    const eventLinkEls = [...content.querySelectorAll('a[href]')]
      .filter(a => EVENT_URL_RE.test(a.getAttribute('href') || ''));

    log(`Year page: ${anchorEls.length} named anchor(s), ${eventLinkEls.length} event link(s)`);

    const map = new Map();
    for (const anchorEl of anchorEls) {
      const anchorName = anchorEl.getAttribute('name');
      // querySelectorAll returns elements in document order, so the first
      // element in eventLinkEls that follows this anchor is the right one.
      const next = eventLinkEls.find(
        link => anchorEl.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING
      );
      if (next) {
        map.set(anchorName, next.textContent.trim());
      } else {
        logWarn(`  No event link found after anchor #${anchorName}`);
      }
    }
    return map;
  }

  function processOneListEvent({ element, rawName, strippedName, anchor }, anchorMap) {
    log(`Processing list event [#${anchor}] "${rawName}"`);

    const yearName = anchorMap.get(anchor);
    if (yearName === undefined) {
      logWarn(`  Anchor #${anchor} not found in YEAR page anchor map`);
      addWarningGlyph(element, `Anchor #${anchor} not found on YEAR page`);
      return;
    }

    const listUpper = strippedName.toUpperCase();
    const yearUpper = yearName.toUpperCase();
    const match     = listUpper === yearUpper;

    log(`  LIST (stripped) : "${listUpper}"`);
    log(`  YEAR page       : "${yearUpper}"`);
    log(`  Result          : ${match ? 'MATCH ✅' : 'MISMATCH ❌'}`);

    addListGlyph(element, match, strippedName, rawName, yearName, anchor);
  }

  // Collect the link's own text plus any immediately following text/inline-element
  // siblings, so that a suffix like " (Golden Globe Awards)" that sits outside
  // the <a> tag is still captured as part of the raw name.
  function getLinkLineText(el) {
    let text = el.textContent;
    let node = el.nextSibling;
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'A') {
        text += node.textContent;
      } else {
        break;
      }
      node = node.nextSibling;
    }
    return text.trim();
  }

  // Remove an optional trailing subtitle in parentheses from LIST page event names.
  // e.g. "2024-01-07 - THE BEVERLY HILTON, BEVERLY HILLS, CA (Golden Globe Awards)"
  //   →  "2024-01-07 - THE BEVERLY HILTON, BEVERLY HILLS, CA"
  function stripListSuffix(name) {
    return name.replace(/\s*\([^)]*\)\s*$/, '').trim();
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SHARED — fetch, parse, normalise
  // ════════════════════════════════════════════════════════════════════════════

  function fetchPage(url) {
    log(`  Fetching: ${url}`);
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: 15000,
        onload(response) {
          log(`  Response ${response.status} for ${url}`);
          if (response.status >= 200 && response.status < 300) {
            resolve(new DOMParser().parseFromString(response.responseText, 'text/html'));
          } else {
            reject(new Error(`HTTP ${response.status}`));
          }
        },
        onerror(err) { logErr(`  Network error for ${url}`, err); reject(err); },
        ontimeout()  { logErr(`  Timeout for ${url}`);            reject(new Error('timeout')); }
      });
    });
  }

  function extractDetailEventName(doc, url) {
    const candidates = [
      doc.querySelector('#page-title'),
      doc.querySelector('h1.page-title'),
      doc.querySelector('h1'),
    ].filter(Boolean);

    log(`  Detail page title candidates for ${url}:`,
      candidates.map(el => `<${el.tagName}#${el.id || ''}> "${el.textContent.trim()}"`));

    if (candidates.length > 0) {
      const name = candidates[0].textContent.trim();
      log(`  Using: "${name}"`);
      return name;
    }
    const fromTitle = (doc.title || '').split(' | ')[0].trim();
    logWarn(`  No heading element found; falling back to <title>: "${fromTitle}"`);
    return fromTitle;
  }

  // Transforms a DETAIL page event name into the format used by YEAR pages so
  // they can be compared case-insensitively.
  //
  // "(The)" appearing immediately before a comma is moved to the front of the
  // venue name (as "THE "), a " - " separator is inserted between the date and
  // the venue, and the whole string is uppercased.
  //
  // e.g. "2024-01-07 Beverly Hilton (The), Beverly Hills, CA"
  //   →  "2024-01-07 - THE BEVERLY HILTON, BEVERLY HILLS, CA"
  function normalizeDetailName(name) {
    const m = name.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/);
    if (!m) {
      logWarn(`  normalizeDetailName: no date prefix in "${name}" — uppercasing as-is`);
      return name.toUpperCase();
    }
    const date = m[1];
    let rest = m[2];
    const beforeThe = rest;
    rest = rest.replace(/^(.+?)\s*\(The\)(,.*)?$/, (_, venue, suffix) => 'The ' + venue + (suffix || ''));
    if (rest !== beforeThe) log(`  (The) rewrite: "${beforeThe}" → "${rest}"`);
    const normalized = (date + ' - ' + rest).toUpperCase();
    log(`  Normalized: "${name}" → "${normalized}"`);
    return normalized;
  }

  // ── DOM mutation ──────────────────────────────────────────────────────────

  function addYearGlyph(element, match, yearName, normalizedDetailName, rawDetailName, eventType) {
    const span = makeGlyphSpan(match ? '✅' : '❌');
    element.after(span);
    const enter = e => showYearTooltip(e, yearName, normalizedDetailName, rawDetailName, eventType, match);
    [element, span].forEach(n => {
      n.addEventListener('mouseenter', enter);
      n.addEventListener('mouseleave', hideTooltip);
    });
  }

  function addListGlyph(element, match, strippedName, rawName, yearName, anchor) {
    const span = makeGlyphSpan(match ? '✅' : '❌');
    element.after(span);
    const enter = e => showListTooltip(e, strippedName, rawName, yearName, anchor, match);
    [element, span].forEach(n => {
      n.addEventListener('mouseenter', enter);
      n.addEventListener('mouseleave', hideTooltip);
    });
  }

  function addWarningGlyph(element, reason) {
    const span = makeGlyphSpan('⚠️');
    element.after(span);
    const msg = 'Error: ' + reason;
    [element, span].forEach(n => {
      n.addEventListener('mouseenter', e => showErrorTooltip(e, msg));
      n.addEventListener('mouseleave', hideTooltip);
    });
  }

  function addUnknownGlyph(element, eventType, url) {
    const span = makeGlyphSpan('❓');
    element.after(span);
    const msg = `Unknown event type: "${eventType}"\n${url}`;
    [element, span].forEach(n => {
      n.addEventListener('mouseenter', e => showErrorTooltip(e, msg));
      n.addEventListener('mouseleave', hideTooltip);
    });
  }

  function makeGlyphSpan(char) {
    const span = document.createElement('span');
    span.className = 'bb-glyph';
    span.textContent = ' ' + char;
    return span;
  }

  // ── Tooltip ───────────────────────────────────────────────────────────────

  function showYearTooltip(evt, yearName, normalizedDetailName, rawDetailName, eventType, match) {
    const tip = document.getElementById('bb-tooltip');
    if (!tip) return;
    const detailHtml = match ? esc(normalizedDetailName) : buildDiffHtml(yearName, normalizedDetailName);
    tip.innerHTML = `
      <table class="bb-tip-table">
        <tr><th>Event type:</th><td>${esc(eventType)}</td></tr>
        <tr><th>YEAR page:</th><td>${esc(yearName)}</td></tr>
        <tr><th>DETAIL page (raw):</th><td>${esc(rawDetailName)}</td></tr>
        <tr><th>DETAIL page (normalized):</th><td>${detailHtml}</td></tr>
        <tr><th>Result:</th><td>${match
          ? '<span class="bb-ok">Match ✅</span>'
          : '<span class="bb-fail">Mismatch ❌</span>'}</td></tr>
      </table>`;
    positionTooltip(tip, evt);
    tip.style.display = 'block';
  }

  function showListTooltip(evt, strippedName, rawName, yearName, anchor, match) {
    const tip = document.getElementById('bb-tooltip');
    if (!tip) return;
    const listUpper = strippedName.toUpperCase();
    const yearUpper = yearName.toUpperCase();
    const strippedHtml = match ? esc(listUpper) : buildDiffHtml(yearUpper, listUpper);
    const yearHtml     = match ? esc(yearUpper) : buildDiffHtml(listUpper, yearUpper);
    tip.innerHTML = `
      <table class="bb-tip-table">
        <tr><th>Anchor:</th><td>#${esc(anchor)}</td></tr>
        <tr><th>LIST page (raw):</th><td>${esc(rawName)}</td></tr>
        <tr><th>LIST page (stripped):</th><td>${strippedHtml}</td></tr>
        <tr><th>YEAR page:</th><td>${yearHtml}</td></tr>
        <tr><th>Result:</th><td>${match
          ? '<span class="bb-ok">Match ✅</span>'
          : '<span class="bb-fail">Mismatch ❌</span>'}</td></tr>
      </table>`;
    positionTooltip(tip, evt);
    tip.style.display = 'block';
  }

  function showErrorTooltip(evt, msg) {
    const tip = document.getElementById('bb-tooltip');
    if (!tip) return;
    tip.innerHTML = `<span class="bb-fail">${esc(msg).replace(/\n/g, '<br>')}</span>`;
    positionTooltip(tip, evt);
    tip.style.display = 'block';
  }

  function hideTooltip() {
    const tip = document.getElementById('bb-tooltip');
    if (tip) tip.style.display = 'none';
  }

  function positionTooltip(tip, evt) {
    const margin = 12;
    tip.style.left = '0';
    tip.style.top  = '0';
    tip.style.display = 'block';
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let x = evt.clientX + margin;
    let y = evt.clientY + margin;
    if (x + w > window.innerWidth  - margin) x = evt.clientX - w - margin;
    if (y + h > window.innerHeight - margin) y = evt.clientY - h - margin;
    tip.style.left = Math.max(0, x) + 'px';
    tip.style.top  = Math.max(0, y) + 'px';
  }

  function createTooltipElement() {
    const div = document.createElement('div');
    div.id = 'bb-tooltip';
    div.style.display = 'none';
    document.body.appendChild(div);
  }

  // ── Diff ──────────────────────────────────────────────────────────────────

  // Token-level diff: split both strings on whitespace and commas (keeping the
  // delimiters as separate tokens) then walk in lockstep, wrapping mismatched
  // tokens with a highlight span.
  function buildDiffHtml(a, b) {
    const tokA = a.split(/(\s+|,)/);
    const tokB = b.split(/(\s+|,)/);
    const len = Math.max(tokA.length, tokB.length);
    let html = '';
    for (let i = 0; i < len; i++) {
      const ta = tokA[i] !== undefined ? tokA[i] : '';
      const tb = tokB[i] !== undefined ? tokB[i] : '';
      html += ta === tb
        ? esc(tb)
        : `<span class="bb-diff-mismatch">${esc(tb || '∅')}</span>`;
    }
    return html;
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  function addStyles() {
    GM_addStyle(`
      #bb-tooltip {
        position: fixed;
        z-index: 9999;
        background: #222;
        color: #f0f0f0;
        border: 1px solid #555;
        border-radius: 6px;
        padding: 10px 14px;
        font-size: 13px;
        font-family: monospace;
        width: max-content;
        pointer-events: none;
        white-space: nowrap;
        box-shadow: 0 4px 16px rgba(0,0,0,0.5);
        line-height: 1.6;
      }
      .bb-tip-table { border-collapse: collapse; width: 100%; }
      .bb-tip-table th {
        text-align: right;
        padding-right: 8px;
        color: #aaa;
        white-space: nowrap;
        vertical-align: top;
        font-weight: normal;
      }
      .bb-tip-table td { white-space: nowrap; }
      .bb-diff-mismatch {
        background: #ffcccc;
        color: #900;
        border-radius: 2px;
        padding: 0 2px;
      }
      .bb-ok   { color: #6f6; }
      .bb-fail { color: #f66; }
      .bb-glyph { cursor: default; font-style: normal; margin-left: 4px; }
    `);
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

})();
