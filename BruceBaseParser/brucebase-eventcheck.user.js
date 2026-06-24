// ==UserScript==
// @name         BruceBase Event Name Checker
// @namespace    http://brucebase.wikidot.com/
// @version      1.1
// @description  Validates event name consistency between year overview and detail pages
// @author       Dr. Volker Zell
// @include      /^https?:\/\/brucebase\.wikidot\.com\/\d{4}$/
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

  // ── Logging ───────────────────────────────────────────────────────────────

  function log(...a)   { console.log  ('[BruceBase]', ...a); }
  function logWarn(...a) { console.warn ('[BruceBase]', ...a); }
  function logErr(...a)  { console.error('[BruceBase]', ...a); }

  // ── Boot ──────────────────────────────────────────────────────────────────

  log('Script starting on', location.href);
  addStyles();
  createTooltipElement();
  const events = extractYearPageEvents();
  log(`Found ${events.length} event link(s) on this page`);
  if (events.length === 0) {
    logWarn('No event links found — check selector / page structure');
    return;
  }
  await processEvents(events);
  log('All events processed');

  // ── Parsing ──────────────────────────────────────────────────────────────

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

      if (!isKnown) {
        logWarn(`Unknown event type "${eventType}" in URL: ${url}`);
      } else {
        log(`[${eventType}] "${yearName}" → ${url}`);
      }

      results.push({ element: el, yearName, url, eventType, isKnown });
    });

    const byType = {};
    results.forEach(({ eventType }) => { byType[eventType] = (byType[eventType] || 0) + 1; });
    log('Event type breakdown:', byType);

    return results;
  }

  function fetchDetailPage(url) {
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
        onerror(err) {
          logErr(`  Network error for ${url}`, err);
          reject(err);
        },
        ontimeout() {
          logErr(`  Timeout for ${url}`);
          reject(new Error('timeout'));
        }
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

  // ── Normalization ─────────────────────────────────────────────────────────

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
      logWarn(`  normalizeDetailName: no date prefix found in "${name}" — uppercasing as-is`);
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

  // ── Processing ────────────────────────────────────────────────────────────

  async function processOneEvent({ element, yearName, url, eventType, isKnown }) {
    log(`Processing [${eventType}] "${yearName}"`);

    if (!isKnown) {
      logWarn(`  Skipping comparison for unknown event type "${eventType}"`);
      addUnknownGlyph(element, eventType, url);
      return;
    }

    try {
      const doc = await fetchDetailPage(url);
      const rawDetailName = extractDetailEventName(doc, url);
      const normalizedDetailName = normalizeDetailName(rawDetailName);
      const yearNameUpper = yearName.trim().toUpperCase();
      const match = yearNameUpper === normalizedDetailName.trim();

      log(`  YEAR    : "${yearNameUpper}"`);
      log(`  DETAIL  : "${normalizedDetailName}"`);
      log(`  Result  : ${match ? 'MATCH ✅' : 'MISMATCH ❌'}`);

      addGlyph(element, match, yearNameUpper, normalizedDetailName, rawDetailName, eventType);
    } catch (e) {
      logErr(`  Failed to process "${yearName}":`, e.message);
      addWarningGlyph(element, e.message);
    }
  }

  async function processEvents(events) {
    const BATCH_SIZE = 3;
    for (let i = 0; i < events.length; i += BATCH_SIZE) {
      const batch = events.slice(i, i + BATCH_SIZE);
      log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: processing events ${i + 1}–${Math.min(i + BATCH_SIZE, events.length)} of ${events.length}`);
      await Promise.allSettled(batch.map(processOneEvent));
      if (i + BATCH_SIZE < events.length) await delay(500);
    }
  }

  // ── DOM mutation ──────────────────────────────────────────────────────────

  function addGlyph(element, match, yearName, normalizedDetailName, rawDetailName, eventType) {
    const span = makeGlyphSpan(match ? '✅' : '❌');
    element.after(span);
    const enter = e => showTooltip(e, yearName, normalizedDetailName, rawDetailName, eventType, match);
    [element, span].forEach(n => {
      n.addEventListener('mouseenter', enter);
      n.addEventListener('mouseleave', hideTooltip);
    });
  }

  function addWarningGlyph(element, reason) {
    const span = makeGlyphSpan('⚠️');
    element.after(span);
    const msg = 'Could not load detail page: ' + reason;
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

  function showTooltip(evt, yearName, normalizedDetailName, rawDetailName, eventType, match) {
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
        max-width: 560px;
        pointer-events: none;
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
      .bb-tip-table td { word-break: break-all; }
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
