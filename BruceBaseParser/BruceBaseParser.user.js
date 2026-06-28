// ==UserScript==
// @name         VZ: BruceBase Parser
// @namespace    https://github.com/vzell/userscripts
// @version      2.07
// @description  Validates event name and setlist consistency between year overview and detail pages
// @author       vzell
// @tag          AI generated
// @homepageURL  https://github.com/vzell/userscripts
// @supportURL   https://github.com/vzell/userscripts/issues
// @downloadURL  https://raw.githubusercontent.com/vzell/userscripts/master/BruceBaseParser.user.js
// @updateURL    https://raw.githubusercontent.com/vzell/userscripts/master/BruceBaseParser.user.js
// @require      file:///V:/home/vzell/git/springsteen-site-parser/dist/smarttable.js
// @require      file:///V:/home/vzell/git/springsteen-site-parser/adapters/brucebase.js
// @include      /^https?:\/\/brucebase\.wikidot\.com\/(\d{4}(-list)?|1949-64(-list)?|start)?$/
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
  const LIST_LINK_RE  = /\/((?:\d{4}|1949-64))#([a-zA-Z0-9]+)$/;

  let _savedOriginalHtml = null;   // pre-processing snapshot for YEAR page Save handler
  const DETAIL_TYPE_RE = /^(gig|nogig|recording|interview|offstage|onstage|rehearsal|soundcheck):/;
  // Matches "Info & Setlist" back-links on detail pages: /YEAR#ANCHOR or /1949-64#ANCHOR
  const INFO_SETLIST_HREF_RE = /^\/[\d][\w-]*#([a-zA-Z0-9]+)$/;

  /** Maps every icon title variant found on YEAR pages to a canonical type key. */
  const ICON_TITLE_MAP = {
    'Photo': 'Photo',       'Photos': 'Photo',
    'Setlist': 'Setlist',   'Setlists': 'Setlist',
    'Ticket': 'Ticket',     'Tickets': 'Ticket',
    'News': 'News',         'News-articles': 'News',
    'Memorabilia': 'Memorabilia', 'Memorabilia, Pass, Posters, etc.': 'Memorabilia',
    'Video': 'Video',       'Video Footage': 'Video',
    'Storyteller': 'Storyteller', 'Storyteller Transcripts': 'Storyteller',
    'Eyewitness': 'Eyewitness', 'Eye': 'Eyewitness', 'Eyewitness Reports': 'Eyewitness',
    'Bootleg': 'Bootleg',   'Audio': 'Bootleg', 'Audio / Video Bootleg': 'Bootleg',
    'LiveDL': 'LiveDL',     'Official Live Download': 'LiveDL',
    'Retail': 'Retail',
  };

  /** Tab labels already handled by icon images — not given extra buttons. */
  const ICON_COVERED_TABS = new Set([
    'Gallery', 'Setlist', 'News/Memorabilia', 'News', 'Media', 'Storyteller', 'Eyewitness', 'Recording',
  ]);

  /** Tab labels that carry no standalone content worth showing on the YEAR page. */
  const SKIP_TABS = new Set([]);

  /** Matches the "Sorry, no …" placeholder text used in empty DETAIL page tabs. */
  const SORRY_RE = /^Sorry,? no /i;

  /** Lowercase English month names indexed 0 (Jan) – 11 (Dec). */
  const MONTH_NAMES = ['january','february','march','april','may','june','july','august','september','october','november','december'];

  /** Lowercase English weekday names indexed 0 (Sun) – 6 (Sat). */
  const DAY_NAMES = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

  /**
   * Content-based tags whose presence can be verified against DETAIL page data.
   * Tags not in this set (venue names, song abbreviations, etc.) are left unchecked.
   */
  const MANAGED_CONTENT_TAGS = new Set([
    'gig', 'interview', 'nogig', 'offstage', 'onstage', 'recording', 'rehearsal', 'soundcheck',
    'bootleg', 'livedl', 'news', 'memorabilia', 'ticket',
    'setlist', 'handwritten', 'printed', 'storyteller',
  ]);

  /** Human-readable reasons why each managed tag might be present but spurious. */
  const SPURIOUS_TAG_REASONS = {
    bootleg:     'Recording tab has no bootleg content',
    livedl:      'Recording tab has no official live download content',
    news:        'News/Memorabilia tab is empty or unavailable',
    memorabilia: 'News/Memorabilia tab is empty or unavailable',
    ticket:      'No ticket images found in News/Memorabilia tab',
    setlist:     'No setlist images found in News/Memorabilia tab',
    handwritten: 'No handwritten setlist images found in News/Memorabilia tab',
    printed:     'No printed setlist images found in News/Memorabilia tab',
    soundcheck:  'No "Soundcheck:" section label found in event content',
    storyteller: 'Storyteller tab is empty or unavailable',
  };

  /** SmartTable column definitions for YEAR OVERVIEW (list) pages. */
  const LIST_SMARTTABLE_COLUMNS = [
    { key: 'date',   label: 'Date',   type: 'date',   width: '105px' },
    { key: 'status', label: 'Status', type: 'string', width: '60px',  sortable: false },
    { key: 'event',  label: 'Event',  type: 'string' },
    { key: 'url',    label: 'Link',   type: 'string', sortable: false, filterable: false,
      render: url => {
        const a = document.createElement('a');
        a.href = url; a.textContent = 'Open'; a.target = '_blank'; a.rel = 'noopener noreferrer';
        return a;
      } },
  ];

  /** SmartTable column definitions for the HOME page aggregate table. */
  const HOME_SMARTTABLE_COLUMNS = [
    { key: 'year',   label: 'Year',   type: 'number', width: '58px' },
    { key: 'date',   label: 'Date',   type: 'date',   width: '105px' },
    { key: 'status', label: 'Status', type: 'string', width: '60px',  sortable: false },
    { key: 'event',  label: 'Event',  type: 'string' },
    { key: 'url',    label: 'Link',   type: 'string', sortable: false, filterable: false,
      render: url => {
        const a = document.createElement('a');
        a.href = url; a.textContent = 'Open'; a.target = '_blank'; a.rel = 'noopener noreferrer';
        return a;
      } },
  ];

  /** Maps each canonical icon type to the DETAIL page tab that holds its content. */
  const CANONICAL_TAB_LABEL = {
    Photo:        'Gallery',
    Setlist:      'News/Memorabilia',
    Ticket:       'News/Memorabilia',
    News:         'News/Memorabilia',
    Memorabilia:  'News/Memorabilia',
    Video:        'Media',
    Storyteller:  'Storyteller',
    Eyewitness:   'Eyewitness',
    Bootleg:      'Recording',
    LiveDL:       'Recording',
  };

  function log(...a)     { console.log  ('[BruceBase]', ...a); }
  function logWarn(...a) { console.warn ('[BruceBase]', ...a); }
  function logErr(...a)  { console.error('[BruceBase]', ...a); }

  log('Script starting on', location.href);
  addStyles();
  createTooltipElement();

  const path        = location.pathname.replace(/^\//, '');
  const isHomePage   = path === '' || path === 'start';
  const isListPage   = /^(\d{4}|1949-64)-list$/.test(path);
  const isYearPage   = /^\d{4}$/.test(path) || path === '1949-64';
  const isDetailPage = DETAIL_TYPE_RE.test(path);

  if (isHomePage) {
    log('Detected HOME page');
    await runHomePage();
  } else if (isListPage) {
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
  // HOME PAGE MODE
  // ════════════════════════════════════════════════════════════════════════════

  async function runHomePage() {
    const pageTitle = document.getElementById('page-title');
    if (!pageTitle) return;

    const slugs = extractGigPageSlugs();
    if (slugs.length === 0) { logWarn('HOME: no gig-page links found'); return; }
    log(`HOME: found ${slugs.length} year page slug(s)`);

    // ── Button container (same IDs / classes as YEAR page) ──────────────────
    const fetchBtn = document.createElement('button');
    fetchBtn.id = 'bb-fetch-all-btn';
    fetchBtn.className = 'bb-toggle-btn';
    fetchBtn.textContent = '▶ Fetch All Year Pages';
    fetchBtn.title = 'Fetch all year pages (YEAR mode) and validate name/setlist consistency — click again to stop';

    const overviewBtn = document.createElement('button');
    overviewBtn.id = 'bb-fetch-overview-btn';
    overviewBtn.className = 'bb-toggle-btn';
    overviewBtn.textContent = '▶ Fetch All Year-List Pages';
    overviewBtn.title = 'Fetch all year-list pages (LIST mode) and validate event name consistency — click again to stop';

    const filterBtn = document.createElement('button');
    filterBtn.id = 'bb-mismatch-toggle';
    filterBtn.className = 'bb-toggle-btn';
    filterBtn.textContent = '⚡ Mismatches';
    filterBtn.title = 'Filter to show only events or year sections with mismatches';
    filterBtn.disabled = true;

    const btnContainer = document.createElement('div');
    btnContainer.id = 'bb-btn-container';

    const [homeSaveBtn, homeLoadBtn] = makeSaveLoadBtns(
      'home', () => resultsEl, () => ''
    );
    btnContainer.append(fetchBtn, overviewBtn, filterBtn, homeSaveBtn, homeLoadBtn);

    // ── Progress indicator (same structure as YEAR page) ─────────────────────
    const timerSpan = document.createElement('span');
    timerSpan.id = 'bb-year-timer';
    timerSpan.textContent = '00:00';

    const progressEl = document.createElement('p');
    progressEl.id = 'bb-year-progress';
    progressEl.append(timerSpan);

    // ── Sticky bar (same structure as YEAR page) ─────────────────────────────
    const controlsEl = document.createElement('div');
    controlsEl.id = 'bb-controls';
    controlsEl.append(btnContainer, progressEl);

    const stickyBar = document.createElement('div');
    stickyBar.id = 'bb-sticky-bar';
    stickyBar.appendChild(controlsEl);

    pageTitle.parentNode.insertBefore(stickyBar, pageTitle);
    pageTitle.style.display = 'none';

    // ── Results container ─────────────────────────────────────────────────────
    const resultsEl = document.createElement('div');
    resultsEl.id = 'bb-home-results';
    stickyBar.after(resultsEl);

    // Measure heights for sticky positioning (mirrors setupStickyBar logic).
    const bbHeader = document.getElementById('header');
    document.documentElement.style.setProperty('--bb-header-h', `${bbHeader ? bbHeader.offsetHeight : 0}px`);
    requestAnimationFrame(() => {
      document.documentElement.style.setProperty('--bb-sticky-bar-h', `${stickyBar.offsetHeight}px`);
    });

    // ── SmartTable + mismatch-filter state (rebuilt after each fetch) ────────
    let stHostEl         = null; // SmartTable host div, placed before resultsEl
    let stBtnEl          = null; // SmartTable trigger button, moved into btnContainer
    let currentMismatchFn = null; // set after each fetch; null while fetching

    let filterActive = false;
    filterBtn.addEventListener('click', () => {
      if (!currentMismatchFn) return;
      filterActive = !filterActive;
      currentMismatchFn(filterActive);
    });

    // ── Shared fetch logic ────────────────────────────────────────────────────
    let fetching = false;
    let stopRequested = false;
    const fetchBtns = [fetchBtn, overviewBtn];

    /**
     * Fetches and processes all year slugs, transforming each via slugTransform.
     * activeBtn is the button that triggered the fetch; it toggles to ⏹ Stop while running.
     * @param {HTMLButtonElement} activeBtn
     * @param {function(string): string} slugTransform
     */
    async function runFetch(activeBtn, slugTransform) {
      if (fetching) return;
      fetching = true;
      stopRequested = false;
      const idleLabel = activeBtn.textContent;
      const stopLabel = activeBtn === fetchBtn ? '⏹ Stop Year Pages' : '⏹ Stop Year-List Pages';
      // Tear down any SmartTable and mismatch state from the previous run.
      if (stBtnEl)  { stBtnEl.remove();  stBtnEl  = null; }
      if (stHostEl) { stHostEl.remove(); stHostEl = null; }
      filterActive = false;
      currentMismatchFn = null;
      filterBtn.textContent = '⚡ Mismatches';
      // Disable the other fetch button while this one is running.
      fetchBtns.forEach(b => { if (b !== activeBtn) b.disabled = true; });
      activeBtn.textContent = stopLabel;
      activeBtn.title = 'Click to abort after the current page fetch completes';
      filterBtn.disabled = true;
      homeSaveBtn.disabled = true;
      resultsEl.innerHTML = '';

      const startTime = Date.now();
      timerSpan.textContent = '00:00';
      const timerId = setInterval(() => {
        timerSpan.textContent = fmtElapsed(Date.now() - startTime);
      }, 1000);

      let processed = 0;
      for (let i = 0; i < slugs.length; i++) {
        if (stopRequested) break;
        const fetchSlug = slugTransform(slugs[i]);
        const setMsg = msg => progressEl.replaceChildren(timerSpan, ` ... ${msg}`);
        setMsg(`Fetching ${fetchSlug} (${i + 1} / ${slugs.length})`);
        await fetchAndProcessYear(fetchSlug, resultsEl, setMsg);
        processed++;
      }

      clearInterval(timerId);
      timerSpan.textContent = fmtElapsed(Date.now() - startTime);
      const doneMsg = stopRequested
        ? `Stopped after ${processed} / ${slugs.length} year pages.`
        : `Done — ${slugs.length} year pages processed.`;
      progressEl.replaceChildren(timerSpan, ` ... ${doneMsg}`);
      activeBtn.textContent = idleLabel;
      activeBtn.title = activeBtn === fetchBtn
        ? 'Fetch all year pages (YEAR mode) and validate name/setlist consistency — click again to stop'
        : 'Fetch all year-list pages (LIST mode) and validate event name consistency — click again to stop';
      fetchBtns.forEach(b => { b.disabled = false; });
      filterBtn.disabled = processed === 0;
      fetching = false;

      if (processed === 0) return;

      // ── SmartTable ──────────────────────────────────────────────────────────
      if (typeof SmartTable !== 'undefined') {
        stHostEl = document.createElement('div');
        stHostEl.id = 'bb-home-smarttable-host';
        resultsEl.before(stHostEl);
        SmartTable.render({
          columns:   HOME_SMARTTABLE_COLUMNS,
          rows:      extractHomeSmartTableRows(resultsEl),
          container: stHostEl,
          options:   { stickyOffset: 'calc(var(--bb-header-h) + var(--bb-sticky-bar-h))' },
        });
        stBtnEl = stHostEl.querySelector('.st-btn-trigger');
        if (stBtnEl) filterBtn.before(stBtnEl);
      }

      // ── Mismatch filter ─────────────────────────────────────────────────────
      if (activeBtn === overviewBtn) {
        // List overview pages: events are <li> items with a bb-glyph next sibling.
        const allLinks = [...resultsEl.querySelectorAll('.bb-year-wrapper a[href]')]
          .filter(a => LIST_LINK_RE.test(a.getAttribute('href') || ''));
        const total = allLinks.length;
        const mismatchCount = allLinks.filter(a => {
          const sib = a.nextElementSibling;
          return !sib || !sib.classList.contains('bb-glyph') || !sib.textContent.includes('✅');
        }).length;
        filterBtn.textContent = `⚡ Mismatches (${mismatchCount})`;
        currentMismatchFn = active => {
          for (const wrapper of resultsEl.querySelectorAll('.bb-year-wrapper')) {
            const header     = wrapper.previousElementSibling;
            const hasHeader  = header && header.classList.contains('bb-year-header');
            const secLinks   = [...wrapper.querySelectorAll('a[href]')]
              .filter(a => LIST_LINK_RE.test(a.getAttribute('href') || ''));
            const hasMismatch = secLinks.some(a => {
              const sib = a.nextElementSibling;
              return !sib || !sib.classList.contains('bb-glyph') || !sib.textContent.includes('✅');
            });

            if (active && !hasMismatch) {
              // Entire year section is all-green — hide h3 + wrapper.
              if (hasHeader) header.style.display = 'none';
              wrapper.style.display = 'none';
            } else {
              if (hasHeader) header.style.display = '';
              wrapper.style.display = '';
              // Hide individual ✅ rows within the visible section.
              for (const a of secLinks) {
                const sib     = a.nextElementSibling;
                const isMatch = sib && sib.classList.contains('bb-glyph') && sib.textContent.includes('✅');
                const row     = a.closest('li') || a.parentNode;
                if (row) row.style.display = active && isMatch ? 'none' : '';
              }
            }
          }
          filterBtn.textContent = active
            ? `⚡ All Events (${total})`
            : `⚡ Mismatches (${mismatchCount})`;
        };
      } else {
        // Full year pages: events are wrapped in .bb-section-processed divs.
        const allSections    = [...resultsEl.querySelectorAll('.bb-section-processed')];
        const mismatchCount  = allSections.filter(p =>
          [...p.querySelectorAll('.bb-glyph')].some(g =>
            ['❌', '⚠️', '❓'].some(ch => g.textContent.includes(ch))) ||
          !!p.querySelector('.bb-song-year-only, .bb-song-detail-only, .bb-song-char-diff, .bb-para-warn, .bb-anchor-warn')
        ).length;
        const total = allSections.length;
        filterBtn.textContent = `⚡ Mismatches (${mismatchCount})`;
        currentMismatchFn = active => {
          applyMismatchFilter(active);
          // Also hide entire year sections that contain no mismatches.
          for (const wrapper of resultsEl.querySelectorAll('.bb-year-wrapper')) {
            const header    = wrapper.previousElementSibling;
            const hasHeader = header && header.classList.contains('bb-year-header');
            const hasMismatch = [...wrapper.querySelectorAll('.bb-section-processed')].some(p =>
              [...p.querySelectorAll('.bb-glyph')].some(g =>
                ['❌', '⚠️', '❓'].some(ch => g.textContent.includes(ch))) ||
              !!p.querySelector('.bb-song-year-only, .bb-song-detail-only, .bb-song-char-diff, .bb-para-warn, .bb-anchor-warn')
            );
            if (active && !hasMismatch) {
              if (hasHeader) header.style.display = 'none';
              wrapper.style.display = 'none';
            } else {
              if (hasHeader) header.style.display = '';
              wrapper.style.display = '';
            }
          }
          filterBtn.textContent = active
            ? `⚡ All Events (${total})`
            : `⚡ Mismatches (${mismatchCount})`;
        };
      }
      homeSaveBtn.disabled = false;
    }

    fetchBtn.addEventListener('click', () => {
      if (fetching) {
        stopRequested = true;
        fetchBtn.textContent = '⏹ Stopping…';
        fetchBtn.disabled = true;
      } else {
        runFetch(fetchBtn, s => s);
      }
    });
    overviewBtn.addEventListener('click', () => {
      if (fetching) {
        stopRequested = true;
        overviewBtn.textContent = '⏹ Stopping…';
        overviewBtn.disabled = true;
      } else {
        runFetch(overviewBtn, s => `${s}-list`);
      }
    });
    homeLoadBtn.addEventListener('click', () =>
      triggerLoadCache(data => loadPageCache('home', resultsEl, progressEl, data))
    );
  }

  // Scans #page-content for links to YEAR-LIST pages (/YYYY-list, /1949-64-list)
  // and returns the corresponding YEAR page slugs in document order.
  function extractGigPageSlugs() {
    const seen  = new Set();
    const slugs = [];
    for (const a of document.querySelectorAll('#page-content a[href]')) {
      const href = a.getAttribute('href') || '';
      // Match /YYYY-list or /1949-64-list; longer alternative first to avoid
      // /1949-64-list matching only /1949 before the -64 part.
      const m = href.match(/^\/((?:\d{4}-\d{2}|\d{4}))-list$/);
      if (!m) continue;
      const slug = m[1];
      if (!seen.has(slug)) {
        seen.add(slug);
        slugs.push(slug);
      }
    }
    return slugs;
  }

  // Fetches one year page, runs the full consistency-check pipeline on it, and
  // appends a year header + processed content block to resultsEl.
  // All existing helpers (wrapYearSections, extractYearPageEvents, processYearEvents,
  // insertSectionToggle) work unchanged because the year content is injected into
  // the live home-page DOM before any helper is called.
  async function fetchAndProcessYear(slug, resultsEl, onProgress) {
    const url = `${location.protocol}//${location.host}/${slug}`;
    onProgress(`Fetching ${slug}…`);

    let yearDoc;
    try {
      yearDoc = await fetchPage(url);
    } catch (e) {
      logErr(`Failed to fetch ${slug}:`, e.message);
      const errEl = document.createElement('p');
      errEl.style.color = '#c00';
      errEl.textContent = `⚠️ ${slug}: ${e.message}`;
      resultsEl.appendChild(errEl);
      return;
    }

    const yearContent = yearDoc.querySelector('#page-content');
    if (!yearContent) {
      logWarn(`${slug}: no #page-content found in fetched document`);
      return;
    }

    // Year header: glyph (outside the link so clicks on the link navigate; clicks
    // elsewhere on the h3 collapse/expand) + link to the live year page.
    const header = document.createElement('h3');
    header.className = 'bb-year-header';
    const toggleGlyph = document.createElement('span');
    toggleGlyph.className = 'bb-year-toggle-glyph';
    toggleGlyph.textContent = '▼ ';
    const yearLink = document.createElement('a');
    yearLink.href = `/${slug}`;
    yearLink.target = '_blank';
    yearLink.textContent = slug;
    header.append(toggleGlyph, yearLink);
    resultsEl.appendChild(header);

    // Inject year-page markup into the live home-page DOM so that all
    // DOM helpers (addYearGlyph, renderYearSetlist, makeGlyphSpan, …) operate
    // on elements that belong to the current document.
    const wrapper = document.createElement('div');
    wrapper.className = 'bb-year-wrapper';
    wrapper.dataset.year = slug;
    wrapper.innerHTML = yearContent.innerHTML;

    // Remove per-year noise before injecting into the live DOM so it never
    // appears in the rendered output.
    stripYearWrapperNoise(wrapper, slug.endsWith('-list'));

    resultsEl.appendChild(wrapper);

    // Wire up collapse/expand behaviour now that both header and wrapper exist.
    setupYearHeaderToggle(header, toggleGlyph, wrapper, resultsEl);

    onProgress(`Processing ${slug}…`);

    if (slug.endsWith('-list')) {
      await fetchAndProcessListPage(slug.replace(/-list$/, ''), wrapper, onProgress);
    } else {
      const sections = wrapYearSections(wrapper);
      const events   = extractYearPageEvents(wrapper);
      log(`  ${slug}: ${events.length} event(s)`);
      if (events.length === 0) return;
      await processYearEvents(events, sections);
    }
  }

  /**
   * Runs the list-page glyph pipeline on an already-injected wrapper div.
   * Mirrors runListPage() but operates on a given container element instead
   * of document, so it works when the list page is fetched by the HOME page.
   * @param {string}      year      - Bare year slug (e.g. "1965" or "1949-64")
   * @param {HTMLElement} container - The bb-year-wrapper div containing the injected HTML
   * @param {function}    onProgress
   */
  async function fetchAndProcessListPage(year, container, onProgress) {
    const listEvents = extractListPageEvents(year, container);
    log(`  ${year}-list: ${listEvents.length} event link(s) in container`);
    if (listEvents.length === 0) return;

    onProgress(`Fetching YEAR page for ${year}…`);
    const yearPageUrl = `${location.protocol}//${location.host}/${year}`;
    let yearDoc;
    try {
      yearDoc = await fetchPage(yearPageUrl);
    } catch (e) {
      logErr(`Failed to fetch YEAR page for ${year}:`, e.message);
      listEvents.forEach(({ element }) =>
        addWarningGlyph(element, 'Could not fetch YEAR page: ' + e.message));
      return;
    }

    const anchorMap = buildAnchorToNameMap(yearDoc);
    log(`  ${year}-list: anchor map has ${anchorMap.size} entries`);
    listEvents.forEach(ev => processOneListEvent(ev, anchorMap, year));
  }

  /**
   * Makes a bb-year-header collapsible.
   * Single click on the h3 (outside the year link) toggles that year's wrapper.
   * Ctrl+click toggles ALL year wrappers together (collapse if any is open, expand if all closed).
   * @param {HTMLElement} headerEl   - The <h3> element
   * @param {HTMLElement} glyphEl    - The glyph <span> inside the header
   * @param {HTMLElement} wrapperEl  - The bb-year-wrapper to show/hide
   * @param {HTMLElement} resultsEl  - The container holding all year sections
   */
  function setupYearHeaderToggle(headerEl, glyphEl, wrapperEl, resultsEl) {
    /** Sync the header's tooltip to the wrapper's current visibility. */
    function syncTooltip(h, w) {
      const open = w.style.display !== 'none';
      h.title = open
        ? 'Click to collapse · Ctrl+click to collapse all'
        : 'Click to expand · Ctrl+click to expand all';
    }

    syncTooltip(headerEl, wrapperEl);

    headerEl.addEventListener('click', e => {
      // Let clicks on the year link navigate normally.
      if (e.target.closest('a')) return;
      e.preventDefault();

      if (e.ctrlKey) {
        // Collapse all if any wrapper is visible; otherwise expand all.
        const anyOpen = [...resultsEl.querySelectorAll('.bb-year-wrapper')]
          .some(w => w.style.display !== 'none');
        for (const h of resultsEl.querySelectorAll('h3.bb-year-header')) {
          const w = h.nextElementSibling;
          if (!w || !w.classList.contains('bb-year-wrapper')) continue;
          const g = h.querySelector('.bb-year-toggle-glyph');
          w.style.display  = anyOpen ? 'none' : '';
          if (g) g.textContent = anyOpen ? '▶ ' : '▼ ';
          syncTooltip(h, w);
        }
      } else {
        const collapsed         = wrapperEl.style.display === 'none';
        wrapperEl.style.display = collapsed ? '' : 'none';
        glyphEl.textContent     = collapsed ? '▼ ' : '▶ ';
        syncTooltip(headerEl, wrapperEl);
      }
    });
  }

  // Removes repeated per-year noise from a freshly-injected bb-year-wrapper.
  // isListPage=true  → /YYYY-list (overview) pages: events sit before or between
  //                    <hr> elements, so pre-<hr> content must NOT be bulk-removed;
  //                    only the jump-to-recent box is stripped instead.
  // isListPage=false → full year pages: everything before the first <hr> is noise
  //                    (year heading, icon legend, jump-to-recent box).
  // Both variants strip all nav paragraphs and the social-media icon div.
  function stripYearWrapperNoise(container, isListPage = false) {
    if (isListPage) {
      // Jump-to-most-recent paginator box.
      for (const el of [...container.querySelectorAll('.list-pages-box')]) el.remove();
      // Section headings (e.g. "<h1>1949-1964 listing by date / location</h1>").
      for (const el of [...container.querySelectorAll('h1')]) el.remove();
      // <hr> dividers — become doubled noise when injected into the HOME page.
      for (const el of [...container.querySelectorAll('hr')]) el.remove();
    } else {
      // Remove all direct children before the first <hr>.
      const firstHr = container.querySelector(':scope > hr');
      if (firstHr) {
        let node = container.firstChild;
        while (node && node !== firstHr) {
          const next = node.nextSibling;
          container.removeChild(node);
          node = next;
        }
      }
    }
    // Remove nav paragraphs: "< Previous | Listing | Next >" (year pages) and
    // "Earlier < Current > Next" (list pages, appear at both top and bottom).
    for (const el of [...container.querySelectorAll('p')]) {
      if (/Previous|Earlier/.test(el.textContent)) el.remove();
    }
    // Remove the social-media icon div.
    for (const el of [...container.querySelectorAll('div')]) {
      if (el.querySelector('a[href*="facebook"]')) { el.remove(); break; }
    }
  }

  /**
   * Builds SmartTable NormalizedRow[] from all loaded bb-year-wrapper divs.
   * Works for both full year wrappers (EVENT_URL_RE links) and list-page
   * wrappers (LIST_LINK_RE links).
   * @param {HTMLElement} resultsEl - The #bb-home-results container
   * @returns {object[]}
   */
  function extractHomeSmartTableRows(resultsEl) {
    const rows = [];
    for (const wrapper of resultsEl.querySelectorAll('.bb-year-wrapper')) {
      const slug    = wrapper.dataset.year || '';
      const yearStr = slug.replace(/-list$/, '');
      const isListW = slug.endsWith('-list');
      const linkRe  = isListW ? LIST_LINK_RE : EVENT_URL_RE;
      const year    = parseInt(yearStr, 10) || 0;

      for (const a of wrapper.querySelectorAll('a[href]')) {
        if (!linkRe.test(a.getAttribute('href') || '')) continue;

        // Glyph: skip bb-event-type span if present (year pages only).
        let sib = a.nextElementSibling;
        if (sib && sib.classList.contains('bb-event-type')) sib = sib.nextElementSibling;
        const status = (sib && sib.classList.contains('bb-glyph')) ? sib.textContent.trim() : '';

        let event = a.textContent.trim();
        let date;
        if (isListW) {
          // List pages: date is the leading "YYYY-MM-DD" in the link text.
          const m = event.match(/^(\d{4}-\d{2}-\d{2})\s*[-–]?\s*(.*)/s);
          date  = m ? m[1] : '';
          event = m ? m[2].trim() : event;
        } else {
          // Year pages: date is in the href.
          const m = (a.getAttribute('href') || '').match(/(\d{4}-\d{2}-\d{2})/);
          date = m ? m[1] : '';
          // Strip the "YYYY-MM-DD - " prefix from the visible event name.
          const t = event.match(/^\d{4}-\d{2}-\d{2}\s*[-–]?\s*(.*)/s);
          if (t) event = t[1].trim();
        }

        rows.push({ year, date, status, event, url: a.href || '' });
      }
    }
    return rows;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // YEAR PAGE MODE
  // ════════════════════════════════════════════════════════════════════════════

  async function runYearPage() {
    const content = document.querySelector('#page-content') || document.body;
    const originalHtml = content.innerHTML;
    _savedOriginalHtml = originalHtml;

    // Must run before wrapYearSections() wraps direct children into
    // .bb-section-processed divs — _splitOnHr() in the adapter iterates
    // content.children looking for <HR> direct children.
    const HAS_ST = typeof SmartTable !== 'undefined' && typeof BrucebaseAdapter !== 'undefined';
    const stRows = HAS_ST ? BrucebaseAdapter.extract() : null;

    hideJumpToRecentBox(content);

    const sections = wrapYearSections(content);
    log(`Wrapped ${sections.length} year section(s) for toggling`);

    const events = extractYearPageEvents(content);
    log(`Found ${events.length} event link(s)`);
    if (events.length === 0) {
      logWarn('No event links found — check selector / page structure');
      return;
    }

    // ── Button container — shown immediately, disabled until processing is done ──
    const pageTitle = document.getElementById('page-title');
    const btnContainer = document.createElement('div');
    btnContainer.id = 'bb-btn-container';

    // Use let so the click handler can clone-replace buttons on restart to strip stale listeners.
    let globalBtn = document.createElement('button');
    globalBtn.id = 'bb-global-toggle';
    globalBtn.className = 'bb-toggle-btn';
    globalBtn.textContent = '⇄ Original Page';
    globalBtn.title = 'Toggle between the original unprocessed page and the annotated processed view';
    globalBtn.disabled = true;

    let mismatchBtn = document.createElement('button');
    mismatchBtn.id = 'bb-mismatch-toggle';
    mismatchBtn.className = 'bb-toggle-btn';
    mismatchBtn.textContent = '⚡ Mismatches';
    mismatchBtn.title = 'Filter to show only events with name or setlist mismatches';
    mismatchBtn.disabled = true;

    const [yearSaveBtn, yearLoadBtn] = makeSaveLoadBtns(
      'year', () => content, () => _savedOriginalHtml
    );
    yearLoadBtn.addEventListener('click', () =>
      triggerLoadCache(data => loadPageCache('year', content, progressEl, data))
    );

    const yearStartBtn = document.createElement('button');
    yearStartBtn.className = 'bb-toggle-btn';
    yearStartBtn.textContent = '▶ Start';
    yearStartBtn.title = 'Start processing all events on this page';

    btnContainer.append(yearStartBtn, yearSaveBtn, yearLoadBtn, globalBtn, mismatchBtn);

    // ── SmartTable integration (optional) ────────────────────────────────────
    if (stRows) {
      const stHost = document.createElement('div');
      stHost.id = 'bb-smarttable-host';
      // Place before #page-content so the rendered table appears between the
      // sticky bar and the event list when the trigger button is clicked.
      content.parentNode.insertBefore(stHost, content);

      SmartTable.render({
        columns:   BrucebaseAdapter.columnDefs,
        rows:      stRows,
        container: stHost,
        options:   { stickyOffset: 'calc(var(--bb-header-h) + var(--bb-sticky-bar-h))' },
      });

      // Move the trigger button into our button bar. The SmartTable click
      // handler still targets stHost, so the table renders in the right place.
      const stBtn = stHost.querySelector('.st-btn-trigger');
      if (stBtn) {
        stBtn.title = 'Toggle the SmartTable view for sorting and filtering events';
        btnContainer.appendChild(stBtn);
      }
    }

    // ── Processing indicator ─────────────────────────────────────────────────
    const progressEl = document.createElement('p');
    progressEl.id = 'bb-year-progress';
    const timerSpan = document.createElement('span');
    timerSpan.id = 'bb-year-timer';
    timerSpan.textContent = '00:00';
    progressEl.append(timerSpan, ' … Ready — click ▶ Start to process, or 📂 Load from cache');

    // Wrap buttons and progress in a single flex row, then build sticky bar.
    const controlsEl = document.createElement('div');
    controlsEl.id = 'bb-controls';
    controlsEl.append(btnContainer, progressEl);

    setupStickyBar(content, pageTitle, controlsEl);

    // ── Start/Stop toggle ────────────────────────────────────────────────────
    let _yearProcessing = false;
    let _yearStopRequested = false;

    yearStartBtn.addEventListener('click', async () => {
      if (_yearProcessing) {
        _yearStopRequested = true;
        yearStartBtn.textContent = '⏹ Stopping…';
        yearStartBtn.disabled = true;
        return;
      }
      _yearProcessing = true;
      _yearStopRequested = false;
      yearStartBtn.textContent = '⏹ Stop';
      yearStartBtn.title = 'Abort processing after the current batch completes';

      // ── Restore DOM before each run to prevent duplicate annotations ───────
      // Remove artifacts inserted by the previous run.
      document.getElementById('bb-page-original')?.remove();
      content.querySelectorAll('.bb-section-controls, .bb-section-original').forEach(el => el.remove());
      for (const sec of sections) {
        sec.processedDiv.innerHTML = sec.sectionOriginalHtml;
        sec.toggleInserted = false;
      }

      // Clone-replace toggle buttons to strip stale click listeners from prior runs.
      const freshGlobal = globalBtn.cloneNode(true);
      freshGlobal.disabled = true;
      globalBtn.replaceWith(freshGlobal);
      globalBtn = freshGlobal;

      const freshMismatch = mismatchBtn.cloneNode(true);
      freshMismatch.disabled = true;
      mismatchBtn.replaceWith(freshMismatch);
      mismatchBtn = freshMismatch;

      yearSaveBtn.disabled = true;

      // Re-extract events from the now-clean DOM.
      const currentEvents = extractYearPageEvents(content);
      log(`Found ${currentEvents.length} event link(s)`);
      if (currentEvents.length === 0) {
        logWarn('No event links found — check selector / page structure');
        progressEl.replaceChildren(timerSpan, ' ... No events found on this page');
        _yearProcessing = false;
        yearStartBtn.textContent = '▶ Start';
        yearStartBtn.title = 'Start processing all events on this page';
        yearStartBtn.disabled = false;
        return;
      }

      const startTime = Date.now();
      timerSpan.textContent = '00:00';
      const timerId = setInterval(() => {
        timerSpan.textContent = fmtElapsed(Date.now() - startTime);
      }, 1000);

      await processYearEvents(currentEvents, sections, (idx, name, total) => {
        progressEl.replaceChildren(
          timerSpan,
          ` ... Processing event "${String(idx).padStart(3, '0')} / ${total}: ${name}"`
        );
      }, () => _yearStopRequested);

      clearInterval(timerId);
      timerSpan.textContent = fmtElapsed(Date.now() - startTime);
      const wasStopped = _yearStopRequested;
      progressEl.replaceChildren(timerSpan, wasStopped
        ? ` ... Stopped — partial results shown`
        : ` ... Done — ${currentEvents.length} events processed`);

      setupGlobalToggle(globalBtn, content, originalHtml);
      setupMismatchFilter(mismatchBtn, currentEvents.length);
      globalBtn.disabled = false;
      mismatchBtn.disabled = false;
      yearSaveBtn.disabled = false;

      _yearProcessing = false;
      yearStartBtn.textContent = '▶ Start';
      yearStartBtn.title = wasStopped
        ? 'Start processing all events on this page'
        : 'Re-run processing (resets current annotations)';
      yearStartBtn.disabled = false;
      log(wasStopped ? 'Processing stopped by user' : 'All events processed');
    });
  }

  // Hides the "Jump to most recent show/event" navigation box injected by wikidot
  // at the top of YEAR pages — it's not useful when the script renders its own UI.
  function hideJumpToRecentBox(content) {
    for (const box of content.querySelectorAll('.list-pages-box')) {
      if (box.textContent.includes('most recent')) {
        box.remove();
        break;
      }
    }
  }

  // Builds the sticky header band for YEAR pages.
  // Inserts #bb-sticky-bar where #page-title used to be, hides #page-title
  // (the year number is already present in #bb-pre-events), and moves all
  // #page-content nodes before the first <hr> into #bb-pre-events.
  // Also measures #header height and stores it as --bb-header-h for CSS.
  function setupStickyBar(content, pageTitle, controlsEl) {
    const stickyBar = document.createElement('div');
    stickyBar.id = 'bb-sticky-bar';

    if (pageTitle && pageTitle.parentNode) {
      pageTitle.parentNode.insertBefore(stickyBar, pageTitle);
      // The year number is already rendered in #bb-pre-events — hide the
      // duplicate #page-title h1 so it doesn't take up space in the sticky bar.
      pageTitle.style.display = 'none';
    }
    stickyBar.append(controlsEl);

    // Collect all direct children of #page-content before the first <hr>
    // (icon legend table, year heading, jump-to-recent box, etc.) and move
    // them into the sticky bar so they scroll with the pinned header band.
    const firstHr = content.querySelector(':scope > hr');
    if (firstHr) {
      const preHrNodes = [];
      for (let n = content.firstChild; n && n !== firstHr; n = n.nextSibling) {
        preHrNodes.push(n);
      }
      if (preHrNodes.length) {
        const preEventsDiv = document.createElement('div');
        preEventsDiv.id = 'bb-pre-events';
        preHrNodes.forEach(n => preEventsDiv.appendChild(n));
        // Remove <br> elements — they only add wasteful vertical space in the
        // compact sticky bar (e.g. the <br>2012<br> inside the year heading).
        for (const br of [...preEventsDiv.querySelectorAll('br')]) br.remove();
        stickyBar.appendChild(preEventsDiv);
      }
    }

    const headerEl = document.getElementById('header');
    if (headerEl) {
      const h = Math.round(headerEl.getBoundingClientRect().height);
      document.documentElement.style.setProperty('--bb-header-h', `${h}px`);
    }
    document.documentElement.style.setProperty('--bb-sticky-bar-h', `${stickyBar.offsetHeight}px`);
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

  // Wires up the pre-existing #bb-global-toggle button.
  // Creates the hidden original-view div beside #page-content so that all event
  // listeners on the processed content survive toggling.
  function setupGlobalToggle(btn, content, originalHtml) {
    const originalEl = document.createElement('div');
    originalEl.id = 'bb-page-original';
    originalEl.innerHTML = originalHtml;
    originalEl.style.display = 'none';
    content.parentNode.insertBefore(originalEl, content.nextSibling);

    let showingOriginal = false;
    btn.addEventListener('click', () => {
      showingOriginal = !showingOriginal;
      content.style.display    = showingOriginal ? 'none'  : 'block';
      originalEl.style.display = showingOriginal ? 'block' : 'none';
      btn.textContent = showingOriginal ? '⇄ Processed Page' : '⇄ Original Page';
    });
  }

  // ── Save / Load cache helpers ─────────────────────────────────────────────

  /**
   * Downloads the fully-processed page state as a JSON cache file.
   * Uses a Blob + temporary <a download> — no new @grant needed.
   * @param {string} pageType
   * @param {HTMLElement} contentEl
   * @param {string} originalHtml
   */
  function savePageCache(pageType, contentEl, originalHtml) {
    const data = {
      schemaVersion: 1,
      pageType,
      url:           location.href,
      pageTitle:     document.getElementById('page-title')?.textContent.trim() ?? '',
      timestamp:     new Date().toISOString(),
      processedHtml: contentEl.innerHTML,
      originalHtml:  originalHtml ?? '',
    };
    const blob      = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const blobUrl   = URL.createObjectURL(blob);
    const rawTitle  = data.pageTitle || location.pathname.replace(/\//g, '-').replace(/^-/, '');
    const safeTitle = rawTitle.replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+$/g, '');
    const a         = document.createElement('a');
    a.download      = `bb-${pageType.toUpperCase()}-${safeTitle}.json`;
    a.href          = blobUrl;
    a.click();
    URL.revokeObjectURL(blobUrl);
  }

  /**
   * Opens a native file picker and calls onLoaded with the parsed JSON data.
   * @param {function(Object): void} onLoaded
   */
  function triggerLoadCache(onLoaded) {
    const input  = document.createElement('input');
    input.type   = 'file';
    input.accept = '.json';
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const data = JSON.parse(e.target.result);
          if (data.schemaVersion !== 1) throw new Error('Unsupported schema version');
          onLoaded(data);
        } catch (err) {
          logWarn(`Load cache failed: ${err.message}`);
          alert(`Could not load cache file: ${err.message}`);
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  /**
   * Creates a [saveBtn, loadBtn] pair pre-wired with the save handler.
   * The loadBtn click handler must be added by the caller.
   * Both use getContentEl() / getOriginalHtml() lazily at click time.
   * @param {string} pageType
   * @param {function(): HTMLElement} getContentEl
   * @param {function(): string} getOriginalHtml
   * @returns {[HTMLButtonElement, HTMLButtonElement]}
   */
  function makeSaveLoadBtns(pageType, getContentEl, getOriginalHtml) {
    const saveBtn = document.createElement('button');
    saveBtn.id        = 'bb-save-btn';
    saveBtn.className = 'bb-toggle-btn';
    saveBtn.textContent = '💾 Save';
    saveBtn.title     = 'Save the processed page to a JSON cache file for offline use';
    saveBtn.disabled  = true;

    const loadBtn = document.createElement('button');
    loadBtn.id        = 'bb-load-btn';
    loadBtn.className = 'bb-toggle-btn';
    loadBtn.textContent = '📂 Load';
    loadBtn.title     = 'Load a previously saved JSON cache file to restore the processed view';

    saveBtn.addEventListener('click', () =>
      savePageCache(pageType, getContentEl(), getOriginalHtml())
    );

    return [saveBtn, loadBtn];
  }

  /**
   * Injects saved HTML into contentEl and re-wires all recoverable listeners.
   * @param {string} pageType
   * @param {HTMLElement} contentEl
   * @param {HTMLElement|null} progressEl
   * @param {Object} data
   */
  function loadPageCache(pageType, contentEl, progressEl, data) {
    contentEl.innerHTML = data.processedHtml;

    rewireLoadedPage(contentEl, pageType);

    // Global toggle
    const oldGlobal = document.getElementById('bb-global-toggle');
    if (oldGlobal) {
      if (pageType === 'detail') {
        rewireDetailToggle(contentEl);
      } else {
        document.getElementById('bb-page-original')?.remove();
        const freshGlobal = oldGlobal.cloneNode(true);
        freshGlobal.textContent = '⇄ Original Page';
        freshGlobal.disabled = false;
        oldGlobal.replaceWith(freshGlobal);
        setupGlobalToggle(freshGlobal, contentEl, data.originalHtml);
      }
    }

    // Mismatch filter (YEAR / LIST only; HOME relies on runtime state)
    const oldMismatch = document.getElementById('bb-mismatch-toggle');
    if (oldMismatch && pageType !== 'home' && pageType !== 'detail') {
      const freshMismatch = oldMismatch.cloneNode(true);
      oldMismatch.replaceWith(freshMismatch);
      if (pageType === 'year') {
        const eventCount = contentEl.querySelectorAll('.bb-section-processed').length;
        setupMismatchFilter(freshMismatch, eventCount);
      } else if (pageType === 'list') {
        const listEvs = [...contentEl.querySelectorAll('a[href]')]
          .filter(a => LIST_LINK_RE.test(a.getAttribute('href') || ''))
          .map(a => ({ element: a }));
        setupListMismatchFilter(freshMismatch, listEvs);
      }
      freshMismatch.disabled = false;
    }

    // Enable save button
    const saveBtn = document.getElementById('bb-save-btn');
    if (saveBtn) saveBtn.disabled = false;

    // Update progress bar
    if (progressEl) {
      const ts        = new Date(data.timestamp).toLocaleString();
      const timerSpan = document.getElementById('bb-year-timer');
      progressEl.replaceChildren(timerSpan ?? '', ` … Loaded from cache (saved ${ts})`);
    }
  }

  /**
   * Re-wires all event listeners recoverable from DOM state after a cache load.
   * @param {HTMLElement} container
   * @param {string} pageType
   */
  function rewireLoadedPage(container, pageType) {
    container.querySelectorAll(
      '.bb-song-year-only, .bb-song-detail-only, .bb-song-char-diff'
    ).forEach(span => {
      span.addEventListener('mouseenter', e => showSongTooltip(e, span));
      span.addEventListener('mouseleave', hideTooltip);
    });

    container.querySelectorAll('[data-msg]').forEach(el => {
      el.addEventListener('mouseenter', e => showErrorTooltip(e, el.dataset.msg));
      el.addEventListener('mouseleave', hideTooltip);
    });

    if (pageType === 'year' || pageType === 'home') {
      rewireSectionControls(container);
    }

    container.querySelectorAll('.bb-section-processed').forEach(section =>
      addCacheRetryBtn(section)
    );
  }

  /**
   * Re-creates showView closures for per-section ⇄ Original and ☰ List buttons
   * by scanning .bb-section-controls and their siblings in the saved DOM.
   * @param {HTMLElement} container
   */
  function rewireSectionControls(container) {
    container.querySelectorAll('.bb-section-controls').forEach(controls => {
      const origBtnOld = controls.querySelector('.bb-section-toggle');
      const listBtnOld = controls.querySelector('.bb-list-toggle');
      if (!origBtnOld || !listBtnOld) return;

      const origBtn = origBtnOld.cloneNode(true);
      const listBtn = listBtnOld.cloneNode(true);
      origBtnOld.replaceWith(origBtn);
      listBtnOld.replaceWith(listBtn);

      let el = controls.nextElementSibling;
      let originalDiv = null, processedDiv = null;
      while (el) {
        if (el.classList.contains('bb-section-original'))  originalDiv  = el;
        if (el.classList.contains('bb-section-processed')) { processedDiv = el; break; }
        el = el.nextElementSibling;
      }
      if (!processedDiv) return;

      let listDiv = null, setlistEls = null, viewState = 'flat';

      function showView(view) {
        viewState = view;
        processedDiv.style.display = view === 'original' ? 'none' : '';
        if (originalDiv) originalDiv.style.display = view === 'original' ? '' : 'none';
        if (listDiv) {
          listDiv.style.display = view === 'list' ? '' : 'none';
          setlistEls?.forEach(s => { s.style.display = view === 'list' ? 'none' : ''; });
        }
        origBtn.textContent = view === 'original' ? '⇄ Processed' : '⇄ Original';
        listBtn.textContent = view === 'list'      ? '☰ Flat'      : '☰ List';
      }

      origBtn.addEventListener('click', () =>
        showView(viewState === 'original' ? 'flat' : 'original')
      );
      listBtn.addEventListener('click', () => {
        if (viewState === 'list') { showView('flat'); return; }
        if (!listDiv) {
          setlistEls = [...processedDiv.querySelectorAll('p, blockquote')].filter(el =>
            el.querySelector('.bb-sep, .bb-song-match, .bb-song-year-only, .bb-song-detail-only, .bb-song-char-diff')
          );
          if (!setlistEls.length) return;
          listDiv = buildListDiv(setlistEls, processedDiv);
          setlistEls[0].parentNode.insertBefore(listDiv, setlistEls[0]);
        }
        showView('list');
      });
    });
  }

  /**
   * Re-wires the DETAIL page global toggle using the .bb-detail-processed /
   * .bb-detail-original divs inside the setlist container after a cache load.
   * @param {HTMLElement} td
   */
  function rewireDetailToggle(td) {
    const btn = document.getElementById('bb-global-toggle');
    if (!btn) return;
    const processedDiv = td.querySelector('.bb-detail-processed');
    const originalDiv  = td.querySelector('.bb-detail-original');
    if (!processedDiv || !originalDiv) return;

    const freshBtn = btn.cloneNode(true);
    freshBtn.textContent = '⇄ Original Page';
    freshBtn.disabled = false;
    btn.replaceWith(freshBtn);

    let showingOriginal = false;
    freshBtn.addEventListener('click', () => {
      showingOriginal = !showingOriginal;
      processedDiv.style.display = showingOriginal ? 'none'  : 'block';
      originalDiv.style.display  = showingOriginal ? 'block' : 'none';
      freshBtn.textContent = showingOriginal ? '⇄ Processed Page' : '⇄ Original Page';
    });
  }

  /**
   * Adds a ⟳ button to a .bb-section-processed div that refetches the event's
   * DETAIL page to restore icon panels and tab buttons after a cache load.
   * Icons and tab buttons are dimmed until the refetch completes.
   * @param {HTMLElement} section
   */
  function addCacheRetryBtn(section) {
    const eventLink = [...section.querySelectorAll('a[href]')]
      .find(a => EVENT_URL_RE.test(a.getAttribute('href') || ''));
    if (!eventLink) return;

    section.querySelectorAll('img.image').forEach(img => { img.style.opacity = '0.45'; });
    section.querySelectorAll('.bb-event-tab-btn').forEach(b => {
      b.style.opacity      = '0.45';
      b.style.pointerEvents = 'none';
    });

    const retryBtn = document.createElement('button');
    retryBtn.className   = 'bb-toggle-btn bb-cache-retry';
    retryBtn.textContent = '⟳';
    retryBtn.title =
      'Refetch DETAIL page to restore icon panels and tab buttons\n' +
      `(${location.protocol}//${location.host}${eventLink.getAttribute('href')})`;

    retryBtn.addEventListener('click', async () => {
      retryBtn.textContent = '⏳';
      retryBtn.disabled    = true;
      try {
        const url = `${location.protocol}//${location.host}${eventLink.getAttribute('href')}`;
        const doc = await fetchPage(url);

        section.querySelectorAll('img.image').forEach(img => { img.style.opacity = ''; });
        section.querySelector('.bb-event-tab-row')?.remove();
        section.querySelectorAll('.bb-icon-sorry').forEach(s => s.remove());

        wireIconHandlers(eventLink, doc);
        retryBtn.remove();
      } catch (e) {
        retryBtn.textContent = '⟳';
        retryBtn.disabled    = false;
        retryBtn.title       = `Refetch failed: ${e.message} — click to retry`;
      }
    });

    const tabRow    = section.querySelector('.bb-event-tab-row');
    const firstIcon = section.querySelector('img.image');
    if (tabRow)          tabRow.prepend(retryBtn);
    else if (firstIcon)  firstIcon.before(retryBtn);
    else                 section.appendChild(retryBtn);
  }

  // ── End Save / Load cache helpers ─────────────────────────────────────────

  // Inserts two per-section toggle buttons (wrapped in .bb-section-controls)
  // immediately after the given <hr>.  The original-view div is created here
  // (after processing) so that extractYearPageEvents never encounters duplicate
  // <a> links inside it.
  //
  // Three mutually exclusive views:
  //   'flat'     — default: processedDiv fully visible
  //   'original' — pre-processing snapshot: processedDiv hidden, originalDiv shown
  //   'list'     — processedDiv stays visible; only the flat setlist <p>/<blockquote>
  //                elements are hidden in place and replaced by an <ol> view inserted
  //                directly inside processedDiv before the first setlist element.
  //                Everything else (title, scheduled block, icons, descriptive text)
  //                remains visible and unchanged.
  function insertSectionToggle(hr, processedDiv, sectionOriginalHtml) {
    const originalDiv = document.createElement('div');
    originalDiv.className = 'bb-section-original';
    originalDiv.innerHTML = sectionOriginalHtml;
    originalDiv.style.display = 'none';
    processedDiv.parentNode.insertBefore(originalDiv, processedDiv);

    let listDiv    = null;   // built lazily inside processedDiv
    let setlistEls = null;   // the <p>/<blockquote> elements replaced in list mode
    let viewState  = 'flat';

    const origBtn = document.createElement('button');
    origBtn.className = 'bb-toggle-btn bb-section-toggle';
    origBtn.textContent = '⇄ Original';
    origBtn.title = 'Toggle between original and processed view for this event';

    const listBtn = document.createElement('button');
    listBtn.className = 'bb-toggle-btn bb-list-toggle';
    listBtn.textContent = '☰ List';
    listBtn.title = 'Toggle between flat paragraph view and numbered list view for this setlist';

    function showView(view) {
      viewState = view;
      // Only the original toggle hides the whole processedDiv.
      processedDiv.style.display = view === 'original' ? 'none' : '';
      originalDiv.style.display  = view === 'original' ? '' : 'none';
      // The list toggle swaps only the setlist elements inside processedDiv.
      if (listDiv) {
        listDiv.style.display = view === 'list' ? '' : 'none';
        setlistEls.forEach(el => { el.style.display = view === 'list' ? 'none' : ''; });
      }
      origBtn.textContent = view === 'original' ? '⇄ Processed' : '⇄ Original';
      listBtn.textContent = view === 'list'     ? '☰ Flat'      : '☰ List';
    }

    origBtn.addEventListener('click', () => {
      showView(viewState === 'original' ? 'flat' : 'original');
    });

    listBtn.addEventListener('click', () => {
      if (viewState === 'list') {
        showView('flat');
      } else {
        if (!listDiv) {
          setlistEls = [...processedDiv.querySelectorAll('p, blockquote')].filter(el =>
            el.querySelector('.bb-sep, .bb-song-match, .bb-song-year-only, .bb-song-detail-only, .bb-song-char-diff')
          );
          if (setlistEls.length === 0) return;  // nothing to list-ify
          listDiv = buildListDiv(setlistEls, processedDiv);
          setlistEls[0].parentNode.insertBefore(listDiv, setlistEls[0]);
        }
        showView('list');
      }
    });

    const controls = document.createElement('div');
    controls.className = 'bb-section-controls';
    controls.append(origBtn, listBtn);
    hr.after(controls);
  }

  // Builds an ordered-list view from an array of setlist <p>/<blockquote> elements.
  // The returned div is inserted INSIDE processedDiv before the first setlist element,
  // so the event title, scheduled block, icons, and descriptive text remain visible.
  // Each source element contributes:
  //   - a label paragraph (from .bb-section-label/.bb-section-label-warn nodes)
  //   - an <ol> with one <li> per song (nodes split on .bb-sep spans)
  // Song colouring, <a href> links, and ⚠️ spans are preserved; tooltips re-wired.
  // Numbers are custom <a>/<span> elements so the number itself can be a clickable
  // link that fetches the song page and appends a bb-song-tab-row to section.
  function buildListDiv(setlistEls, section) {
    const div = document.createElement('div');
    div.className = 'bb-section-list';
    div.style.display = 'none';
    div.appendChild(document.createElement('br'));

    for (const el of setlistEls) {
      let labelHtml = '';
      const groups  = [[]];   // array of HTML-string arrays, split on .bb-sep

      for (const node of el.childNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.classList.contains('bb-section-label') ||
              node.classList.contains('bb-section-label-warn')) {
            labelHtml += node.outerHTML;
          } else if (node.classList.contains('bb-sep')) {
            groups.push([]);
          } else {
            groups[groups.length - 1].push(node.outerHTML);
          }
        } else if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent;
          if (text.trim()) groups[groups.length - 1].push(esc(text));
        }
      }

      const labelP = document.createElement('p');
      labelP.className = 'bb-list-label';
      if (labelHtml) {
        labelP.innerHTML = labelHtml;
      } else {
        const syntheticSpan = document.createElement('span');
        syntheticSpan.className = 'bb-section-label';
        syntheticSpan.textContent = el.tagName === 'BLOCKQUOTE' ? 'Recordings:' : 'Show:';
        labelP.appendChild(syntheticSpan);
      }
      div.appendChild(labelP);

      const validGroups = groups.filter(g => g.join('').trim());
      if (validGroups.length > 0) {
        const ol = document.createElement('ol');
        ol.className = 'bb-list-view';
        let itemNum = 0;
        for (const group of validGroups) {
          itemNum++;
          const li = document.createElement('li');
          li.innerHTML = group.join('');

          // The flat-view renderer (renderSetlistElement) already injects bb-song-num
          // elements into each processed <p>/<blockquote>. Strip them before we
          // prepend the list-view's own number to avoid duplicates.
          li.querySelectorAll('a.bb-song-num, span.bb-song-num-plain').forEach(el => el.remove());

          // Prepend clickable number if a /song: link exists, else plain number.
          const songAnchor = li.querySelector('a[href^="/song:"]');
          const songHref   = songAnchor?.getAttribute('href') ?? null;
          const songName   = songAnchor?.textContent.trim() ?? '';

          if (songHref && section) {
            const numLink = document.createElement('a');
            numLink.href      = songHref;
            numLink.className = 'bb-song-num';
            numLink.textContent = `${itemNum}.`;
            numLink.title = `${songName} — click to load song page tabs`;
            numLink.addEventListener('click', e => {
              e.preventDefault();
              fetchAndToggleSongTabRow(songHref, songName, section, numLink);
            });
            li.prepend(numLink);
          } else {
            const numSpan = document.createElement('span');
            numSpan.className   = 'bb-song-num-plain';
            numSpan.textContent = `${itemNum}.`;
            li.prepend(numSpan);
          }

          ol.appendChild(li);
        }
        div.appendChild(ol);
      }
    }

    // Re-wire tooltip listeners so the list view is fully interactive.
    div.querySelectorAll('.bb-song-year-only, .bb-song-detail-only, .bb-song-char-diff').forEach(span => {
      span.addEventListener('mouseenter', e => showSongTooltip(e, span));
      span.addEventListener('mouseleave', hideTooltip);
    });
    div.querySelectorAll('.bb-para-warn').forEach(span => {
      span.addEventListener('mouseenter', e => showErrorTooltip(e, span.dataset.msg));
      span.addEventListener('mouseleave', hideTooltip);
    });

    return div;
  }

  // Wires up the pre-existing #bb-mismatch-toggle button.
  // When active, hides every event block that has no name mismatch, no setlist
  // discrepancy, and no ⚠️/❓ warning so only problem events remain visible.
  // Counts are computed once (all processing is done by the time this is called)
  // and embedded in the button label.
  // eventCount must be passed as events.length — sections.length overcounts because
  // trailing non-event sections (page navigation, footer) are also wrapped as
  // .bb-section-processed by wrapYearSections.
  function setupMismatchFilter(btn, eventCount) {
    const sections = [...document.querySelectorAll('.bb-section-processed')];
    const totalEvents = eventCount;
    const mismatchCount = sections.filter(div =>
      [...div.querySelectorAll('.bb-glyph')].some(g => ['❌', '⚠️', '❓'].some(ch => g.textContent.includes(ch))) ||
      !!div.querySelector('.bb-song-year-only, .bb-song-detail-only, .bb-song-char-diff, .bb-para-warn, .bb-anchor-warn')
    ).length;

    btn.textContent = `⚡ Mismatches (${mismatchCount})`;

    let filterActive = false;
    btn.addEventListener('click', () => {
      filterActive = !filterActive;
      btn.textContent = filterActive
        ? `⚡ All Events (${totalEvents})`
        : `⚡ Mismatches (${mismatchCount})`;
      applyMismatchFilter(filterActive);
    });
  }

  // Mismatch filter for YEAR OVERVIEW (list) pages.
  // Events are plain links in the page rather than .bb-section-processed divs,
  // so we hide/show the nearest block ancestor (li, tr, or parentNode).
  function setupListMismatchFilter(btn, listEvents) {
    const mismatchCount = listEvents.filter(({ element }) => {
      const sib = element.nextElementSibling;
      return !sib || !sib.classList.contains('bb-glyph') || !sib.textContent.includes('✅');
    }).length;

    btn.textContent = `⚡ Mismatches (${mismatchCount})`;

    let filterActive = false;
    btn.addEventListener('click', () => {
      filterActive = !filterActive;
      btn.textContent = filterActive
        ? `⚡ All Events (${listEvents.length})`
        : `⚡ Mismatches (${mismatchCount})`;
      for (const { element } of listEvents) {
        const sib     = element.nextElementSibling;
        const isMatch = sib && sib.classList.contains('bb-glyph') && sib.textContent.includes('✅');
        const row     = element.closest('li, tr') || element.parentNode;
        if (row) row.style.display = filterActive && isMatch ? 'none' : '';
      }
    });
  }

  // Shows or hides event blocks on YEAR pages.
  // Each .bb-section-processed div wraps exactly one event (the content between
  // two <hr> separators).  We also hide/restore the <hr> and section-toggle button
  // that precede it so the page doesn't show orphaned separators.
  // A block is a mismatch when it contains:
  //   - a .bb-glyph with ❌, ⚠️, or ❓
  //   - a .bb-song-year-only, .bb-song-detail-only, .bb-song-char-diff, or .bb-para-warn span
  function applyMismatchFilter(active) {
    for (const processedDiv of document.querySelectorAll('.bb-section-processed')) {
      const hasMismatch =
        [...processedDiv.querySelectorAll('.bb-glyph')]
          .some(g => ['❌', '⚠️', '❓'].some(ch => g.textContent.includes(ch))) ||
        !!processedDiv.querySelector(
          '.bb-song-year-only, .bb-song-detail-only, .bb-song-char-diff, .bb-para-warn, .bb-anchor-warn'
        );

      const hide = active && !hasMismatch;
      processedDiv.style.display = hide ? 'none' : '';

      // Walk backward: [<hr>] [.bb-section-controls] [.bb-section-original] [processedDiv]
      // bb-section-original has its own independent display state — skip without toggling.
      // bb-section-list lives inside processedDiv and is hidden with it automatically.
      let el = processedDiv.previousElementSibling;
      if (el && el.classList.contains('bb-section-original')) el = el.previousElementSibling;
      if (el && el.classList.contains('bb-section-controls')) { el.style.display = hide ? 'none' : ''; el = el.previousElementSibling; }
      if (el && el.tagName === 'HR')                          { el.style.display = hide ? 'none' : ''; }
    }
  }

  // Wraps the processed td children and an original snapshot in show/hide divs,
  // then prepends the ⇄ Original Page button to the existing #bb-btn-container.
  // The container is created earlier in runDetailPage so Load works immediately.
  function insertDetailToggle(originalTdHtml) {
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
    btn.textContent = '⇄ Original Page';
    btn.title = 'Toggle between the original unprocessed setlist and the annotated processed view';

    let showingOriginal = false;
    btn.addEventListener('click', () => {
      showingOriginal = !showingOriginal;
      processedDiv.style.display = showingOriginal ? 'none'  : 'block';
      originalDiv.style.display  = showingOriginal ? 'block' : 'none';
      btn.textContent = showingOriginal ? '⇄ Processed Page' : '⇄ Original Page';
      // Hide all script-added annotation artefacts outside the setlist tab when
      // showing original, restore them when switching back to processed view.
      document.body.classList.toggle('bb-original-view', showingOriginal);
    });

    // Prepend to existing #bb-btn-container created in runDetailPage.
    document.getElementById('bb-btn-container')?.prepend(btn);
  }

  // Annotates the "Setlist" tab in the wikidot navigation regardless of whether
  // it is currently selected: green inline style when everything matches, ⚠️ appended
  // when any name or setlist mismatch is detected.
  function annotateSetlistTab(nameMatch, hasSetlist) {
    // Find the <em> whose text is exactly "Setlist" — works whether the tab is
    // active/selected or not (li[title="active"] only exists for the current tab).
    const em = [...document.querySelectorAll('li em')]
      .find(el => /^\s*setlist\s*$/i.test(el.textContent));
    if (!em) return;
    const hasSetlistMismatch = hasSetlist && !!document.querySelector(
      '.bb-song-year-only, .bb-song-detail-only, .bb-song-char-diff, .bb-section-label-warn'
    );
    if (!nameMatch || hasSetlistMismatch) {
      const warnSpan = document.createElement('span');
      warnSpan.className = 'bb-setlist-tab-ann';
      warnSpan.textContent = ' ⚠️';
      em.appendChild(warnSpan);
    } else {
      // Class-based so the toggle can revert it without touching inline styles.
      em.classList.add('bb-setlist-tab-match');
    }
  }

  function extractYearPageEvents(content) {
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

      // Prose paragraphs can contain links to other events (e.g. "1993 speech").
      // Only treat a link as an event heading if its text starts with YYYY-MM-DD.
      if (!/^\d{4}-\d{2}-\d{2}/.test(yearName)) {
        log(`Skipping prose event link: "${yearName}" → ${url}`);
        return;
      }

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
      // Skip anything inside a <table> — release/news announcement boxes use tables
      // and their all-caps headings (e.g. "THE ESSENTIAL" from /retail: links)
      // would otherwise pass the prose filter and be mistaken for setlist songs.
      if (el.closest('table')) continue;
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
          .replace(/^([^/:\n]+[^/:\n\d]):\s*/, '') // strip label prefix (e.g. "Encore:") but NOT time expressions like "3:07"
          .replace(/\s*\([^)]*[a-z][^)]*\)/g, '')  // strip parentheticals with lowercase (with/xN/parts/…)
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
        const m = text.match(/^([^/:\n]+[^/:\n\d]):\s*/); // label must not end in digit ("Encore:" OK, "3:07" not)
        if (m) {
          label = m[1].trim();  // preserve original case ("With Garland Jeffreys")
          text  = text.slice(m[0].length);
        }
      }

      const rawAndClean = text.split(' / ')
        .map(s => s.trim())
        .filter(s => s.length > 0)
        .map(raw => ({ raw, compareKey: songCompareKey(raw) }))
        .filter(p => p.compareKey.length > 0)
        .filter(p => !/[a-z]{2,}/.test(p.compareKey)); // prose has runs of lowercase; isolated "c" in "McGRATH" is OK
      const songs    = rawAndClean.map(p => p.compareKey);
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

  // Returns the comparison key for a raw YEAR-page song token.
  // When the token lists alternatives with ", and/or", ", and", or ", or"
  // (e.g. "SONG A, SONG B, and/or SONG C"), normalises to "SONG A - SONG B - SONG C"
  // to match the " - " separator that parseDetailSetlist produces for multi-link <li> entries.
  // Falls back to cleanSongName for all other tokens.
  function songCompareKey(raw) {
    const clean = cleanSongName(raw);
    if (/[a-z]/.test(clean) && /,\s+(?:and\/or|and|or)\s+/i.test(raw)) {
      return cleanSongName(
        raw.replace(/,\s+(?:and\/or|and|or)\s+/gi, ', ').replace(/,\s*/g, ' - ')
      );
    }
    return clean;
  }

  async function processYearEvents(events, sections, onProgress, shouldStop) {
    const BATCH_SIZE = 3;
    let started = 0;
    for (let i = 0; i < events.length; i += BATCH_SIZE) {
      if (shouldStop?.()) break;
      const batch = events.slice(i, i + BATCH_SIZE);
      log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: events ${i + 1}–${Math.min(i + BATCH_SIZE, events.length)} of ${events.length}`);
      await Promise.allSettled(batch.map(async ev => {
        const idx = ++started;
        if (onProgress) onProgress(idx, ev.yearName, events.length);
        await processOneYearEvent(ev);
        // Insert the ⇄ Original toggle for this section as soon as its event is done.
        if (sections) {
          const processedDiv = ev.element.closest('.bb-section-processed');
          const sec = processedDiv && sections.find(s => s.processedDiv === processedDiv && !s.toggleInserted);
          if (sec) {
            sec.toggleInserted = true;
            insertSectionToggle(sec.hr, sec.processedDiv, sec.sectionOriginalHtml);
          }
        }
      }));
      if (i + BATCH_SIZE < events.length) await delay(500);
    }
  }

  async function processOneYearEvent({ element, yearName, url, eventType, isKnown, setlistEls, anchorEl, anchorName }) {
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
      // Names that differ only by a show-variant suffix on the detail page
      // are expected for split shows — flag with ⚠️ rather than ❌.
      const normTrimmed = normalizedDetailName.trim();
      const isEarlyLate = !nameMatch && [' (EARLY)', ' (LATE)', ' (AFTERNOON)', ' (EVENING)']
        .some(sfx => normTrimmed === yearNameUpper + sfx);

      log(`  YEAR   : "${yearNameUpper}"`);
      log(`  DETAIL : "${normalizedDetailName}"`);
      log(`  Result : ${nameMatch ? 'MATCH ✅' : isEarlyLate ? 'EARLY/LATE ⚠️' : 'MISMATCH ❌'}`);

      const eventDateM = yearNameUpper.match(/^(\d{4}-\d{2}-\d{2})/);
      const eventDate  = eventDateM ? eventDateM[1].toLowerCase() : null;

      const eventAlias = extractEventAlias(doc);
      addYearGlyph(element, nameMatch, isEarlyLate, yearNameUpper, normalizedDetailName, rawDetailName, eventType, eventAlias, anchorName);

      // ── Timing blocks ────────────────────────────────────────────────────
      const timingBlocks = extractTimingBlocks(doc);
      let lastScheduledDiv = null;
      if (timingBlocks.length > 0) {
        let insertAfter = element.closest('p') || element.parentNode;
        for (const text of timingBlocks) {
          lastScheduledDiv = addScheduledBlock(insertAfter, text);
          insertAfter = lastScheduledDiv;
        }
      }

      // ── Venue info ────────────────────────────────────────────────────────
      const venueLink = findVenueLink(doc);
      let _venueTabDoc  = null;
      let _venueTabHref = '';
      let _venueTabName = '';
      if (venueLink) {
        try {
          const venueHref  = venueLink.getAttribute('href');
          const venueDoc   = await fetchPage(`${location.protocol}//${location.host}${venueHref}`);
          const venueName  = venueDoc.querySelector('#page-title')?.textContent.trim() ?? '';
          if (venueName) {
            const rawVenuePartM   = rawDetailName.match(/^\d{4}-\d{2}-\d{2}\s*(?:-\s*)?(.*)/s);
            const detailVenuePart = rawVenuePartM ? rawVenuePartM[1].trim() : '';
            const match           = !!detailVenuePart && venueName === detailVenuePart;
            const anchorEl        = element.closest('p') || element.parentNode;
            const venuePrefix = eventType === 'recording' ? 'Recording session'
                                            : eventType === 'nogig'     ? 'No gig'
                                            : '';
            renderVenueInfo(lastScheduledDiv || anchorEl, venueHref, venueName, match, detailVenuePart, venuePrefix);
            _venueTabDoc  = venueDoc;
            _venueTabHref = venueHref;
            _venueTabName = venueName;
          }
        } catch (e) {
          logWarn(`  Venue page fetch failed: ${e.message}`);
        }
      }

      // ── Clickable icons ──────────────────────────────────────────────────
      wireIconHandlers(element, doc);

      // ── Venue tab buttons ─────────────────────────────────────────────────
      if (_venueTabDoc) {
        const section = element.closest('.bb-section-processed');
        if (section) addVenueTabButtons(_venueTabDoc, _venueTabHref, _venueTabName, section);
      }

      // ── Setlist check ────────────────────────────────────────────────────
      if (setlistEls.length > 0) {
        const yearSections   = parseYearSetlist(setlistEls);
        const detailSections = parseDetailSetlist(doc);
        const yearFlat      = yearSections.flatMap(s => s.songs);
        const yearRawFlat   = yearSections.flatMap(s => s.rawSongs);
        const detailFlat    = detailSections.flatMap(s => s.songs);
        const detailUrlFlat = detailSections.flatMap(s => s.songUrls || s.songs.map(() => null));
        log(`  Setlist: ${yearFlat.length} year songs, ${detailFlat.length} detail songs`);

        if (yearFlat.length > 0 || detailFlat.length > 0) {
          const diffItems = mergeCharDiffs(lcsDiff(yearFlat, detailFlat));
          const detailParaFlat = detailSections.flatMap(s => s.songs.map(() => !!s.paragraphBased));
          let yp = 0, dp = 0;
          for (const item of diffItems) {
            if (item.type !== 'detail-only') item.rawYearSong = yearRawFlat[yp++];
            if (item.type !== 'year-only') {
              item.paragraphBased = detailParaFlat[dp];
              item.detailSongUrl  = detailUrlFlat[dp];
              dp++;
            }
          }
          // Annotate each year section with the corresponding detail section label
          // (by position) so renderSetlistElement can flag label mismatches.
          // Use sentinel false when detail exists but has no explicit <strong> headers
          // and year has at least one non-show section (e.g. Soundcheck).
          const noDetailLabels = detailSections.length > 0 &&
            detailSections.every(s => !s.hasExplicitLabel);
          const hasNonShowYearSection = yearSections.some(s => {
            const lc = s.label.toLowerCase();
            return lc !== 'show' && lc !== 'recording';
          });
          yearSections.forEach((sec, i) => {
            if (noDetailLabels && hasNonShowYearSection) {
              sec.detailLabel = false;  // section may exist but DETAIL has no label headers
            } else {
              sec.detailLabel = i < detailSections.length ? detailSections[i].label : null;
            }
          });
          renderYearSetlist(yearSections, diffItems);
        }
      }

      // ── Anchor consistency check ─────────────────────────────────────────
      if (anchorEl && anchorName) {
        checkYearAnchorConsistency(doc, anchorName, anchorEl, eventDate);
      }
    } catch (e) {
      logErr(`  Failed to process "${yearName}":`, e.message);
      addWarningGlyph(element, e.message, eventType);
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

    yearSections.forEach((sec, sIdx) => renderSetlistElement(sec.sourceEl, sec.label, sectionItems[sIdx], sec.detailLabel));
  }

  // detailLabel: the corresponding detail section label (original case), or null if
  // the detail page has no section at this index, or undefined if not applicable.
  // Renders a raw YEAR-page token that contains a list connective (", and/or", etc.).
  // Each song part gets .bb-song-match colouring; the separators stay plain (original colour).
  function renderMatchWithConnectives(raw) {
    const parts = raw.split(/(,\s+(?:(?:and\/or|and|or)\s+)?)/gi);
    return parts.map((part, i) =>
      i % 2 === 0
        ? `<span class="bb-song-match">${esc(part.trim())}</span>`
        : esc(part)
    ).join('');
  }

  function renderSetlistElement(el, label, items, detailLabel) {
    let html    = '';
    let isFirst = true;
    let songNum = 0;

    const labelLc = label.toLowerCase();
    if (labelLc === 'soundcheck') {
      html += '<span class="bb-section-label">Soundcheck: </span>';
    } else if (labelLc !== 'show' && labelLc !== 'recording') {
      html += `<span class="bb-section-label">${esc(label)}: </span>`;
    }

    // Section-label mismatch warning (YEAR page mode only, when detailLabel is set).
    // Rules:
    //  - 'recording' sections appear as part of 'show' on DETAIL pages — never flag.
    //  - 'show' vs 'show' (the implicit default) — no flag regardless of case.
    //  - All other labels use case-sensitive comparison so capitalisation differences
    //    (e.g. 'with Willie Nile' vs 'With Willie Nile') are caught.
    if (detailLabel !== undefined && labelLc !== 'recording') {
      let labelWarnMsg = null;
      if (detailLabel === null) {
        labelWarnMsg = `Section "${label}" exists on YEAR page but DETAIL page has no corresponding section`;
      } else if (detailLabel === false) {
        // DETAIL has content but no explicit <strong> label headers for any section.
        if (labelLc !== 'show') {
          labelWarnMsg = `Section label "${label}", missing from DETAIL page`;
        } else {
          labelWarnMsg = `Section "show" exists on YEAR page but DETAIL page has no corresponding section label`;
        }
      } else if (!(labelLc === 'show' && detailLabel.toLowerCase() === 'show')) {
        if (label !== detailLabel) {
          labelWarnMsg = `Section label mismatch: YEAR page has "${label}", DETAIL page has "${detailLabel}"`;
        }
      }
      if (labelWarnMsg) {
        html += `<span class="bb-section-label-warn bb-para-warn" data-msg="${esc(labelWarnMsg)}">⚠️</span> `;
      }
    }

    for (const item of items) {
      if (!isFirst) html += '<span class="bb-sep"> / </span>';
      isFirst = false;
      songNum++;

      // Song number: clickable when a song page URL is known, plain otherwise.
      const numSongHref = item.detailSongUrl ?? null;
      const numSongName = item.yearSong ?? item.detailSong ?? '';
      if (numSongHref) {
        html += `<a href="${esc(numSongHref)}" class="bb-song-num" data-sn="${esc(numSongName)}">${songNum}.</a>`;
      } else {
        html += `<span class="bb-song-num-plain">${songNum}.</span>`;
      }

      const paraWarn = item.paragraphBased
        ? ` <span class="bb-para-warn" data-msg="Detail page lists this song as a paragraph (&lt;p&gt;) instead of a list item (&lt;ol&gt;/&lt;li&gt;). Setlist may be incomplete.">⚠️</span>`
        : '';
      if (item.type === 'match') {
        const raw = item.rawYearSong || item.yearSong;
        // Test on the cleaned name so that ", and" inside a "(with ...)" suffix
        // does not trigger the connective split.
        if (/,\s+(?:and\/or|and|or)\s+/i.test(item.yearSong)) {
          html += renderMatchWithConnectives(raw) + paraWarn;
        } else {
          const rawSuffix = item.rawYearSong ? esc(item.rawYearSong.slice(item.yearSong.length)) : '';
          if (item.detailSongUrl) {
            html += `<a href="${esc(item.detailSongUrl)}" class="bb-song-match">${esc(item.yearSong)}</a>${rawSuffix}${paraWarn}`;
          } else {
            html += `<span class="bb-song-match">${esc(item.yearSong)}</span>${rawSuffix}${paraWarn}`;
          }
        }
      } else if (item.type === 'year-only') {
        const display = item.rawYearSong || item.yearSong;
        html += `<span class="bb-song-year-only" data-year-song="${esc(item.yearSong)}">${esc(display)}</span>`;
      } else if (item.type === 'detail-only') {
        html += `<span class="bb-song-detail-only" data-detail-song="${esc(item.detailSong)}">${esc(item.detailSong)}</span>${paraWarn}`;
      } else if (item.type === 'char-diff') {
        const inner = buildCharDiffHtml(item.yearSong, item.detailSong);
        html += `<span class="bb-song-char-diff" data-year-song="${esc(item.yearSong)}" data-detail-song="${esc(item.detailSong)}">${inner}</span>${paraWarn}`;
      }
    }

    // Preserve <sup><em> footnote nodes (e.g. "Setlist incomplete.") that were
    // inside the element before we overwrite innerHTML.
    const supHtml = [...el.querySelectorAll('sup')].map(s => s.outerHTML).join('');
    el.innerHTML = supHtml ? html + '<br>' + supHtml : html;

    // Wire song-number click handlers so clicking loads the song tab row.
    const numSection = el.closest('.bb-section-processed');
    if (numSection) {
      el.querySelectorAll('a.bb-song-num').forEach(numLink => {
        const songHref = numLink.getAttribute('href');
        const songName = numLink.dataset.sn || '';
        numLink.addEventListener('click', e => {
          e.preventDefault();
          fetchAndToggleSongTabRow(songHref, songName, numSection, numLink);
        });
      });
    }

    el.querySelectorAll('.bb-song-year-only, .bb-song-detail-only, .bb-song-char-diff').forEach(span => {
      span.addEventListener('mouseenter', e => showSongTooltip(e, span));
      span.addEventListener('mouseleave', hideTooltip);
    });
    el.querySelectorAll('.bb-para-warn').forEach(span => {
      span.addEventListener('mouseenter', e => showErrorTooltip(e, span.dataset.msg));
      span.addEventListener('mouseleave', hideTooltip);
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // DETAIL PAGE MODE
  // ════════════════════════════════════════════════════════════════════════════

  async function runDetailPage() {
    const detailSections = parseDetailSetlist(document);
    const hasSetlist = detailSections.length > 0;
    if (!hasSetlist) log('No setlist found on detail page — will still annotate title');

    // Extract event type and raw detail name before any DOM modifications
    // so that extractDetailEventName reads a clean #page-title.
    const detailTypeM    = path.match(/^([a-z]+):/);
    const detailEventType = detailTypeM ? detailTypeM[1] : 'unknown';
    const rawDetailName  = extractDetailEventName(document, location.pathname);
    const normalizedDetailName = normalizeDetailName(rawDetailName);

    // ── Button container ──────────────────────────────────────────────────────
    // Created immediately so Load works before any processing starts.
    const pageTitle = document.getElementById('page-title');
    const td = getSetlistContainer(document);
    let _detailOriginalHtml = '';

    const [detailSaveBtn, detailLoadBtn] = makeSaveLoadBtns(
      'detail', () => td, () => _detailOriginalHtml
    );
    detailLoadBtn.addEventListener('click', () =>
      triggerLoadCache(data => loadPageCache('detail', td, null, data))
    );

    const detailBtnContainer = document.createElement('div');
    detailBtnContainer.id = 'bb-btn-container';
    detailBtnContainer.append(detailSaveBtn, detailLoadBtn);
    pageTitle?.after(detailBtnContainer);

    async function runDetailProcessing() {
      const info = detailPathToYearAndAnchor(path);
      if (!info) {
        logWarn('Could not derive year from path:', path);
        return;
      }

      const yearPageUrl = `${location.protocol}//${location.host}/${yearPageSlug(info.year)}`;
      log(`Fetching YEAR page for setlist comparison: ${yearPageUrl}`);

      let yearDoc;
      try {
        yearDoc = await fetchPage(yearPageUrl);
      } catch (e) {
        logErr('Failed to fetch YEAR page:', e.message);
        return;
      }

      const yearContent = yearDoc.querySelector('#page-content') || yearDoc.body;

      // Match by href rather than by derived anchor name — the DETAIL page URL may
      // lack the a/b suffix that the YEAR page anchor carries (e.g. anchor "150571a"
      // for URL "/gig:1971-05-15-…"), so anchor lookup would fail.
      const eventLink = [...yearContent.querySelectorAll('a[href]')]
        .filter(a => EVENT_URL_RE.test(a.getAttribute('href') || ''))
        .find(a => a.getAttribute('href') === '/' + path);

      if (!eventLink) {
        logWarn('No matching event link found on YEAR page for path:', path);
        return;
      }
      log(`  Event link found: "${eventLink.textContent.trim()}" href="${eventLink.getAttribute('href')}"`);

      // ── Event name check on DETAIL page ──────────────────────────────────
      const yearNameUpper = eventLink.textContent.trim().toUpperCase();
      const nameMatch     = yearNameUpper === normalizedDetailName.trim();
      const normTrimmed   = normalizedDetailName.trim();
      const isEarlyLate   = !nameMatch && [' (EARLY)', ' (LATE)', ' (AFTERNOON)', ' (EVENING)']
        .some(sfx => normTrimmed === yearNameUpper + sfx);
      log(`  YEAR   : "${yearNameUpper}"`);
      log(`  DETAIL : "${normalizedDetailName}"`);
      log(`  Result : ${nameMatch ? 'MATCH ✅' : isEarlyLate ? 'EARLY/LATE ⚠️' : 'MISMATCH ❌'}`);
      addDetailTitleAnnotation(detailEventType, yearNameUpper, normalizedDetailName, rawDetailName, nameMatch, isEarlyLate);

      const detailTabMap = buildTabMap(document);
      const detailDateM  = yearNameUpper.match(/^(\d{4}-\d{2}-\d{2})/);
      if (detailDateM) {
        annotateDetailPageTags(detailTabMap, detailDateM[1], detailEventType);
      }

      const allYearNamedAnchors = [...yearContent.querySelectorAll('a[name]')];
      const nextAnchor = allYearNamedAnchors
        .find(a => eventLink.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING);
      log(`  Next anchor: ${nextAnchor ? `name="${nextAnchor.getAttribute('name')}"` : 'none (end of page)'}`);

      // ── Anchor consistency check on DETAIL page ───────────────────────────
      // Find the named anchor on the YEAR page that precedes this event link.
      let yearAnchorEl = null;
      for (const a of allYearNamedAnchors) {
        if (a.compareDocumentPosition(eventLink) & Node.DOCUMENT_POSITION_FOLLOWING) {
          yearAnchorEl = a;
        }
      }
      const yearAnchorName = yearAnchorEl ? yearAnchorEl.getAttribute('name') : null;
      log(`  YEAR page anchor for this event: ${yearAnchorName ? `"${yearAnchorName}"` : 'none found'}`);

      if (yearAnchorName) {
        const infoLink = findInfoSetlistLink(document);
        if (infoLink) {
          const href = infoLink.getAttribute('href') || '';
          const m = href.match(INFO_SETLIST_HREF_RE);
          const detailAnchorRef = m ? m[1] : null;
          log(`  DETAIL "Info & Setlist" refs: ${detailAnchorRef ? `"#${detailAnchorRef}"` : 'no fragment'}`);

          if (detailAnchorRef) {
            const detailIssues = [];
            const detailPassed = [];

            if (detailAnchorRef === yearAnchorName) {
              detailPassed.push(`Anchor "#${detailAnchorRef}" matches YEAR page anchor "#${yearAnchorName}" ✅`);
            } else {
              detailIssues.push(`Anchor mismatch: "Info & Setlist" refs "#${detailAnchorRef}" but YEAR page anchor for this event is "#${yearAnchorName}"`);
            }

            const eventDateForDetail = yearNameUpper.match(/^(\d{4}-\d{2}-\d{2})/);
            if (eventDateForDetail) {
              const theoretical = dateToAnchor(eventDateForDetail[1]);
              if (theoretical) {
                if (detailAnchorRef.startsWith(theoretical)) {
                  detailPassed.push(`Date-derived anchor "#${theoretical}" (from ${eventDateForDetail[1]}) ✅`);
                } else {
                  detailIssues.push(`Date-derived anchor: expected "#${theoretical}" (from ${eventDateForDetail[1]}) but "Info & Setlist" refs "#${detailAnchorRef}"`);
                }
              }
              const hrefPathM = href.match(/^\/([^#]+)#/);
              if (hrefPathM) {
                const hrefYear = hrefPathM[1];
                const dateYear = eventDateForDetail[1].slice(0, 4);
                if (yearMatchesHrefSlug(dateYear, hrefYear)) {
                  detailPassed.push(`Href year "${hrefYear}" matches event date year "${dateYear}" ✅`);
                } else {
                  detailIssues.push(`Year mismatch: event date year "${dateYear}" ≠ href year "${hrefYear}"`);
                }
              }
            }

            if (detailIssues.length > 0) {
              logWarn(`  Anchor/year issue(s): ${detailIssues.join('; ')}`);
              addAnchorWarnDetail(infoLink, yearAnchorName, detailAnchorRef, detailIssues);
            } else {
              log(`  Anchor MATCH ✅`);
              addAnchorMatchDetail(infoLink, `Anchor checks passed:\n${detailPassed.join('\n')}`);
            }
          }
        } else {
          log(`  Anchor check: no "Info & Setlist" link found on this detail page`);
        }
      }

      // ── Venue name check on DETAIL page ────────────────────────────────────
      const detailVenueLink = findVenueLink(document);
      if (detailVenueLink) {
        try {
          const venueHref  = detailVenueLink.getAttribute('href');
          const venueDoc   = await fetchPage(`${location.protocol}//${location.host}${venueHref}`);
          const venueName  = venueDoc.querySelector('#page-title')?.textContent.trim() ?? '';
          if (venueName) {
            const rawVenuePartM   = rawDetailName.match(/^\d{4}-\d{2}-\d{2}\s*(?:-\s*)?(.*)/s);
            const detailVenuePart = rawVenuePartM ? rawVenuePartM[1].trim() : '';
            const venueMatch      = !!detailVenuePart && venueName === detailVenuePart;
            log(`  Venue: "${venueName}" ${venueMatch ? '✅' : '⚠️'} vs detail "${detailVenuePart}"`);
            addVenueGlyphDetail(detailVenueLink, venueName, venueMatch, detailVenuePart);
          }
        } catch (e) {
          logWarn(`  Venue page fetch failed: ${e.message}`);
        }
      }

      // Setlist comparison — only when the detail page actually has a setlist.
      if (!hasSetlist) {
        annotateSetlistTab(nameMatch, false);
        return;
      }

      const setlistEls = collectSetlistElements(eventLink, nextAnchor, yearContent);
      log(`  Collected ${setlistEls.length} setlist element(s) from YEAR page`);

      const yearSections  = parseYearSetlist(setlistEls);
      const yearFlat      = yearSections.flatMap(s => s.songs);
      const yearRawFlat   = yearSections.flatMap(s => s.rawSongs);
      const detailFlat    = detailSections.flatMap(s => s.songs);
      log(`Detail mode: ${yearFlat.length} year songs, ${detailFlat.length} detail songs`);
      log(`  Year songs:   ${JSON.stringify(yearFlat)}`);
      log(`  Detail songs: ${JSON.stringify(detailFlat)}`);

      const diffItems = mergeCharDiffs(lcsDiff(yearFlat, detailFlat));
      log(`  Diff: ${diffItems.map(i => `${i.type}(${i.yearSong || i.detailSong})`).join(', ')}`);
      const detailParaFlat = detailSections.flatMap(s => s.songs.map(() => !!s.paragraphBased));
      let yp = 0, dp = 0;
      for (const item of diffItems) {
        if (item.type !== 'detail-only') item.rawYearSong = yearRawFlat[yp++];
        if (item.type !== 'year-only')   item.paragraphBased = detailParaFlat[dp++];
      }

      // Snapshot td content just before rendering so the original is unmodified.
      _detailOriginalHtml = td ? td.innerHTML : '';

      renderDetailSetlist(diffItems);
      flagDetailSectionHeaders(yearSections, detailSections, diffItems);
      insertDetailToggle(_detailOriginalHtml);
      annotateSetlistTab(nameMatch, true);

      detailSaveBtn.disabled = false;
    }

    // Auto-process on page load.
    await runDetailProcessing();
  }

  // Appends a ⚠️ warning to <p><strong>…</strong></p> section-header elements
  // on the DETAIL page when their label does not match the corresponding YEAR
  // section label (matched by position).  Also flags any DETAIL headers that have
  // no counterpart on the YEAR page at all (point 2: YEAR has only an implicit
  // "show" section, so DETAIL headers are unexpected).
  //
  // When the DETAIL page has no section-header elements at all but the YEAR page
  // has explicit non-show sections (e.g. Soundcheck), synthetic headers are
  // inserted with a ⚠️ flag.
  function flagDetailSectionHeaders(yearSections, detailSections, diffItems) {
    const td = getSetlistContainer(document);
    if (!td) return;

    // Collect all section-header <p> elements: those whose full text content
    // equals the text of their sole <strong> child (i.e. a pure label line).
    const headerEls = [...td.children].filter(el => {
      if (el.tagName !== 'P') return false;
      const strong = el.querySelector('strong');
      return strong && el.textContent.trim() === strong.textContent.trim();
    });

    // === Case A: DETAIL already has section headers — flag mismatches ===
    if (headerEls.length > 0) {
      headerEls.forEach((el, i) => {
        const strong = el.querySelector('strong');
        const detailLabel = strong.textContent.trim();
        const yearSec = yearSections[i];

        let msg = null;
        const yearLabelLc = yearSec ? yearSec.label.toLowerCase() : null;
        if (!yearSec) {
          msg = `DETAIL page has section "${detailLabel}" but YEAR page has no corresponding section`;
        } else if (yearLabelLc === 'recording') {
          // Recording sections appear as 'show' on DETAIL pages — skip
        } else if (yearLabelLc === 'show' && detailLabel.toLowerCase() === 'show') {
          // Both are the implicit default section — no flag
        } else if (yearSec.label !== detailLabel) {
          // Case-sensitive — catches capitalisation differences (e.g. 'with' vs 'With')
          msg = `Section label mismatch: YEAR page has "${yearSec.label}", DETAIL page has "${detailLabel}"`;
        }

        if (msg) {
          const warn = document.createElement('span');
          warn.className = 'bb-para-warn';
          warn.textContent = ' ⚠️';
          warn.dataset.msg = msg;
          warn.addEventListener('mouseenter', e => showErrorTooltip(e, warn.dataset.msg));
          warn.addEventListener('mouseleave', hideTooltip);
          el.appendChild(warn);
        }
      });
      return;
    }

    // === Case B: DETAIL has no section headers but YEAR has explicit non-show sections ===
    // Insert synthetic <p><strong>Label</strong> ⚠️</p> headers at the correct positions.
    const noDetailLabels = detailSections.every(s => !s.hasExplicitLabel);
    const hasNonShowSection = yearSections.some(s => {
      const lc = s.label.toLowerCase();
      return lc !== 'show' && lc !== 'recording';
    });
    if (!noDetailLabels || !hasNonShowSection) return;

    // Build posMap: year-song position index → year section index
    const posMap = [];
    yearSections.forEach((sec, sIdx) => sec.songs.forEach(() => posMap.push(sIdx)));

    // Walk diffItems to count how many rendered <li>/<p> items belong to each section.
    // year-only and match/char-diff advance yearCursor; detail-only does not.
    let yearCursor = 0;
    const sectionItemCounts = yearSections.map(() => 0);
    for (const item of diffItems) {
      const sIdx = yearCursor < posMap.length ? posMap[yearCursor] : yearSections.length - 1;
      sectionItemCounts[sIdx]++;
      if (item.type !== 'detail-only') yearCursor++;
    }

    // Find the rendered list element and snapshot all its children
    const listEl = td.querySelector('ol, ul');
    if (!listEl) return;
    const listTag = listEl.tagName;
    const allLis = [...listEl.children];
    const listNextSibling = listEl.nextSibling;
    const listParent = listEl.parentNode;
    listEl.remove();

    // Rebuild as interleaved <p><strong>Label ⚠️</strong></p> + <ol/ul> fragments
    const fragment = document.createDocumentFragment();
    let liOffset = 0;
    yearSections.forEach((sec, sIdx) => {
      const labelLc = sec.label.toLowerCase();
      const count = sectionItemCounts[sIdx];
      if (labelLc === 'recording' || count === 0) { liOffset += count; return; }

      const msg = labelLc !== 'show'
        ? `Section label "${sec.label}", missing from DETAIL page`
        : `Section "show" exists on YEAR page but DETAIL page has no corresponding section label`;

      const warn = document.createElement('span');
      warn.className = 'bb-para-warn';
      warn.textContent = ' ⚠️';
      warn.dataset.msg = msg;
      warn.addEventListener('mouseenter', e => showErrorTooltip(e, warn.dataset.msg));
      warn.addEventListener('mouseleave', hideTooltip);

      const p = document.createElement('p');
      const strong = document.createElement('strong');
      strong.textContent = labelLc === 'show' ? 'Show' : sec.label;
      p.appendChild(strong);
      p.appendChild(warn);
      fragment.appendChild(p);

      const newList = document.createElement(listTag);
      allLis.slice(liOffset, liOffset + count).forEach(li => newList.appendChild(li));
      fragment.appendChild(newList);
      liOffset += count;
    });

    listParent.insertBefore(fragment, listNextSibling);
  }

  // "gig:2003-09-14-..." → { year: "2003" }  (anchor no longer needed)
  function detailPathToYearAndAnchor(p) {
    const m = p.match(/:(\d{4})-\d{2}-\d{2}/);
    if (!m) return null;
    return { year: m[1] };
  }

  // Maps a 4-digit year string to the brucebase page slug that covers it.
  // 1949–1964 are consolidated onto a single "1949-64" page; all other years
  // have their own /YYYY page.
  function yearPageSlug(year) {
    const y = parseInt(year, 10);
    return (y >= 1949 && y <= 1964) ? '1949-64' : year;
  }

  // Returns the setlist container element for a (fetched or live) document.
  // Normally #wiki-tab-0-1 holds a <table><tr><td> layout; older/simpler pages
  // place the <ol>/<ul> directly inside the div with no <td>.
  // Very old pages (e.g. 1974) have no tab widget at all — fall back to #page-content.
  function getSetlistContainer(doc) {
    return doc.querySelector('#wiki-tab-0-1 td')
        || doc.querySelector('#wiki-tab-0-1')
        || doc.querySelector('#page-content');
  }

  function renderDetailSetlist(diffItems) {
    const td = getSetlistContainer(document);
    if (!td) return;

    // Standard pages use <li> elements; old pages (e.g. 1974) list songs as bare <p> elements.
    const isParagraphBased = !td.querySelector('li');
    const allLis = isParagraphBased
      ? [...td.querySelectorAll('p')].filter(p => p.querySelector('a[href^="/song:"]'))
      : [...td.querySelectorAll('li')];
    let liIdx = 0;

    for (const item of diffItems) {
      if (item.type === 'match' || item.type === 'char-diff' || item.type === 'detail-only') {
        if (liIdx < allLis.length) {
          const el = allLis[liIdx];
          styleDetailLi(el, item);
          if (isParagraphBased) addParaStructureWarning(el);
          liIdx++;
        }
      } else if (item.type === 'year-only') {
        // Insert a new element for a song present on the year page but missing here.
        // Use <p> on paragraph-based pages so the inserted node matches surrounding format.
        const newEl = document.createElement(isParagraphBased ? 'p' : 'li');
        newEl.className = 'bb-song-year-only';
        newEl.dataset.yearSong = item.yearSong;
        newEl.textContent = item.yearSong;
        newEl.addEventListener('mouseenter', e => showSongTooltip(e, newEl));
        newEl.addEventListener('mouseleave', hideTooltip);

        if (liIdx < allLis.length) {
          allLis[liIdx].parentNode.insertBefore(newEl, allLis[liIdx]);
        } else if (isParagraphBased) {
          td.appendChild(newEl);
        } else {
          const lastList = td.querySelector('ol:last-of-type') || td.querySelector('ul:last-of-type');
          if (lastList) lastList.appendChild(newEl);
        }
      }
    }
  }

  function addParaStructureWarning(el) {
    const span = document.createElement('span');
    span.className = 'bb-para-warn';
    span.textContent = ' ⚠️';
    span.dataset.msg = 'Unusual format: song listed as a paragraph (<p>) instead of a list item (<ol>/<li>). Setlist may be incomplete.';
    span.addEventListener('mouseenter', e => showErrorTooltip(e, span.dataset.msg));
    span.addEventListener('mouseleave', hideTooltip);
    el.appendChild(span);
  }

  function styleDetailLi(li, item) {
    if (item.type === 'match') {
      // Prefer adding the match class to individual song links so that
      // descriptive <span> nodes (e.g. "(parts)") don't inherit the green colour.
      // When no /song: link exists (plain-text <li>), fall back to the <li> itself.
      const songLinks = [...li.querySelectorAll('a[href^="/song:"]')];
      if (songLinks.length > 0) {
        songLinks.forEach(a => a.classList.add('bb-song-match'));
      } else {
        li.classList.add('bb-song-match');
      }
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
      logWarn('parseDetailSetlist: no setlist container found (#wiki-tab-0-1 or #page-content)');
      return [];
    }

    const sections    = [];
    let currentLabel  = 'show';
    let hasExplicitLabel = false;  // true when currentLabel was set by a <p><strong>…</strong></p> header
    let pendingSongs  = [];   // songs collected from <p><a href="/song:…"> (old pages)

    function flushPending() {
      if (pendingSongs.length > 0) {
        sections.push({
          label: currentLabel,
          songs: pendingSongs.map(s => s.name),
          songUrls: pendingSongs.map(s => s.url),
          paragraphBased: true,
          hasExplicitLabel
        });
        pendingSongs = [];
        hasExplicitLabel = false;
        currentLabel = 'show';
      }
    }

    function parseSongsFromList(listEl) {
      const songs = [];
      for (const li of listEl.querySelectorAll('li')) {
        const links = [...li.querySelectorAll('a[href^="/song:"]')];
        let name, url = null;
        if (links.length > 0) {
          name = cleanSongName(links.map(a => a.textContent.trim()).join(' - '));
          // Medley entries (multiple links) have no single song URL.
          if (links.length === 1) url = links[0].getAttribute('href');
        } else {
          // Fall back to plain text for songs with no dedicated song page.
          // Skip venue/date entries (e.g. "2004-04-18 Hit Factory, NY").
          const text = li.textContent.trim();
          if (text && !/^\d{4}-\d{2}-\d{2}/.test(text)) name = cleanSongName(text);
        }
        if (name) songs.push({ name, url });
      }
      return songs;
    }

    // First pass: iterate direct children.
    // Handles three layouts:
    //   (a) standard: <p><strong>Label</strong></p> + <ol>/<ul>
    //   (b) old pages: <p><a href="/song:…">SONG</a></p> (p-based setlist)
    for (const child of td.children) {
      if (child.tagName === 'P') {
        const strong = child.querySelector('strong');
        if (strong && child.textContent.trim() === strong.textContent.trim()) {
          flushPending();
          currentLabel = strong.textContent.trim();  // original case preserved for mismatch messages
          hasExplicitLabel = true;
        } else if (strong && !child.querySelector('a[href^="/song:"]') &&
                   [...child.childNodes].every(n =>
                     (n.nodeType === Node.TEXT_NODE && /^\s*$/.test(n.textContent)) ||
                     n.nodeName === 'STRONG' || n.nodeName === 'SPAN'
                   )) {
          // e.g. <p><strong>Pre-show</strong> <span style="font-size:80%"><em>(solo acoustic)</em></span></p>
          // Full text used as label so it matches the YEAR-page label "Pre-show (solo acoustic):".
          flushPending();
          currentLabel = child.textContent.trim();
          hasExplicitLabel = true;
        } else {
          // Old-style setlist: song link in a bare <p>
          const links = [...child.querySelectorAll('a[href^="/song:"]')];
          if (links.length > 0) {
            const name = cleanSongName(links.map(a => a.textContent.trim()).join(' - '));
            const url = links.length === 1 ? links[0].getAttribute('href') : null;
            if (name) pendingSongs.push({ name, url });
          }
        }
      } else if (child.tagName === 'OL' || child.tagName === 'UL') {
        flushPending();
        const songItems = parseSongsFromList(child);
        if (songItems.length > 0) {
          sections.push({
            label: currentLabel,
            songs: songItems.map(s => s.name),
            songUrls: songItems.map(s => s.url),
            hasExplicitLabel
          });
          hasExplicitLabel = false;
          currentLabel = 'show';
        }
      }
    }
    flushPending();

    // Second pass: if still empty, widen to all descendant lists
    // (handles pages where the <ol> is nested inside a <div> within #page-content).
    if (sections.length === 0) {
      for (const list of td.querySelectorAll('ol, ul')) {
        const songItems = parseSongsFromList(list);
        if (songItems.length > 0) sections.push({
          label: currentLabel,
          songs: songItems.map(s => s.name),
          songUrls: songItems.map(s => s.url)
        });
      }
    }

    return sections;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // YEAR LIST PAGE MODE
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Converts processed listEvents into SmartTable NormalizedRow[].
   * Called after processOneListEvent so glyph spans are already in the DOM.
   * @param {Array<{element: HTMLElement}>} listEvents
   * @returns {object[]}
   */
  function extractListSmartTableRows(listEvents) {
    return listEvents.map(({ element }) => {
      const name  = element.textContent.trim();
      const m     = name.match(/^(\d{4}-\d{2}-\d{2})\s*[-–]?\s*(.*)/s);
      const date  = m ? m[1] : '';
      const event = m ? m[2].trim() : name;
      const sib   = element.nextElementSibling;
      const status = (sib && sib.classList.contains('bb-glyph')) ? sib.textContent.trim() : '';
      return { date, event, status, url: element.href || '' };
    });
  }

  async function runListPage(year) {
    const content   = document.querySelector('#page-content') || document.body;
    const pageTitle = document.getElementById('page-title');

    // Save original HTML before any DOM mutations (used by Original Page toggle).
    const originalHtml = content.innerHTML;

    const listEvents = extractListPageEvents(year);
    log(`Found ${listEvents.length} event link(s) on list page`);
    if (listEvents.length === 0) {
      logWarn('No list-page event links found — check selector / page structure');
      return;
    }

    // ── Button container ──────────────────────────────────────────────────────
    const btnContainer = document.createElement('div');
    btnContainer.id = 'bb-btn-container';

    const globalBtn = document.createElement('button');
    globalBtn.id = 'bb-global-toggle';
    globalBtn.className = 'bb-toggle-btn';
    globalBtn.textContent = '⇄ Original Page';
    globalBtn.title = 'Toggle between the original unprocessed page and the annotated processed view';
    globalBtn.disabled = true;

    const mismatchBtn = document.createElement('button');
    mismatchBtn.id = 'bb-mismatch-toggle';
    mismatchBtn.className = 'bb-toggle-btn';
    mismatchBtn.textContent = '⚡ Mismatches';
    mismatchBtn.title = 'Filter to show only events with name or setlist mismatches';
    mismatchBtn.disabled = true;

    const [listSaveBtn, listLoadBtn] = makeSaveLoadBtns(
      'list', () => content, () => originalHtml
    );
    listLoadBtn.addEventListener('click', () =>
      triggerLoadCache(data => loadPageCache('list', content, progressEl, data))
    );

    btnContainer.append(globalBtn, mismatchBtn, listSaveBtn, listLoadBtn);

    // ── Progress ─────────────────────────────────────────────────────────────
    const progressEl = document.createElement('p');
    progressEl.id = 'bb-year-progress';
    const timerSpan = document.createElement('span');
    timerSpan.id = 'bb-year-timer';
    timerSpan.textContent = '00:00';
    progressEl.append(timerSpan, ' ... Fetching…');

    // ── Sticky bar ────────────────────────────────────────────────────────────
    // Do NOT use setupStickyBar() here — on list pages events may live before the
    // first <hr>, so moving pre-<hr> content to the bar would swallow event rows.
    // Instead build the bar manually, mirroring runHomePage's approach.
    const controlsEl = document.createElement('div');
    controlsEl.id = 'bb-controls';
    controlsEl.append(btnContainer, progressEl);

    const stickyBar = document.createElement('div');
    stickyBar.id = 'bb-sticky-bar';
    stickyBar.appendChild(controlsEl);

    if (pageTitle && pageTitle.parentNode) {
      pageTitle.parentNode.insertBefore(stickyBar, pageTitle);
      pageTitle.style.display = 'none';
    }

    const headerEl = document.getElementById('header');
    if (headerEl) {
      document.documentElement.style.setProperty(
        '--bb-header-h', `${Math.round(headerEl.getBoundingClientRect().height)}px`
      );
    }
    document.documentElement.style.setProperty('--bb-sticky-bar-h', `${stickyBar.offsetHeight}px`);

    // ── Fetch and process ─────────────────────────────────────────────────────
    const startTime = Date.now();
    const timerId = setInterval(() => {
      timerSpan.textContent = fmtElapsed(Date.now() - startTime);
    }, 1000);

    const yearPageUrl = `${location.protocol}//${location.host}/${year}`;
    log(`Fetching YEAR page (shared): ${yearPageUrl}`);
    let yearDoc;
    try {
      yearDoc = await fetchPage(yearPageUrl);
    } catch (e) {
      logErr('Failed to fetch YEAR page:', e.message);
      listEvents.forEach(({ element }) =>
        addWarningGlyph(element, 'Could not fetch YEAR page: ' + e.message));
      clearInterval(timerId);
      return;
    }

    const anchorMap = buildAnchorToNameMap(yearDoc);
    log(`Anchor map built: ${anchorMap.size} entries`);
    anchorMap.forEach((name, anchor) => log(`  #${anchor} → "${name}"`));
    listEvents.forEach(ev => processOneListEvent(ev, anchorMap, year));

    clearInterval(timerId);
    timerSpan.textContent = fmtElapsed(Date.now() - startTime);
    progressEl.replaceChildren(timerSpan, ` ... Done — ${listEvents.length} events processed`);

    // ── SmartTable (mirrors runYearPage — trigger button moved into btnContainer) ──
    if (typeof SmartTable !== 'undefined') {
      const stHost = document.createElement('div');
      stHost.id = 'bb-list-smarttable-host';
      // Place between sticky bar and #page-content so the table appears there.
      stickyBar.after(stHost);
      SmartTable.render({
        columns: LIST_SMARTTABLE_COLUMNS,
        rows:    extractListSmartTableRows(listEvents),
        container: stHost,
        options: { stickyOffset: 'calc(var(--bb-header-h) + var(--bb-sticky-bar-h))' },
      });
      const stBtn = stHost.querySelector('.st-btn-trigger');
      if (stBtn) btnContainer.appendChild(stBtn);
    }

    // ── Wire up buttons ───────────────────────────────────────────────────────
    setupGlobalToggle(globalBtn, content, originalHtml);
    setupListMismatchFilter(mismatchBtn, listEvents);

    globalBtn.disabled   = false;
    mismatchBtn.disabled = false;
    listSaveBtn.disabled = false;

    log('All list events processed');
  }

  function extractListPageEvents(year, container = null) {
    const content  = container || document.querySelector('#page-content') || document.body;
    const allLinks = content.querySelectorAll('a[href]');
    const results  = [];

    allLinks.forEach(el => {
      const m = el.href.match(LIST_LINK_RE);
      if (!m) return;

      const hrefYear = m[1];
      const anchor   = m[2];
      const rawName  = getLinkLineText(el);
      const stripped = stripListSuffix(rawName);

      log(`[#${anchor}] hrefYear="${hrefYear}" raw="${rawName}"${rawName !== stripped ? ` stripped="${stripped}"` : ''}`);
      results.push({ element: el, rawName, strippedName: stripped, anchor, hrefYear });
    });
    return results;
  }

  /**
   * Derives the theoretical 6-digit Brucebase anchor from a YYYY-MM-DD date.
   * Format: DDMMYY — last two digits of year, so "2026-01-17" → "170126".
   * Returns null if the date string does not match the expected format.
   * @param {string} dateStr - "YYYY-MM-DD"
   * @returns {string|null}
   */
  function dateToAnchor(dateStr) {
    const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const [, year, month, day] = m;
    return day + month + year.slice(2);
  }

  /**
   * Returns true when a 4-digit dateYear falls within the year expressed by a
   * page slug, including range slugs like "1949-64" (meaning 1949–1964).
   * The end year is formed by replacing the last two digits of the start year
   * with the two-digit suffix (same century).
   * @param {string} dateYear  Four-digit year string, e.g. "1953"
   * @param {string} hrefSlug  Page slug, e.g. "1953" or "1949-64"
   * @returns {boolean}
   */
  function yearMatchesHrefSlug(dateYear, hrefSlug) {
    if (dateYear === hrefSlug) return true;
    const rangeM = hrefSlug.match(/^(\d{4})-(\d{2})$/);
    if (rangeM) {
      const start = parseInt(rangeM[1], 10);
      const end   = parseInt(rangeM[1].slice(0, 2) + rangeM[2], 10);
      const year  = parseInt(dateYear, 10);
      return year >= start && year <= end;
    }
    return false;
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

  function processOneListEvent({ element, rawName, strippedName, anchor, hrefYear }, anchorMap, pageYear) {
    log(`Processing list event [#${anchor}] hrefYear="${hrefYear}" "${rawName}"`);

    // ── Year / date-anchor pre-checks (no YEAR page fetch needed) ─────────────
    const dateM     = rawName.match(/^(\d{4}-\d{2}-\d{2})/);
    const eventDate = dateM ? dateM[1] : null;
    const dateYear  = eventDate ? eventDate.slice(0, 4) : null;

    const preIssues = [];
    if (dateYear && hrefYear && !yearMatchesHrefSlug(dateYear, hrefYear)) {
      preIssues.push(`Year mismatch: event date year "${dateYear}" ≠ href year "${hrefYear}"`);
    }
    if (eventDate && anchor) {
      const theoretical = dateToAnchor(eventDate);
      if (theoretical && !anchor.startsWith(theoretical)) {
        preIssues.push(`Date-derived anchor: expected "#${theoretical}" (from ${eventDate}) but href has "#${anchor}"`);
      }
    }

    // Cross-year href: anchor map is built for pageYear, not hrefYear — skip name comparison.
    if (hrefYear && pageYear && hrefYear !== pageYear) {
      logWarn(`  Cross-year href: hrefYear="${hrefYear}" ≠ pageYear="${pageYear}"`);
      addWarningGlyph(element, preIssues.length > 0
        ? preIssues.join('\n')
        : `Cross-year href: event is on ${pageYear}-list but href points to /${hrefYear}`);
      return;
    }

    // ── Name comparison (normal case: hrefYear === pageYear) ───────────────────
    const yearName = anchorMap.get(anchor);
    if (yearName === undefined) {
      logWarn(`  Anchor #${anchor} not found in YEAR page anchor map`);
      const msg = [`Anchor #${anchor} not found on YEAR page`, ...preIssues].join('\n');
      addWarningGlyph(element, msg);
      return;
    }

    const listUpper = strippedName.toUpperCase();
    const yearUpper = yearName.toUpperCase();
    const match     = listUpper === yearUpper;

    log(`  LIST (stripped) : "${listUpper}"`);
    log(`  YEAR page       : "${yearUpper}"`);
    log(`  Result          : ${match ? 'MATCH ✅' : 'MISMATCH ❌'}`);

    addListGlyph(element, match, strippedName, rawName, yearName, anchor);

    // Append pre-checks warning after the glyph if there are issues.
    if (preIssues.length > 0) {
      const sib = element.nextElementSibling;
      const warnSpan = document.createElement('span');
      warnSpan.className = 'bb-anchor-warn';
      warnSpan.textContent = ' ⚠️';
      const msg = preIssues.join('\n');
      warnSpan.addEventListener('mouseenter', e => showErrorTooltip(e, msg));
      warnSpan.addEventListener('mouseleave', hideTooltip);
      (sib && sib.classList.contains('bb-glyph') ? sib : element).after(warnSpan);
    }
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

    return chars.map(c => {
      if (c.match) return `<span class="bb-char-match">${esc(c.ch)}</span>`;
      if (c.ch === ' ') return `<span class="bb-char-diff bb-char-diff-space">&nbsp;</span>`;
      return `<span class="bb-char-diff">${esc(c.ch)}</span>`;
    }).join('');
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
    // Move articles from suffix position to prefix: "Adelphi (The)" → "The Adelphi".
    // Uses a non-anchored in-place replacement so it works for multi-venue strings like
    // "Spotify HQ, Adelphi (The), London" where (The) is not at the end of the whole string.
    rest = rest.replace(/\b([^,(]+?)\s*\((The|Le|De)\)/g, (_, venue, article) => article + ' ' + venue.trim());
    if (rest !== beforeArticle) log(`  article rewrite: "${beforeArticle}" → "${rest}"`);
    const normalized = (date + ' - ' + rest).toUpperCase();
    log(`  Normalized: "${name}" → "${normalized}"`);
    return normalized;
  }

  // ── DOM mutation ──────────────────────────────────────────────────────────

  function addYearGlyph(element, match, isEarlyLate, yearName, normalizedDetailName, rawDetailName, eventType, alias, anchorName = null) {
    const glyph     = match ? '✅' : isEarlyLate ? '⚠️' : '❌';
    const typeSpan  = makeEventTypeSpan(eventType);
    const glyphSpan = makeGlyphSpan(glyph);
    const nodes     = alias ? [typeSpan, glyphSpan, makeAliasSpan(alias)] : [typeSpan, glyphSpan];
    element.after(...nodes);
    const enter = e => showYearTooltip(e, yearName, normalizedDetailName, rawDetailName, eventType, match, isEarlyLate, anchorName);
    [element, typeSpan, glyphSpan].forEach(n => {
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

  function addWarningGlyph(element, reason, eventType = null) {
    const glyphSpan = makeGlyphSpan('⚠️');
    if (eventType) {
      element.after(makeEventTypeSpan(eventType), glyphSpan);
    } else {
      element.after(glyphSpan);
    }
    const msg = 'Error: ' + reason;
    [element, glyphSpan].forEach(n => {
      n.addEventListener('mouseenter', e => showErrorTooltip(e, msg));
      n.addEventListener('mouseleave', hideTooltip);
    });
  }

  function addUnknownGlyph(element, eventType, url) {
    const glyphSpan = makeGlyphSpan('❓');
    element.after(makeEventTypeSpan(eventType), glyphSpan);
    const msg = `Unknown event type: "${eventType}"\n${url}`;
    [element, glyphSpan].forEach(n => {
      n.addEventListener('mouseenter', e => showErrorTooltip(e, msg));
      n.addEventListener('mouseleave', hideTooltip);
    });
  }

  // Returns the event alias from the first tab of a detail page, or null.
  // The alias must be the very first element child of #wiki-tab-0-0, as a
  // <p><strong>…</strong></p>, AND must be immediately followed by <hr> as
  // the second element child.  Both conditions must hold to avoid treating
  // in-page section headers (e.g. "Willie Nile Set") as aliases.
  function extractEventAlias(doc) {
    const tab = doc.getElementById('wiki-tab-0-0');
    if (!tab) return null;
    const kids = tab.children;
    if (kids.length < 2) return null;
    if (kids[1].tagName !== 'HR') return null;
    const first = kids[0];
    if (first.tagName !== 'P') return null;
    const strong = first.querySelector('strong');
    if (!strong || first.textContent.trim() !== strong.textContent.trim()) return null;
    const text = strong.textContent.trim();
    return text || null;
  }

  function makeAliasSpan(alias) {
    const span = document.createElement('span');
    span.className = 'bb-event-alias';
    span.textContent = ` — ${alias}`;
    return span;
  }

  // Returns all timing/scheduling code blocks from a detail page.
  // Blocks are <div class="code"><pre><code>…</code></pre></div> elements.
  // Covers "Scheduled: …", "Local Start Time …", and any future patterns.
  function extractTimingBlocks(doc) {
    const blocks = [];
    for (const code of doc.querySelectorAll('div.code pre code')) {
      const text = code.textContent.trim();
      if (text) blocks.push(text);
    }
    return blocks;
  }

  // Inserts a small styled block containing the timing text after afterEl on
  // the YEAR page. Returns the inserted div for chaining multiple blocks.
  function addScheduledBlock(afterEl, text) {
    const div = document.createElement('div');
    div.className = 'bb-scheduled';
    div.textContent = text;
    afterEl.after(div);
    return div;
  }

  /**
   * Returns the first <a href="/venue:…"> link found in the given document.
   * @param {Document} doc
   * @returns {HTMLAnchorElement|null}
   */
  function findVenueLink(doc) {
    return [...doc.querySelectorAll('a[href]')]
      .find(a => /^\/venue:/.test(a.getAttribute('href') || '')) || null;
  }

  /**
   * Appends venue name (hyperlinked, bold-italic) to the last bb-scheduled div
   * so the whole line reads "Scheduled: … at Venue Name ✅/⚠️".  If there is no
   * scheduled div, inserts a new one after afterEl.
   * @param {HTMLElement} afterEl        Last bb-scheduled div or event heading <p>
   * @param {string}      venueHref      Relative href, e.g. "/venue:state-farm-…"
   * @param {string}      venueName      Text from the venue page's #page-title
   * @param {boolean}     match          True when venueName matches DETAIL event-name venue part
   * @param {string}      detailVenuePart Uppercase venue part from normalizedDetailName
   */
  function renderVenueInfo(afterEl, venueHref, venueName, match, detailVenuePart, prefix = '') {
    const isScheduled = afterEl.classList && afterEl.classList.contains('bb-scheduled');
    let container;
    if (isScheduled) {
      container = afterEl;
    } else {
      container = document.createElement('div');
      container.className = 'bb-scheduled';
      if (prefix) container.appendChild(document.createTextNode(prefix));
      afterEl.after(container);
    }

    container.appendChild(document.createTextNode(' at '));

    const a = document.createElement('a');
    a.href = location.protocol + '//' + location.host + venueHref;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = venueName;
    const em = document.createElement('em');
    const strong = document.createElement('strong');
    strong.style.fontSize = '1.1em';
    em.appendChild(a);
    strong.appendChild(em);
    container.appendChild(strong);

    const msg = match
      ? `Venue match ✅\nVENUE page: "${venueName}"\nDETAIL event: "${detailVenuePart}"`
      : `Venue mismatch ⚠️\nVENUE page: "${venueName}"\nDETAIL event: "${detailVenuePart}"`;
    const glyph = document.createElement('span');
    glyph.className = match ? 'bb-glyph' : 'bb-glyph bb-venue-warn';
    glyph.textContent = match ? ' ✅' : ' ⚠️';
    glyph.style.cursor = 'help';
    glyph.addEventListener('mouseenter', e => showErrorTooltip(e, msg));
    glyph.addEventListener('mouseleave', hideTooltip);
    container.appendChild(glyph);
  }

  // ── Icon click feature ────────────────────────────────────────────────────

  /**
   * Builds a Map of YUI tab label → wiki-tab-0-N index from a detail page doc.
   * @param {Document} doc
   * @returns {Map<string, number>}
   */
  function buildTabMap(doc) {
    const map = new Map();
    doc.querySelectorAll('.yui-nav em').forEach((em, i) =>
      map.set(em.textContent.trim(), i)
    );
    return map;
  }

  /**
   * Returns the wiki-tab-0-N div for the given label, or null if not found.
   * @param {Document} doc
   * @param {Map<string, number>} tabMap
   * @param {string} label
   * @returns {HTMLElement|null}
   */
  function getTabEl(doc, tabMap, label) {
    const idx = tabMap.get(label);
    return idx !== undefined ? doc.getElementById(`wiki-tab-0-${idx}`) : null;
  }

  // Tries 'News/Memorabilia' first, then the short-form 'News' used on older pages.
  function getNewsMemTab(doc, tabMap) {
    return getTabEl(doc, tabMap, 'News/Memorabilia') || getTabEl(doc, tabMap, 'News') || null;
  }

  /** @returns {{type:'gallery', items:{thumbUrl:string,mediumUrl:string}[]}|null} */
  function extractGalleryContent(doc, tabMap) {
    const tab = getTabEl(doc, tabMap, 'Gallery');
    if (!tab) return null;
    const items = [...tab.querySelectorAll('img')].map(img => {
      const thumbUrl  = img.src;
      const linkEl    = img.closest('a[href]');
      const mediumUrl = linkEl ? linkEl.href : thumbUrl.replace('/thumbnail.jpg', '/medium.jpg');
      return { thumbUrl, mediumUrl };
    }).filter(i => i.thumbUrl);
    return items.length ? { type: 'gallery', items } : null;
  }

  /** @returns {{type:'images', caption:string, items:{thumbUrl:string,fullUrl:string}[]}|null} */
  function extractSetlistImages(doc, tabMap) {
    const tab = getNewsMemTab(doc, tabMap);
    if (!tab) return null;
    const items = [...tab.querySelectorAll('img')].filter(img =>
      /setlist/i.test(img.src) && !/ticket/i.test(img.src)
    ).map(img => ({
      thumbUrl: img.src,
      fullUrl:  img.closest('a[href]')?.href || img.src.replace(/\/small\.jpg$|\/thumbnail\.jpg$/, ''),
    }));
    return items.length ? { type: 'images', caption: 'Setlist', items } : null;
  }

  /** @returns {{type:'images', caption:string, items:{thumbUrl:string,fullUrl:string}[]}|null} */
  function extractTicketImages(doc, tabMap) {
    const tab = getNewsMemTab(doc, tabMap);
    if (!tab) return null;
    const items = [...tab.querySelectorAll('img')].filter(img =>
      /ticket/i.test(img.src)
    ).map(img => ({
      thumbUrl: img.src,
      fullUrl:  img.closest('a[href]')?.href || img.src,
    }));
    return items.length ? { type: 'images', caption: 'Tickets', items } : null;
  }

  /** @returns {{type:'links', caption:string, items:{url:string,text:string,source:string}[]}|null} */
  function extractNewsLinks(doc, tabMap) {
    const tab = getNewsMemTab(doc, tabMap);
    if (!tab) return null;
    if (/^Sorry,? no .+ available/.test(tab.textContent.trim())) return null;
    // Tabs populated via wikidot list-pages contain gallery images and rich
    // embedded blocks — render as full HTML instead of extracting sparse links.
    if (tab.querySelector('.list-pages-box')) {
      const clone = tab.cloneNode(true);
      // Strip gallery-box images (already shown via Memorabilia/Setlist/Ticket icons)
      clone.querySelectorAll('.gallery-box, script').forEach(el => el.remove());
      // Strip copyright paragraphs whose only non-whitespace child is a <sup>
      clone.querySelectorAll('p').forEach(p => {
        const meaningful = [...p.childNodes].filter(
          n => !(n.nodeType === 3 && !n.textContent.trim())
        );
        if (meaningful.length === 1 && meaningful[0].nodeName === 'SUP') p.remove();
      });
      // Remove list-pages-item containers that are now empty
      clone.querySelectorAll('.list-pages-item').forEach(item => {
        if (!item.textContent.trim()) item.remove();
      });
      return { type: 'html', caption: 'News', html: clone.innerHTML };
    }
    const items = [...tab.querySelectorAll('a[href]')].filter(a => {
      const href = a.getAttribute('href') || '';
      return href.startsWith('http') && !/\.(jpg|jpeg|png|gif|webp)$/i.test(href);
    }).map(a => {
      let source = '';
      let node = a.nextSibling;
      while (node) {
        if (node.nodeName === 'SUP') { source = node.textContent.trim().replace(/^\(|\)$/g, ''); break; }
        node = node.nextSibling;
      }
      return { url: a.href, text: a.textContent.trim(), source };
    }).filter(l => l.text);
    if (items.length) return { type: 'links', caption: 'News', items };
    return { type: 'html', caption: 'News', html: tab.innerHTML };
  }

  /** @returns {{type:'images', caption:string, items:{thumbUrl:string,fullUrl:string}[]}|null} */
  function extractMemorabilia(doc, tabMap) {
    const tab = getNewsMemTab(doc, tabMap);
    if (!tab) return null;
    const items = [...tab.querySelectorAll('img')].filter(img =>
      /\/news:/.test(img.src)
    ).map(img => ({
      thumbUrl: img.src,
      fullUrl:  img.closest('a[href]')?.href || img.src,
    }));
    return items.length ? { type: 'images', caption: 'Memorabilia', items } : null;
  }

  /** @returns {{type:'html', caption:string, html:string}|null} */
  function extractMediaContent(doc, tabMap) {
    const tab = getTabEl(doc, tabMap, 'Media');
    if (!tab) return null;
    const hasMedia = tab.querySelector('iframe, object, embed, video');
    return hasMedia ? { type: 'html', caption: 'Media', html: tab.innerHTML } : null;
  }

  /**
   * Returns tab HTML if non-empty, null if the tab is absent or shows the
   * "Sorry, no X available" placeholder.
   * @returns {{type:'html', caption:string, html:string}|null}
   */
  function extractTabHtml(doc, tabMap, label, caption) {
    const tab = getTabEl(doc, tabMap, label);
    if (!tab) return null;
    if (/^Sorry,? no .+ available/.test(tab.textContent.trim())) return null;
    return { type: 'html', caption, html: tab.innerHTML };
  }

  /**
   * Returns true when the Recording tab's <hr> separates a genuine LiveDL
   * entry (before) from Bootleg content (after). Detected by the presence of
   * a cover-image container, a nugs.net link, or "Official concert recording"
   * text anywhere in the tab. When false the <hr> is structural (e.g. two
   * unrelated blocks) and Bootleg should show the full tab.
   * @param {HTMLElement} tab
   * @returns {boolean}
   */
  function isLiveDLSplit(tab) {
    return !!(
      tab.querySelector('.image-container, a[href*="nugs.net"]') ||
      /official\s+concert\s+recording/i.test(tab.textContent)
    );
  }

  /**
   * Extracts content from the Recording tab for Bootleg or LiveDL icons.
   *
   * Splits at <hr> only when the content before it is a genuine LiveDL entry
   * (cover image / nugs.net link / "Official concert recording" text). In that
   * case LiveDL receives the slice before <hr> and Bootleg receives the slice
   * after it. Otherwise (no <hr>, or <hr> is a structural separator with no
   * LiveDL content before it) both types return the full tab.
   *
   * @param {Document} doc
   * @param {Map<string,number>} tabMap
   * @param {'Bootleg'|'LiveDL'} canonical
   * @returns {{type:'html', caption:string, html:string}|null}
   */
  function extractRecordingContent(doc, tabMap, canonical) {
    const tab = getTabEl(doc, tabMap, 'Recording');
    if (!tab) return null;
    if (/^Sorry,? no .+ available/.test(tab.textContent.trim())) return null;

    const caption = canonical === 'LiveDL' ? 'Official Live Download' : 'Recording';
    const hr = tab.querySelector('hr');

    if (!hr || !isLiveDLSplit(tab)) {
      if (canonical !== 'LiveDL') {
        return { type: 'html', caption, html: tab.innerHTML };
      }
      // LiveDL with no hr split: still strip retail reference paragraphs.
      const clone = tab.cloneNode(true);
      clone.querySelectorAll('p').forEach(p => {
        if (p.querySelector('a[href^="/retail:"]')) p.remove();
      });
      return { type: 'html', caption, html: clone.innerHTML };
    }

    const clone   = tab.cloneNode(true);
    const hrClone = clone.querySelector('hr');
    const parent  = hrClone.parentElement;

    if (canonical === 'LiveDL') {
      // Remove <hr> and every node after it
      let node = hrClone;
      while (node) {
        const next = node.nextSibling;
        parent.removeChild(node);
        node = next;
      }
      // Strip retail reference paragraphs — shown under the Retail icon instead.
      clone.querySelectorAll('p').forEach(p => {
        if (p.querySelector('a[href^="/retail:"]')) p.remove();
      });
    } else {
      // Remove every node before <hr>, then remove <hr> itself
      let node = parent.firstChild;
      while (node && node !== hrClone) {
        const next = node.nextSibling;
        parent.removeChild(node);
        node = next;
      }
      parent.removeChild(hrClone);
    }

    return { type: 'html', caption, html: clone.innerHTML };
  }

  /**
   * Dispatches to the per-type extractor for a canonical icon type.
   * @param {Document} doc
   * @param {string} canonical
   * @param {Map<string,number>} tabMap
   * @returns {object|null}
   */
  function extractIconContent(doc, canonical, tabMap) {
    switch (canonical) {
      case 'Photo':       return extractGalleryContent(doc, tabMap);
      case 'Setlist':     return extractSetlistImages(doc, tabMap);
      case 'Ticket':      return extractTicketImages(doc, tabMap);
      case 'News':        return extractNewsLinks(doc, tabMap);
      case 'Memorabilia': return extractMemorabilia(doc, tabMap);
      case 'Video':       return extractMediaContent(doc, tabMap);
      case 'Storyteller': return extractTabHtml(doc, tabMap, 'Storyteller', 'Storyteller');
      case 'Eyewitness':  return extractTabHtml(doc, tabMap, 'Eyewitness', 'Eyewitness');
      case 'Bootleg':     return extractRecordingContent(doc, tabMap, 'Bootleg');
      case 'LiveDL':      return extractRecordingContent(doc, tabMap, 'LiveDL');
      default:            return null;
    }
  }

  // ── Lightbox (Photo/Gallery) ───────────────────────────────────────────────

  /** @type {HTMLElement|null} Singleton lightbox grid overlay. */
  let _lightbox = null;
  /** @type {HTMLElement|null} Singleton full-size image viewer (separate body child so display:none on _lightbox doesn't cascade). */
  let _viewer = null;

  /**
   * Lazily creates both the thumbnail-grid lightbox and the full-size viewer,
   * each as independent direct children of document.body.
   */
  function initLightbox() {
    if (_lightbox) return;
    _lightbox = document.createElement('div');
    _lightbox.id = 'bb-lightbox';
    _lightbox.innerHTML = `
      <div id="bb-lightbox-inner">
        <div id="bb-lightbox-header">
          <span id="bb-lightbox-title"></span>
          <button id="bb-lightbox-close">✕</button>
        </div>
        <div id="bb-lightbox-grid"></div>
      </div>`;
    document.body.appendChild(_lightbox);
    _lightbox.addEventListener('click', e => { if (e.target === _lightbox) closeLightbox(); });
    _lightbox.querySelector('#bb-lightbox-close').addEventListener('click', closeLightbox);

    _viewer = document.createElement('div');
    _viewer.id = 'bb-lightbox-viewer';
    _viewer.style.display = 'none';
    _viewer.innerHTML = `
      <button id="bb-lightbox-viewer-close">✕</button>
      <img id="bb-lightbox-viewer-img" alt="">`;
    document.body.appendChild(_viewer);
    _viewer.querySelector('#bb-lightbox-viewer-close').addEventListener('click', () => {
      _viewer.style.display = 'none';
    });
    _viewer.addEventListener('click', e => { if (e.target === _viewer) _viewer.style.display = 'none'; });

    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });
  }

  /**
   * Populates and shows the lightbox for a gallery content object.
   * @param {{type:'gallery', items:{thumbUrl:string,mediumUrl:string}[]}} content
   * @param {string} label  Display label for the title bar.
   */
  function openLightbox(content, label) {
    initLightbox();
    const grid  = _lightbox.querySelector('#bb-lightbox-grid');
    const title = _lightbox.querySelector('#bb-lightbox-title');
    title.textContent = `📷 ${label} — ${content.items.length} photos`;
    grid.innerHTML = '';
    for (const { thumbUrl, mediumUrl } of content.items) {
      const img = document.createElement('img');
      img.src = thumbUrl;
      img.loading = 'lazy';
      img.addEventListener('click', () => {
        _viewer.querySelector('#bb-lightbox-viewer-img').src = mediumUrl;
        _viewer.style.display = 'flex';
      });
      grid.appendChild(img);
    }
    _lightbox.style.display = 'flex';
  }

  /** Closes the lightbox grid and the full-size viewer. */
  function closeLightbox() {
    if (_lightbox) _lightbox.style.display = 'none';
    if (_viewer)   _viewer.style.display   = 'none';
  }

  /**
   * Shows a single full-size image in the viewer overlay without opening the
   * thumbnail grid lightbox.
   * @param {string} src  Full-size image URL.
   */
  function showImageViewer(src) {
    initLightbox();
    _viewer.querySelector('#bb-lightbox-viewer-img').src = src;
    _viewer.style.display = 'flex';
  }

  /**
   * Derives a human-readable caption from an image URL's filename.
   * e.g. ".../20260117_Article_01.jpg/thumbnail.jpg" → "Article 01"
   * @param {string} url
   * @returns {string}
   */
  function filenameCaption(url) {
    const parts = url.split('/');
    const base  = (parts.find(p => /\.(jpg|jpeg|png|gif|webp)$/i.test(p) && /^\d{8}_/.test(p)) || '')
                    .replace(/\.[^.]+$/, '');
    return base.replace(/^\d{8}_/, '').replace(/_/g, ' ');
  }

  // ── Inline panels (all non-photo icons) ───────────────────────────────────

  /**
   * Toggles the inline panel for an icon. Each panel is independent — multiple
   * panels across different events can be open simultaneously.
   * Lazily builds the panel on first click and appends it to section.
   * @param {HTMLImageElement} icon
   * @param {object} content
   * @param {HTMLElement} section  The .bb-section-processed container.
   */
  function toggleIconPanel(icon, content, section) {
    if (!icon._bbPanel) {
      icon._bbPanel = buildIconPanel(content);
      icon._bbPanel._bbIcon = icon;
      section.appendChild(icon._bbPanel);
    }
    const open = icon._bbPanel.style.display !== 'none';
    icon._bbPanel.style.display = open ? 'none' : '';
    icon.classList.toggle('bb-icon-active', !open);
  }

  /**
   * Builds a detached inline panel div for the given content object.
   * @param {object} content
   * @returns {HTMLElement}
   */
  function buildIconPanel(content) {
    const div = document.createElement('div');
    div.className = 'bb-icon-panel';
    div.style.display = 'none';

    const header    = document.createElement('div');
    header.className = 'bb-icon-panel-header';
    const titleSpan = document.createElement('span');
    titleSpan.textContent = content.caption;
    const closeBtn  = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.className  = 'bb-icon-panel-close';
    closeBtn.addEventListener('click', () => {
      div.style.display = 'none';
      if (div._bbIcon) div._bbIcon.classList.remove('bb-icon-active');
    });
    header.append(titleSpan, closeBtn);
    div.appendChild(header);

    const body = document.createElement('div');
    body.className = 'bb-icon-panel-body';

    if (content.type === 'images') {
      body.className += ' bb-icon-thumbnails';
      for (const { thumbUrl, fullUrl } of content.items) {
        const fig     = document.createElement('figure');
        fig.className = 'bb-thumb-item';
        const img     = document.createElement('img');
        img.src       = thumbUrl;
        img.loading   = 'lazy';
        img.addEventListener('click', () => showImageViewer(fullUrl));
        fig.appendChild(img);
        const cap     = filenameCaption(thumbUrl);
        if (cap) {
          const figcap = document.createElement('figcaption');
          figcap.textContent = cap;
          fig.appendChild(figcap);
        }
        body.appendChild(fig);
      }
    } else if (content.type === 'links') {
      for (const { url, text, source } of content.items) {
        const p  = document.createElement('p');
        p.className = 'bb-news-item';
        const a  = document.createElement('a');
        a.href   = url;
        a.target = '_blank';
        a.rel    = 'noopener';
        a.textContent = text;
        p.appendChild(a);
        if (source) {
          const span = document.createElement('span');
          span.className   = 'bb-link-source';
          span.textContent = ` (${source})`;
          p.appendChild(span);
        }
        body.appendChild(p);
      }
    } else if (content.type === 'html') {
      if (content.caption === 'Media') {
        // Extract each embed from its wikidot wrapper into a clean flex item so
        // wikidot's own block/width:100% styles on the wrapper don't fight flex.
        body.className += ' bb-icon-panel-body--media';
        const tmp = document.createElement('div');
        tmp.innerHTML = content.html;
        const embeds = [...tmp.querySelectorAll('iframe, object, embed, video')];
        if (embeds.length > 0) {
          for (const embed of embeds) {
            const item = document.createElement('div');
            item.className = 'bb-media-item';
            item.appendChild(embed);
            body.appendChild(item);
          }
        } else {
          body.innerHTML = content.html;
        }
      } else {
        body.innerHTML = content.html;
      }
      body.querySelectorAll('a[href^="/"]').forEach(a => {
        a.href = 'http://brucebase.wikidot.com' + a.getAttribute('href');
      });
    }

    div.appendChild(body);
    return div;
  }

  /**
   * Fetches each retail page href and builds combined HTML: reference paragraphs
   * from the Recording tab followed by the retail page body (YUI nav and YUI
   * content containers stripped).
   * @param {Element[]} retailParas  <p> elements from Recording tab with retail links.
   * @param {string[]}  retailHrefs  Deduplicated /retail:… hrefs to fetch.
   * @returns {Promise<{type:'html', caption:string, html:string}>}
   */
  async function buildRetailContent(retailParas, retailHrefs) {
    let html = '<div class="bb-retail-refs">';
    for (const p of retailParas) {
      html += p.outerHTML;
    }
    html += '</div>';

    for (const href of retailHrefs) {
      try {
        const retailDoc = await fetchPage('http://brucebase.wikidot.com' + href);
        const content   = retailDoc.querySelector('#page-content');
        if (content) {
          const clone = content.cloneNode(true);

          // Strip <script> tags — they don't execute via innerHTML but add noise.
          clone.querySelectorAll('script').forEach(el => el.remove());

          // Strip footer: find the disclaimer link, walk up to its direct-child-of-clone
          // ancestor div, then also remove the <hr> that immediately precedes it.
          const disclaimerLink = clone.querySelector('a[href="/content:disclaimer"]');
          if (disclaimerLink) {
            let footerEl = disclaimerLink;
            while (footerEl.parentElement && footerEl.parentElement !== clone) {
              footerEl = footerEl.parentElement;
            }
            const prevSib = footerEl.previousElementSibling;
            if (prevSib && prevSib.tagName === 'HR') prevSib.remove();
            footerEl.remove();
          }

          // Flatten each YUI navset into labeled tab panels so tab content is visible.
          clone.querySelectorAll('.yui-navset').forEach(navset => {
            const labels = [...navset.querySelectorAll('ul.yui-nav li')]
              .map(li => li.querySelector('em')?.textContent.trim() ?? li.textContent.trim());
            const panels = [...(navset.querySelector('div.yui-content')?.children ?? [])];
            const wrapper = document.createElement('div');
            wrapper.className = 'bb-retail-tabs';
            panels.forEach((panel, i) => {
              if (labels[i]) {
                const lbl = document.createElement('p');
                lbl.innerHTML = `<strong class="bb-retail-tab-label">${esc(labels[i])}</strong>`;
                wrapper.appendChild(lbl);
              }
              panel.style.removeProperty('display');
              wrapper.appendChild(panel.cloneNode(true));
            });
            navset.replaceWith(wrapper);
          });

          html += '<hr style="margin:8px 0;">' + clone.innerHTML;
        }
      } catch (e) {
        html += `<p style="color:#c00">Failed to fetch ${esc(href)}: ${esc(e.message)}</p>`;
      }
    }
    return { type: 'html', caption: 'Retail', html };
  }

  /**
   * Wires the Retail icon: scans the Recording tab for paragraphs containing
   * /retail: links. Adds a warning glyph if none are found; otherwise makes the
   * icon clickable — first click lazily fetches retail pages and builds the panel.
   * @param {HTMLImageElement}   icon      The Retail icon image.
   * @param {Document}           doc       Parsed DETAIL page.
   * @param {Map<string,number>} tabMap    Tab label → index map for doc.
   * @param {HTMLElement}        section   Containing .bb-section-processed div.
   * @param {string}             rawTitle  Icon title before any suffix was added.
   */
  function wireRetailIcon(icon, doc, tabMap, section, rawTitle) {
    const recTab    = getTabEl(doc, tabMap, 'Recording');
    const retailParas = [];
    const retailHrefs = new Set();

    if (recTab) {
      for (const p of recTab.querySelectorAll('p')) {
        if (p.querySelector('a[href^="/retail:"]')) {
          retailParas.push(p);
          for (const a of p.querySelectorAll('a[href^="/retail:"]')) {
            retailHrefs.add(a.getAttribute('href'));
          }
        }
      }
    }

    if (retailParas.length === 0) {
      const warn = document.createElement('span');
      warn.className  = 'bb-glyph bb-icon-sorry';
      warn.textContent = '⚠️';
      warn.dataset.msg = 'Retail icon on YEAR page but no retail reference found in the Recording tab.';
      warn.addEventListener('mouseenter', e => showErrorTooltip(e, warn.dataset.msg));
      warn.addEventListener('mouseleave', hideTooltip);
      icon.after(warn);
      icon.style.opacity = '0.45';
      return;
    }

    icon.style.cursor = 'pointer';
    icon.title = `${rawTitle} — click to expand`;
    const hrefs = [...retailHrefs];

    icon.addEventListener('click', async () => {
      if (icon._bbRetailLoading) return;
      if (icon._bbPanel) {
        const open = icon._bbPanel.style.display !== 'none';
        icon._bbPanel.style.display = open ? 'none' : '';
        icon.classList.toggle('bb-icon-active', !open);
        return;
      }
      icon._bbRetailLoading = true;
      icon.style.cursor = 'wait';
      icon.classList.add('bb-icon-active');
      try {
        const content    = await buildRetailContent(retailParas, hrefs);
        icon._bbPanel    = buildIconPanel(content);
        icon._bbPanel._bbIcon = icon;
        section.appendChild(icon._bbPanel);
        icon._bbPanel.style.display = '';
      } catch (e) {
        logWarn('  Retail panel build failed:', e.message);
        icon.classList.remove('bb-icon-active');
      } finally {
        icon._bbRetailLoading = false;
        icon.style.cursor = 'pointer';
      }
    });
  }

  /**
   * Scans icon images in the event's section, attaches click handlers for
   * actionable icons (as determined by ICON_TITLE_MAP) that have extractable
   * content from doc.
   * @param {HTMLElement} eventLink  The event <a> element on the YEAR page.
   * @param {Document}    doc        Parsed detail page document.
   */
  /**
   * Appends a row of small buttons for DETAIL page tabs that are not already
   * covered by an icon image (e.g. "Light Of Day", "Performances"). Each
   * button toggles an inline panel showing that tab's content, using the same
   * buildIconPanel infrastructure as the icon handlers.
   * @param {Document}          doc
   * @param {Map<string,number>} tabMap
   * @param {HTMLElement}       section
   */
  /**
   * Creates the fixed-width label span that precedes each tab button row.
   * @param {string} text  e.g. "Event:" or "Venue:"
   * @returns {HTMLElement}
   */
  function makeTabRowLabel(text) {
    const span = document.createElement('span');
    span.className = 'bb-tab-row-label';
    span.textContent = text;
    return span;
  }

  function addEventTabButtons(doc, tabMap, section) {
    const row = document.createElement('div');
    row.className = 'bb-event-tab-row';
    row.appendChild(makeTabRowLabel('Event:'));

    for (const [label] of tabMap) {
      if (ICON_COVERED_TABS.has(label) || SKIP_TABS.has(label)) continue;
      const tab = getTabEl(doc, tabMap, label);
      if (!tab) continue;
      const text = tab.textContent.trim();
      if (!text || /^Sorry,? no .+ available/.test(text)) continue;

      const content = { type: 'html', caption: label, html: tab.innerHTML };
      const btn = document.createElement('button');
      btn.className = 'bb-event-tab-btn';
      btn.textContent = label;
      btn.title = `Click to expand/collapse the ${label} panel`;

      btn.addEventListener('click', () => {
        if (!btn._bbPanel) {
          btn._bbPanel = buildIconPanel(content);
          btn._bbPanel._bbIcon = btn;
          section.appendChild(btn._bbPanel);
        }
        const open = btn._bbPanel.style.display !== 'none';
        btn._bbPanel.style.display = open ? 'none' : '';
        btn.classList.toggle('bb-icon-active', !open);
      });

      row.appendChild(btn);
    }

    if (row.children.length > 1) section.appendChild(row);
  }

  /**
   * Returns the set of lowercase tag strings expected for a Brucebase event
   * based on its date, event type, and DETAIL page tab content.
   * @param {Document}           doc       - DETAIL page document.
   * @param {Map<string,number>} tabMap
   * @param {string|null}        eventDate - "YYYY-MM-DD", or null if unknown.
   * @param {string}             eventType - "gig" | "recording" | etc.
   * @returns {Set<string>}
   */
  /**
   * Returns true when an expected tag string is satisfied by the actual tag set.
   * For purely numeric tags (day numbers), both the zero-padded form ("07") and
   * the stripped form ("7") are accepted so that either brucebase convention works.
   * @param {string}      tag
   * @param {Set<string>} actualTags
   * @returns {boolean}
   */
  function isTagPresent(tag, actualTags) {
    if (actualTags.has(tag)) return true;
    if (/^\d+$/.test(tag)) {
      const stripped = String(parseInt(tag, 10));
      const padded   = stripped.padStart(2, '0');
      return actualTags.has(stripped) || actualTags.has(padded);
    }
    return false;
  }

  /**
   * Returns true when a tag string is one whose presence can be verified
   * against DETAIL page data (content-based, date-based, or event-type tags).
   * Tags outside this set (venue names, song abbreviations, etc.) are ignored.
   * @param {string} tag
   * @returns {boolean}
   */
  function isManagedTag(tag) {
    if (MANAGED_CONTENT_TAGS.has(tag)) return true;
    if (MONTH_NAMES.includes(tag) || DAY_NAMES.includes(tag)) return true;
    if (/^\d{4}$/.test(tag)) return true;
    if (/^\d{1,2}$/.test(tag) && parseInt(tag, 10) >= 1 && parseInt(tag, 10) <= 31) return true;
    return false;
  }

  /**
   * Builds a human-readable tooltip message for a tag that is present on the
   * page but whose expected condition is NOT met (a "spurious" tag).
   * @param {string}      tag
   * @param {Set<string>} expectedTags - Result of computeExpectedTags().
   * @returns {string}
   */
  function spuriousTagMsg(tag, expectedTags) {
    if (SPURIOUS_TAG_REASONS[tag]) return `Tag "${tag}" is present but: ${SPURIOUS_TAG_REASONS[tag]}`;
    if (/^\d{4}$/.test(tag)) {
      const exp = [...expectedTags].find(t => /^\d{4}$/.test(t)) || '?';
      return `Year tag "${tag}" present but event year is "${exp}"`;
    }
    if (MONTH_NAMES.includes(tag)) {
      const exp = [...expectedTags].find(t => MONTH_NAMES.includes(t)) || '?';
      return `Month tag "${tag}" present but event month is "${exp}"`;
    }
    if (DAY_NAMES.includes(tag)) {
      const exp = [...expectedTags].find(t => DAY_NAMES.includes(t)) || '?';
      return `Weekday tag "${tag}" present but event weekday is "${exp}"`;
    }
    if (/^\d{1,2}$/.test(tag) && parseInt(tag, 10) <= 31) {
      const exp = [...expectedTags].find(t => /^\d+$/.test(t) && !/^\d{4}$/.test(t)) || '?';
      return `Day tag "${tag}" present but event day is "${exp}"`;
    }
    const expType = [...expectedTags].find(t => KNOWN_EVENT_TYPES.has(t));
    if (expType) return `Event-type tag "${tag}" present but event type is "${expType}"`;
    return `Tag "${tag}" is present but its expected condition was not detected`;
  }

  function computeExpectedTags(doc, tabMap, eventDate, eventType) {
    const expected = new Set();

    const dm = (eventDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dm) {
      const [, yr, mo, dd] = dm;
      expected.add(yr);
      expected.add(MONTH_NAMES[parseInt(mo, 10) - 1]);
      expected.add(String(parseInt(dd, 10)));
      const dayNum = parseInt(dd, 10);
      if (dayNum > 0) {
        const d = new Date(parseInt(yr, 10), parseInt(mo, 10) - 1, dayNum);
        if (!isNaN(d.getTime())) expected.add(DAY_NAMES[d.getDay()]);
      }
    }

    if (eventType) expected.add(eventType.toLowerCase());

    // Recording tab: distinguish bootleg from LiveDL.
    const recTab = getTabEl(doc, tabMap, 'Recording');
    if (recTab && !SORRY_RE.test(recTab.textContent.trim())) {
      const liveDL = isLiveDLSplit(recTab);
      const hasHr  = !!recTab.querySelector('hr');
      if (liveDL)           expected.add('livedl');
      if (!liveDL || hasHr) expected.add('bootleg');  // not purely LiveDL
    }

    // News/Memorabilia tab: news, memorabilia, ticket, setlist subtypes.
    const newsMemTab = getNewsMemTab(doc, tabMap);
    if (newsMemTab && !SORRY_RE.test(newsMemTab.textContent.trim())) {
      expected.add('news');
      if (tabMap.has('News/Memorabilia')) expected.add('memorabilia');
      const imgs = [...newsMemTab.querySelectorAll('img')];
      if (imgs.some(img => /ticket/i.test(img.src))) expected.add('ticket');
      const setlistImgs = imgs.filter(img => /setlist/i.test(img.src) && !/ticket/i.test(img.src));
      if (setlistImgs.length > 0) {
        expected.add('setlist');
        if (setlistImgs.some(img => /handwritten/i.test(img.src))) expected.add('handwritten');
        if (setlistImgs.some(img => /printed/i.test(img.src)))     expected.add('printed');
      }
    }

    // Soundcheck section label in page content.
    const pageContent = doc.querySelector('#page-content') || doc.body;
    if (/\bsoundcheck\s*:/i.test(pageContent.textContent)) expected.add('soundcheck');

    // Storyteller tab.
    const storytellerTab = getTabEl(doc, tabMap, 'Storyteller');
    if (storytellerTab && !SORRY_RE.test(storytellerTab.textContent.trim())) expected.add('storyteller');

    return expected;
  }

  /**
   * Appends a "Tags" button to the event's .bb-event-tab-row on the YEAR page.
   * The panel lists all DETAIL page tags as hyperlinks; expected-but-missing
   * tags are shown in bold red with a ⚠️ indicator. The button label also turns
   * red and shows the missing count when issues are found.
   * @param {Document}           doc
   * @param {Map<string,number>} tabMap
   * @param {HTMLElement}        section   - .bb-section-processed element.
   * @param {HTMLElement}        eventLink - The event <a> element on the YEAR page.
   */
  function addTagsButton(doc, tabMap, section, eventLink) {
    const tagsEl = doc.querySelector('.page-tags');
    if (!tagsEl) return;
    const tagLinks = [...tagsEl.querySelectorAll('a[href]')];
    if (tagLinks.length === 0) return;

    const href      = eventLink.getAttribute('href') || '';
    const typeM     = href.match(/^\/([a-z]+):/);
    const eventType = typeM ? typeM[1] : '';
    const dateM     = eventLink.textContent.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    const eventDate = dateM ? dateM[1] : null;

    const actualTags   = new Set(tagLinks.map(a => a.textContent.trim().toLowerCase()));
    const expectedTags = computeExpectedTags(doc, tabMap, eventDate, eventType);
    const missingTags  = [...expectedTags].filter(t => !isTagPresent(t, actualTags)).sort();

    // Merge existing tag links (with spurious flag) + missing placeholders → sorted.
    const existingItems = tagLinks.map(a => {
      const tag      = a.textContent.trim().toLowerCase();
      const spurious = isManagedTag(tag) && !isTagPresent(tag, expectedTags);
      return { tag, html: a.outerHTML, missing: false, spurious, tooltip: spurious ? spuriousTagMsg(tag, expectedTags) : '' };
    });
    const missingItems = missingTags.map(tag => ({ tag, html: null, missing: true, spurious: false, tooltip: '' }));
    const allItems = [...existingItems, ...missingItems].sort((a, b) => a.tag.localeCompare(b.tag));

    const spuriousCount = existingItems.filter(i => i.spurious).length;
    const issueParts = [];
    if (missingTags.length > 0)  issueParts.push(`${missingTags.length} missing`);
    if (spuriousCount > 0)       issueParts.push(`${spuriousCount} spurious`);

    let html = '';
    if (missingTags.length > 0) {
      html += '<p style="color:red; font-weight:bold; margin:0 0 6px 0">⚠️ Missing expected tags:</p>';
    }
    html += '<ol class="bb-tags-list" style="margin:4px 0; padding-left:18px;">';
    for (const item of allItems) {
      if (item.missing) {
        html += `<li style="color:red; font-weight:bold">⚠️ ${esc(item.tag)}</li>`;
      } else if (item.spurious) {
        html += `<li>${item.html} <span style="color:darkorange; font-weight:bold; cursor:help" title="${esc(item.tooltip)}">⚠️</span></li>`;
      } else {
        html += `<li>${item.html}</li>`;
      }
    }
    html += '</ol>';

    const content = { type: 'html', caption: 'Tags', html };
    let row = section.querySelector('.bb-event-tab-row');
    if (!row) {
      row = document.createElement('div');
      row.className = 'bb-event-tab-row';
      row.appendChild(makeTabRowLabel('Event:'));
      section.appendChild(row);
    }

    const btn = document.createElement('button');
    btn.className = 'bb-event-tab-btn';
    btn.textContent = issueParts.length > 0 ? `Tags ⚠️ (${issueParts.join(', ')})` : 'Tags';
    btn.title = issueParts.length > 0
      ? `Tags panel — issues detected: ${issueParts.join(', ')}`
      : 'Click to expand/collapse the Tags panel';
    if (missingTags.length > 0)      btn.style.color = 'red';
    else if (spuriousCount > 0)      btn.style.color = 'darkorange';

    btn.addEventListener('click', () => {
      if (!btn._bbPanel) {
        btn._bbPanel = buildIconPanel(content);
        btn._bbPanel._bbIcon = btn;
        section.appendChild(btn._bbPanel);
      }
      const open = btn._bbPanel.style.display !== 'none';
      btn._bbPanel.style.display = open ? 'none' : '';
      btn.classList.toggle('bb-icon-active', !open);
    });

    row.appendChild(btn);
  }

  /**
   * Returns the set of lowercase tags expected for a venue page.
   * Currently: "venue" (always) and the first letter of the venue name.
   * @param {string} venueName  - Text from the venue page's #page-title.
   * @returns {Set<string>}
   */
  function computeExpectedVenueTags(venueName) {
    const expected = new Set(['venue']);
    const first = (venueName || '').trim()[0];
    if (first && /[a-z]/i.test(first)) expected.add(first.toLowerCase());
    return expected;
  }

  /**
   * Returns true for venue-page tags whose presence can be verified:
   * the "venue" tag and single lowercase letter tags (first-letter index).
   * @param {string} tag
   * @returns {boolean}
   */
  function isManagedVenueTag(tag) {
    return tag === 'venue' || /^[a-z]$/.test(tag);
  }

  /**
   * Appends a row of buttons (.bb-venue-tab-row) for the venue page tabs,
   * plus a "Tags" button with consistency checks for the venue page tags.
   * Called after wireIconHandlers so the venue row appears after the event row.
   * @param {Document}    venueDoc   - Parsed venue page document.
   * @param {string}      venueHref  - Relative href, e.g. "/venue:blue-cross-…"
   * @param {string}      venueName  - Text from the venue page's #page-title.
   * @param {HTMLElement} section    - .bb-section-processed container.
   */
  function addVenueTabButtons(venueDoc, venueHref, venueName, section) {
    const venueTabMap = buildTabMap(venueDoc);
    const row = document.createElement('div');
    row.className = 'bb-venue-tab-row';
    row.appendChild(makeTabRowLabel('Venue:'));

    for (const [label] of venueTabMap) {
      const tab = getTabEl(venueDoc, venueTabMap, label);
      if (!tab) continue;
      const text = tab.textContent.trim();
      if (!text || SORRY_RE.test(text)) continue;

      const html = tab.innerHTML
        .replace(/href="\//g, `href="${location.protocol}//${location.host}/`);
      const content = { type: 'html', caption: `Venue: ${label}`, html };
      const btn = document.createElement('button');
      btn.className = 'bb-venue-tab-btn';
      btn.textContent = label;
      btn.title = `Venue page tab — click to expand/collapse: ${label}`;

      btn.addEventListener('click', () => {
        if (!btn._bbPanel) {
          btn._bbPanel = buildIconPanel(content);
          btn._bbPanel._bbIcon = btn;
          section.appendChild(btn._bbPanel);
        }
        const open = btn._bbPanel.style.display !== 'none';
        btn._bbPanel.style.display = open ? 'none' : '';
        btn.classList.toggle('bb-icon-active', !open);
      });

      row.appendChild(btn);
    }

    // Tags button for the venue page
    addVenueTagsButton(venueDoc, venueName, section, row);

    if (row.children.length > 1) section.appendChild(row);
  }

  /**
   * Appends a "Tags" button (inside row) that shows the venue page's .page-tags
   * with consistency checks: "venue" and the first-letter tag are always expected.
   * @param {Document}    venueDoc   - Parsed venue page document.
   * @param {string}      venueName  - Text from the venue page's #page-title.
   * @param {HTMLElement} section    - .bb-section-processed container (panel host).
   * @param {HTMLElement} row        - .bb-venue-tab-row to append the button to.
   */
  function addVenueTagsButton(venueDoc, venueName, section, row) {
    const tagsEl = venueDoc.querySelector('.page-tags');
    if (!tagsEl) return;
    const tagLinks = [...tagsEl.querySelectorAll('a[href]')];
    if (tagLinks.length === 0) return;

    const actualTags   = new Set(tagLinks.map(a => a.textContent.trim().toLowerCase()));
    const expectedTags = computeExpectedVenueTags(venueName);
    const missingTags  = [...expectedTags].filter(t => !actualTags.has(t)).sort();

    const existingItems = tagLinks.map(a => {
      const tag     = a.textContent.trim().toLowerCase();
      const spurious = isManagedVenueTag(tag) && !expectedTags.has(tag);
      const tooltip  = spurious ? `Tag "${tag}" is present but not expected for this venue` : '';
      return { tag, html: a.outerHTML, missing: false, spurious, tooltip };
    });
    const missingItems = missingTags.map(tag => ({ tag, html: null, missing: true, spurious: false, tooltip: '' }));
    const allItems = [...existingItems, ...missingItems].sort((a, b) => a.tag.localeCompare(b.tag));

    const spuriousCount = existingItems.filter(i => i.spurious).length;
    const issueParts = [];
    if (missingTags.length > 0) issueParts.push(`${missingTags.length} missing`);
    if (spuriousCount > 0)      issueParts.push(`${spuriousCount} spurious`);

    let html = '';
    if (missingTags.length > 0) {
      html += '<p style="color:red; font-weight:bold; margin:0 0 6px 0">⚠️ Missing expected venue tags:</p>';
    }
    html += '<ol class="bb-tags-list" style="margin:4px 0; padding-left:18px;">';
    for (const item of allItems) {
      if (item.missing) {
        html += `<li style="color:red; font-weight:bold">⚠️ ${esc(item.tag)}</li>`;
      } else if (item.spurious) {
        html += `<li>${item.html} <span style="color:darkorange; font-weight:bold; cursor:help" title="${esc(item.tooltip)}">⚠️</span></li>`;
      } else {
        html += `<li>${item.html}</li>`;
      }
    }
    html += '</ol>';

    const content = { type: 'html', caption: 'Venue Tags', html };
    const btn = document.createElement('button');
    btn.className = 'bb-venue-tab-btn';
    btn.textContent = issueParts.length > 0 ? `Tags ⚠️ (${issueParts.join(', ')})` : 'Tags';
    btn.title = issueParts.length > 0
      ? `Venue Tags panel — issues detected: ${issueParts.join(', ')}`
      : 'Click to expand/collapse the Venue Tags panel';
    if (missingTags.length > 0)  btn.style.color = 'red';
    else if (spuriousCount > 0)  btn.style.color = 'darkorange';

    btn.addEventListener('click', () => {
      if (!btn._bbPanel) {
        btn._bbPanel = buildIconPanel(content);
        btn._bbPanel._bbIcon = btn;
        section.appendChild(btn._bbPanel);
      }
      const open = btn._bbPanel.style.display !== 'none';
      btn._bbPanel.style.display = open ? 'none' : '';
      btn.classList.toggle('bb-icon-active', !open);
    });

    row.appendChild(btn);
  }

  // ── Song tab rows (triggered from list-view number clicks) ────────────────

  /**
   * Returns the set of lowercase tags expected on a SONG page.
   * @param {Document}           songDoc
   * @param {Map<string,number>} songTabMap
   * @param {string}             songName  - Display name from the <a> text.
   * @returns {Set<string>}
   */
  function computeExpectedSongTags(songDoc, songTabMap, songName) {
    const expected = new Set(['song']);
    const first = (songName || '').trim()[0];
    if (first && /[a-z]/i.test(first)) expected.add(first.toLowerCase());

    // lyricsheet: Gallery tab has images with "lyricsheet" in src.
    const galleryTab = getTabEl(songDoc, songTabMap, 'Gallery');
    if (galleryTab && [...galleryTab.querySelectorAll('img')]
        .some(img => /lyricsheet/i.test(img.src || img.getAttribute('src') || ''))) {
      expected.add('lyricsheet');
    }

    return expected;
  }

  /**
   * Returns true for song-page tags whose presence can be verified.
   * @param {string} tag
   * @returns {boolean}
   */
  function isManagedSongTag(tag) {
    return tag === 'song' || tag === 'lyricsheet' || /^[a-z]$/.test(tag);
  }

  /**
   * Appends a "Tags" button (inside row) for the song page's .page-tags.
   * Consistency checks: "song", first-letter, and "lyricsheet" are managed.
   * @param {Document}           songDoc
   * @param {Map<string,number>} songTabMap
   * @param {string}             songName
   * @param {HTMLElement}        section
   * @param {HTMLElement}        row
   */
  function addSongTagsButton(songDoc, songTabMap, songName, section, row) {
    const tagsEl = songDoc.querySelector('.page-tags');
    if (!tagsEl) return;
    const tagLinks = [...tagsEl.querySelectorAll('a[href]')];
    if (tagLinks.length === 0) return;

    const actualTags   = new Set(tagLinks.map(a => a.textContent.trim().toLowerCase()));
    const expectedTags = computeExpectedSongTags(songDoc, songTabMap, songName);
    const missingTags  = [...expectedTags].filter(t => !actualTags.has(t)).sort();

    const existingItems = tagLinks.map(a => {
      const tag     = a.textContent.trim().toLowerCase();
      const spurious = isManagedSongTag(tag) && !expectedTags.has(tag);
      const tooltip  = spurious ? `Tag "${tag}" is present but not expected for this song` : '';
      return { tag, html: a.outerHTML, missing: false, spurious, tooltip };
    });
    const missingItems = missingTags.map(tag => ({ tag, html: null, missing: true, spurious: false, tooltip: '' }));
    const allItems = [...existingItems, ...missingItems].sort((a, b) => a.tag.localeCompare(b.tag));

    const spuriousCount = existingItems.filter(i => i.spurious).length;
    const issueParts = [];
    if (missingTags.length > 0) issueParts.push(`${missingTags.length} missing`);
    if (spuriousCount > 0)      issueParts.push(`${spuriousCount} spurious`);

    let html = '';
    if (missingTags.length > 0) {
      html += '<p style="color:red; font-weight:bold; margin:0 0 6px 0">⚠️ Missing expected song tags:</p>';
    }
    html += '<ol class="bb-tags-list" style="margin:4px 0; padding-left:18px;">';
    for (const item of allItems) {
      if (item.missing) {
        html += `<li style="color:red; font-weight:bold">⚠️ ${esc(item.tag)}</li>`;
      } else if (item.spurious) {
        html += `<li>${item.html} <span style="color:darkorange; font-weight:bold; cursor:help" title="${esc(item.tooltip)}">⚠️</span></li>`;
      } else {
        html += `<li>${item.html}</li>`;
      }
    }
    html += '</ol>';

    const content = { type: 'html', caption: `${songName} — Tags`, html };
    const btn = document.createElement('button');
    btn.className = 'bb-song-tab-btn';
    btn.textContent = issueParts.length > 0 ? `Tags ⚠️ (${issueParts.join(', ')})` : 'Tags';
    btn.title = issueParts.length > 0
      ? `Song Tags — issues: ${issueParts.join(', ')}`
      : 'Click to expand/collapse the Song Tags panel';
    if (missingTags.length > 0)  btn.style.color = 'red';
    else if (spuriousCount > 0)  btn.style.color = 'darkorange';

    btn.addEventListener('click', () => {
      if (!btn._bbPanel) {
        btn._bbPanel = buildIconPanel(content);
        btn._bbPanel._bbIcon = btn;
        section.appendChild(btn._bbPanel);
      }
      const open = btn._bbPanel.style.display !== 'none';
      btn._bbPanel.style.display = open ? 'none' : '';
      btn.classList.toggle('bb-icon-active', !open);
    });

    row.appendChild(btn);
  }

  /**
   * Fetches a song page and appends a .bb-song-tab-row to section.
   * Returns the row element, or null when the song page has no usable content.
   * @param {Document}    songDoc
   * @param {string}      songName
   * @param {HTMLElement} section
   * @returns {HTMLElement|null}
   */
  function addSongTabButtons(songDoc, songName, section) {
    const songTabMap = buildTabMap(songDoc);
    const row = document.createElement('div');
    row.className = 'bb-song-tab-row';

    const label = document.createElement('span');
    label.className = 'bb-song-tab-label';
    label.textContent = songName + ':';
    label.title = songName;
    row.appendChild(label);

    for (const [tabLabel] of songTabMap) {
      const tab = getTabEl(songDoc, songTabMap, tabLabel);
      if (!tab) continue;
      const text = tab.textContent.trim();
      if (!text || SORRY_RE.test(text)) continue;

      const html = tab.innerHTML
        .replace(/href="\//g, `href="${location.protocol}//${location.host}/`);
      const content = { type: 'html', caption: `${songName} — ${tabLabel}`, html };
      const btn = document.createElement('button');
      btn.className = 'bb-song-tab-btn';
      btn.textContent = tabLabel;
      btn.title = `Song tab — click to expand/collapse: ${tabLabel}`;

      btn.addEventListener('click', () => {
        if (!btn._bbPanel) {
          btn._bbPanel = buildIconPanel(content);
          btn._bbPanel._bbIcon = btn;
          section.appendChild(btn._bbPanel);
        }
        const open = btn._bbPanel.style.display !== 'none';
        btn._bbPanel.style.display = open ? 'none' : '';
        btn.classList.toggle('bb-icon-active', !open);
      });

      row.appendChild(btn);
    }

    addSongTagsButton(songDoc, songTabMap, songName, section, row);

    if (row.children.length <= 1) return null;  // only the label, nothing to show
    section.appendChild(row);
    return row;
  }

  /**
   * Fetches a song page on demand (first click) or toggles an already-loaded row.
   * The section element caches loaded rows in section._bbSongRows (Map<href, row>).
   * @param {string}      songHref  e.g. "/song:night"
   * @param {string}      songName  Display name for the label prefix
   * @param {HTMLElement} section   .bb-section-processed container
   * @param {HTMLAnchorElement} numLink  The number link that was clicked
   */
  async function fetchAndToggleSongTabRow(songHref, songName, section, numLink) {
    if (!section._bbSongRows) section._bbSongRows = new Map();

    const existing = section._bbSongRows.get(songHref);
    if (existing) {
      const visible = existing.style.display !== 'none';
      existing.style.display = visible ? 'none' : '';
      numLink.classList.toggle('bb-song-loaded', !visible);
      return;
    }

    numLink.classList.add('bb-song-loading');
    numLink.title = `Loading ${songName}…`;

    try {
      const url     = `${location.protocol}//${location.host}${songHref}`;
      const songDoc = await fetchPage(url);
      const row     = addSongTabButtons(songDoc, songName, section);
      numLink.classList.remove('bb-song-loading');
      if (row) {
        section._bbSongRows.set(songHref, row);
        numLink.classList.add('bb-song-loaded');
        numLink.title = `${songName} — click to show/hide`;
      } else {
        numLink.title = `${songName} — no song tab content found`;
      }
    } catch (e) {
      numLink.classList.remove('bb-song-loading');
      numLink.title = `${songName} — fetch failed: ${e.message}`;
      logWarn(`  Song page fetch failed for ${songHref}:`, e.message);
    }
  }

  /**
   * On DETAIL pages: wraps .page-tags in a yellow warning box and appends
   * expected-but-missing tags as bold-red spans inside the tag container.
   * No-op when all expected tags are present.
   * @param {Map<string,number>} tabMap
   * @param {string}             eventDate  - "YYYY-MM-DD"
   * @param {string}             eventType  - "gig" | "recording" | etc.
   */
  function annotateDetailPageTags(tabMap, eventDate, eventType) {
    const tagsContainer = document.querySelector('.page-tags');
    if (!tagsContainer) return;

    const tagLinks     = [...tagsContainer.querySelectorAll('a[href]')];
    const actualTags   = new Set(tagLinks.map(a => a.textContent.trim().toLowerCase()));
    const expectedTags = computeExpectedTags(document, tabMap, eventDate, eventType);
    const missingTags  = [...expectedTags].filter(t => !isTagPresent(t, actualTags)).sort();
    const spuriousLinks = tagLinks.filter(a => {
      const tag = a.textContent.trim().toLowerCase();
      return isManagedTag(tag) && !isTagPresent(tag, expectedTags);
    });

    if (missingTags.length === 0 && spuriousLinks.length === 0) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'bb-tags-warn-box';
    wrapper.style.cssText = 'border:3px solid gold; background:#fffbe6; padding:6px 10px; border-radius:4px; margin:4px 0;';
    tagsContainer.parentNode.insertBefore(wrapper, tagsContainer);
    wrapper.appendChild(tagsContainer);

    // Flag spurious tags with an orange ⚠️ icon next to the tag link.
    for (const a of spuriousLinks) {
      const tag     = a.textContent.trim().toLowerCase();
      const msg     = spuriousTagMsg(tag, expectedTags);
      const warnSpan = document.createElement('span');
      warnSpan.className = 'bb-tag-spurious';
      warnSpan.style.cssText = 'color:darkorange; font-weight:bold; cursor:help; margin:0 2px;';
      warnSpan.textContent = '⚠️';
      warnSpan.title = msg;
      warnSpan.addEventListener('mouseenter', e => showErrorTooltip(e, msg));
      warnSpan.addEventListener('mouseleave', hideTooltip);
      a.after(warnSpan);
    }

    // Append missing tags in bold red inside the tag span.
    const span = tagsContainer.querySelector('span') || tagsContainer;
    for (const tag of missingTags) {
      const missingSpan = document.createElement('span');
      missingSpan.className = 'bb-tag-missing';
      missingSpan.style.cssText = 'color:red; font-weight:bold; margin:0 3px;';
      missingSpan.title = `Tag "${tag}" expected based on event data but not present`;
      missingSpan.textContent = ` ⚠️${tag}`;
      span.appendChild(missingSpan);
    }
  }

  function wireIconHandlers(eventLink, doc) {
    const section = eventLink.closest('.bb-section-processed');
    if (!section) return;
    const tabMap = buildTabMap(doc);
    for (const icon of section.querySelectorAll('img.image')) {
      // Unwrap real navigation <a> parents (e.g. /stats:Official%20Live%20Downloads)
      // so clicks reach our handler instead of navigating away.
      const iconParent = icon.parentElement;
      if (iconParent && iconParent.tagName === 'A') {
        const href = iconParent.getAttribute('href') || '';
        if (href && !/^javascript:/i.test(href)) {
          iconParent.replaceWith(...iconParent.childNodes);
        }
      }
      // Strip suffix added on a previous run so the lookup works after a ⟳ retry.
      const rawTitle = icon.title.replace(/ — click to expand$/, '');
      const canonical = ICON_TITLE_MAP[rawTitle];
      if (!canonical) continue;
      // Retail requires async page fetches — wire it separately and skip the
      // synchronous extractIconContent path.
      if (canonical === 'Retail') {
        wireRetailIcon(icon, doc, tabMap, section, rawTitle);
        continue;
      }
      const content = extractIconContent(doc, canonical, tabMap);
      if (!content) {
        // Flag icons whose DETAIL tab explicitly says "Sorry, no X available"
        const tabLabel = CANONICAL_TAB_LABEL[canonical];
        if (tabLabel) {
          const sorryTab = tabLabel === 'News/Memorabilia'
            ? getNewsMemTab(doc, tabMap)
            : getTabEl(doc, tabMap, tabLabel);
          if (sorryTab && /^Sorry,? no /i.test(sorryTab.textContent.trim())) {
            const warn = document.createElement('span');
            warn.className = 'bb-glyph bb-icon-sorry';
            warn.textContent = '⚠️';
            warn.dataset.msg = `${canonical} icon on YEAR page but DETAIL page tab "${tabLabel}" reports no content available.`;
            warn.addEventListener('mouseenter', e => showErrorTooltip(e, warn.dataset.msg));
            warn.addEventListener('mouseleave', hideTooltip);
            icon.after(warn);
            icon.style.opacity = '0.45';
          }
        }
        continue;
      }
      icon.style.cursor = 'pointer';
      icon.title = `${rawTitle} — click to expand`;
      if (canonical === 'Photo') {
        icon.addEventListener('click', () => openLightbox(content, rawTitle));
      } else {
        icon.addEventListener('click', () => toggleIconPanel(icon, content, section));
      }
    }
    addEventTabButtons(doc, tabMap, section);
    addTagsButton(doc, tabMap, section, eventLink);
  }

  // Returns the first <a href> on doc whose href matches INFO_SETLIST_HREF_RE
  // and whose text content contains "info" (case-insensitive).
  function findInfoSetlistLink(doc) {
    return [...doc.querySelectorAll('a[href]')].find(a => {
      const href = a.getAttribute('href') || '';
      return INFO_SETLIST_HREF_RE.test(href) && /info/i.test(a.textContent);
    }) || null;
  }

  // Compares the YEAR page anchor name with the fragment on the detail page's
  // "Info & Setlist" back-link, plus DateToAnchor and href-year checks.
  // Annotates anchorEl with a warning span if any issue is found.
  function checkYearAnchorConsistency(detailDoc, yearAnchorName, anchorEl, eventDate = null) {
    const infoLink = findInfoSetlistLink(detailDoc);
    if (!infoLink) {
      log(`  Anchor check: no "Info & Setlist" link found on detail page`);
      return;
    }
    const href = infoLink.getAttribute('href') || '';
    const m = href.match(INFO_SETLIST_HREF_RE);
    const detailAnchorRef = m ? m[1] : null;
    if (!detailAnchorRef) return;

    log(`  Anchor check: YEAR="#${yearAnchorName}", DETAIL refs="#${detailAnchorRef}"`);

    const issues = [];

    if (yearAnchorName !== detailAnchorRef) {
      issues.push(`Anchor mismatch: YEAR page anchor "#${yearAnchorName}" ≠ DETAIL "Info & Setlist" refs "#${detailAnchorRef}"`);
    }

    if (eventDate) {
      const theoretical = dateToAnchor(eventDate);
      if (theoretical && !yearAnchorName.startsWith(theoretical)) {
        issues.push(`Date-derived anchor: expected "#${theoretical}" (from ${eventDate}) but YEAR page has "#${yearAnchorName}"`);
      }
      const hrefPathM = href.match(/^\/([^#]+)#/);
      if (hrefPathM) {
        const hrefYear = hrefPathM[1];
        const dateYear = eventDate.slice(0, 4);
        if (!yearMatchesHrefSlug(dateYear, hrefYear)) {
          issues.push(`Year mismatch: event date year "${dateYear}" ≠ DETAIL href year "${hrefYear}"`);
        }
      }
    }

    if (issues.length > 0) {
      logWarn(`  Anchor/year issue(s):\n  ${issues.join('\n  ')}`);
      addAnchorWarnYear(anchorEl, yearAnchorName, detailAnchorRef, href, issues);
    } else {
      log(`  Anchor MATCH ✅`);
    }
  }

  // Inserts a warning span immediately after the <a name="..."> anchor element
  // on the YEAR page when anchor, DateToAnchor, or year consistency checks fail.
  function addAnchorWarnYear(anchorEl, yearAnchorName, detailAnchorRef, detailHref, issues = []) {
    const span = document.createElement('span');
    span.className = 'bb-anchor-warn';
    span.textContent = '⚠️';
    const msg = issues.length > 0
      ? issues.join('\n')
      : `Anchor mismatch: YEAR page anchor is "#${yearAnchorName}" but DETAIL page "Info & Setlist" links to "#${detailAnchorRef}" (href="${detailHref}")`;
    span.dataset.msg = msg;
    span.addEventListener('mouseenter', e => showErrorTooltip(e, msg));
    span.addEventListener('mouseleave', hideTooltip);
    anchorEl.after(span);
  }

  // Appends a warning span immediately after the "Info & Setlist" link on the
  // DETAIL page when anchor, DateToAnchor, or year consistency checks fail.
  function addAnchorWarnDetail(linkEl, yearAnchorName, detailAnchorRef, issues = []) {
    const span = document.createElement('span');
    span.className = 'bb-anchor-warn';
    span.textContent = ' ⚠️';
    const msg = issues.length > 0
      ? issues.join('\n')
      : `Anchor mismatch: "Info & Setlist" links to "#${detailAnchorRef}" but actual YEAR page anchor for this event is "#${yearAnchorName}"`;
    span.dataset.msg = msg;
    span.addEventListener('mouseenter', e => showErrorTooltip(e, msg));
    span.addEventListener('mouseleave', hideTooltip);
    linkEl.after(span);
  }

  // Appends a ✅ glyph immediately after the "Info & Setlist" link on the
  // DETAIL page when all anchor, DateToAnchor, and year checks pass.
  function addAnchorMatchDetail(linkEl, msg) {
    const span = document.createElement('span');
    span.className = 'bb-anchor-match';
    span.textContent = ' ✅';
    span.dataset.msg = msg;
    span.addEventListener('mouseenter', e => showErrorTooltip(e, msg));
    span.addEventListener('mouseleave', hideTooltip);
    linkEl.after(span);
  }

  /**
   * Appends a ✅ or ⚠️ glyph after the Venue link on the DETAIL page.
   * @param {HTMLAnchorElement} linkEl
   * @param {string} venueName      VENUE page #page-title text
   * @param {boolean} match
   * @param {string} detailVenuePart Raw venue part from the DETAIL event name
   */
  function addVenueGlyphDetail(linkEl, venueName, match, detailVenuePart) {
    const msg = match
      ? `Venue match ✅\nVENUE page: "${venueName}"\nDETAIL event: "${detailVenuePart}"`
      : `Venue mismatch ⚠️\nVENUE page: "${venueName}"\nDETAIL event: "${detailVenuePart}"`;
    const span = document.createElement('span');
    span.className = match ? 'bb-anchor-match' : 'bb-venue-warn';
    span.textContent = match ? ' ✅' : ' ⚠️';
    span.style.cursor = 'help';
    span.addEventListener('mouseenter', e => showErrorTooltip(e, msg));
    span.addEventListener('mouseleave', hideTooltip);
    linkEl.after(span);
  }

  function makeGlyphSpan(char) {
    const span = document.createElement('span');
    span.className = 'bb-glyph';
    span.textContent = ' ' + char;
    return span;
  }

  function makeEventTypeSpan(type) {
    const span = document.createElement('span');
    span.className = 'bb-event-type';
    span.textContent = ` (${type})`;
    return span;
  }

  // Annotates #page-title on the current DETAIL page with the event type tag
  // and a name-comparison glyph.  Must be called AFTER extractDetailEventName()
  // so the snapshot is taken before any DOM changes.
  function addDetailTitleAnnotation(eventType, yearNameUpper, normalizedDetailName, rawDetailName, nameMatch, isEarlyLate, anchorName = null) {
    const pageTitle = document.getElementById('page-title');
    if (!pageTitle) return;
    const h1 = pageTitle.querySelector('h1') || pageTitle;

    const typeSpan = document.createElement('span');
    typeSpan.className = 'bb-event-type-detail';
    typeSpan.textContent = ` (${eventType})`;
    h1.appendChild(typeSpan);

    const glyph     = nameMatch ? '✅' : isEarlyLate ? '⚠️' : '❌';
    const glyphSpan = makeGlyphSpan(glyph);
    h1.appendChild(glyphSpan);

    const enter = e => showYearTooltip(e, yearNameUpper, normalizedDetailName, rawDetailName, eventType, nameMatch, isEarlyLate, anchorName);
    [typeSpan, glyphSpan].forEach(n => {
      n.addEventListener('mouseenter', enter);
      n.addEventListener('mouseleave', hideTooltip);
    });
  }

  // ── Tooltip ───────────────────────────────────────────────────────────────

  function showYearTooltip(evt, yearName, normalizedDetailName, rawDetailName, eventType, match, isEarlyLate = false, anchorName = null) {
    const tip = document.getElementById('bb-tooltip');
    if (!tip) return;
    const detailHtml = match ? esc(normalizedDetailName) : buildDiffHtml(yearName, normalizedDetailName);
    const resultHtml = match
      ? '<span class="bb-ok">Match ✅</span>'
      : isEarlyLate
        ? '<span class="bb-warn">Event variant on same day ⚠️</span>'
        : '<span class="bb-fail">Mismatch ❌</span>';
    tip.innerHTML = `
      <table class="bb-tip-table">
        <tr><th>Event type:</th><td>${esc(eventType)}</td></tr>
        ${anchorName ? `<tr><th>Event anchor:</th><td>#${esc(anchorName)}</td></tr>` : ''}
        <tr><th>YEAR page:</th><td>${esc(yearName)}</td></tr>
        <tr><th>DETAIL page (raw):</th><td>${esc(rawDetailName)}</td></tr>
        <tr><th>DETAIL page (normalized):</th><td>${detailHtml}</td></tr>
        <tr><th>Result:</th><td>${resultHtml}</td></tr>
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
      .bb-warn { color: #c80; }
      .bb-fail { color: #f66; }
      .bb-event-type        { color: #888; font-style: italic; font-weight: normal; }
      .bb-event-type-detail { font-size: 0.6em; font-weight: normal; color: #666; font-style: italic; vertical-align: middle; }
      .bb-event-alias       { font-style: italic; font-weight: bold; color: #555; }
      .bb-glyph { cursor: default; font-style: normal; margin-left: 4px; }
      .bb-scheduled { font-size: 0.9em; font-family: monospace; color: #555; margin: 1px 0 3px; }

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
      .bb-toggle-btn:hover    { background: #357abd; }
      .bb-toggle-btn:disabled { opacity: 0.5; cursor: default; }
      /* #bb-controls wraps #bb-btn-container + #bb-year-progress in one flex row */
      #bb-controls       { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 6px 0 2px; }
      #bb-btn-container  { display: flex; gap: 6px; align-items: center; margin: 0; }
      #bb-global-toggle  { margin: 0; }
      .bb-section-controls { display: inline-flex; gap: 4px; margin: 2px 0; }
      .bb-section-toggle   { margin-left: 0; }
      .bb-list-toggle      { margin-left: 0; }
      .bb-list-label       { margin: 2px 0 1px; }
      ol.bb-list-view      { list-style: none; margin: 0 0 4px 0; padding: 0; }
      ol.bb-list-view li   { margin: 1px 0; display: flex; align-items: baseline; }
      a.bb-song-num        { font-family: monospace; font-size: 0.85em; min-width: 2.4em; text-align: right; padding-right: 5px; flex-shrink: 0; color: #aaa; text-decoration: none; cursor: pointer; }
      a.bb-song-num:hover  { color: #4a90d9; text-decoration: underline; }
      a.bb-song-num.bb-song-loaded  { color: #2e8b57; font-weight: bold; }
      a.bb-song-num.bb-song-loading { color: #ccc; cursor: wait; pointer-events: none; }
      span.bb-song-num-plain { font-family: monospace; font-size: 0.85em; min-width: 2.4em; text-align: right; padding-right: 5px; flex-shrink: 0; color: #ccc; }
      .bb-song-tab-row { display: flex; flex-wrap: wrap; gap: 4px; margin: 3px 0; align-items: center; }
      .bb-song-tab-btn { background: #e8e8e8; border: 1px solid #bbb; border-radius: 3px; cursor: pointer; font-size: 0.8em; padding: 1px 7px; color: #333; font-family: sans-serif; }
      .bb-song-tab-btn:hover { background: #d4d4d4; }
      .bb-song-tab-btn.bb-icon-active { background: #4a90d9; color: #fff; border-color: #357abd; }
      .bb-song-tab-label { flex-shrink: 0; font-size: 0.78em; color: #888; font-style: italic; max-width: 14em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #bb-fetch-all-btn  { margin: 6px 6px 2px 0; }
      #bb-year-progress  { color: #666; font-style: italic; margin: 0; font-size: 0.9em; font-family: monospace; }

      /* SmartTable trigger button inside our bar — match .bb-toggle-btn appearance */
      #bb-btn-container .st-btn-trigger {
        display: inline-block;
        padding: 2px 10px;
        background: #4a90d9;
        color: #fff;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        font-family: sans-serif;
        margin: 0;
      }
      #bb-btn-container .st-btn-trigger:hover { background: #357abd; }

      /* SmartTable host div — sits between sticky bar and #page-content */
      #bb-smarttable-host { margin: 8px 0; }

      /* ── Sticky layout ───────────────────────────────────── */
      :root { --bb-header-h: 0px; --bb-sticky-bar-h: 0px; }
      #header {
        position: sticky;
        top: 0;
        z-index: 100;
        background: #fff;
      }
      #side-bar {
        position: sticky;
        top: var(--bb-header-h);
        align-self: flex-start;
      }
      #bb-sticky-bar {
        position: sticky;
        top: var(--bb-header-h);
        z-index: 90;
        background: #fff;
        padding-bottom: 6px;
        border-bottom: 2px solid #d0d0d0;
        margin-bottom: 6px;
      }

      /* Home page: year section headers */
      .bb-year-header {
        font-size: 1.1em;
        font-weight: bold;
        margin: 1.4em 0 0.3em;
        padding: 3px 8px;
        background: #e8f0fb;
        border-left: 4px solid #4a90d9;
        cursor: pointer;
        user-select: none;
      }
      .bb-year-header a { color: inherit; text-decoration: none; cursor: pointer; }
      .bb-year-header a:hover { text-decoration: underline; }
      .bb-year-toggle-glyph { font-style: normal; }

      /* Home page: aggregated event table */
      #bb-home-table { margin-top: 8px; }
      .bb-event-table { border-collapse: collapse; width: 100%; font-size: 0.9em; }
      .bb-event-table th,
      .bb-event-table td { border: 1px solid #ccc; padding: 3px 8px; text-align: left; white-space: nowrap; }
      .bb-event-table td:last-child { white-space: normal; }
      .bb-event-table th { background: #e8f0fb; position: sticky;
                           top: calc(var(--bb-header-h, 0px) + var(--bb-sticky-bar-h, 0px)); }
      .bb-event-table a { color: inherit; }
      .bb-event-table tr:hover { background: #f4f8ff; }

      /* Setlist song states */
      .bb-song-match       { color: #2a2; }
      a.bb-song-match      { text-decoration: none; }
      a.bb-song-match:hover { text-decoration: underline; }
      .bb-song-year-only   { background: #add8e6; border-radius: 3px; padding: 0 2px; cursor: default; }
      .bb-song-detail-only { background: #ffff88; border-radius: 3px; padding: 0 2px; cursor: default; }
      .bb-song-char-diff   { cursor: default; }

      /* Character-level diff within a song name */
      .bb-char-match      { color: #2a2; }
      .bb-char-diff       { color: #c00; font-weight: bold; background: #ffe0e0; border-radius: 2px; }
      .bb-char-diff-space { background: #b0c8ff; border-radius: 2px; }

      /* Separator between songs on YEAR page */
      .bb-sep          { color: #999; }
      .bb-section-label { color: #888; font-style: italic; }
      .bb-para-warn    { cursor: help; }
      .bb-anchor-warn  { cursor: help; }

      /* Setlist tab label decoration (DETAIL page) */
      .bb-setlist-tab-match { color: #2a2; font-weight: bold; }

      /* "Original Page" mode on DETAIL pages — hide all script annotations */
      .bb-original-view .bb-glyph,
      .bb-original-view .bb-anchor-match,
      .bb-original-view .bb-anchor-warn,
      .bb-original-view .bb-venue-warn,
      .bb-original-view .bb-tag-missing,
      .bb-original-view .bb-tag-spurious,
      .bb-original-view .bb-icon-sorry,
      .bb-original-view .bb-setlist-tab-ann { display: none !important; }
      .bb-original-view .bb-tags-warn-box   { border: none !important; background: none !important; padding: 0 !important; }
      .bb-original-view .bb-setlist-tab-match { color: inherit !important; font-weight: inherit !important; }

      /* Year-only <li> rows inserted on detail pages */
      li.bb-song-year-only {
        background: #ffff88;
        list-style-type: disc;
        cursor: default;
      }
      li.bb-song-detail-only { background: #add8e6; }

      /* ── Clickable icons ─────────────────────────────────── */
      img.bb-icon-active { outline: 2px solid #4a90d9; border-radius: 2px; }
      .bb-icon-sorry { cursor: help; font-size: 0.8em; vertical-align: super; margin-left: 1px; }
      .bb-event-tab-row, .bb-venue-tab-row { display: flex; flex-wrap: wrap; gap: 4px; margin: 3px 0; align-items: center; }
      .bb-event-tab-btn, .bb-venue-tab-btn { background: #e8e8e8; border: 1px solid #bbb; border-radius: 3px; cursor: pointer; font-size: 0.8em; padding: 1px 7px; color: #333; font-family: sans-serif; }
      .bb-event-tab-btn:hover, .bb-venue-tab-btn:hover { background: #d4d4d4; }
      .bb-event-tab-btn.bb-icon-active, .bb-venue-tab-btn.bb-icon-active { background: #4a90d9; color: #fff; border-color: #357abd; }
      .bb-tab-row-label { min-width: 3.5em; flex-shrink: 0; font-size: 0.78em; color: #888; font-style: italic; }
      .bb-retail-tabs { margin: 6px 0; }
      .bb-retail-tab-label { font-size: 0.82em; color: #555; display: block; margin: 8px 0 2px; }
      .bb-cache-retry { font-size: 0.9em; padding: 1px 5px; opacity: 0.75; }
      .bb-cache-retry:hover { opacity: 1; }

      /* Inline icon panels */
      .bb-icon-panel { margin: 4px 0; border: 1px solid #ddd; border-radius: 4px; background: #fafafa; font-size: 0.85em; }
      .bb-icon-panel-header { display: flex; justify-content: space-between; align-items: center; padding: 3px 8px; background: #e8e8e8; border-radius: 4px 4px 0 0; font-weight: bold; }
      .bb-icon-panel-close { background: none; border: none; cursor: pointer; font-size: 1em; color: #666; padding: 0 2px; }
      .bb-icon-panel-body { padding: 6px 8px; }
      .bb-icon-panel-body a { color: #06c; text-decoration: none; }
      .bb-icon-panel-body a:hover { text-decoration: underline; }
      .bb-icon-panel-body--media { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; }
      .bb-media-item { flex: 0 0 auto; }
      .bb-icon-thumbnails { display: flex; flex-wrap: wrap; gap: 6px; }
      .bb-thumb-item { display: flex; flex-direction: column; align-items: center; cursor: pointer; margin: 0; padding: 0; }
      .bb-thumb-item img { width: 80px; height: 60px; object-fit: cover; border-radius: 2px; }
      .bb-thumb-item img:hover { opacity: 0.85; }
      .bb-thumb-item figcaption { font-size: 0.72em; color: #555; text-align: center; margin-top: 2px; max-width: 80px; word-break: break-word; }
      .bb-news-item { margin: 2px 0; }
      .bb-link-source { color: #888; font-size: 0.9em; font-style: italic; }

      /* Lightbox overlay */
      #bb-lightbox { position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,0.88); display: flex; flex-direction: column; align-items: center; justify-content: center; }
      #bb-lightbox-inner { background: #111; border-radius: 8px; max-width: 92vw; max-height: 88vh; overflow-y: auto; padding: 12px; }
      #bb-lightbox-header { display: flex; justify-content: space-between; align-items: center; color: #eee; margin-bottom: 8px; font-size: 0.9em; }
      #bb-lightbox-close { background: none; border: none; color: #eee; font-size: 1.2em; cursor: pointer; }
      #bb-lightbox-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 4px; }
      #bb-lightbox-grid img { width: 100%; height: 72px; object-fit: cover; cursor: pointer; border-radius: 2px; }
      #bb-lightbox-grid img:hover { opacity: 0.85; }
      #bb-lightbox-viewer { position: fixed; inset: 0; z-index: 10000; background: rgba(0,0,0,0.96); display: flex; align-items: center; justify-content: center; }
      #bb-lightbox-viewer img { max-width: 96vw; max-height: 96vh; object-fit: contain; }
      #bb-lightbox-viewer-close { position: absolute; top: 12px; right: 16px; background: none; border: none; color: #eee; font-size: 1.6em; cursor: pointer; z-index: 1; }
    `);
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  function fmtElapsed(ms) {
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

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
