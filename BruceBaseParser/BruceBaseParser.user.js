// ==UserScript==
// @name         VZ: BruceBase Parser
// @namespace    https://github.com/vzell/userscripts
// @version      1.14
// @description  Validates event name and setlist consistency between year overview and detail pages
// @author       vzell
// @tag          AI generated
// @homepageURL  https://github.com/vzell/userscripts
// @supportURL   https://github.com/vzell/userscripts/issues
// @downloadURL  https://raw.githubusercontent.com/vzell/userscripts/master/BruceBaseParser.user.js
// @updateURL    https://raw.githubusercontent.com/vzell/userscripts/master/BruceBaseParser.user.js
// @include      /^https?:\/\/brucebase\.wikidot\.com\/\d{4}(-list)?$/
// @include      /^https?:\/\/brucebase\.wikidot\.com\/(gig|nogig|recording|interview|offstage|onstage|rehearsal|soundcheck):/
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      brucebase.wikidot.com
// @license      MIT
// ==/UserScript==

(async function () {
  'use strict';

  const KNOWN_EVENT_TYPES = new Set([
    'gig', 'interview', 'nogig', 'offstage', 'onstage', 'recording', 'rehearsal', 'soundcheck'
  ]);

  const EVENT_URL_RE  = /\/([a-z]+):\d{4}-\d{2}-\d{2}/;
  const LIST_LINK_RE  = /\/(\d{4})#([a-zA-Z0-9]+)$/;
  const DETAIL_TYPE_RE = /^(gig|nogig|recording|interview|offstage|onstage|rehearsal|soundcheck):/;

  function log(...a)     { console.log  ('[BruceBase]', ...a); }
  function logWarn(...a) { console.warn ('[BruceBase]', ...a); }
  function logErr(...a)  { console.error('[BruceBase]', ...a); }

  log('Script starting on', location.href);
  addStyles();
  createTooltipElement();

  const path        = location.pathname.replace(/^\//, '');
  const isListPage   = /^\d{4}-list$/.test(path);
  const isYearPage   = /^\d{4}$/.test(path);
  const isDetailPage = DETAIL_TYPE_RE.test(path);

  if (isListPage) {
    log('Detected YEAR OVERVIEW (list) page');
    await runListPage(path.replace('-list', ''));
  } else if (isYearPage) {
    log('Detected YEAR page');
    await runYearPage();
  } else if (isDetailPage) {
    log('Detected DETAIL page');
    await runDetailPage();
  } else {
    logWarn('Unrecognized page type for path:', path);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // YEAR PAGE MODE
  // ════════════════════════════════════════════════════════════════════════════

  async function runYearPage() {
    const content = document.querySelector('#page-content') || document.body;

    // Snapshot original HTML before any DOM modifications
    const originalHtml = content.innerHTML;

    // Wrap content between <hr>s so per-section toggles can show/hide each slice
    const sections = wrapYearSections(content);
    log(`Wrapped ${sections.length} year section(s) for toggling`);

    const events = extractYearPageEvents();
    log(`Found ${events.length} event link(s)`);
    if (events.length === 0) {
      logWarn('No event links found — check selector / page structure');
      return;
    }
    await processYearEvents(events);

    // Insert toggle controls now that processing is complete
    insertGlobalToggle(content, originalHtml);
    sections.forEach(({ hr, processedDiv, sectionOriginalHtml }) =>
      insertSectionToggle(hr, processedDiv, sectionOriginalHtml)
    );

    log('All events processed');
  }

  // Wraps the content that follows each <hr> (up to the next <hr>) inside a
  // .bb-section-processed div, and returns a snapshot of the original HTML.
  // The original-view div is NOT created here — it is created by insertSectionToggle
  // AFTER processing completes, so that querySelectorAll during event extraction
  // does not pick up cloned <a> elements and process them twice.
  function wrapYearSections(content) {
    const hrs = [...content.querySelectorAll('hr')].filter(el => el.parentElement === content);
    const result = [];

    for (let k = 0; k < hrs.length; k++) {
      const hr     = hrs[k];
      const nextHr = hrs[k + 1] || null;

      // Collect all direct-child siblings between this hr and the next
      const toWrap = [];
      let node = hr.nextSibling;
      while (node && node !== nextHr) {
        toWrap.push(node);
        node = node.nextSibling;
      }
      if (toWrap.length === 0) continue;

      // Serialize original HTML *before* any node moves
      const sectionOriginalHtml = toWrap.map(n =>
        n.nodeType === Node.TEXT_NODE    ? n.textContent :
        n.nodeType === Node.ELEMENT_NODE ? n.outerHTML   : ''
      ).join('');

      // Wrap live nodes in a processed container (the only copy in the DOM)
      const processedDiv = document.createElement('div');
      processedDiv.className = 'bb-section-processed';
      content.insertBefore(processedDiv, toWrap[0]);
      toWrap.forEach(n => processedDiv.appendChild(n));

      result.push({ hr, processedDiv, sectionOriginalHtml });
    }

    return result;
  }

  // Creates a full-page toggle button after #page-title.
  // The original view is a separate hidden div inserted beside #page-content so
  // that all event listeners on the processed content area survive toggling.
  function insertGlobalToggle(content, originalHtml) {
    const pageTitle = document.getElementById('page-title');
    if (!pageTitle) return;

    const originalEl = document.createElement('div');
    originalEl.id = 'bb-page-original';
    originalEl.innerHTML = originalHtml;
    originalEl.style.display = 'none';
    content.parentNode.insertBefore(originalEl, content.nextSibling);

    const btn = document.createElement('button');
    btn.id = 'bb-global-toggle';
    btn.className = 'bb-toggle-btn';
    btn.textContent = '⇄ Show Original Page';

    let showingOriginal = false;
    btn.addEventListener('click', () => {
      showingOriginal = !showingOriginal;
      content.style.display    = showingOriginal ? 'none'  : 'block';
      originalEl.style.display = showingOriginal ? 'block' : 'none';
      btn.textContent = showingOriginal ? '⇄ Show Processed Page' : '⇄ Show Original Page';
    });

    pageTitle.after(btn);
  }

  // Inserts a per-section toggle button immediately after the given <hr>.
  // Creates the original-view div here (after processing) so that
  // extractYearPageEvents never encounters duplicate <a> links inside it.
  function insertSectionToggle(hr, processedDiv, sectionOriginalHtml) {
    const originalDiv = document.createElement('div');
    originalDiv.className = 'bb-section-original';
    originalDiv.innerHTML = sectionOriginalHtml;
    originalDiv.style.display = 'none';
    processedDiv.parentNode.insertBefore(originalDiv, processedDiv);

    const btn = document.createElement('button');
    btn.className = 'bb-toggle-btn bb-section-toggle';
    btn.textContent = '⇄ Original';

    let showingOriginal = false;
    btn.addEventListener('click', () => {
      showingOriginal = !showingOriginal;
      processedDiv.style.display = showingOriginal ? 'none'  : 'block';
      originalDiv.style.display  = showingOriginal ? 'block' : 'none';
      btn.textContent = showingOriginal ? '⇄ Processed' : '⇄ Original';
    });

    hr.after(btn);
  }

  // Inserts a toggle button after #page-title on DETAIL pages.
  // Wraps the processed td children and an original snapshot in show/hide divs
  // so wikidot's tab-switching JavaScript and all tooltip listeners survive toggling.
  function insertDetailToggle(originalTdHtml) {
    const pageTitle = document.getElementById('page-title');
    if (!pageTitle) return;

    const td = getSetlistContainer(document);
    if (!td) return;

    // Move processed nodes (with their event listeners) into a wrapper div
    const processedDiv = document.createElement('div');
    processedDiv.className = 'bb-detail-processed';
    while (td.firstChild) processedDiv.appendChild(td.firstChild);

    // Hidden div holds the original (unprocessed) snapshot
    const originalDiv = document.createElement('div');
    originalDiv.className = 'bb-detail-original';
    originalDiv.style.display = 'none';
    originalDiv.innerHTML = originalTdHtml;

    td.appendChild(processedDiv);
    td.appendChild(originalDiv);

    const btn = document.createElement('button');
    btn.id = 'bb-global-toggle';
    btn.className = 'bb-toggle-btn';
    btn.textContent = '⇄ Show Original Page';

    let showingOriginal = false;
    btn.addEventListener('click', () => {
      showingOriginal = !showingOriginal;
      processedDiv.style.display = showingOriginal ? 'none'  : 'block';
      originalDiv.style.display  = showingOriginal ? 'block' : 'none';
      btn.textContent = showingOriginal ? '⇄ Show Processed Page' : '⇄ Show Original Page';
    });

    pageTitle.after(btn);
  }

  function extractYearPageEvents() {
    const content    = document.querySelector('#page-content') || document.body;
    const allLinks   = [...content.querySelectorAll('a[href]')];
    const allAnchors = [...content.querySelectorAll('a[name]')];
    log(`Scanning content: ${allLinks.length} links, ${allAnchors.length} named anchors`);

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

      // Last named anchor that precedes this event link
      let precedingAnchor    = null;
      let precedingAnchorIdx = -1;
      for (let i = 0; i < allAnchors.length; i++) {
        if (allAnchors[i].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) {
          precedingAnchor    = allAnchors[i];
          precedingAnchorIdx = i;
        }
      }

      // First named anchor that follows this event link (end boundary for setlist)
      const nextAnchor = allAnchors.find(a =>
        el.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING
      );

      const setlistEls = isKnown ? collectSetlistElements(el, nextAnchor, content) : [];

      results.push({
        element: el, yearName, url, eventType, isKnown,
        anchorEl:   precedingAnchor,
        anchorName: precedingAnchor ? precedingAnchor.getAttribute('name') : null,
        setlistEls
      });
    });

    const byType = {};
    results.forEach(({ eventType }) => { byType[eventType] = (byType[eventType] || 0) + 1; });
    log('Event type breakdown:', byType);
    return results;
  }

  // Returns all <p> and <blockquote> elements in content that follow
  // eventLinkEl and precede nextAnchorEl, excluding event-name lines.
  // Stops early when a <p> whose text starts with "YYYY-MM-DD - " is encountered:
  // those are inline date headers for events that have no named anchor of their own,
  // and everything after them belongs to a different event.
  function collectSetlistElements(eventLinkEl, nextAnchorEl, content) {
    const INLINE_DATE_RE = /^\d{4}-\d{2}-\d{2}\s+-\s+/;
    const result = [];
    for (const el of content.querySelectorAll('p, blockquote')) {
      if (!(eventLinkEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      if (nextAnchorEl && !(nextAnchorEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING)) break;
      if (el.tagName === 'P' && INLINE_DATE_RE.test(el.textContent.trim())) break;
      // Skip <p> elements nested inside a <blockquote> — the blockquote is collected
      // as a unit and parseYearSetlist already reads its inner <p> text.
      if (el.tagName === 'P' && el.closest('blockquote')) continue;
      const firstLink = el.querySelector('a[href]');
      if (firstLink && EVENT_URL_RE.test(firstLink.getAttribute('href') || '')) continue;
      if (!textWithoutSup(el).trim()) continue;
      // Prose has lowercase letters; setlist entries are all-caps on brucebase.
      // Examine the text up to the first ' / ' (the whole text for single-song
      // entries). Strip any label prefix ("Soundcheck: ") and qualifiers
      // ("(with …)", "(x3)"), then reject if lowercase letters remain.
      // This handles both single-song entries (no ' / ') and prose that embeds
      // quoted lyrics with '/' as line-breaks.
      // <sup><em> footnotes ("Setlist incomplete.") are excluded from the text
      // so their lowercase content doesn't cause the entry to be rejected.
      if (el.tagName === 'P') {
        const text      = textWithoutSup(el).trim();
        const slashIdx  = text.indexOf(' / ');
        const firstPart = slashIdx >= 0 ? text.slice(0, slashIdx) : text;
        const core      = firstPart
          .replace(/^[^/:\n]+:\s*/, '')
          .replace(/\s*\([^)]*[a-z][^)]*\)/g, '') // strip parentheticals with lowercase (with/xN/parts/…)
          .trim();
        if (!core || /[a-z]/.test(core)) continue;
      }
      result.push(el);
    }
    return result;
  }

  // Section = { label: string, songs: string[], sourceEl: Element }
  function parseYearSetlist(setlistEls) {
    const sections = [];
    for (const el of setlistEls) {
      let label = 'show';
      let text;

      if (el.tagName === 'BLOCKQUOTE') {
        label = 'recording';
        const inner = el.querySelector('p');
        text = inner ? textWithoutSup(inner) : textWithoutSup(el);
      } else {
        text = textWithoutSup(el);
        const m = text.match(/^([^/:\n]+):\s*/);
        if (m) {
          label = m[1].trim();  // preserve original case ("With Garland Jeffreys")
          text  = text.slice(m[0].length);
        }
      }

      const rawAndClean = text.split(' / ')
        .map(s => s.trim())
        .filter(s => s.length > 0)
        .map(raw => ({ raw, clean: cleanSongName(raw) }))
        .filter(p => p.clean.length > 0);
      const songs    = rawAndClean.map(p => p.clean);
      const rawSongs = rawAndClean.map(p => p.raw);

      if (songs.length > 0) sections.push({ label, songs, rawSongs, sourceEl: el });
    }
    return sections;
  }

  // Returns el.textContent with all <sup> child elements excluded, so that
  // footnote-style notes ("Setlist incomplete.") don't corrupt song name parsing.
  function textWithoutSup(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('sup').forEach(s => s.remove());
    return clone.textContent;
  }

  // Strips parentheticals containing any lowercase letter: (with …), (x3), (parts), (acoustic) etc.
  // Preserves all-caps song-name parentheticals: (41 SHOTS), (COME OUT TONIGHT) etc.
  function cleanSongName(text) {
    return text
      .replace(/\s*\([^)]*[a-z][^)]*\)/g, '')
      .trim();
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

  async function processOneYearEvent({ element, yearName, url, eventType, isKnown, setlistEls }) {
    log(`Processing [${eventType}] "${yearName}"`);
    if (!isKnown) {
      logWarn(`  Skipping comparison for unknown event type "${eventType}"`);
      addUnknownGlyph(element, eventType, url);
      return;
    }
    try {
      const doc = await fetchPage(url);

      // ── Event name check ─────────────────────────────────────────────────
      const rawDetailName       = extractDetailEventName(doc, url);
      const normalizedDetailName = normalizeDetailName(rawDetailName);
      const yearNameUpper        = yearName.trim().toUpperCase();
      const nameMatch            = yearNameUpper === normalizedDetailName.trim();

      log(`  YEAR   : "${yearNameUpper}"`);
      log(`  DETAIL : "${normalizedDetailName}"`);
      log(`  Result : ${nameMatch ? 'MATCH ✅' : 'MISMATCH ❌'}`);

      addYearGlyph(element, nameMatch, yearNameUpper, normalizedDetailName, rawDetailName, eventType);

      // ── Setlist check ────────────────────────────────────────────────────
      if (setlistEls.length > 0) {
        const yearSections   = parseYearSetlist(setlistEls);
        const detailSections = parseDetailSetlist(doc);
        const yearFlat    = yearSections.flatMap(s => s.songs);
        const yearRawFlat = yearSections.flatMap(s => s.rawSongs);
        const detailFlat  = detailSections.flatMap(s => s.songs);
        log(`  Setlist: ${yearFlat.length} year songs, ${detailFlat.length} detail songs`);

        if (yearFlat.length > 0 || detailFlat.length > 0) {
          const diffItems = mergeCharDiffs(lcsDiff(yearFlat, detailFlat));
          let yp = 0;
          for (const item of diffItems) {
            if (item.type !== 'detail-only') item.rawYearSong = yearRawFlat[yp++];
          }
          renderYearSetlist(yearSections, diffItems);
        }
      }
    } catch (e) {
      logErr(`  Failed to process "${yearName}":`, e.message);
      addWarningGlyph(element, e.message);
    }
  }

  // ── Setlist rendering — YEAR page ─────────────────────────────────────────

  function renderYearSetlist(yearSections, diffItems) {
    // posMap[yearSongFlatIdx] = sectionIdx
    const posMap = [];
    yearSections.forEach((sec, sIdx) => sec.songs.forEach(() => posMap.push(sIdx)));

    let yearCursor = 0;
    const sectionItems = yearSections.map(() => []);

    for (const item of diffItems) {
      if (item.type === 'detail-only') {
        const sIdx = yearCursor < posMap.length ? posMap[yearCursor] : yearSections.length - 1;
        sectionItems[sIdx].push(item);
      } else {
        if (yearCursor < posMap.length) {
          sectionItems[posMap[yearCursor]].push(item);
          yearCursor++;
        }
      }
    }

    yearSections.forEach((sec, sIdx) => renderSetlistElement(sec.sourceEl, sec.label, sectionItems[sIdx]));
  }

  function renderSetlistElement(el, label, items) {
    let html    = '';
    let isFirst = true;

    const labelLc = label.toLowerCase();
    if (labelLc === 'soundcheck') {
      html += '<span class="bb-section-label">Soundcheck: </span>';
    } else if (labelLc !== 'show' && labelLc !== 'recording') {
      html += `<span class="bb-section-label">${esc(label)}: </span>`;
    }

    for (const item of items) {
      if (!isFirst) html += '<span class="bb-sep"> / </span>';
      isFirst = false;

      if (item.type === 'match') {
        const rawSuffix = item.rawYearSong ? esc(item.rawYearSong.slice(item.yearSong.length)) : '';
        html += `<span class="bb-song-match">${esc(item.yearSong)}</span>${rawSuffix}`;
      } else if (item.type === 'year-only') {
        html += `<span class="bb-song-year-only" data-year-song="${esc(item.yearSong)}">${esc(item.yearSong)}</span>`;
      } else if (item.type === 'detail-only') {
        html += `<span class="bb-song-detail-only" data-detail-song="${esc(item.detailSong)}">${esc(item.detailSong)}</span>`;
      } else if (item.type === 'char-diff') {
        const inner = buildCharDiffHtml(item.yearSong, item.detailSong);
        html += `<span class="bb-song-char-diff" data-year-song="${esc(item.yearSong)}" data-detail-song="${esc(item.detailSong)}">${inner}</span>`;
      }
    }

    // Preserve <sup><em> footnote nodes (e.g. "Setlist incomplete.") that were
    // inside the element before we overwrite innerHTML.
    const supHtml = [...el.querySelectorAll('sup')].map(s => s.outerHTML).join('');
    el.innerHTML = supHtml ? html + '<br>' + supHtml : html;

    el.querySelectorAll('.bb-song-year-only, .bb-song-detail-only, .bb-song-char-diff').forEach(span => {
      span.addEventListener('mouseenter', e => showSongTooltip(e, span));
      span.addEventListener('mouseleave', hideTooltip);
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // DETAIL PAGE MODE
  // ════════════════════════════════════════════════════════════════════════════

  async function runDetailPage() {
    const detailSections = parseDetailSetlist(document);
    if (detailSections.length === 0) {
      log('No setlist found on detail page');
      return;
    }

    const info = detailPathToYearAndAnchor(path);
    if (!info) {
      logWarn('Could not derive year/anchor from path:', path);
      return;
    }

    const yearPageUrl = `${location.protocol}//${location.host}/${info.year}`;
    log(`Fetching YEAR page for setlist comparison: ${yearPageUrl}`);

    let yearDoc;
    try {
      yearDoc = await fetchPage(yearPageUrl);
    } catch (e) {
      logErr('Failed to fetch YEAR page:', e.message);
      return;
    }

    const yearContent   = yearDoc.querySelector('#page-content') || yearDoc.body;
    const targetAnchor  = yearContent.querySelector(`a[name="${info.anchor}"]`);
    if (!targetAnchor) {
      logWarn(`Anchor #${info.anchor} not found on YEAR page`);
      return;
    }

    const eventLink = [...yearContent.querySelectorAll('a[href]')]
      .filter(a => EVENT_URL_RE.test(a.getAttribute('href') || ''))
      .find(a => targetAnchor.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING);

    if (!eventLink) {
      logWarn('No event link found after anchor on YEAR page');
      return;
    }

    const nextAnchor = [...yearContent.querySelectorAll('a[name]')]
      .find(a => eventLink.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING);

    const yearSections  = parseYearSetlist(collectSetlistElements(eventLink, nextAnchor, yearContent));
    const yearFlat      = yearSections.flatMap(s => s.songs);
    const yearRawFlat   = yearSections.flatMap(s => s.rawSongs);
    const detailFlat    = detailSections.flatMap(s => s.songs);
    log(`Detail mode: ${yearFlat.length} year songs, ${detailFlat.length} detail songs`);

    const diffItems = mergeCharDiffs(lcsDiff(yearFlat, detailFlat));
    let yp = 0;
    for (const item of diffItems) {
      if (item.type !== 'detail-only') item.rawYearSong = yearRawFlat[yp++];
    }

    // Snapshot the td content just before rendering so the original is unmodified
    const td             = getSetlistContainer(document);
    const originalTdHtml = td ? td.innerHTML : '';

    renderDetailSetlist(diffItems);
    insertDetailToggle(originalTdHtml);
  }

  // "gig:2003-09-14-..." → { year: "2003", anchor: "140903" }
  // "gig:1968-05-00a-..." → { year: "1968", anchor: "000568a" }
  function detailPathToYearAndAnchor(p) {
    const m = p.match(/:(\d{4})-(\d{2})-(\d{2})([a-z]?)/);
    if (!m) return null;
    const [, yyyy, mm, dd, suffix] = m;
    return { year: yyyy, anchor: dd + mm + yyyy.slice(2) + suffix };
  }

  // Returns the setlist container element for a (fetched or live) document.
  // Normally #wiki-tab-0-1 holds a <table><tr><td> layout; older/simpler pages
  // place the <ol>/<ul> directly inside the div with no <td>.
  function getSetlistContainer(doc) {
    return doc.querySelector('#wiki-tab-0-1 td') || doc.querySelector('#wiki-tab-0-1');
  }

  function renderDetailSetlist(diffItems) {
    const td = getSetlistContainer(document);
    if (!td) return;

    const allLis = [...td.querySelectorAll('li')];
    let liIdx = 0;

    for (const item of diffItems) {
      if (item.type === 'match' || item.type === 'char-diff' || item.type === 'detail-only') {
        if (liIdx < allLis.length) {
          styleDetailLi(allLis[liIdx], item);
          liIdx++;
        }
      } else if (item.type === 'year-only') {
        // Insert a new <li> for a song present on the year page but missing here
        const newLi = document.createElement('li');
        newLi.className = 'bb-song-year-only';
        newLi.dataset.yearSong = item.yearSong;
        newLi.textContent = item.yearSong;
        newLi.addEventListener('mouseenter', e => showSongTooltip(e, newLi));
        newLi.addEventListener('mouseleave', hideTooltip);

        if (liIdx < allLis.length) {
          allLis[liIdx].parentNode.insertBefore(newLi, allLis[liIdx]);
        } else {
          const lastList = td.querySelector('ol:last-of-type') || td.querySelector('ul:last-of-type');
          if (lastList) lastList.appendChild(newLi);
        }
      }
    }
  }

  function styleDetailLi(li, item) {
    if (item.type === 'match') {
      // Add match class to song links only — not to the <li> itself — so
      // descriptive <span> nodes like (parts) do not inherit the green colour.
      li.querySelectorAll('a[href^="/song:"]').forEach(a => a.classList.add('bb-song-match'));
    } else if (item.type === 'detail-only') {
      li.classList.add('bb-song-detail-only');
      li.dataset.detailSong = item.detailSong;
      li.addEventListener('mouseenter', e => showSongTooltip(e, li));
      li.addEventListener('mouseleave', hideTooltip);
    } else if (item.type === 'char-diff') {
      li.classList.add('bb-song-char-diff');
      li.dataset.yearSong   = item.yearSong;
      li.dataset.detailSong = item.detailSong;
      const a = li.querySelector('a');
      if (a) a.innerHTML = buildCharDiffHtml(item.yearSong, item.detailSong);
      li.addEventListener('mouseenter', e => showSongTooltip(e, li));
      li.addEventListener('mouseleave', hideTooltip);
    }
  }

  // ── Detail page setlist parser ────────────────────────────────────────────

  // Parses #wiki-tab-0-1 → Section[]
  // Section headers: <p><strong>Soundcheck</strong></p> etc.
  // Songs: <a href="/song:..."> text, medleys joined with " - "
  function parseDetailSetlist(doc) {
    const td = getSetlistContainer(doc);
    if (!td) {
      logWarn('parseDetailSetlist: #wiki-tab-0-1 container not found');
      return [];
    }

    const sections    = [];
    let currentLabel  = 'show';

    for (const child of td.children) {
      if (child.tagName === 'P') {
        const strong = child.querySelector('strong');
        if (strong && child.textContent.trim() === strong.textContent.trim()) {
          currentLabel = strong.textContent.trim().toLowerCase();
        }
      } else if (child.tagName === 'OL' || child.tagName === 'UL') {
        const songs = [];
        for (const li of child.querySelectorAll('li')) {
          const links = [...li.querySelectorAll('a[href^="/song:"]')];
          let name;
          if (links.length > 0) {
            name = cleanSongName(links.map(a => a.textContent.trim()).join(' - '));
          } else {
            // Fall back to plain text for songs with no dedicated song page.
            // Skip venue/date entries (e.g. "2004-04-18 Hit Factory, NY").
            const text = li.textContent.trim();
            if (text && !/^\d{4}-\d{2}-\d{2}/.test(text)) name = cleanSongName(text);
          }
          if (name) songs.push(name);
        }
        if (songs.length > 0) sections.push({ label: currentLabel, songs });
      }
    }

    return sections;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // YEAR LIST PAGE MODE
  // ════════════════════════════════════════════════════════════════════════════

  async function runListPage(year) {
    const listEvents = extractListPageEvents(year);
    log(`Found ${listEvents.length} event link(s) on list page`);
    if (listEvents.length === 0) {
      logWarn('No list-page event links found — check selector / page structure');
      return;
    }

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
    const content  = document.querySelector('#page-content') || document.body;
    const allLinks = content.querySelectorAll('a[href]');
    const results  = [];

    allLinks.forEach(el => {
      const m = el.href.match(LIST_LINK_RE);
      if (!m || m[1] !== year) return;

      const anchor   = m[2];
      const rawName  = getLinkLineText(el);
      const stripped = stripListSuffix(rawName);

      log(`[#${anchor}] raw="${rawName}"${rawName !== stripped ? ` stripped="${stripped}"` : ''}`);
      results.push({ element: el, rawName, strippedName: stripped, anchor });
    });
    return results;
  }

  function buildAnchorToNameMap(yearDoc) {
    const content      = yearDoc.querySelector('#page-content') || yearDoc.body;
    const anchorEls    = [...content.querySelectorAll('a[name]')];
    const eventLinkEls = [...content.querySelectorAll('a[href]')]
      .filter(a => EVENT_URL_RE.test(a.getAttribute('href') || ''));

    log(`Year page: ${anchorEls.length} named anchor(s), ${eventLinkEls.length} event link(s)`);

    const map = new Map();
    for (const anchorEl of anchorEls) {
      const anchorName = anchorEl.getAttribute('name');
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

  function stripListSuffix(name) {
    return name.replace(/\s*\([^)]*\)\s*$/, '').trim();
  }

  // ════════════════════════════════════════════════════════════════════════════
  // DIFF ALGORITHMS
  // ════════════════════════════════════════════════════════════════════════════

  // Standard LCS-based diff on song name arrays (case-insensitive).
  // Returns DiffItem[]: { type: 'match'|'year-only'|'detail-only', yearSong?, detailSong? }
  function lcsDiff(yearSongs, detailSongs) {
    const a = yearSongs.map(s => s.toUpperCase());
    const b = detailSongs.map(s => s.toUpperCase());
    const m = a.length, n = b.length;

    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);

    const result = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && a[i-1] === b[j-1]) {
        result.unshift({ type: 'match', yearSong: yearSongs[i-1], detailSong: detailSongs[j-1] });
        i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
        result.unshift({ type: 'detail-only', detailSong: detailSongs[j-1] });
        j--;
      } else {
        result.unshift({ type: 'year-only', yearSong: yearSongs[i-1] });
        i--;
      }
    }
    return result;
  }

  // Reclassify adjacent year-only + detail-only pairs as char-diff when
  // edit distance is small (likely a typo/variant rather than a different song).
  function mergeCharDiffs(items) {
    const result = [...items];
    let i = 0;
    while (i < result.length - 1) {
      if (result[i].type === 'year-only' && result[i+1].type === 'detail-only') {
        const a = result[i].yearSong, b = result[i+1].detailSong;
        if (editDistance(a.toUpperCase(), b.toUpperCase()) <= Math.max(3, 0.2 * a.length)) {
          result.splice(i, 2, { type: 'char-diff', yearSong: a, detailSong: b });
        }
      }
      i++;
    }
    return result;
  }

  function editDistance(a, b) {
    const m = a.length, n = b.length;
    const dp = [];
    for (let i = 0; i <= m; i++) {
      dp[i] = [i];
      for (let j = 1; j <= n; j++) {
        dp[i][j] = i === 0 ? j
          : a[i-1] === b[j-1] ? dp[i-1][j-1]
          : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
      }
    }
    return dp[m][n];
  }

  // Character-level LCS diff: returns HTML showing yearSong chars,
  // with mismatched chars in .bb-char-diff and matching in .bb-char-match.
  function buildCharDiffHtml(yearSong, detailSong) {
    const a = yearSong.toUpperCase(), b = detailSong.toUpperCase();
    const m = a.length, n = b.length;

    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);

    let i = m, j = n;
    const chars = [];
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && a[i-1] === b[j-1]) {
        chars.unshift({ ch: a[i-1], match: true });
        i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
        j--;
      } else {
        chars.unshift({ ch: a[i-1], match: false });
        i--;
      }
    }

    return chars.map(c => c.match
      ? `<span class="bb-char-match">${esc(c.ch)}</span>`
      : `<span class="bb-char-diff">${esc(c.ch)}</span>`
    ).join('');
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

  function normalizeDetailName(name) {
    const m = name.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/);
    if (!m) {
      logWarn(`  normalizeDetailName: no date prefix in "${name}" — uppercasing as-is`);
      return name.toUpperCase();
    }
    const date = m[1];
    let rest = m[2];
    const beforeArticle = rest;
    rest = rest.replace(/^(.+?)\s*\((The|Le)\)(,.*)?$/, (_, venue, article, suffix) => article + ' ' + venue + (suffix || ''));
    if (rest !== beforeArticle) log(`  article rewrite: "${beforeArticle}" → "${rest}"`);
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
    const listUpper    = strippedName.toUpperCase();
    const yearUpper    = yearName.toUpperCase();
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

  function showSongTooltip(evt, el) {
    const tip = document.getElementById('bb-tooltip');
    if (!tip) return;
    const cls        = el.className || '';
    const yearSong   = el.dataset.yearSong   || '';
    const detailSong = el.dataset.detailSong || '';
    let html = '';

    if (cls.includes('bb-song-year-only')) {
      html = `<span class="bb-fail">Only on YEAR page (missing from detail):</span><br>${esc(yearSong || el.textContent.trim())}`;
    } else if (cls.includes('bb-song-detail-only')) {
      html = `<span class="bb-fail">Only on DETAIL page (missing from year):</span><br>${esc(detailSong || el.textContent.trim())}`;
    } else if (cls.includes('bb-song-char-diff')) {
      html = `<table class="bb-tip-table">
        <tr><th>YEAR page:</th><td>${esc(yearSong)}</td></tr>
        <tr><th>DETAIL page:</th><td>${esc(detailSong)}</td></tr>
        <tr><th>Diff:</th><td>${buildDiffHtml(yearSong.toUpperCase(), detailSong.toUpperCase())}</td></tr>
      </table>`;
    }

    if (!html) return;
    tip.innerHTML = html;
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

  // ── Token diff (for event name mismatch tooltips) ─────────────────────────

  function buildDiffHtml(a, b) {
    const tokA = a.split(/(\s+|,)/);
    const tokB = b.split(/(\s+|,)/);
    const len  = Math.max(tokA.length, tokB.length);
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

      /* Toggle buttons */
      .bb-toggle-btn {
        display: inline-block;
        margin: 4px 0 4px 6px;
        padding: 2px 10px;
        background: #4a90d9;
        color: #fff;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        font-family: sans-serif;
        vertical-align: middle;
      }
      .bb-toggle-btn:hover { background: #357abd; }
      #bb-global-toggle { margin: 6px 0 2px 0; display: block; }
      .bb-section-toggle { margin-left: 0; }

      /* Setlist song states */
      .bb-song-match       { color: #2a2; }
      .bb-song-year-only   { background: #add8e6; border-radius: 3px; padding: 0 2px; cursor: default; }
      .bb-song-detail-only { background: #ffff88; border-radius: 3px; padding: 0 2px; cursor: default; }
      .bb-song-char-diff   { cursor: default; }

      /* Character-level diff within a song name */
      .bb-char-match { color: #2a2; }
      .bb-char-diff  { color: #c00; font-weight: bold; }

      /* Separator between songs on YEAR page */
      .bb-sep          { color: #999; }
      .bb-section-label { color: #888; font-style: italic; }

      /* Year-only <li> rows inserted on detail pages */
      li.bb-song-year-only {
        background: #ffff88;
        list-style-type: disc;
        cursor: default;
      }
      li.bb-song-detail-only { background: #add8e6; }
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
