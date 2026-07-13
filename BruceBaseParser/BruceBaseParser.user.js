// ==UserScript==
// @name         VZ: BruceBase Parser
// @namespace    https://github.com/vzell/userscripts
// @version      3.31
// @description  Validates event name and setlist consistency between year overview and detail pages
// @author       vzell
// @tag          AI generated
// @homepageURL  https://github.com/vzell/userscripts
// @supportURL   https://github.com/vzell/userscripts/issues
// @downloadURL  https://raw.githubusercontent.com/vzell/userscripts/master/BruceBaseParser.user.js
// @updateURL    https://raw.githubusercontent.com/vzell/userscripts/master/BruceBaseParser.user.js
// @require      https://cdn.jsdelivr.net/npm/@jaames/iro@5
// @require      file:///V:/home/vzell/git/springsteen-site-parser/dist/smarttable.js
// @require      file:///V:/home/vzell/git/springsteen-site-parser/adapters/brucebase.js
// @require      file:///V:/home/vzell/git/musicbrainz-userscripts/lib/VZ_MBLibrary.user.js
// @include      /^https?:\/\/brucebase\.wikidot\.com\/(\d{4}(-list)?|1949-64(-list)?|start)?$/
// @include      /^https?:\/\/brucebase\.wikidot\.com\/(gig|nogig|nobruce|recording|interview|offstage|onstage|rehearsal|soundcheck):/
// @include      /^https?:\/\/brucebase\.wikidot\.com\/venue:/
// @include      /^https?:\/\/brucebase\.wikidot\.com\/retail:/
// @include      /^https?:\/\/brucebase\.wikidot\.com\/song:/
// @include      /^https?:\/\/brucebase\.wikidot\.com\/relation:/
// @include      /^https?:\/\/brucebase\.wikidot\.com\/system:recent-changes$/
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_info
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      brucebase.wikidot.com
// @connect      raw.githubusercontent.com
// @license      MIT
// ==/UserScript==

(async function () {
  'use strict';

  const SCRIPT_BASE_NAME = "BruceBaseParser";
  // SCRIPT_ID is derived from SCRIPT_BASE_NAME: CamelCase → kebab-case, lower-cased, prepend "vz-bb-"
  const SCRIPT_ID   = 'vz-bb-' + SCRIPT_BASE_NAME.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
  const SCRIPT_NAME = (typeof GM_info !== 'undefined' && GM_info.script) ? GM_info.script.name : SCRIPT_BASE_NAME;
  // Remote changelog is fetched and the GM menu item registered by VZ_MBLibrary
  // (via remoteConfig passed to the constructor below).
  const REMOTE_BASE          = 'https://raw.githubusercontent.com/vzell/userscripts/master/BruceBaseParser/';
  const REMOTE_CHANGELOG_URL = REMOTE_BASE + SCRIPT_BASE_NAME + '_CHANGELOG.json';
  const REMOTE_CACHE_TTL_MS  = 60 * 60 * 1000; // 1 hour
  const CACHE_KEY_CHANGELOG  = SCRIPT_BASE_NAME.toLowerCase() + '-remote-changelog';

  const KNOWN_EVENT_TYPES = new Set([
    'gig', 'interview', 'nobruce', 'nogig', 'offstage', 'onstage', 'recording', 'rehearsal', 'soundcheck'
  ]);

  const EVENT_URL_RE  = /\/([a-z]+):\d{4}-\d{2}-\d{2}/;
  const LIST_LINK_RE  = /\/((?:\d{4}|1949-64))#([a-zA-Z0-9]+)$/;

  let _savedOriginalHtml = null;   // pre-processing snapshot for YEAR page Save handler
  const DETAIL_TYPE_RE = /^(gig|nogig|nobruce|recording|interview|offstage|onstage|rehearsal|soundcheck):/;
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
    'gig', 'interview', 'nobruce', 'nogig', 'offstage', 'onstage', 'recording', 'rehearsal', 'soundcheck',
    'bootleg', 'livedl', 'news', 'memorabilia', 'ticket',
    'setlist', 'handwritten', 'printed', 'storyteller', 'eyewitness', 'help', 'underconstruction',
    'featured', 'prem', 'rescheduled',
  ]);

  /**
   * User-editable, end-user-extensible table of Springsteen tour date ranges
   * — NOT to be confused with the setlist tour-*premiere* check just below
   * (a song's live debut) — used by the DETAIL-page tour-association tag
   * check (see checkEventTourTags). Each entry: official tour name, the tag
   * BruceBase uses for events during that tour, and one or more inclusive
   * ["YYYY-MM-DD","YYYY-MM-DD"] date ranges (a tour can have disjoint legs,
   * e.g. Land Of Hope And Dreams' 2025 and 2026 legs). Multiple entries can
   * cover the same date — e.g. a named sub-leg nested inside a larger tour
   * — see pickMostSpecificTour for how the page-title annotation picks a
   * single winner among matches.
   */
  const TOUR_DEFINITIONS = [
    { name: 'Greetings From Asbury Park',                    tag: 'tour_gfap',    ranges: [['1972-10-28', '1973-09-22']] },
    { name: 'The Wild, The Innocent & The E Street Shuffle', tag: 'tour_wiess',   ranges: [['1973-09-28', '1975-03-09']] },
    { name: 'Born to Run',                                   tag: 'tour_btr',     ranges: [['1975-07-20', '1975-12-31'], ['1976-03-25', '1976-05-28']] },
    { name: 'Chicken Scratch',                               tag: 'tour_cs',      ranges: [['1976-03-25', '1976-05-28']] },
    { name: 'The Lawsuit',                                   tag: 'tour_lwst',    ranges: [['1976-09-26', '1976-11-04'], ['1977-02-07', '1977-03-25']] },
    { name: 'Darkness On The Edge Of Town',                  tag: 'tour_doteot',  ranges: [['1978-05-23', '1979-01-01']] },
    { name: 'The River',                                     tag: 'tour_rvr',     ranges: [['1980-10-03', '1981-06-08'], ['1981-07-02', '1981-09-14']] },
    { name: 'Born In The U.S.A.',                            tag: 'tour_bitusa',  ranges: [['1984-06-29', '1985-01-27'], ['1985-03-21', '1985-04-23'], ['1985-06-01', '1985-07-07'], ['1985-08-05', '1985-10-02']] },
    { name: 'Tunnel Of Love',                                tag: 'tour_tol',     ranges: [['1988-02-25', '1988-05-23'], ['1988-06-11', '1988-08-03']] },
    { name: 'Amnesty International - Human Rights Now!',     tag: 'tour_hrn',     ranges: [['1988-09-02', '1988-10-15']] },
    { name: 'The 1992-93 World Tour',                        tag: 'tour_htlt',    ranges: [['1992-06-15', '1992-12-17'], ['1993-03-31', '1993-06-01']] },
    { name: 'Solo Acoustic',                                 tag: 'tour_gotj',    ranges: [['1995-11-22', '1996-01-28'], ['1996-02-12', '1996-05-08'], ['1996-09-16', '1996-12-14'], ['1997-01-27', '1997-02-17'], ['1997-05-06', '1997-05-26']] },
    { name: 'Reunion',                                       tag: 'tour_rnn',     ranges: [['1999-04-09', '1999-06-27'], ['1999-07-15', '1999-11-29'], ['2000-02-28', '2000-07-01']] },
    { name: 'The Rising',                                    tag: 'tour_rsng',    ranges: [['2002-08-07', '2002-10-27'], ['2002-11-03', '2002-12-17'], ['2003-02-28', '2003-04-19'], ['2003-05-06', '2003-10-04']] },
    { name: 'Vote For Change',                               tag: 'tour_vfc',     ranges: [['2004-10-01', '2004-10-13']] },
    { name: 'Devils & Dust Solo and Acoustic',               tag: 'tour_dd',      ranges: [['2005-04-25', '2005-06-28'], ['2005-07-13', '2005-11-22']] },
    { name: 'Seeger Sessions',                               tag: 'tour_sgrs',    ranges: [['2006-04-30', '2006-06-25'], ['2006-10-01', '2006-11-21']] },
    { name: 'Magic',                                         tag: 'tour_mgc',     ranges: [['2007-10-02', '2007-12-19'], ['2008-02-28', '2008-05-02'], ['2008-05-22', '2008-07-20'], ['2008-07-27', '2008-08-24']] },
    { name: 'Working On A Dream',                            tag: 'tour_woad',    ranges: [['2009-04-01', '2009-08-02'], ['2009-08-19', '2009-11-22']] },
    { name: 'Wrecking Ball',                                 tag: 'tour_wb',      ranges: [['2012-03-18', '2012-05-02'], ['2012-05-13', '2012-07-31'], ['2012-08-14', '2012-12-10'], ['2013-03-14', '2013-03-31'], ['2013-04-29', '2013-07-28'], ['2013-09-12', '2013-09-21']] },
    { name: 'High Hopes',                                    tag: 'tour_hh',      ranges: [['2014-01-26', '2014-03-02'], ['2014-04-08', '2014-05-18']] },
    { name: 'The River 2016',                                tag: 'tour_rvr16',   ranges: [['2016-01-16', '2016-04-25'], ['2016-05-14', '2016-09-14']] },
    { name: 'Book Promotion',                                tag: 'tour_book',    ranges: [['2016-09-27', '2016-12-02']] },
    { name: 'Summer 17',                                     tag: 'tour_sumr17',  ranges: [['2017-01-22', '2017-02-25']] },
    { name: 'Springsteen On Broadway',                       tag: 'tour_sob',     ranges: [['2017-10-03', '2018-12-15'], ['2021-06-26', '2021-09-04']] },
    { name: '2023-24 International',                         tag: 'tour_23int',   ranges: [['2023-02-01', '2023-04-14'], ['2023-04-28', '2023-12-12']] },
      { name: '2023-25 International',                         tag: 'tour_23int',   ranges: [['2024-03-19', '2024-04-21'], ['2024-05-05', '2024-07-27'], ['2024-08-15', '2024-11-22'], ['2025-05-14', '2025-07-03']] },
    { name: 'Land Of Hope And Dreams',                       tag: 'tour_lohad',   ranges: [['2025-05-14', '2025-07-03'], ['2026-03-31', '2026-05-30']] },
    { name: 'Land Of Hope And Dreams - No Kings',            tag: 'tour_lohadnk', ranges: [['2026-03-31', '2026-05-30']] },
  ];

  /** Set of every tag in TOUR_DEFINITIONS, kept in sync automatically as that table is edited. */
  const TOUR_TAG_SET = new Set(TOUR_DEFINITIONS.map(t => t.tag));

  /**
   * Special tag for an event whose date falls within a tour's date range
   * (per TOUR_DEFINITIONS) but is confirmed NOT actually part of that tour
   * — e.g. a one-off charity gig or award ceremony slotted in between real
   * tour dates. See checkEventTourTags for how this is deduced.
   */
  const TOUR_NO_TAG = 'tour_no';

  /**
   * User-editable manual overrides for the tour_no heuristic (see
   * checkEventTourTags): keyed by the event's URL path (e.g.
   * "gig:2026-04-18-pollak-theatre-west-long-branch-nj" — matching the
   * top-level `path` constant's format, no leading slash). `true` forces
   * "not part of the tour" (tour_no) even without an event alias; `false`
   * forces "part of the tour" even though an alias IS present (a real tour
   * show that happens to also carry its own promotional nickname). Empty
   * by default — the default heuristic (event alias present => tour_no)
   * already covers the common case; add an entry here only for a genuine
   * exception.
   */
  const TOUR_NO_OVERRIDES = {
    // 'gig:2026-04-18-pollak-theatre-west-long-branch-nj': true,
  };

  /**
   * Allowed tag values for the setlist tour-premiere-count check (see
   * computeTourPremiereTagValue) — BruceBase's convention for tagging how
   * many songs a DETAIL page's Setlist tab shows as bold (a tour debut):
   * bare "1".."9" for 1-9 premieres, "9+" for more than 9. Never zero-padded
   * (unlike the day-of-month tag), which is what lets isManagedTag /
   * spuriousTagMsg / passingTagMsg tell a premiere-count tag apart from a
   * day tag despite both being small plain numbers.
   */
  const TOUR_PREMIERE_TAG_VALUES = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9', '9+']);

  /** Human-readable reasons why each managed tag might be present but spurious. */
  const SPURIOUS_TAG_REASONS = {
    bootleg:     'Recording tab has no bootleg content',
    livedl:      'Recording tab has no official live download content',
    news:        'News/Memorabilia tab is empty or unavailable',
    memorabilia: 'News/Memorabilia tab has no images (text-only, e.g. a "Links" section) or is empty/unavailable',
    ticket:      'No ticket images found in News/Memorabilia tab',
    setlist:     'No setlist images found in News/Memorabilia tab',
    handwritten: 'No handwritten setlist images found in News/Memorabilia tab',
    printed:     'No printed setlist images found in News/Memorabilia tab',
    soundcheck:  'No "Soundcheck" section header found in setlist content',
    storyteller: 'Storyteller tab is empty or unavailable',
    eyewitness:  'Eyewitness tab is empty or unavailable',
    help:        'No "Help Us" call-to-action icon found on the YEAR page or the DETAIL page itself for this event',
    underconstruction: 'Page does not show the "Under Construction" banner',
    featured:    'No "Featured" icon found on the YEAR page or the DETAIL page itself for this event',
    prem:        'No tour-premiere songs (bold-marked in the Setlist tab) were found',
    rescheduled: 'Page notes do not mention "rescheduled from"',
  };

  /** Human-readable reasons why each managed tag is correctly present ("passing"). */
  const PASSING_TAG_REASONS = {
    bootleg:     'Recording tab has bootleg content',
    livedl:      'Recording tab has an official live download',
    news:        'News/Memorabilia tab has content',
    memorabilia: 'News/Memorabilia tab (labelled "News/Memorabilia") has image content',
    ticket:      'Ticket image(s) found in the News/Memorabilia tab',
    setlist:     'Setlist image(s) found in the News/Memorabilia tab',
    handwritten: 'Handwritten setlist image(s) found in the News/Memorabilia tab',
    printed:     'Printed setlist image(s) found in the News/Memorabilia tab',
    soundcheck:  '"Soundcheck" section header found in the setlist content',
    storyteller: 'Storyteller tab has content',
    eyewitness:  'Eyewitness tab has content',
    help:        '"Help Us" call-to-action icon found on the YEAR page or the DETAIL page itself for this event',
    underconstruction: 'Page shows the "Under Construction" banner',
    featured:    '"Featured" icon found on the YEAR page or the DETAIL page itself for this event',
    prem:        'At least one tour-premiere song (bold-marked in the Setlist tab) was found',
    rescheduled: 'Page notes mention "rescheduled from"',
  };

  /**
   * User-editable song→tag manual overrides for the DETAIL page setlist tag
   * check (see computeSongTagAlias / checkSetlistSongTags). Add an entry here
   * only when neither the exact-match nor the derived-alias correctly predicts
   * the real tag BruceBase uses for a song (idiosyncratic/legacy tags).
   * Keyed by the lowercase, trimmed song title (as it appears in
   * parseDetailSetlist's `songs` array); value is the exact tag string
   * expected on the DETAIL page. Empty by default — populate as exceptions
   * are discovered.
   *
   * Sibling tables for other page types (VENUE_TAG_ALIAS_OVERRIDES,
   * RELATION_TAG_ALIAS_OVERRIDES, RETAIL_TAG_ALIAS_OVERRIDES) can be added
   * later following this same naming/placement convention.
   */
  const SONG_TAG_ALIAS_OVERRIDES = {
    // 'incident on 57th street': 'incident57',
    '634-5789 (soulsville, u.s.a.)':'6345789',
    'devils & dust': 'dad',
    'does this bus stop at 82nd street?': 'dtbsa82s',
    'incident on 57th street': 'io57s',
    'rosalita (come out tonight)': 'rosalita',
    '4th of july, asbury park (sandy)': 'sandy',
    'tenth avenue freeze-out': '10th',
    'wreck on the highway': 'wroth',
    'you can look (but you better not touch)': 'youcanlook',
  };

  /**
   * User-editable, end-user-extensible manual overrides for setlist song
   * *combinations* — a medley/tribute entry joined by " - " (BruceBase's
   * separator, e.g. "LAND OF HOPE AND DREAMS - PEOPLE GET READY") that
   * BruceBase tags with a single fixed value for the pair, rather than one
   * tag per individual song. Checked in `checkSetlistSongTags` *before* the
   * default per-song split (see `SONG_TAG_ALIAS_OVERRIDES` doc comment for
   * that default behavior) — a combination whose full (unsplit) string
   * matches a key here is checked as one unit against the given tag, and
   * never split into its individual songs at all. Keyed by the lowercase,
   * trimmed full combination string exactly as it appears in
   * `parseDetailSetlist`'s `songs` array (i.e. both song names joined by
   * `" - "`); value is the exact tag string expected on the DETAIL page.
   * Empty of real entries so far except the one already known —
   * populate as further exceptions are discovered.
   */
  const SONG_COMBINATION_TAG_OVERRIDES = {
    'land of hope and dreams - people get ready': 'lohad.pgr',
  };

  /** USPS state abbreviation -> full state name, for the event-name/venue-name location tag check. */
  const US_STATE_NAMES = {
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
    CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
    FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
    IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
    ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
    MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
    NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
    NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
    PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
    TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
    WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  };

  /** Canadian province/territory abbreviation -> full name, for the event-name/venue-name location tag check. */
  const CA_PROVINCE_NAMES = {
    AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick',
    NL: 'Newfoundland and Labrador', NS: 'Nova Scotia', NT: 'Northwest Territories',
    NU: 'Nunavut', ON: 'Ontario', PE: 'Prince Edward Island', QC: 'Quebec',
    SK: 'Saskatchewan', YT: 'Yukon',
  };

  /**
   * Country name (as it appears in an event-name/venue-name title) -> extra
   * tags expected alongside the country's own slug tag (e.g. "England" also
   * expects "unitedkingdom" and "europe"). Not exhaustive — add entries as
   * new countries appear in event/venue titles.
   */
  const COUNTRY_EXTRA_TAGS = {
    England: ['unitedkingdom', 'europe'], Scotland: ['unitedkingdom', 'europe'],
    Wales: ['unitedkingdom', 'europe'], 'Northern Ireland': ['unitedkingdom', 'europe'],
    Ireland: ['europe'], Finland: ['europe', 'scandinavia'], Sweden: ['europe', 'scandinavia'],
    Norway: ['europe', 'scandinavia'], Denmark: ['europe', 'scandinavia'], Iceland: ['europe', 'scandinavia'],
    Germany: ['europe'], France: ['europe'], Italy: ['europe'], Spain: ['europe'],
    Portugal: ['europe'], Netherlands: ['europe'], Belgium: ['europe'], Switzerland: ['europe'],
    Austria: ['europe'], Poland: ['europe'], 'Czech Republic': ['europe'], Greece: ['europe'],
    Australia: ['oceania'], 'New Zealand': ['oceania'], Japan: ['asia'],
    Brazil: ['southamerica'], Mexico: ['northamerica'],
  };

  /**
   * User-editable venue name/detail -> tag overrides for the event-name and
   * venue-name location tag checks (see checkParsedLocationTags). Add an
   * entry only when the plain slug doesn't match BruceBase's real tag, OR
   * set the value to `null` to mean "no tag is expected for this venue name
   * at all" (e.g. a generic building name like "Spotify HQ" that BruceBase
   * never tags, favoring the more specific venue detail instead).
   * Keyed by the lowercase, trimmed venue name/detail string.
   */
  const VENUE_TAG_ALIAS_OVERRIDES = {
    // 'spotify hq': null,
      'bruce springsteen center for american music':'bscfam',
  };

  /**
   * User-editable relation name -> tag overrides for the "On Stage"/"In
   * Studio" tab relation tag check (see checkOnStageRelationTags). Add an
   * entry only when neither the exact match, the "The "-stripped, the
   * suffix-stripped (Jr./Sr./II/III/IV), nor the nickname-stripped (quoted
   * substring removed) form matches BruceBase's real tag — e.g. a plain
   * typo/irregularity in the real tag itself, or a non-obvious/unrelated
   * tag name BruceBase happens to use for that relation (like an old or
   * internal band nickname). Keyed by the lowercase, trimmed relation name
   * (as it appears in extractOnStageRelationNames's output). See
   * ESTREETBAND_DOTTED_TAG_OVERRIDES for the E Street Band members' own
   * dotted-vs-plain tag exception, which isn't a plain unconditional
   * override like these.
   */
  const RELATION_TAG_ALIAS_OVERRIDES = {
    // gig:1993-06-24-brendan-byrne-arena-east-rutherford-nj lists "The
    // 1992–93 World Tour Band" on the "On Stage" tab, but the page's real
    // tag for it is "otherband" — no relation to the band's actual name.
    'the 1992–93 world tour band': 'otherband',
  };

  /**
   * Individual E Street Band members whose expected "On Stage" tab tag is a
   * dotted "first.last" form (e.g. "Charles Giordano" -> "charles.giordano")
   * instead of the usual concatenated slug ("charlesgiordano") — but only
   * on a gig/rehearsal page whose "On Stage" tab does NOT explicitly list
   * "The E Street Band" itself (see checkOnStageRelationTags's
   * preferDottedEStreetTag). Confirmed against two live pages:
   * gig:1993-06-24-brendan-byrne-arena-east-rutherford-nj ("The E Street
   * Band" not mentioned — the "1992-93 World Tour Band" played instead;
   * several of these people's companion "onstage:" page tags are dotted)
   * and rehearsal:2026-03-19-youth-temple-ocean-grove-nj ("The E Street
   * Band" explicitly listed; the same people's tags are the plain
   * concatenated form). Keyed by the lowercase, trimmed relation name.
   * checkSingleRelationName tries BOTH forms regardless of context (so an
   * exception like gig1993's non-dotted "Roy Bittan"/"Patti Scialfa" still
   * matches), but this table decides which form is *reported* as the
   * missing/expected tag when neither is present.
   */
  const ESTREETBAND_DOTTED_TAG_OVERRIDES = {
    'charles giordano': 'charles.giordano',
    'clarence clemons': 'clarence.clemons',
    'danny federici':   'danny.federici',
    'garry tallent':    'garry.tallent',
    'jake clemons':     'jake.clemons',
    'max weinberg':     'max.weinberg',
    'nils lofgren':     'nils.lofgren',
    'patti scialfa':    'patti.scialfa',
    'roy bittan':       'roy.bittan',
    'soozie tyrell':    'soozie.tyrell',
    'steven van zandt': 'steven.vanzandt',
  };

  /**
   * Relation-listing tab label -> config for checkOnStageRelationTags. A
   * page has at most one of these tabs (it's always tab index 0 — see
   * extractRelations). `fixedTag`, when set, is a tag that's always
   * expected whenever that tab is present, independent of any relation
   * name listed there (e.g. "onstage" for gig/rehearsal's "On Stage" tab,
   * "studio" for recording's "In Studio" tab). `fixedTag: null` means the
   * tab only drives the per-relation-name checks, with no such fixed tag
   * (e.g. nogig's "On Audio" tab, or a video recording session's "On Set"
   * tab — confirmed against recording:2012-01-13-mattison-avenue-asbury-park-nj,
   * whose "On Set" tab lists Bruce Springsteen/Willie Nile/John Eddie, each
   * with their own name tag present, and no "onset"-style fixed tag).
   */
  const RELATION_TAB_CONFIGS = {
    'On Stage': { fixedTag: 'onstage' },
    'In Studio': { fixedTag: 'studio' },
    'On Audio': { fixedTag: null },
    'On Set': { fixedTag: null },
  };

  /**
   * Generic tags whose presence is verified by fuzzy case-insensitive
   * substring match against either the event alias (the `<strong>` header
   * before a DETAIL page's relation list — see extractEventAlias /
   * makeAliasSpan's ".bb-event-alias") or the page's free-text notes
   * preamble (see extractPageNotesText) — not any per-event-type rule and
   * not tied to any specific event type or tab. A tag is "verified"
   * (rendered green) whenever it's both present on the page AND at least
   * one of its configured substrings occurs case-insensitively in either
   * source, e.g. tag "grammy" (substring "grammy") matches alias "68th
   * Annual Grammy Awards Ceremony", tag "private" (substrings
   * "private"/"closed") matches alias "Closed Rehearsal", or tag "benefit"
   * matches a notes paragraph mentioning "...Light Of Day Benefit.". A
   * substring list need not equal the tag itself — "private" is verified by
   * either of two different words that both imply a non-public event.
   * Absence is not flagged as missing — this only upgrades an
   * already-present tag to "verified", it never requires the tag to exist.
   */
  const FUZZY_SUBSTRING_TAGS = {
    award: ['award'],
    grammy: ['grammy'],
    private: ['private', 'closed'],
    benefit: ['benefit'],
    anniversary: ['anniversary'],
    interview: ['interview'],
    funeral: ['funeral'],
  };

  /**
   * Human-readable explanation per checkOnStageRelationTags `method`, for
   * tag tooltips. `tabLabel` is the relation tab that produced the match
   * (e.g. "On Stage" or "In Studio" — see RELATION_TAB_CONFIGS).
   * @param {string} method
   * @param {string} tabLabel
   * @returns {string}
   */
  function relationMethodLabel(method, tabLabel) {
    const labels = {
      fixed: `always expected because this page has a "${tabLabel}" tab`,
      guest: `always expected because a relation is listed under the "${tabLabel}" tab marked "(Guest)"`,
      exact: `matches a relation listed under the "${tabLabel}" tab (lowercase, whitespace/punctuation stripped)`,
      'the-stripped': `matches a relation listed under the "${tabLabel}" tab (leading "The " stripped, lowercase, whitespace/punctuation stripped)`,
      'suffix-stripped': `matches a relation listed under the "${tabLabel}" tab (trailing Jr./Sr./II/III/IV stripped, lowercase, whitespace/punctuation stripped)`,
      'nickname-stripped': `matches a relation listed under the "${tabLabel}" tab (quoted nickname removed, lowercase, whitespace/punctuation stripped)`,
      'estreetband-dotted': `matches a relation listed under the "${tabLabel}" tab (dotted "first.last" form — ESTREETBAND_DOTTED_TAG_OVERRIDES)`,
      override: `matches a manual override for a relation listed under the "${tabLabel}" tab (RELATION_TAG_ALIAS_OVERRIDES)`,
      'ampersand-combined': `matches a relation listed under the "${tabLabel}" tab (combined name with "&" removed, lowercase, whitespace/punctuation stripped)`,
    };
    return labels[method];
  }

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

  /** SmartTable column definitions for the system:recent-changes page. */
  const RECENT_CHANGES_COLUMNS = [
    { key: 'title',    label: 'Page',    type: 'string' },
    { key: 'flags',    label: 'Type',    type: 'string', width: '70px' },
    { key: 'date',     label: 'Date',    type: 'string', width: '155px' },
    { key: 'revision', label: 'Rev',     type: 'number', width: '55px' },
    { key: 'author',   label: 'By',      type: 'string', width: '120px' },
    { key: 'comment',  label: 'Comment', type: 'string' },
    { key: 'url',      label: 'Link',    type: 'string', sortable: false, filterable: false,
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

  // CONFIG SCHEMA
  //
  // All keys use the prefix "bbp_" (BruceBaseParser) to namespace settings
  // for this specific userscript and avoid collisions with other scripts
  // sharing the same VZ_MBLibrary storage backend.
  const configSchema = {
      // ============================================================
      // GENERIC SECTION
      // ============================================================
      divider_generic: {
          type: 'divider',
          label: '🛠️ GENERIC SETTINGS'
      },

      bbp_enable_debug_logging: {
          label: "Enable debug logging",
          type: "checkbox",
          default: false,
          description: "Enable debug logging in the browser developer console"
      },

      // ============================================================
      // KEYBOARD SHORTCUTS SECTION
      // ============================================================
      divider_keyboard_shortcuts: {
          type: 'divider',
          label: '🎹 KEYBOARD SHORTCUTS'
      },

      bbp_enable_keyboard_shortcuts: {
          label: 'Enable Keyboard Shortcuts',
          type: 'checkbox',
          default: true,
          description: 'Enable keyboard shortcuts and show the "⌨️ Shortcuts" help button'
      },

      bbp_enable_keyboard_shortcut_tooltip: {
          label: 'Enable Keyboard Shortcut Tooltip',
          type: 'checkbox',
          default: true,
          description: 'Enable keyboard shortcut tooltip for the prefix shortcut map'
      },

      bbp_keyboard_shortcut_prefix: {
          label: "Keyboard Shortcut Prefix",
          type: "keyboard_shortcut",
          default: "Ctrl+M",
          description: "Keyboard shortcut prefix key combination (expects a second key press to be complete, e.g. Ctrl+M, Ctrl+., Alt+X, Ctrl+Shift+,)"
      },

      bbp_enable_direct_ctrl_char_shortcuts: {
          label: 'Enable Direct Ctrl+Letter Shortcuts',
          type: 'checkbox',
          default: false,
          description: 'When enabled, direct Ctrl+<letter> shortcuts (Ctrl+B, etc.) fire globally at all times. ' +
                       'When disabled (default), ALL Ctrl+<a-z> shortcuts are suppressed everywhere. ' +
                       'Use the Keyboard Shortcut Prefix (default: Ctrl+M) and a second key instead of blocked Ctrl+letter shortcuts.'
      },

      // ---- Configurable direct shortcuts ----
      // Every entry below controls a single-chord shortcut (no prefix second-key needed).
      // Use the 🎹 Capture button to record a new combination. Changes take effect after Save.

      bbp_shortcut_toggle_sticky_bar: {
          label: "Shortcut: Toggle Sticky Bar",
          type: "keyboard_shortcut",
          default: "Ctrl+B",
          description: "Toggle sticky bar display on any page with a sticky bar (default: Ctrl+B)"
      },

      // ============================================================
      // SETLIST SECTION
      // ============================================================
      divider_setlist: {
          type: 'divider',
          label: '🎵 SETLIST'
      },

      bbp_enable_setlist_tag_warnings: {
          label: 'Flag Untagged Setlist Songs',
          type: 'checkbox',
          default: false,
          description: 'Show a ⚠️ warning icon next to setlist songs (DETAIL page Setlist tab, and YEAR page inline setlist) that have no corresponding tag on the event\'s DETAIL page.'
      },

      // ============================================================
      // TAB ANNOTATIONS SECTION
      // ============================================================
      divider_tab_annotations: {
          type: 'divider',
          label: '🔖 TAB ANNOTATIONS'
      },

      bbp_enable_setlist_tab_annotation: {
          label: 'Annotate Setlist Tab',
          type: 'checkbox',
          default: true,
          description: 'On the DETAIL page, append a ⚠️ to the "Setlist" tab label when the event name or setlist differs from the YEAR page, or color it green when everything matches.'
      },

      bbp_enable_first_tab_annotation: {
          label: 'Annotate First Tab (On Stage / In Studio / On Audio / On Set)',
          type: 'checkbox',
          default: true,
          description: 'On the DETAIL page, append a ⚠️ to the event\'s first tab label ("On Stage"/"In Studio"/"On Audio"/"On Set") when any relation listed there has no matching tag, or color it green when everything matches.'
      },

      // ============================================================
      // TAG SOURCE HIGHLIGHT SECTION
      // ============================================================
      divider_tag_source_highlight: {
          type: 'divider',
          label: '🔍 TAG SOURCE HIGHLIGHT'
      },

      bbp_enable_tag_source_highlight: {
          label: 'Highlight Tag Source on Hover',
          type: 'checkbox',
          default: false,
          description: 'On DETAIL/VENUE/RETAIL/SONG/RELATION pages, hovering a verified (green) tag also draws a green box around the tag itself and, when its on-page source is identifiable (e.g. a matching setlist song, an "On Stage"/"In Studio"/"On Audio"/"On Set" relation name, a page title, a "Commercially Released" date, or a "Bands"/"Members" name), around that source too. On YEAR pages, the same applies inside each event\'s own "Tags" panel, highlighting the source within that event\'s own section.'
      },

      // ============================================================
      // APPEARANCE SECTION
      // ============================================================
      divider_appearance: {
          type: 'divider',
          label: '🎨 APPEARANCE'
      },

      bbp_event_alias_color: {
          label: 'Event Alias Color',
          type: 'color_picker',
          default: '#555555',
          description: 'Text color of the event alias span (.bb-event-alias), shown next to the event name on the YEAR page and DETAIL page title. Default: gray (#555555).'
      },

      bbp_tour_name_color: {
          label: 'Tour Name Color',
          type: 'color_picker',
          default: '#0066cc',
          description: 'Text color of the matched tour name span, shown on the DETAIL page (.bb-tour-name) and, when "Show Tour Name on YEAR Page" is enabled, the YEAR page (.bb-year-tour-name). Both are kept in sync to this one color. Default: blue (#0066cc).'
      },

      // ============================================================
      // TOUR ASSOCIATION SECTION
      // ============================================================
      divider_tour: {
          type: 'divider',
          label: '🎸 TOUR ASSOCIATION'
      },

      bbp_show_tour_name_on_year_page: {
          label: 'Show Tour Name on YEAR Page',
          type: 'checkbox',
          default: false,
          description: 'Also show the matching Springsteen tour\'s official name (see TOUR_DEFINITIONS) next to each event on the YEAR page, styled the same as the event alias. Off by default since not every event has a known tour association.'
      },
  };

  //--------------------------------------------------------------------------------
  // Initialize VZ-MBLibrary (Logging + Settings + Changelog)
  // Use a ref object to avoid circular dependency during initialization
  const settings = {};
  const remoteConfig = {
      changelogUrl:      REMOTE_CHANGELOG_URL,
      cacheKeyChangelog: CACHE_KEY_CHANGELOG,
      cacheTtlMs:        REMOTE_CACHE_TTL_MS
  };
  const Lib = (typeof VZ_MBLibrary !== 'undefined')
        ? new VZ_MBLibrary(SCRIPT_ID, SCRIPT_NAME, configSchema, null, () => {
            // Dynamic check: returns current value of debug setting
            return settings.bbp_enable_debug_logging ?? false;
        }, remoteConfig)
        : {
            settings: {},
            info: console.log, debug: console.log, error: console.error, warn: console.warn, time: console.time, timeEnd: console.timeEnd
        };
  const scriptVersion = (typeof GM_info !== 'undefined' && GM_info.script) ? GM_info.script.version : 'unknown';
  const libVersion = (Lib && Lib.version) ? Lib.version : 'unknown';
  // Copy settings reference so the callback above can access them
  Object.assign(settings, Lib.settings);

  Lib.info('init', `Script v${scriptVersion} loaded (lib v${libVersion}).`);

  /**
   * Format a single log argument for console output: Error instances render as
   * their message (JSON.stringify on an Error yields "{}" since message/stack
   * are non-enumerable), plain objects are JSON-stringified, everything else
   * is coerced to a string.
   * @param {*} a
   * @returns {string}
   */
  function fmtLogArg(a) {
    if (a instanceof Error) return a.message;
    if (typeof a === 'object' && a !== null) {
      try { return JSON.stringify(a); } catch (e) { return String(a); }
    }
    return String(a);
  }

  /**
   * Join variadic log arguments into a single space-separated string.
   * @param {Array<*>} args
   * @returns {string}
   */
  function fmtArgs(args) { return args.map(fmtLogArg).join(' '); }

  /** Debug-level log, gated on the bbp_enable_debug_logging setting. */
  function log(...a)     { Lib.debug('meta', fmtArgs(a)); }
  /** Warn-level log, always visible regardless of the debug setting. */
  function logWarn(...a) { Lib.warn('warn', fmtArgs(a)); }
  /** Error-level log, always visible regardless of the debug setting. */
  function logErr(...a)  { Lib.error('error', fmtArgs(a)); }

  // ════════════════════════════════════════════════════════════════════════════
  // KEYBOARD SHORTCUTS SECTION
  // Config keys: bbp_enable_keyboard_shortcuts, bbp_enable_keyboard_shortcut_tooltip,
  //              bbp_keyboard_shortcut_prefix, bbp_enable_direct_ctrl_char_shortcuts,
  //              bbp_shortcut_toggle_sticky_bar
  // Ported from ShowAllEntityData's Emacs-style prefix-key shortcut engine (sa_
  // settings renamed to bbp_). Two dispatch paths share one ctrlMFunctionMap:
  // pressing the prefix key (default Ctrl+M) then a single character always
  // works; pressing the direct Ctrl+<letter> combo only works when
  // bbp_enable_direct_ctrl_char_shortcuts is on.
  // Functions  : parsePrefixShortcut, getPrefixDisplay, isPrefixKeyEvent, isShortcutEvent,
  //              getShortcutDisplay, buildShortcutHint, showCtrlMTooltip, hideCtrlMTooltip,
  //              toggleStickyBar, showShortcutsHelp, addShortcutsHelpButton, initKeyboardShortcuts
  // ════════════════════════════════════════════════════════════════════════════

  let ctrlMModeActive = false;
  let ctrlMModeTimeout;
  const ctrlMFunctionMap = {}; // populated below, once the actions it dispatches to are defined
  let ctrlMTooltipElement = null;

  /**
   * Parse a shortcut string such as "Ctrl+M", "Ctrl+.", "Alt+Shift+X" into its
   * component parts.
   * @param {string} str - The shortcut string to parse
   * @returns {{ ctrl: boolean, meta: boolean, alt: boolean, shift: boolean, key: string }}
   */
  function parsePrefixShortcut(str) {
    const parts = (str || 'Ctrl+M').trim().split('+');
    let key = parts.pop().trim();
    // A trailing '+' (e.g. "Ctrl++") means the actual key character is '+'
    if (key === '') key = '+';
    const mods = parts.map(p => p.trim().toLowerCase());
    return {
      ctrl:  mods.includes('ctrl'),
      meta:  mods.includes('meta') || mods.includes('cmd') || mods.includes('super'),
      alt:   mods.includes('alt'),
      shift: mods.includes('shift'),
      key:   key
    };
  }

  /**
   * Returns the display string for the configured prefix shortcut (e.g. "Ctrl+M").
   * Falls back to "Ctrl+M" when the setting is not yet available.
   * @returns {string}
   */
  function getPrefixDisplay() {
    return (Lib.settings && Lib.settings.bbp_keyboard_shortcut_prefix) || 'Ctrl+M';
  }

  /**
   * Returns true when a keyboard event matches the configured prefix shortcut.
   * When "Ctrl" appears in the prefix it matches BOTH Ctrl and Meta/Cmd keys,
   * preserving cross-platform (Mac/Windows/Linux) compatibility.
   * @param {KeyboardEvent} e
   * @returns {boolean}
   */
  function isPrefixKeyEvent(e) {
    const p = parsePrefixShortcut(getPrefixDisplay());
    const ctrlMatch  = p.ctrl  ? (e.ctrlKey || e.metaKey) : (!e.ctrlKey && !e.metaKey);
    const altMatch   = p.alt   ? e.altKey                 : !e.altKey;
    const shiftMatch = p.shift ? e.shiftKey               : !e.shiftKey;
    const keyMatch   = e.key.toLowerCase() === p.key.toLowerCase();
    return ctrlMatch && altMatch && shiftMatch && keyMatch;
  }

  /**
   * Returns true when a keyboard event matches a configured single-chord shortcut.
   * Mirrors isPrefixKeyEvent logic but reads an arbitrary setting key. "Ctrl" in
   * the stored value matches both Ctrl and Meta/Cmd for cross-platform compat.
   * @param {KeyboardEvent} e
   * @param {string} settingKey - The configSchema key to read (e.g. 'bbp_shortcut_toggle_sticky_bar')
   * @param {string} fallback   - Default shortcut string when the setting is absent
   * @returns {boolean}
   */
  function isShortcutEvent(e, settingKey, fallback) {
    const raw = (Lib.settings && Lib.settings[settingKey]) || fallback;
    const p = parsePrefixShortcut(raw);
    const ctrlMatch  = p.ctrl  ? (e.ctrlKey || e.metaKey) : (!e.ctrlKey && !e.metaKey);
    const altMatch   = p.alt   ? e.altKey                 : !e.altKey;
    const shiftMatch = p.shift ? e.shiftKey               : !e.shiftKey;
    const keyMatch   = e.key.toLowerCase() === p.key.toLowerCase();
    return ctrlMatch && altMatch && shiftMatch && keyMatch;
  }

  /**
   * Returns the display string for a configured single-chord shortcut.
   * Falls back to the supplied default when the setting is not yet available.
   * @param {string} settingKey - The configSchema key to read
   * @param {string} fallback   - Value to return when the setting is absent
   * @returns {string}
   */
  function getShortcutDisplay(settingKey, fallback) {
    return (Lib.settings && Lib.settings[settingKey]) || fallback;
  }

  /**
   * Builds a keyboard shortcut hint string for button/tooltip titles. Always
   * includes the prefix-mode form (e.g. "Ctrl+M, then B"). Appends the direct
   * shortcut (e.g. "or Ctrl+B") only when bbp_enable_direct_ctrl_char_shortcuts
   * is on, or when the shortcut is not a Ctrl+<a-z> key and is therefore never
   * suppressed.
   * @param {string} settingKey  configSchema key for the direct shortcut
   * @param {string} fallback    default direct shortcut string
   * @param {string} prefixKey   single key label used after the prefix (e.g. 'B')
   * @returns {string}  e.g. "Ctrl+M, then B" or "Ctrl+M, then B, or Ctrl+B"
   */
  function buildShortcutHint(settingKey, fallback, prefixKey) {
    const directKey   = getShortcutDisplay(settingKey, fallback);
    const prefixHint  = `${getPrefixDisplay()}, then ${prefixKey}`;
    const p = parsePrefixShortcut(directKey);
    const isBlockedLetter = p.ctrl && !p.alt && !p.shift
                         && p.key.length === 1
                         && p.key.toLowerCase() >= 'a' && p.key.toLowerCase() <= 'z';
    const directOn = !!(Lib.settings && Lib.settings.bbp_enable_direct_ctrl_char_shortcuts);
    return (!isBlockedLetter || directOn) ? `${prefixHint}, or ${directKey}` : prefixHint;
  }

  /**
   * Displays a floating tooltip listing all prefix-mode function shortcuts
   * (from ctrlMFunctionMap) in the upper-right corner of the page.
   * No-ops when the tooltip is disabled in settings.
   */
  function showCtrlMTooltip() {
    if (!Lib.settings.bbp_enable_keyboard_shortcut_tooltip) return;

    hideCtrlMTooltip();

    ctrlMTooltipElement = document.createElement('div');
    ctrlMTooltipElement.id = 'bb-ctrl-m-tooltip';
    ctrlMTooltipElement.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background-color: #f0f0f0;
      border: 1px solid #999;
      border-radius: 4px;
      padding: 8px 12px;
      font-size: 0.75em;
      max-width: 250px;
      z-index: 10000;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      line-height: 1.4;
    `;

    let tooltipHTML = `<strong>${getPrefixDisplay()} Shortcuts:</strong><br/><strong>Functions:</strong><br/>`;
    for (const [key, entry] of Object.entries(ctrlMFunctionMap)) {
      tooltipHTML += `<div style="margin-left: 4px;"><strong>${key}</strong>: ${entry.description}</div>`;
    }

    ctrlMTooltipElement.innerHTML = tooltipHTML;
    document.body.appendChild(ctrlMTooltipElement);
  }

  /**
   * Removes the prefix-mode tooltip from the DOM if it is currently visible.
   * Safe to call even when no tooltip is present.
   */
  function hideCtrlMTooltip() {
    if (ctrlMTooltipElement) {
      ctrlMTooltipElement.remove();
      ctrlMTooltipElement = null;
    }
  }

  /**
   * Toggles #bb-sticky-bar between displayed and hidden, keeping the
   * --bb-sticky-bar-h CSS variable (used by other sticky elements for their
   * top offset) in sync. Page-agnostic by design: works on any page type that
   * happens to render a #bb-sticky-bar (HOME, YEAR, LIST, RECENT CHANGES today,
   * and any future page mode that adopts the same element) — driven entirely
   * by the element's presence, not by a page-type allowlist.
   */
  function toggleStickyBar() {
    const bar = document.getElementById('bb-sticky-bar');
    if (!bar) {
      logWarn('No #bb-sticky-bar found on this page — nothing to toggle');
      return;
    }
    const isHidden = bar.style.display === 'none';
    if (isHidden) {
      bar.style.display = '';
      document.documentElement.style.setProperty('--bb-sticky-bar-h', `${bar.offsetHeight}px`);
    } else {
      document.documentElement.style.setProperty('--bb-sticky-bar-h', '0px');
      bar.style.display = 'none';
    }
    log(`Sticky bar ${isHidden ? 'shown' : 'hidden'} via keyboard shortcut`);
  }

  ctrlMFunctionMap['b'] = {
    fn: () => toggleStickyBar(),
    description: 'Toggle Sticky Bar'
  };

  /**
   * Displays a dialog listing the available keyboard shortcuts. Acts as a
   * toggle — calling it again while already open closes it. Closes on Escape,
   * on clicking outside the box, or via its ✕ button.
   */
  function showShortcutsHelp() {
    const existing = document.getElementById('bb-shortcuts-help');
    if (existing) { existing.remove(); return; }

    const overlay = document.createElement('div');
    overlay.id = 'bb-shortcuts-help';
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 10001;
      background: rgba(0,0,0,0.35);
      display: flex; align-items: center; justify-content: center;
    `;

    const box = document.createElement('div');
    box.style.cssText = `
      background: #fff; border-radius: 8px; padding: 16px 20px;
      max-width: 420px; width: 90vw; max-height: 80vh; overflow-y: auto;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3); font-size: 0.9em;
    `;

    const directOn = !!Lib.settings.bbp_enable_direct_ctrl_char_shortcuts;
    box.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <strong style="font-size:1.1em;">🎹 Keyboard Shortcuts</strong>
        <button id="bb-shortcuts-help-close" type="button" style="background:none; border:none; font-size:1.2em; cursor:pointer;">✕</button>
      </div>
      <div style="margin-bottom:8px;">
        <span style="font-family:monospace; background:#f5f5f5; padding:2px 6px; border-radius:3px;">${esc(getPrefixDisplay())}</span>
        <span style="color:#666; margin-left:10px;">Enter prefix mode (then a second key runs a function)</span>
      </div>
      <div style="margin-bottom:8px;">
        <span style="font-family:monospace; background:#f5f5f5; padding:2px 6px; border-radius:3px;">${esc(buildShortcutHint('bbp_shortcut_toggle_sticky_bar', 'Ctrl+B', 'B'))}</span>
        <span style="color:#666; margin-left:10px;">Toggle sticky bar (any page with one)</span>
      </div>
      <div style="margin-bottom:8px;">
        <span style="font-family:monospace; background:#f5f5f5; padding:2px 6px; border-radius:3px;">? or /</span>
        <span style="color:#666; margin-left:10px;">Show this help</span>
      </div>
      <div style="margin-top:12px; padding-top:8px; border-top:1px solid #eee; font-size:0.85em; color:#666; font-style:italic;">
        ${directOn
          ? 'Direct Ctrl+letter shortcuts are enabled globally (fire at all times).'
          : `Direct Ctrl+letter shortcuts are suppressed everywhere. Use ${esc(getPrefixDisplay())} followed by the letter key instead, or enable "Direct Ctrl+Letter Shortcuts" in Settings.`}
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    box.querySelector('#bb-shortcuts-help-close').addEventListener('click', close);
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); }
    });

    log('Shortcuts help displayed');
  }

  /**
   * Adds the "⌨️ Shortcuts" help button to the given button container, unless
   * it is already present. No-ops when the container is missing.
   * @param {Element} container - The #bb-btn-container element to append to.
   */
  function addShortcutsHelpButton(container) {
    if (!container || document.getElementById('bb-shortcuts-help-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'bb-shortcuts-help-btn';
    btn.className = 'bb-toggle-btn';
    btn.type = 'button';
    btn.textContent = '⌨️ Shortcuts';
    btn.title = `Show keyboard shortcuts (or press ? / ${buildShortcutHint('bbp_shortcut_toggle_sticky_bar', 'Ctrl+B', 'B')})`;
    btn.addEventListener('click', showShortcutsHelp);
    container.appendChild(btn);
  }

  /**
   * Registers the prefix-mode and direct-shortcut keydown listeners once per
   * page load. Safe to call multiple times — guarded by
   * document._bbKeyboardShortcutsInitialized.
   */
  function initKeyboardShortcuts() {
    if (document._bbKeyboardShortcutsInitialized) return;

    // Prefix-mode listener — capture phase so it always wins the key, matching
    // the "always available, never suppressed" guarantee described in Settings.
    document.addEventListener('keydown', (e) => {
      if (isPrefixKeyEvent(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();

        if (ctrlMModeActive) {
          ctrlMModeActive = false;
          clearTimeout(ctrlMModeTimeout);
          hideCtrlMTooltip();
          log(`Exited ${getPrefixDisplay()} mode`);
          return;
        }

        ctrlMModeActive = true;
        showCtrlMTooltip();
        log(`Entered ${getPrefixDisplay()} mode. Press a shortcut key or Escape to cancel.`);

        clearTimeout(ctrlMModeTimeout);
        ctrlMModeTimeout = setTimeout(() => {
          ctrlMModeActive = false;
          hideCtrlMTooltip();
          log(`Exited ${getPrefixDisplay()} mode (timeout)`);
        }, 5000);
        return;
      }

      if (ctrlMModeActive && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
        const key = e.key.toLowerCase();
        const entry = ctrlMFunctionMap[key];
        if (entry) {
          e.preventDefault();
          if (typeof entry.fn === 'function') {
            entry.fn();
            log(`Function "${entry.description}" triggered via ${getPrefixDisplay()} then '${e.key}'`);
          } else {
            logWarn(`Function "${entry.description}" not available`);
          }
        }
        ctrlMModeActive = false;
        clearTimeout(ctrlMModeTimeout);
        hideCtrlMTooltip();
        return;
      }

      if (e.key === 'Escape' && ctrlMModeActive) {
        e.preventDefault();
        ctrlMModeActive = false;
        clearTimeout(ctrlMModeTimeout);
        hideCtrlMTooltip();
        log(`Exited ${getPrefixDisplay()} mode (Escape pressed)`);
        return;
      }

      if (ctrlMModeActive && (e.ctrlKey || e.metaKey || e.altKey) && e.key !== 'Escape') {
        ctrlMModeActive = false;
        clearTimeout(ctrlMModeTimeout);
        hideCtrlMTooltip();
      }
    }, { capture: true });

    // Direct Ctrl+<letter> shortcuts and "?"/"/" help — bubble phase.
    document.addEventListener('keydown', (e) => {
      const isTyping = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';

      if ((e.key === '?' || e.key === '/') && !isTyping) {
        e.preventDefault();
        showShortcutsHelp();
        return;
      }

      // Block ALL direct Ctrl+<letter> (a-z) shortcuts when
      // bbp_enable_direct_ctrl_char_shortcuts is off.
      if (!Lib.settings.bbp_enable_direct_ctrl_char_shortcuts &&
          e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey &&
          e.key.length === 1 &&
          e.key.toLowerCase() >= 'a' && e.key.toLowerCase() <= 'z') {
        return;
      }

      if (isShortcutEvent(e, 'bbp_shortcut_toggle_sticky_bar', 'Ctrl+B')) {
        e.preventDefault();
        toggleStickyBar();
      }
    });

    document._bbKeyboardShortcutsInitialized = true;
    log('Keyboard shortcuts initialized');
  }

  /**
   * Tests whether an href's first path segment has a "<category>:" prefix
   * (e.g. /gig:1978-08-21, /venue:xyz, /system:recent-changes). Plain
   * navigation/UI links - year pages, pagination, Wikidot's own Edit/History/
   * Tags buttons, in-page anchors, etc. - never match and must keep their
   * normal same-tab behaviour.
   * @param {string} href Raw href attribute value.
   * @returns {boolean}
   */
  function isCategoryPageHref(href) {
    let path;
    try {
      path = new URL(href, location.href).pathname;
    } catch (e) {
      return false;
    }
    const firstSegment = path.replace(/^\//, '').split('/')[0];
    return /^[a-zA-Z][\w-]*:/.test(firstSegment);
  }

  /** sessionStorage key for rememberActiveTabForPagination/restorePaginatedTab. */
  const PAGER_TAB_RESTORE_KEY = 'bb-pager-restore-tab';

  /**
   * Returns the nav label of the currently visible `.yui-content` tab panel
   * (the one without `display:none`), or null if none is found. Panel
   * visibility — not a `.selected`/`[title="active"]` marker on the nav
   * `<li>` — is used because those attributes reflect the page's
   * server-rendered *default* tab and aren't reliably updated by a client-
   * side tab switch, whereas panel visibility is the one thing the tab
   * widget must get right for tab-switching to work at all.
   * @returns {string|null}
   */
  function getVisibleTabLabel() {
    const visiblePanel = [...document.querySelectorAll('.yui-content > [id^="wiki-tab-0-"]')]
      .find(div => div.style.display !== 'none');
    const idx = visiblePanel?.id.match(/^wiki-tab-0-(\d+)$/)?.[1];
    if (idx === undefined) return null;
    return [...document.querySelectorAll('.yui-nav em')][idx]?.textContent.trim() || null;
  }

  /**
   * Records the currently visible tab's label (see getVisibleTabLabel) and
   * this page's own path (with any "/p/N" pagination suffix stripped) to
   * sessionStorage, so restorePaginatedTab() can re-select the same tab
   * once the paginated page finishes loading. A `.pager` link (see
   * forceNewTab) is a real same-tab page navigation, and BruceBase's own
   * tabview always selects the first tab on a fresh page load — without
   * this, clicking "next page" from e.g. the "Performances" tab would
   * always land back on the first tab instead.
   */
  function rememberActiveTabForPagination() {
    const label = getVisibleTabLabel();
    if (!label) return;
    sessionStorage.setItem(PAGER_TAB_RESTORE_KEY, JSON.stringify({
      label,
      path: location.pathname.replace(/\/p\/\d+$/, ''),
    }));
  }

  /**
   * Re-selects the tab recorded by rememberActiveTabForPagination(), if any,
   * by clicking its nav link (exactly what a real user click would do, so
   * BruceBase's own tabview switches panels normally). No-op when nothing
   * was recorded, its path doesn't match the current page's (e.g. the
   * stored click was abandoned in favor of navigating elsewhere), or the
   * recorded tab is already the one showing — e.g. it's the page's default
   * tab, as "Performances" is on a relation page like garry-tallent's.
   * Re-clicking an already-active tab isn't a no-op: it makes BruceBase's
   * own tab widget re-fetch/reset that panel back to its own default (page
   * 1) state, discarding the page-2+ content the "/p/N" navigation already
   * correctly server-rendered.
   */
  function restorePaginatedTab() {
    const raw = sessionStorage.getItem(PAGER_TAB_RESTORE_KEY);
    if (!raw) return;
    sessionStorage.removeItem(PAGER_TAB_RESTORE_KEY);
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return;
    }
    if (data.path !== location.pathname.replace(/\/p\/\d+$/, '')) return;
    if (getVisibleTabLabel() === data.label) return;
    const targetEm = [...document.querySelectorAll('.yui-nav em')]
      .find(em => em.textContent.trim() === data.label);
    targetEm?.closest('a')?.click();
  }

  /**
   * Forces a single <a> element to open in a new tab, but only when it
   * links to a "<category>:" BruceBase page (see isCategoryPageHref) and
   * isn't part of a tab's internal `<div class="pager">` pagination widget
   * (e.g. a "Performances" tab with many results, linking to "/relation:
   * garry-tallent/p/2" etc.) — those must keep their normal same-tab
   * behaviour or the pagination breaks (opens a new, blank tab instead of
   * advancing to the next page in place). Pager links instead get a
   * one-time click listener that remembers the active tab so it can be
   * restored after the page reloads — see rememberActiveTabForPagination.
   * @param {Element} a Anchor element to update.
   */
  function forceNewTab(a) {
    const href = a.getAttribute('href');
    if (!href || !isCategoryPageHref(href)) return;
    if (a.closest('.pager')) {
      if (!a.dataset.bbPagerWired) {
        a.dataset.bbPagerWired = '1';
        a.addEventListener('click', rememberActiveTabForPagination);
      }
      return;
    }
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  }

  /**
   * Starts a MutationObserver that forces every hyperlink on the page -
   * present now or inserted later by any processing step (original site
   * markup, Save/Load, tab switches, SmartTable, etc.) - to open in a new
   * tab. Without this, an accidental click on a link inside the processed
   * content would replace a page that may have taken a long time to build.
   */
  function startNewTabLinkGuard() {
    document.querySelectorAll('a[href]').forEach(forceNewTab);
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (node.matches('a[href]')) forceNewTab(node);
          node.querySelectorAll?.('a[href]').forEach(forceNewTab);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  log('Script starting on', location.href);
  addStyles();
  createTooltipElement();
  startNewTabLinkGuard();
  restorePaginatedTab();

  const path        = location.pathname.replace(/^\//, '');
  const isHomePage   = path === '' || path === 'start';
  const isListPage   = /^(\d{4}|1949-64)-list$/.test(path);
  const isYearPage   = /^\d{4}$/.test(path) || path === '1949-64';
  const isDetailPage = DETAIL_TYPE_RE.test(path);
  const isVenuePage          = /^venue:/.test(path);
  const isRetailPage         = /^retail:/.test(path);
  const isSongPage           = /^song:/.test(path);
  const isRelationPage       = /^relation:/.test(path);
  const isRecentChangesPage  = path === 'system:recent-changes';

  log('[DBG] path:', JSON.stringify(path),
      '| home:', isHomePage, '| list:', isListPage, '| year:', isYearPage,
      '| detail:', isDetailPage, '| venue:', isVenuePage,
      '| retail:', isRetailPage, '| song:', isSongPage,
      '| relation:', isRelationPage, '| recent:', isRecentChangesPage);

  if (Lib.settings.bbp_enable_keyboard_shortcuts) initKeyboardShortcuts();

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
  } else if (isVenuePage) {
    log('Detected VENUE page');
    await runVenuePage();
  } else if (isRetailPage) {
    log('Detected RETAIL page');
    await runRetailPage();
  } else if (isSongPage) {
    log('Detected SONG page');
    await runSongPage();
  } else if (isRelationPage) {
    log('Detected RELATION page');
    await runRelationPage();
  } else if (isRecentChangesPage) {
    log('Detected RECENT CHANGES page');
    await runRecentChangesPage();
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
    filterBtn.textContent = '⚡ Issues';
    filterBtn.title = 'Filter to show only events or year sections with detected issues';
    filterBtn.disabled = true;

    const homeOriginalBtn = document.createElement('button');
    homeOriginalBtn.id = 'bb-global-toggle';
    homeOriginalBtn.className = 'bb-toggle-btn';
    homeOriginalBtn.textContent = '⇄ Original Page';
    homeOriginalBtn.title = 'Toggle between the original page title and the aggregated results view';

    const btnContainer = document.createElement('div');
    btnContainer.id = 'bb-btn-container';

    const [homeSaveBtn, homeLoadBtn] = makeSaveLoadBtns(
      'home', () => resultsEl, () => ''
    );
    btnContainer.append(fetchBtn, overviewBtn, filterBtn, homeOriginalBtn, homeSaveBtn, homeLoadBtn);
    if (Lib.settings.bbp_enable_keyboard_shortcuts) addShortcutsHelpButton(btnContainer);

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

    const homeFilterBar = createFilterBar('home');
    stickyBar.appendChild(homeFilterBar.el);

    pageTitle.parentNode.insertBefore(stickyBar, pageTitle);
    pageTitle.style.display = 'none';

    // ── Results container ─────────────────────────────────────────────────────
    const resultsEl = document.createElement('div');
    resultsEl.id = 'bb-home-results';
    stickyBar.after(resultsEl);

    // ── "⇄ Original Page" toggle — shows the original page title, hides results ──
    let homeShowingOriginal = false;
    homeOriginalBtn.addEventListener('click', () => {
      homeShowingOriginal = !homeShowingOriginal;
      resultsEl.style.display = homeShowingOriginal ? 'none' : '';
      pageTitle.style.display = homeShowingOriginal ? ''     : 'none';
      homeOriginalBtn.textContent = homeShowingOriginal ? '⇄ Processed Page' : '⇄ Original Page';
      log(`HOME: ${homeShowingOriginal ? 'showing' : 'hiding'} original page via toggle`);
    });

    // Measure heights for sticky positioning (mirrors setupStickyBar logic).
    const bbHeader = document.getElementById('header');
    document.documentElement.style.setProperty('--bb-header-h', `${bbHeader ? bbHeader.offsetHeight : 0}px`);
    requestAnimationFrame(() => {
      document.documentElement.style.setProperty('--bb-sticky-bar-h', `${stickyBar.offsetHeight}px`);
    });

    // ── SmartTable + filter state (rebuilt after each fetch) ─────────────────
    let stHostEl = null; // SmartTable host div, placed before resultsEl
    let stBtnEl  = null; // SmartTable trigger button, moved into btnContainer

    const homeFilterState = {
      mismatchActive: false,
      textMatcher:    null,
      filterQuery:    '',
      filterOptions:  { caseSensitive: false, useRegex: false, exclude: false, fullText: false },
      applyFn:        null,
    };

    homeFilterBar.setOnChange((query, options) => {
      homeFilterState.filterQuery   = query;
      homeFilterState.filterOptions = options;
      homeFilterState.textMatcher   = buildFilterMatcher(query, options);
      if (homeFilterState.applyFn) homeFilterState.applyFn();
    });

    filterBtn.addEventListener('click', () => {
      if (!homeFilterState.applyFn) return;
      homeFilterState.mismatchActive = !homeFilterState.mismatchActive;
      homeFilterState.applyFn();
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
      homeFilterState.mismatchActive = false;
      homeFilterState.applyFn = null;
      homeFilterBar.setCount(0);
      homeFilterBar.setTotal(0);
      filterBtn.textContent = '⚡ Issues';
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

      // ── Mismatch + text filter ────────────────────────────────────────────────
      const mode = activeBtn === overviewBtn ? 'list' : 'year';
      const isMismatchFn = mode === 'list'
        ? a => isListMismatch(a)
        : div => isYearMismatch(div);

      const allUnits = mode === 'list'
        ? [...resultsEl.querySelectorAll('.bb-year-wrapper a[href]')]
            .filter(a => LIST_LINK_RE.test(a.getAttribute('href') || ''))
        : [...resultsEl.querySelectorAll('.bb-section-processed')];
      const total        = allUnits.length;
      const mismatchCount = allUnits.filter(isMismatchFn).length;

      filterBtn.textContent = `⚡ Issues (${mismatchCount})`;
      homeFilterBar.setTotal(total);

      homeFilterState.applyFn = () => {
        const count = applyHomeFilters(homeFilterState, resultsEl, isMismatchFn, mode);
        homeFilterBar.setCount(count);
        filterBtn.textContent = homeFilterState.mismatchActive
          ? `⚡ All Events (${total})`
          : `⚡ Issues (${mismatchCount})`;
      };
      homeFilterState.applyFn();
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
    mismatchBtn.textContent = '⚡ Issues';
    mismatchBtn.title = 'Filter to show only events with detected issues (name mismatches, setlist differences, anchor/venue warnings, etc.)';
    mismatchBtn.disabled = true;

    let relToggleBtn = document.createElement('button');
    relToggleBtn.id        = 'bb-rel-toggle';
    relToggleBtn.className = 'bb-toggle-btn';
    relToggleBtn.textContent = 'Hide Relations';
    relToggleBtn.title = 'Hide or show all relation participant blocks';
    relToggleBtn.disabled = true;

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

    btnContainer.append(yearStartBtn, yearSaveBtn, yearLoadBtn, globalBtn, mismatchBtn, relToggleBtn);
    if (Lib.settings.bbp_enable_keyboard_shortcuts) addShortcutsHelpButton(btnContainer);

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

    const stickyBar   = setupStickyBar(content, pageTitle, controlsEl);
    const yearFilterBar = createFilterBar('year');
    const preEventsEl = stickyBar.querySelector('#bb-pre-events');
    if (preEventsEl) stickyBar.insertBefore(yearFilterBar.el, preEventsEl);
    else stickyBar.appendChild(yearFilterBar.el);
    document.documentElement.style.setProperty('--bb-sticky-bar-h', `${stickyBar.offsetHeight}px`);

    // ── Start/Stop toggle ────────────────────────────────────────────────────
    let _yearProcessing = false;
    let _yearStopRequested = false;

    let yearFilterState = {
      mismatchActive: false,
      textMatcher:    null,
      filterQuery:    '',
      filterOptions:  { caseSensitive: false, useRegex: false, exclude: false, fullText: false },
    };

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
      clearAllHighlights(content);
      yearFilterState.mismatchActive = false;
      document.getElementById('bb-page-original')?.remove();
      content.querySelectorAll('.bb-section-controls, .bb-section-original, .bb-section-header').forEach(el => el.remove());
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

      document.body.classList.remove('bb-relations-hidden');
      content.querySelectorAll('.bb-rel-hidden').forEach(el => el.classList.remove('bb-rel-hidden'));
      const freshRelToggle = relToggleBtn.cloneNode(true);
      freshRelToggle.textContent = 'Hide Relations';
      freshRelToggle.disabled = true;
      relToggleBtn.replaceWith(freshRelToggle);
      relToggleBtn = freshRelToggle;

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
      yearFilterBar.setTotal(currentEvents.length);
      const yearApplyFn = () => yearFilterBar.setCount(applyYearFilters(yearFilterState, currentEvents));
      setupMismatchFilter(mismatchBtn, currentEvents.length, yearFilterState, yearApplyFn);
      setupYearTextFilter(yearFilterBar, yearFilterState, yearApplyFn);
      yearApplyFn();
      globalBtn.disabled = false;
      mismatchBtn.disabled = false;
      yearSaveBtn.disabled = false;
      setupRelationsToggle(relToggleBtn);
      relToggleBtn.disabled = false;

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
        // Remove all wikidot list-pages widgets (e.g. "Jump to most recent") —
        // they render nothing useful in the sticky bar and add visual noise.
        for (const box of [...preEventsDiv.querySelectorAll('.list-pages-box')]) box.remove();
        stickyBar.appendChild(preEventsDiv);
      }
    }

    const headerEl = document.getElementById('header');
    if (headerEl) {
      const h = Math.round(headerEl.getBoundingClientRect().height);
      document.documentElement.style.setProperty('--bb-header-h', `${h}px`);
    }
    document.documentElement.style.setProperty('--bb-sticky-bar-h', `${stickyBar.offsetHeight}px`);
    return stickyBar;
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

  /**
   * Selector for annotated elements that (a) stay in the live DOM in both
   * "Original Page" toggle states — unlike .bb-tag-missing/.bb-tag-spurious/
   * .bb-tag-onstage/etc., which are separate elements hidden outright via
   * .bb-original-view's `display:none` rules — and (b) carry a native
   * `title` tooltip set directly on them by this script. CSS can reset
   * their color/cursor (see addStyles' .bb-original-view rules) but can't
   * touch an HTML attribute, so toggleAnnotationTitles handles those.
   */
  const ORIGINAL_VIEW_TITLE_SELECTOR = '.bb-tag-ok, .bb-relation-name-ok, .bb-setlist-tab-match, .bb-first-tab-match';

  /**
   * Moves the native `title` tooltip off every ORIGINAL_VIEW_TITLE_SELECTOR
   * element into a `data-bb-orig-title` attribute when entering "Original
   * Page" view (so no annotation tooltip survives — matching the DETAIL
   * page's setlist tab, which shows a pristine, listener-free clone with no
   * titles at all) and restores it when leaving. Safe to call every click;
   * a no-op for elements with nothing to move/restore.
   * @param {boolean} showingOriginal
   */
  function toggleAnnotationTitles(showingOriginal) {
    for (const el of document.querySelectorAll(ORIGINAL_VIEW_TITLE_SELECTOR)) {
      if (showingOriginal) {
        if (el.hasAttribute('title')) {
          el.dataset.bbOrigTitle = el.getAttribute('title');
          el.removeAttribute('title');
        }
      } else if (el.dataset.bbOrigTitle !== undefined) {
        el.setAttribute('title', el.dataset.bbOrigTitle);
        delete el.dataset.bbOrigTitle;
      }
    }
  }

  /**
   * Wires up the "⇄ Original Page" button for VENUE/RETAIL/SONG/RELATION
   * pages using a pure CSS toggle (body.bb-original-view — see addStyles),
   * instead of the innerHTML clone-and-swap that setupGlobalToggle uses.
   * Unlike DETAIL/YEAR pages, these page types' own #page-content isn't
   * restructured by this script — annotations are only ever appended to
   * .page-tags (all four) and .yui-nav em (RELATION only), all already
   * hidden by the .bb-original-view CSS rules — so #page-content is never
   * hidden or cloned here, which keeps BruceBase's own tab-switching JS
   * (bound to these exact DOM nodes at page load, where the page has tabs)
   * working in both toggle states. setupGlobalToggle's clone loses that
   * binding on its non-live copy, breaking tab clicks whenever that copy
   * is the one shown.
   * @param {HTMLButtonElement} btn
   */
  function setupAnnotationOnlyToggle(btn) {
    let showingOriginal = false;
    btn.addEventListener('click', () => {
      showingOriginal = !showingOriginal;
      btn.textContent = showingOriginal ? '⇄ Processed Page' : '⇄ Original Page';
      document.body.classList.toggle('bb-original-view', showingOriginal);
      toggleAnnotationTitles(showingOriginal);
    });
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
      } else if (pageType === 'venue' || pageType === 'retail' || pageType === 'song' || pageType === 'relation') {
        document.body.classList.remove('bb-original-view');
        const freshGlobal = oldGlobal.cloneNode(true);
        freshGlobal.textContent = '⇄ Original Page';
        freshGlobal.disabled = false;
        oldGlobal.replaceWith(freshGlobal);
        setupAnnotationOnlyToggle(freshGlobal);
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

    // Relations toggle (YEAR only)
    const oldRelToggle = document.getElementById('bb-rel-toggle');
    if (oldRelToggle && pageType === 'year') {
      document.body.classList.remove('bb-relations-hidden');
      contentEl.querySelectorAll('.bb-rel-hidden').forEach(el => el.classList.remove('bb-rel-hidden'));
      const freshRelToggle = oldRelToggle.cloneNode(true);
      freshRelToggle.textContent = 'Hide Relations';
      oldRelToggle.replaceWith(freshRelToggle);
      setupRelationsToggle(freshRelToggle);
      freshRelToggle.disabled = false;
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
      '.bb-song-match, .bb-song-year-only, .bb-song-detail-only, .bb-song-char-diff'
    ).forEach(span => {
      span.addEventListener('mouseenter', e => showSongTooltip(e, span));
      span.addEventListener('mouseleave', hideTooltip);
    });

    // [data-msg] elements that ALSO carry a native [title] are one-line
    // messages that intentionally rely on the browser's native tooltip only
    // (title survives the innerHTML round-trip with no JS needed) — only
    // elements with a genuinely rich (multi-line/HTML) tooltip and no title
    // need their custom listener restored here.
    container.querySelectorAll('[data-msg]:not([title])').forEach(el => {
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
        processedDiv.querySelectorAll('.bb-relations-flat').forEach(el => {
          el.style.display = view === 'list' ? 'none' : '';
        });
        processedDiv.querySelectorAll('.bb-relations-list').forEach(el => {
          el.style.display = view === 'list' ? '' : 'none';
        });
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
            !el.classList.contains('bb-relations-flat') &&
            el.querySelector('.bb-sep, .bb-song-match, .bb-song-year-only, .bb-song-detail-only, .bb-song-char-diff')
          );
          const hasRelBlocks = !!processedDiv.querySelector('.bb-relations-flat');
          if (!setlistEls.length && !hasRelBlocks) return;
          if (setlistEls.length > 0) {
            listDiv = buildListDiv(setlistEls, processedDiv);
            setlistEls[0].parentNode.insertBefore(listDiv, setlistEls[0]);
          }
        }
        showView('list');
      });

      // Re-wire per-event relation toggle (only present on events with relation blocks).
      const relBtnOld = controls.querySelector('.bb-rel-section-toggle');
      if (relBtnOld) {
        const relBtn = relBtnOld.cloneNode(true);
        relBtnOld.replaceWith(relBtn);
        relBtn.addEventListener('click', () => {
          const hiding = !processedDiv.classList.contains('bb-rel-hidden');
          processedDiv.classList.toggle('bb-rel-hidden', hiding);
          relBtn.textContent = hiding ? 'Show Relations' : 'Hide Relations';
        });
      }
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
        const href = eventLink.getAttribute('href') || '';
        const url  = `${location.protocol}//${location.host}${href}`;
        const doc  = await fetchPage(url);

        section.querySelectorAll('img.image').forEach(img => { img.style.opacity = ''; });
        section.querySelector('.bb-event-tab-row')?.remove();
        section.querySelectorAll('.bb-icon-sorry').forEach(s => s.remove());

        const typeM     = href.match(/^\/([a-z]+):/);
        const eventType = typeM ? typeM[1] : '';
        const retryTabMap = buildTabMap(doc);
        const onstageResult = await fetchOnstageCompanionTags(href.replace(/^\//, ''), eventType, retryTabMap);
        wireIconHandlers(eventLink, doc, onstageResult);
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

    // If the section opens with a banner/header table (e.g. tour-leg announcement),
    // hoist it out of processedDiv and place it between <hr> and the toggle controls
    // so the visual order is: hr → table → controls → content.  Strip the same table
    // from the original-view snapshot to avoid rendering it twice when toggled.
    let controlAnchor = hr;
    if (processedDiv.firstElementChild?.tagName === 'TABLE') {
      const headerTable = processedDiv.firstElementChild;
      headerTable.classList.add('bb-section-header');
      processedDiv.removeChild(headerTable);
      hr.after(headerTable);
      controlAnchor = headerTable;
      const origLeading = originalDiv.firstElementChild;
      if (origLeading?.tagName === 'TABLE') origLeading.remove();
    }

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
      // Swap relation flat/list views alongside the setlist toggle.
      processedDiv.querySelectorAll('.bb-relations-flat').forEach(el => {
        el.style.display = view === 'list' ? 'none' : '';
      });
      processedDiv.querySelectorAll('.bb-relations-list').forEach(el => {
        el.style.display = view === 'list' ? '' : 'none';
      });
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
            !el.classList.contains('bb-relations-flat') &&
            el.querySelector('.bb-sep, .bb-song-match, .bb-song-year-only, .bb-song-detail-only, .bb-song-char-diff')
          );
          const hasRelBlocks = !!processedDiv.querySelector('.bb-relations-flat');
          if (setlistEls.length === 0 && !hasRelBlocks) return;  // nothing to list-ify
          if (setlistEls.length > 0) {
            listDiv = buildListDiv(setlistEls, processedDiv);
            setlistEls[0].parentNode.insertBefore(listDiv, setlistEls[0]);
          }
        }
        showView('list');
      }
    });

    const controls = document.createElement('div');
    controls.className = 'bb-section-controls';
    controls.append(origBtn, listBtn);

    // Only add the per-event relation toggle when this event has relation blocks.
    if (processedDiv.querySelector('.bb-relations-flat')) {
      const relBtn = document.createElement('button');
      relBtn.className = 'bb-toggle-btn bb-rel-section-toggle';
      relBtn.textContent = 'Hide Relations';
      relBtn.title = 'Hide or show relation participant blocks for this event';
      relBtn.addEventListener('click', () => {
        const hiding = !processedDiv.classList.contains('bb-rel-hidden');
        processedDiv.classList.toggle('bb-rel-hidden', hiding);
        relBtn.textContent = hiding ? 'Show Relations' : 'Hide Relations';
      });
      controls.append(relBtn);
    }

    // Hide Buttons: toggle all tab-button rows for this event.
    const hideButtonsBtn = document.createElement('button');
    hideButtonsBtn.className = 'bb-toggle-btn bb-hide-buttons-toggle';
    hideButtonsBtn.textContent = 'Hide Buttons';
    hideButtonsBtn.title = 'Hide or show all tab button rows for this event';
    hideButtonsBtn.addEventListener('click', () => {
      const hiding = hideButtonsBtn.textContent === 'Hide Buttons';
      processedDiv.querySelectorAll(
        '.bb-event-tab-row, .bb-venue-tab-row, .bb-song-tab-row, .bb-relation-tab-row'
      ).forEach(row => { row.style.display = hiding ? 'none' : ''; });
      hideButtonsBtn.textContent = hiding ? 'Show Buttons' : 'Hide Buttons';
    });
    controls.append(hideButtonsBtn);

    // Fetch Songs: load song page tabs for every unloaded bb-song-num link.
    if (processedDiv.querySelector('a.bb-song-num')) {
      const fetchSongsBtn = document.createElement('button');
      fetchSongsBtn.className = 'bb-toggle-btn bb-fetch-songs-btn';
      fetchSongsBtn.textContent = 'Fetch Songs';
      fetchSongsBtn.title = 'Load song page tabs for all songs in this event';
      fetchSongsBtn.addEventListener('click', async () => {
        fetchSongsBtn.disabled = true;
        for (const link of processedDiv.querySelectorAll('a.bb-song-num')) {
          const href = link.getAttribute('href');
          if (!href || link.classList.contains('bb-song-loading') ||
              processedDiv._bbSongRows?.has(href)) continue;
          await fetchAndToggleSongTabRow(href, link.dataset.sn || '', processedDiv, link);
        }
        fetchSongsBtn.disabled = false;
      });
      controls.append(fetchSongsBtn);
    }

    // Fetch Relations: load relation tab rows for every unloaded bullet, one per unique href.
    if (processedDiv.querySelector('.bb-rel-bullet[data-rel-href]')) {
      const fetchRelsBtn = document.createElement('button');
      fetchRelsBtn.className = 'bb-toggle-btn bb-fetch-rels-btn';
      fetchRelsBtn.textContent = 'Fetch Relations';
      fetchRelsBtn.title = 'Load relation page tab rows for all participants in this event';
      fetchRelsBtn.addEventListener('click', async () => {
        fetchRelsBtn.disabled = true;
        const seen = new Set();
        for (const bullet of processedDiv.querySelectorAll('.bb-rel-bullet[data-rel-href]')) {
          const href = bullet.dataset.relHref;
          if (!href || seen.has(href) || bullet.classList.contains('bb-rel-loading') ||
              processedDiv._bbRelRows?.has(href)) continue;
          seen.add(href);
          await fetchAndToggleRelationTabRow(href, bullet.dataset.relName || '', processedDiv, bullet);
        }
        fetchRelsBtn.disabled = false;
      });
      controls.append(fetchRelsBtn);
    }

    controlAnchor.after(controls);
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

    for (let i = 0; i < setlistEls.length; i++) {
      const el = setlistEls[i];

      // For multi-section events, any bb-relations-list that sits between the
      // previous setlist element and this one belongs to this section.  Move it
      // into the list div here so relations appear before their section rather
      // than after the combined bb-section-list div.
      if (i > 0) {
        let sib = setlistEls[i - 1].nextElementSibling;
        while (sib && sib !== el) {
          const next = sib.nextElementSibling;
          if (sib.classList.contains('bb-relations-list')) {
            div.appendChild(document.createElement('hr'));
            div.appendChild(sib);
          }
          sib = next;
        }
      }

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
          const li = document.createElement('li');
          li.innerHTML = group.join('');

          // Detect detail-only before stripping the num link (we need its href).
          const isDetailOnly = !!li.querySelector('.bb-song-detail-only');
          const detailNumLink = isDetailOnly
            ? li.querySelector('a.bb-song-num[href^="/song:"]') : null;
          const detailSongHref = detailNumLink?.getAttribute('href') ?? null;
          const detailSongName = detailNumLink?.dataset.sn
            ?? li.querySelector('.bb-song-detail-only')?.dataset.detailSong ?? '';

          // The flat-view renderer (renderSetlistElement) already injects bb-song-num
          // elements into each processed <p>/<blockquote>. Strip them before we
          // prepend the list-view's own number to avoid duplicates.
          li.querySelectorAll('a.bb-song-num, span.bb-song-num-plain').forEach(el => el.remove());

          if (isDetailOnly) {
            // Detail-only songs don't exist on the YEAR page: show • without
            // consuming a counter slot, mirroring the flat-view and DETAIL-page fix.
            if (detailSongHref && section) {
              const numLink = document.createElement('a');
              numLink.href      = detailSongHref;
              numLink.className = 'bb-song-num';
              numLink.textContent = '•';
              numLink.title = `${detailSongName} — click to load song page tabs`;
              numLink.addEventListener('click', e => {
                e.preventDefault();
                fetchAndToggleSongTabRow(detailSongHref, detailSongName, section, numLink);
              });
              li.prepend(numLink);
            } else {
              const numSpan = document.createElement('span');
              numSpan.className   = 'bb-song-num-plain';
              numSpan.textContent = '•';
              li.prepend(numSpan);
            }
          } else {
            // Prepend clickable number if a /song: link exists, else plain number.
            itemNum++;
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
          }

          ol.appendChild(li);
        }
        div.appendChild(ol);
      }
    }

    // Re-wire tooltip listeners so the list view is fully interactive.
    // (.bb-para-warn carries its own native title tooltip — no listener needed.)
    div.querySelectorAll('.bb-song-match, .bb-song-year-only, .bb-song-detail-only, .bb-song-char-diff').forEach(span => {
      span.addEventListener('mouseenter', e => showSongTooltip(e, span));
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
  function setupMismatchFilter(btn, eventCount, state = null, applyFn = null) {
    const sections = [...document.querySelectorAll('.bb-section-processed')];
    const totalEvents = eventCount;
    const mismatchCount = sections.filter(div => isYearMismatch(div)).length;

    btn.textContent = `⚡ Issues (${mismatchCount})`;

    let filterActive = false;
    btn.addEventListener('click', () => {
      filterActive = !filterActive;
      btn.textContent = filterActive
        ? `⚡ All Events (${totalEvents})`
        : `⚡ Issues (${mismatchCount})`;
      if (state) state.mismatchActive = filterActive;
      if (applyFn) applyFn(); else applyMismatchFilter(filterActive);
    });
  }

  /**
   * Wires the global "Hide/Show Relations" toggle button.
   * Toggles body.bb-relations-hidden which hides all .bb-relations-flat and
   * .bb-relations-list elements page-wide via CSS (display:none !important).
   * @param {HTMLButtonElement} btn
   */
  function setupRelationsToggle(btn) {
    btn.addEventListener('click', () => {
      const hiding = !document.body.classList.contains('bb-relations-hidden');
      document.body.classList.toggle('bb-relations-hidden', hiding);
      btn.textContent = hiding ? 'Show Relations' : 'Hide Relations';
    });
  }

  // Mismatch filter for YEAR OVERVIEW (list) pages.
  // Events are plain links in the page rather than .bb-section-processed divs,
  // so we hide/show the nearest block ancestor (li, tr, or parentNode).
  function setupListMismatchFilter(btn, listEvents, state = null, applyFn = null) {
    const mismatchCount = listEvents.filter(({ element }) => isListMismatch(element)).length;

    btn.textContent = `⚡ Issues (${mismatchCount})`;

    let filterActive = false;
    btn.addEventListener('click', () => {
      filterActive = !filterActive;
      btn.textContent = filterActive
        ? `⚡ All Events (${listEvents.length})`
        : `⚡ Issues (${mismatchCount})`;
      if (state) state.mismatchActive = filterActive;
      if (applyFn) {
        applyFn();
      } else {
        for (const { element } of listEvents) {
          const sib     = element.nextElementSibling;
          const isMatch = sib && sib.classList.contains('bb-glyph') && sib.textContent.includes('✅');
          const row     = element.closest('li, tr') || element.parentNode;
          if (row) row.style.display = filterActive && isMatch ? 'none' : '';
        }
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
      const hasMismatch = isYearMismatch(processedDiv);
      const hide = active && !hasMismatch;
      processedDiv.style.display = hide ? 'none' : '';

      // Walk backward: [<hr>] [.bb-section-header?] [.bb-section-controls] [.bb-section-original] [processedDiv]
      // bb-section-original has its own independent display state — skip without toggling.
      // bb-section-list lives inside processedDiv and is hidden with it automatically.
      let el = processedDiv.previousElementSibling;
      if (el && el.classList.contains('bb-section-original')) el = el.previousElementSibling;
      if (el && el.classList.contains('bb-section-controls')) { el.style.display = hide ? 'none' : ''; el = el.previousElementSibling; }
      if (el && el.classList.contains('bb-section-header'))   { el.style.display = hide ? 'none' : ''; el = el.previousElementSibling; }
      if (el && el.tagName === 'HR')                          { el.style.display = hide ? 'none' : ''; }
    }
  }

  // ── Event text filter ─────────────────────────────────────────────────────

  /**
   * Returns true when a .bb-section-processed div contains any mismatch indicators.
   * @param {HTMLElement} processedDiv
   * @returns {boolean}
   */
  function isYearMismatch(processedDiv) {
    return (
      [...processedDiv.querySelectorAll('.bb-glyph')]
        .some(g => ['❌', '⚠️', '❓'].some(ch => g.textContent.includes(ch))) ||
      !!processedDiv.querySelector(
        '.bb-song-year-only, .bb-song-detail-only, .bb-song-char-diff, .bb-para-warn, .bb-anchor-warn'
      )
    );
  }

  /**
   * Returns true when a list-page event link has no ✅ glyph sibling.
   * @param {HTMLElement} linkEl
   * @returns {boolean}
   */
  function isListMismatch(linkEl) {
    const sib = linkEl.nextElementSibling;
    return !sib || !sib.classList.contains('bb-glyph') || !sib.textContent.includes('✅');
  }

  /**
   * Compiles a text-test function from query and options.
   * Returns null when query is empty (no filter active).
   * @param {string} query
   * @param {{ caseSensitive: boolean, useRegex: boolean, exclude: boolean }} options
   * @returns {function(string): boolean | null}
   */
  function buildFilterMatcher(query, options) {
    if (!query.trim()) return null;
    let testFn;
    if (options.useRegex) {
      let re;
      try {
        re = new RegExp(query, options.caseSensitive ? '' : 'i');
      } catch {
        return () => false;
      }
      testFn = text => re.test(text);
    } else {
      const q = options.caseSensitive ? query : query.toLowerCase();
      testFn = text => (options.caseSensitive ? text : text.toLowerCase()).includes(q);
    }
    return options.exclude ? text => !testFn(text) : testFn;
  }

  /**
   * Builds a global RegExp for text-node walking (exec loop).
   * Returns null for empty query or invalid regex.
   * @param {string} query
   * @param {{ caseSensitive: boolean, useRegex: boolean }} options
   * @returns {RegExp | null}
   */
  function buildHighlightRegex(query, options) {
    if (!query.trim()) return null;
    try {
      const flags = 'g' + (options.caseSensitive ? '' : 'i');
      if (options.useRegex) return new RegExp(query, flags);
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(escaped, flags);
    } catch {
      return null;
    }
  }

  /**
   * Highlights all occurrences of query in every text node within container.
   * Used in Ev mode to highlight across the full .bb-section-processed div.
   * Skips SCRIPT, STYLE, and MARK parent elements. Replaces text nodes with
   * DocumentFragments containing <mark> elements — no innerHTML manipulation,
   * so event listeners on other elements are fully preserved.
   * @param {HTMLElement} container
   * @param {string} query
   * @param {{ caseSensitive: boolean, useRegex: boolean, exclude: boolean }} options
   */
  function highlightSectionContent(container, query, options) {
    if (!query || options.exclude) return;
    const re = buildHighlightRegex(query, options);
    if (!re) return;

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        const tag = p.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'MARK') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);

    for (const textNode of nodes) {
      const text = textNode.textContent;
      re.lastIndex = 0;
      if (!re.test(text)) continue;
      re.lastIndex = 0;

      const frag = document.createDocumentFragment();
      let lastIdx = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        if (m.index > lastIdx) frag.appendChild(document.createTextNode(text.slice(lastIdx, m.index)));
        const mark = document.createElement('mark');
        mark.className = 'bb-filter-match';
        mark.textContent = m[0];
        frag.appendChild(mark);
        lastIdx = re.lastIndex;
        if (m[0].length === 0) re.lastIndex++;
      }
      if (lastIdx < text.length) frag.appendChild(document.createTextNode(text.slice(lastIdx)));
      textNode.parentNode.replaceChild(frag, textNode);
    }
  }

  /**
   * Removes all <mark class="bb-filter-match"> elements from container,
   * replacing each with its text content, then normalizes adjacent text nodes.
   * @param {HTMLElement} container
   */
  function clearSectionHighlights(container) {
    for (const mark of [...container.querySelectorAll('mark.bb-filter-match')]) {
      mark.replaceWith(mark.textContent);
    }
    container.normalize();
  }

  /**
   * Highlights occurrences of query in an event link's text content only.
   * Used in default (non-Ev) mode. Stores original innerHTML in data-bb-filter-original
   * before the first modification; subsequent calls do not overwrite the stored original.
   * @param {HTMLElement} linkEl
   * @param {string} query
   * @param {{ caseSensitive: boolean, useRegex: boolean, exclude: boolean }} options
   */
  function highlightEventName(linkEl, query, options) {
    if (!query || options.exclude) return;
    if (linkEl.dataset.bbFilterOriginal === undefined) {
      linkEl.dataset.bbFilterOriginal = linkEl.innerHTML;
    }
    const re = buildHighlightRegex(query, options);
    if (!re) return;

    const text = linkEl.textContent;
    let result = '';
    let lastIdx = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      result += esc(text.slice(lastIdx, m.index));
      result += `<mark class="bb-filter-match">${esc(m[0])}</mark>`;
      lastIdx = re.lastIndex;
      if (m[0].length === 0) re.lastIndex++;
    }
    result += esc(text.slice(lastIdx));
    linkEl.innerHTML = result;
  }

  /**
   * Restores a previously highlighted event link to its original innerHTML.
   * @param {HTMLElement} linkEl
   */
  function clearEventNameHighlight(linkEl) {
    if (linkEl.dataset.bbFilterOriginal !== undefined) {
      linkEl.innerHTML = linkEl.dataset.bbFilterOriginal;
      delete linkEl.dataset.bbFilterOriginal;
    }
  }

  /**
   * Restores all highlighted event links and clears all section text-node highlights
   * within scope. Handles both data-attribute (non-Ev) and <mark> (Ev) modes.
   * @param {HTMLElement} scope
   */
  function clearAllHighlights(scope) {
    for (const el of [...scope.querySelectorAll('[data-bb-filter-original]')]) {
      clearEventNameHighlight(el);
    }
    clearSectionHighlights(scope);
  }

  /**
   * Applies combined mismatch + text filter to all YEAR page event sections.
   * A section is hidden when it fails any active filter. In Ev mode, highlights
   * all text occurrences across the full section; otherwise highlights only the
   * event name link.
   * @param {{ mismatchActive: boolean, textMatcher: function|null,
   *           filterQuery: string, filterOptions: object }} state
   * @param {Array} events - from extractYearPageEvents()
   * @returns {number} count of visible events
   */
  function applyYearFilters(state, events) {
    let visibleCount = 0;
    for (const ev of events) {
      const processedDiv = ev.element.closest('.bb-section-processed');
      if (!processedDiv) continue;

      // Locate type/alias siblings first so we can clear their stale highlights.
      // Non-Ev: include event-type and alias spans adjacent to the name link.
      // Ev: use full section text (covers everything, including type/alias/setlist).
      const typeSpan  = ev.element.parentElement?.querySelector('.bb-event-type');
      const aliasSpan = ev.element.parentElement?.querySelector('.bb-event-alias');

      // Clear any previous highlights before re-evaluating.
      clearEventNameHighlight(ev.element);
      if (typeSpan)  clearEventNameHighlight(typeSpan);
      if (aliasSpan) clearEventNameHighlight(aliasSpan);
      clearSectionHighlights(processedDiv);

      const hasMismatch  = isYearMismatch(processedDiv);
      const eventRowText = ev.yearName
        + (typeSpan  ? typeSpan.textContent  : '')
        + (aliasSpan ? aliasSpan.textContent : '');
      const textToTest   = state.filterOptions.fullText
        ? processedDiv.textContent
        : eventRowText;
      const matchesText  = !state.textMatcher || state.textMatcher(textToTest);
      const hide = (state.mismatchActive && !hasMismatch) || (state.textMatcher && !matchesText);

      processedDiv.style.display = hide ? 'none' : '';

      // Walk backward: [<hr>] [.bb-section-header?] [.bb-section-controls] [.bb-section-original] [processedDiv]
      let el = processedDiv.previousElementSibling;
      if (el && el.classList.contains('bb-section-original')) el = el.previousElementSibling;
      if (el && el.classList.contains('bb-section-controls')) { el.style.display = hide ? 'none' : ''; el = el.previousElementSibling; }
      if (el && el.classList.contains('bb-section-header'))   { el.style.display = hide ? 'none' : ''; el = el.previousElementSibling; }
      if (el && el.tagName === 'HR') el.style.display = hide ? 'none' : '';

      if (!hide && state.filterQuery && !state.filterOptions.exclude) {
        if (state.filterOptions.fullText) {
          highlightSectionContent(processedDiv, state.filterQuery, state.filterOptions);
        } else {
          highlightEventName(ev.element, state.filterQuery, state.filterOptions);
          if (typeSpan)  highlightEventName(typeSpan,  state.filterQuery, state.filterOptions);
          if (aliasSpan) highlightEventName(aliasSpan, state.filterQuery, state.filterOptions);
        }
      }

      if (!hide) visibleCount++;
    }
    return visibleCount;
  }

  /**
   * Wires the filter bar onChange to update the shared filter state and call applyFn.
   * Called after processing completes, each time ▶ Start runs.
   * @param {{ setOnChange: function }} filterBar
   * @param {object} state
   * @param {function(): void} applyFn
   */
  function setupYearTextFilter(filterBar, state, applyFn) {
    filterBar.setOnChange((query, options) => {
      state.filterQuery   = query;
      state.filterOptions = options;
      state.textMatcher   = buildFilterMatcher(query, options);
      applyFn();
    });
  }

  /**
   * Applies combined mismatch + text filter to LIST page event links.
   * Shows/hides the nearest block ancestor (li, tr, or parentNode) of each link.
   * @param {{ mismatchActive: boolean, textMatcher: function|null,
   *           filterQuery: string, filterOptions: object }} state
   * @param {Array} listEvents - from extractListPageEvents()
   * @returns {number} count of visible events
   */
  function applyListFilters(state, listEvents) {
    let visibleCount = 0;
    for (const ev of listEvents) {
      // Locate <em> suffix first so we can clear its stale highlight.
      const row      = ev.element.closest('li, tr') || ev.element.parentNode;
      const listEmEl = row?.querySelector('em');

      clearEventNameHighlight(ev.element);
      if (listEmEl) clearEventNameHighlight(listEmEl);

      const hasMismatch = isListMismatch(ev.element);
      // Always include <em> text (event-type suffix), e.g. "(Rehearsal)".
      const emText   = listEmEl ? (' ' + listEmEl.textContent) : '';
      const textToTest  = (state.filterOptions.fullText ? ev.rawName : ev.strippedName) + emText;
      const matchesText = !state.textMatcher || state.textMatcher(textToTest);
      const show = (!state.mismatchActive || hasMismatch) && matchesText;

      if (row) row.style.display = show ? '' : 'none';

      if (show && state.filterQuery && !state.filterOptions.exclude) {
        highlightEventName(ev.element, state.filterQuery, state.filterOptions);
        if (listEmEl) highlightEventName(listEmEl, state.filterQuery, state.filterOptions);
      }

      if (show) visibleCount++;
    }
    return visibleCount;
  }

  /**
   * Wires the filter bar onChange to update the shared list filter state and call applyFn.
   * @param {{ setOnChange: function }} filterBar
   * @param {object} state
   * @param {function(): void} applyFn
   */
  function setupListTextFilter(filterBar, state, applyFn) {
    filterBar.setOnChange((query, options) => {
      state.filterQuery   = query;
      state.filterOptions = options;
      state.textMatcher   = buildFilterMatcher(query, options);
      applyFn();
    });
  }

  /**
   * Applies combined mismatch + text filter to HOME page results.
   * Handles both 'year' mode (.bb-section-processed divs) and 'list' mode (anchor links).
   * Hides .bb-year-header and .bb-year-wrapper entirely when all their events are hidden.
   * In Ev mode for year sections, highlights all text within each visible section.
   * @param {{ mismatchActive: boolean, textMatcher: function|null,
   *           filterQuery: string, filterOptions: object }} state
   * @param {HTMLElement} resultsEl
   * @param {function(HTMLElement): boolean} isMismatchFn
   * @param {'year'|'list'} mode
   * @returns {number} total visible event count
   */
  function applyHomeFilters(state, resultsEl, isMismatchFn, mode) {
    let totalVisible = 0;
    for (const wrapper of resultsEl.querySelectorAll('.bb-year-wrapper')) {
      const header    = wrapper.previousElementSibling;
      const hasHeader = header && header.classList.contains('bb-year-header');
      let wrapperVisible = 0;

      if (mode === 'list') {
        const secLinks = [...wrapper.querySelectorAll('a[href]')]
          .filter(a => LIST_LINK_RE.test(a.getAttribute('href') || ''));
        for (const a of secLinks) {
          const homeListRow = a.closest('li') || a.parentNode;
          const homeEmEl    = homeListRow?.querySelector('em');

          clearEventNameHighlight(a);
          if (homeEmEl) clearEventNameHighlight(homeEmEl);

          const hasMismatch = isMismatchFn(a);
          const homeEmText  = homeEmEl ? (' ' + homeEmEl.textContent) : '';
          const textToTest  = state.filterOptions.fullText
            ? ((homeListRow || a).textContent)
            : (a.textContent + homeEmText);
          const matchesText = !state.textMatcher || state.textMatcher(textToTest);
          const show = (!state.mismatchActive || hasMismatch) && matchesText;
          if (homeListRow) homeListRow.style.display = show ? '' : 'none';
          if (show && state.filterQuery && !state.filterOptions.exclude) {
            highlightEventName(a, state.filterQuery, state.filterOptions);
            if (homeEmEl) highlightEventName(homeEmEl, state.filterQuery, state.filterOptions);
          }
          if (show) wrapperVisible++;
        }
      } else {
        const secs = [...wrapper.querySelectorAll('.bb-section-processed')];
        for (const sec of secs) {
          clearSectionHighlights(sec);
          const hasMismatch = isMismatchFn(sec);
          const textToTest  = state.filterOptions.fullText
            ? sec.textContent
            : (() => {
                const link      = sec.querySelector('a[href*=":"]');
                if (!link) return sec.textContent;
                const parent    = link.parentElement;
                const typeSpan  = parent?.querySelector('.bb-event-type');
                const aliasSpan = parent?.querySelector('.bb-event-alias');
                return link.textContent
                  + (typeSpan  ? typeSpan.textContent  : '')
                  + (aliasSpan ? aliasSpan.textContent : '');
              })();
          const matchesText = !state.textMatcher || state.textMatcher(textToTest);
          const hide = (state.mismatchActive && !hasMismatch) || (state.textMatcher && !matchesText);

          sec.style.display = hide ? 'none' : '';
          let el = sec.previousElementSibling;
          if (el && el.classList.contains('bb-section-original')) el = el.previousElementSibling;
          if (el && el.classList.contains('bb-section-controls')) { el.style.display = hide ? 'none' : ''; el = el.previousElementSibling; }
          if (el && el.classList.contains('bb-section-header'))   { el.style.display = hide ? 'none' : ''; el = el.previousElementSibling; }
          if (el && el.tagName === 'HR') el.style.display = hide ? 'none' : '';

          if (!hide && state.filterQuery && !state.filterOptions.exclude) {
            highlightSectionContent(sec, state.filterQuery, state.filterOptions);
          }
          if (!hide) wrapperVisible++;
        }
      }

      const wrapperHide = wrapperVisible === 0;
      if (hasHeader) header.style.display = wrapperHide ? 'none' : '';
      wrapper.style.display = wrapperHide ? 'none' : '';
      totalVisible += wrapperVisible;
    }
    return totalVisible;
  }

  /**
   * Builds and returns the filter bar element and its controller.
   * Layout: [count] [input][×] [Cc] [Rx] [Ex] | [Ev]
   * The bar is inserted inside #bb-sticky-bar after #bb-controls.
   * @param {'year'|'list'|'home'} pageType
   * @returns {{ el: HTMLElement, setTotal: function(number): void,
   *             setCount: function(number): void,
   *             setOnChange: function(function): void }}
   */
  function createFilterBar(pageType) {
    let _total = 0;
    let _onChangeFn = null;

    const bar = document.createElement('div');
    bar.id = 'bb-filter-bar';

    const countEl = document.createElement('span');
    countEl.id    = 'bb-filter-count';
    countEl.title = 'Visible events / total events on this page';
    countEl.textContent = '0 / 0 events';

    const inputWrap = document.createElement('div');
    inputWrap.id = 'bb-filter-input-wrap';

    const filterInput = document.createElement('input');
    filterInput.id          = 'bb-filter-input';
    filterInput.type        = 'text';
    filterInput.placeholder = 'Filter events…';

    const clearBtn = document.createElement('button');
    clearBtn.id          = 'bb-filter-clear';
    clearBtn.type        = 'button';
    clearBtn.title       = 'Clear filter';
    clearBtn.textContent = '×';
    inputWrap.append(filterInput, clearBtn);

    const makeCheckbox = (id, label, title) => {
      const lbl = document.createElement('label');
      lbl.className = 'bb-filter-cb-label';
      lbl.title     = title;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id   = id;
      lbl.append(cb, ' ' + label);
      return { lbl, cb };
    };

    const { lbl: ccLbl, cb: ccCb } = makeCheckbox('bb-filter-cc', 'Cc', 'Case-sensitive matching');
    const { lbl: rxLbl, cb: rxCb } = makeCheckbox('bb-filter-rx', 'Rx', 'Treat filter input as a regular expression');
    const { lbl: exLbl, cb: exCb } = makeCheckbox('bb-filter-ex', 'Ex', 'Exclude matching events (show non-matches); highlighting is disabled in this mode');
    const { lbl: evLbl, cb: evCb } = makeCheckbox('bb-filter-ev', 'Ev', 'Match against full event content (name + setlist + button titles) and highlight all occurrences');

    const sep = document.createElement('span');
    sep.className   = 'bb-filter-sep';
    sep.textContent = '|';
    sep.setAttribute('aria-hidden', 'true');

    bar.append(countEl, inputWrap, ccLbl, rxLbl, exLbl, sep, evLbl);

    const getOptions = () => ({
      caseSensitive: ccCb.checked,
      useRegex:      rxCb.checked,
      exclude:       exCb.checked,
      fullText:      evCb.checked,
    });

    const fireChange = () => {
      if (_onChangeFn) _onChangeFn(filterInput.value, getOptions());
    };

    filterInput.addEventListener('input', () => {
      clearBtn.classList.toggle('visible', filterInput.value !== '');
      fireChange();
    });

    filterInput.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (filterInput.value !== '') {
        filterInput.value = '';
        clearBtn.classList.remove('visible');
        fireChange();
      } else {
        filterInput.blur();
      }
    });

    clearBtn.addEventListener('click', () => {
      filterInput.value = '';
      clearBtn.classList.remove('visible');
      fireChange();
    });

    [ccCb, rxCb, exCb, evCb].forEach(cb => cb.addEventListener('change', fireChange));

    return {
      el: bar,
      setTotal(n) {
        _total = n;
        countEl.textContent = `${n} / ${n} events`;
      },
      setCount(n) {
        countEl.textContent = `${n} / ${_total} events`;
      },
      setOnChange(fn) {
        _onChangeFn = fn;
      },
    };
  }

  /**
   * Wires up the "⇄ Original Page" button for DETAIL pages, prepended to
   * the existing #bb-btn-container (created earlier in runDetailPage so
   * Load works immediately). Always creates the button, even when there's
   * no setlist container (e.g. most interview pages, or an early/sparsely-
   * documented gig with no parseable setlist) — DETAIL pages annotate far
   * more than just the setlist (tags, icons, title warnings, anchor/venue
   * checks, etc.), all hidden/shown via the shared body.bb-original-view
   * CSS class (see addStyles), so the toggle is still meaningful even with
   * nothing setlist-specific to swap. When a setlist container IS present,
   * its processed content is additionally moved into a live wrapper div
   * (keeping its own diff-rendering listeners) alongside a hidden original
   * snapshot div, and the two are shown/hidden together with the button.
   * @param {string} originalTdHtml - Pre-render snapshot of the setlist
   *   container's innerHTML, or '' when there's no setlist container.
   */
  function insertDetailToggle(originalTdHtml) {
    const td = getSetlistContainer(document);
    let processedDiv = null;
    let originalDiv  = null;
    if (td) {
      // Move processed nodes (with their event listeners) into a wrapper div
      processedDiv = document.createElement('div');
      processedDiv.className = 'bb-detail-processed';
      while (td.firstChild) processedDiv.appendChild(td.firstChild);

      // Hidden div holds the original (unprocessed) snapshot
      originalDiv = document.createElement('div');
      originalDiv.className = 'bb-detail-original';
      originalDiv.style.display = 'none';
      originalDiv.innerHTML = originalTdHtml;

      td.appendChild(processedDiv);
      td.appendChild(originalDiv);
    }

    const btn = document.createElement('button');
    btn.id = 'bb-global-toggle';
    btn.className = 'bb-toggle-btn';
    btn.textContent = '⇄ Original Page';
    btn.title = 'Toggle between the original unprocessed setlist and the annotated processed view';

    let showingOriginal = false;
    btn.addEventListener('click', () => {
      showingOriginal = !showingOriginal;
      if (processedDiv && originalDiv) {
        processedDiv.style.display = showingOriginal ? 'none'  : 'block';
        originalDiv.style.display  = showingOriginal ? 'block' : 'none';
      }
      btn.textContent = showingOriginal ? '⇄ Processed Page' : '⇄ Original Page';
      // Hide all script-added annotation artefacts outside the setlist tab when
      // showing original, restore them when switching back to processed view.
      document.body.classList.toggle('bb-original-view', showingOriginal);
      toggleAnnotationTitles(showingOriginal);
    });

    // Prepend to existing #bb-btn-container created in runDetailPage.
    document.getElementById('bb-btn-container')?.prepend(btn);
  }

  // Annotates the "Setlist" tab in the wikidot navigation regardless of whether
  // it is currently selected: green inline style when everything matches, ⚠️ appended
  // when any name or setlist mismatch is detected.
  function annotateSetlistTab(nameMatch, hasSetlist) {
    if (!Lib.settings.bbp_enable_setlist_tab_annotation) return;
    // Find the <em> whose text is exactly "Setlist" — works whether the tab is
    // active/selected or not (li[title="active"] only exists for the current tab).
    const em = [...document.querySelectorAll('li em')]
      .find(el => /^\s*setlist\s*$/i.test(el.textContent));
    if (!em) return;
    const hasSongIssue  = hasSetlist && !!document.querySelector(
      '.bb-song-year-only, .bb-song-detail-only, .bb-song-char-diff'
    );
    const hasLabelIssue = hasSetlist && !!document.querySelector('.bb-section-label-warn');
    // [data-year-label] marks a genuine two-sided label mismatch (set by
    // flagDetailSectionHeaders only for that case) — distinct from a section
    // missing entirely from one side, which hasLabelIssue alone also covers
    // (bundled into the generic "differences" message below).
    const hasLabelMismatch = hasSetlist && !!document.querySelector('.bb-section-label-warn[data-year-label]');
    const hasSetlistMismatch = hasSongIssue || hasLabelIssue;
    if (!nameMatch || hasSetlistMismatch) {
      const warnSpan = document.createElement('span');
      warnSpan.className = 'bb-setlist-tab-ann';
      warnSpan.textContent = ' ⚠️';
      const warnParts = [];
      if (!nameMatch) warnParts.push('Event name mismatch between YEAR and DETAIL page');
      if (hasSetlistMismatch) warnParts.push('Setlist has differences between YEAR and DETAIL page');
      if (hasLabelMismatch) warnParts.push('Section label mismatch between YEAR and DETAIL page');
      const msg = warnParts.join('; ');
      warnSpan.dataset.msg = msg;
      warnSpan.title = msg;
      warnSpan.style.cursor = 'help';
      em.appendChild(warnSpan);
    } else {
      // Class-based so the toggle can revert it without touching inline styles.
      em.classList.add('bb-setlist-tab-match');
      em.title = 'Setlist tab verified: event name matches and no setlist differences were found between the YEAR and DETAIL page.';
    }
  }

  // Annotates the event's first tab ("On Stage"/"In Studio"/"On Audio"/"On
  // Set" — whichever RELATION_TAB_CONFIGS label is present, always tab index
  // 0) in the wikidot navigation, mirroring annotateSetlistTab: green inline
  // style when every relation name under it passed checkOnStageRelationTags
  // (colorizeOnStageRelationNames left no .bb-relation-name-warn spans), ⚠️
  // appended when at least one did not. No-op when the page has none of
  // RELATION_TAB_CONFIGS's tab labels (e.g. an interview-only page).
  function annotateFirstTab(tabMap) {
    if (!Lib.settings.bbp_enable_first_tab_annotation) return;
    const tabLabel = Object.keys(RELATION_TAB_CONFIGS).find(label => tabMap.has(label));
    if (!tabLabel) return;
    const em = [...document.querySelectorAll('li em')]
      .find(el => el.textContent.trim().toLowerCase() === tabLabel.toLowerCase());
    if (!em) return;
    const hasRelationWarning = !!document.querySelector('.bb-relation-name-warn');
    if (hasRelationWarning) {
      const warnSpan = document.createElement('span');
      warnSpan.className = 'bb-first-tab-ann';
      warnSpan.textContent = ' ⚠️';
      const msg = `"${tabLabel}" tab has one or more relations with no matching tag`;
      warnSpan.dataset.msg = msg;
      warnSpan.title = msg;
      warnSpan.style.cursor = 'help';
      em.appendChild(warnSpan);
    } else {
      // Class-based so the toggle can revert it without touching inline styles.
      em.classList.add('bb-first-tab-match');
      em.title = `"${tabLabel}" tab verified: every listed relation has a matching tag.`;
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

  /**
   * Returns true when a "Help Us" call-to-action icon is present in
   * `container` — BruceBase's boilerplate note ("If you have any
   * information ... please get in touch"), rendered as `<img title="Help
   * Us">`, shown only for events lacking full documentation. Presence
   * means the "help" tag is expected on the DETAIL page (see
   * computeExpectedTags). For use with an already-per-event-scoped
   * container (e.g. `.bb-section-processed`, which wraps exactly one
   * event) — see eventHasHelpIcon for scanning a multi-event container.
   * @param {Element} container
   * @returns {boolean}
   */
  function hasHelpIcon(container) {
    return !!container.querySelector('img.image[title="Help Us"]');
  }

  /**
   * Same check as hasHelpIcon, but scoped to the HTML between eventLinkEl
   * and nextAnchorEl within a multi-event container (e.g. a YEAR page's
   * `#page-content`, or to the end of `content` when nextAnchorEl is null)
   * — for use when there's no already-per-event-scoped container at hand
   * (e.g. the DETAIL page pipeline, which only has the fetched YEAR page's
   * full content). Mirrors collectSetlistElements's boundary technique.
   * @param {Element}      eventLinkEl
   * @param {Element|null} nextAnchorEl
   * @param {Element}      content
   * @returns {boolean}
   */
  function eventHasHelpIcon(eventLinkEl, nextAnchorEl, content) {
    return [...content.querySelectorAll('img.image[title="Help Us"]')].some(img => {
      const afterLink  = eventLinkEl.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_FOLLOWING;
      const beforeNext = !nextAnchorEl || (nextAnchorEl.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_PRECEDING);
      return afterLink && beforeNext;
    });
  }

  /**
   * Returns true when a "Featured" icon (`<img title="Featured">`, BruceBase's
   * gold-star call-out for a notable event) is present in `container`.
   * Presence means the "featured" tag is expected on the DETAIL page (see
   * computeExpectedTags). For use with an already-per-event-scoped
   * container (e.g. `.bb-section-processed`, which wraps exactly one
   * event) — see eventHasFeaturedIcon for scanning a multi-event container.
   * @param {Element} container
   * @returns {boolean}
   */
  function hasFeaturedIcon(container) {
    return !!container.querySelector('img.image[title="Featured"]');
  }

  /**
   * Same check as hasFeaturedIcon, but scoped to the HTML between
   * eventLinkEl and nextAnchorEl within a multi-event container (e.g. a
   * YEAR page's `#page-content`, or to the end of `content` when
   * nextAnchorEl is null) — for use when there's no already-per-event-
   * scoped container at hand (e.g. the DETAIL page pipeline, which only
   * has the fetched YEAR page's full content). Mirrors eventHasHelpIcon.
   * @param {Element}      eventLinkEl
   * @param {Element|null} nextAnchorEl
   * @param {Element}      content
   * @returns {boolean}
   */
  function eventHasFeaturedIcon(eventLinkEl, nextAnchorEl, content) {
    return [...content.querySelectorAll('img.image[title="Featured"]')].some(img => {
      const afterLink  = eventLinkEl.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_FOLLOWING;
      const beforeNext = !nextAnchorEl || (nextAnchorEl.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_PRECEDING);
      return afterLink && beforeNext;
    });
  }

  /**
   * Returns true when a page shows BruceBase's "!! Under Construction !!
   * Come back soon." banner — a red, italicized, superscript note editors
   * place on pages still being filled in, e.g.
   * `<p><span style="color: red"><sup><em>!! Under Construction !! Come
   * back soon.</em></sup></span></p>`. Presence means the
   * "underconstruction" tag is expected on that page. Matched on the
   * `<sup><em>` text content rather than the exact style attribute, since
   * that's the distinguishing structural marker and is more robust to
   * incidental style-attribute formatting differences.
   * @param {Document|Element} [doc=document]
   * @returns {boolean}
   */
  function hasUnderConstructionBanner(doc = document) {
    return [...doc.querySelectorAll('sup em')].some(em => /under construction/i.test(em.textContent));
  }

  // Section = { label: string, songs: string[], sourceEl: Element }
  function parseYearSetlist(setlistEls) {
    const sections = [];
    for (const el of setlistEls) {
      let label  = 'show';
      let text;
      let boldEl = el; // element bold-song detection is scoped to (see collectYearBoldSongTexts)

      if (el.tagName === 'BLOCKQUOTE') {
        label = 'recording';
        const inner = el.querySelector('p');
        text  = inner ? textWithoutSup(inner) : textWithoutSup(el);
        boldEl = inner || el;
      } else {
        text = textWithoutSup(el);
        const m = text.match(/^([^/:\n]+[^/:\n\d]):\s*/); // label must not end in digit ("Encore:" OK, "3:07" not)
        if (m) {
          label = m[1].trim();  // preserve original case ("With Garland Jeffreys")
          text  = text.slice(m[0].length);
        }
      }

      const boldTexts = collectYearBoldSongTexts(boldEl);
      const rawAndClean = text.split(' / ')
        .map(s => s.trim())
        .filter(s => s.length > 0)
        .map(raw => ({ raw, compareKey: songCompareKey(raw), isPremiere: boldTexts.has(raw.toUpperCase()) }))
        .filter(p => p.compareKey.length > 0)
        .filter(p => !/[a-z]{2,}/.test(p.compareKey)); // prose has runs of lowercase; isolated "c" in "McGRATH" is OK
      const songs     = rawAndClean.map(p => p.compareKey);
      const rawSongs  = rawAndClean.map(p => p.raw);
      const premieres = rawAndClean.map(p => p.isPremiere);

      if (songs.length > 0) sections.push({ label, songs, rawSongs, premieres, sourceEl: el });
    }
    return sections;
  }

  /**
   * Collects the set of song names (trimmed, uppercased — matching
   * parseYearSetlist's raw-token form) that a YEAR page setlist element
   * renders in bold (<strong>) — BruceBase's tour-premiere convention (see
   * also countTourPremiereSongs, the DETAIL-page equivalent). Unlike the
   * DETAIL page, YEAR-page setlist songs are plain text with no `/song:`
   * link at all — e.g. `<strong>MY BEAUTIFUL REWARD</strong> / REASON TO
   * BELIEVE / ...` — so this matches on the `<strong>` element's own text,
   * not an anchor inside it. Only matches a token that is *exactly* one
   * `<strong>`'s text (a connective list like "SONG A, SONG B, and/or SONG
   * C" won't match even if one of its songs is individually bold — a known
   * limitation of comparing whole `/`-separated tokens against whole
   * `<strong>` texts).
   * @param {Element} el - The element parseYearSetlist derives raw song text from.
   * @returns {Set<string>}
   */
  function collectYearBoldSongTexts(el) {
    const texts = new Set();
    // Unlike the DETAIL page (where a premiere song is a <strong>-wrapped
    // /song: link), the YEAR page's setlist songs are plain text — only the
    // premiere ones are individually wrapped in <strong>PLAIN TEXT</strong>,
    // with no anchor at all. Match on the <strong> text itself.
    el.querySelectorAll('strong').forEach(s => {
      texts.add(s.textContent.trim().toUpperCase());
    });
    return texts;
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
      const yearGlyphSpan = addYearGlyph(element, nameMatch, isEarlyLate, yearNameUpper, normalizedDetailName, rawDetailName, eventType, eventAlias, anchorName);
      // Tracks whichever title-decoration span was inserted last via
      // `.after(...)`, so further insertions (onstage-tags glyph, tour
      // name) chain in the order they're computed rather than all
      // competing to be "right after yearGlyphSpan" — addYearGlyph already
      // placed the event-alias span right after yearGlyphSpan itself, so
      // starting the chain there keeps every subsequent insertion ahead of
      // the alias (matching the DOM order BruceBase-adjacent code expects).
      let titleTailAnchor = yearGlyphSpan;

      // ── Onstage companion page (tags-per-page cap spillover) ─────────────
      const eventPath  = new URL(url).pathname.replace(/^\//, '');
      const eventTabMap = buildTabMap(doc);
      const onstageResult = await fetchOnstageCompanionTags(eventPath, eventType, eventTabMap);
      if (onstageResult) {
        const docTagsEl    = doc.querySelector('.page-tags');
        const docTagLinks  = docTagsEl ? [...docTagsEl.querySelectorAll('a[href]')] : [];
        const docActualTags = new Set(docTagLinks.map(a => a.textContent.trim().toLowerCase()));
        const onstageAdditionalTags = [...onstageResult.tags].filter(t => !docActualTags.has(t));
        if (onstageAdditionalTags.length > 0) {
          const onstageGlyphSpan = makeOnstageTagsGlyphSpan(onstageAdditionalTags, onstageResult.url);
          titleTailAnchor.after(onstageGlyphSpan);
          titleTailAnchor = onstageGlyphSpan;
        }
      }

      // ── Tour name annotation (opt-in, see bbp_show_tour_name_on_year_page) ──
      if (Lib.settings.bbp_show_tour_name_on_year_page) {
        const tourCheck = checkEventTourTags(eventDate, eventPath, eventAlias);
        if (tourCheck && !tourCheck.isTourNo && tourCheck.mostSpecificTour) {
          titleTailAnchor.after(makeYearTourNameSpan(tourCheck.mostSpecificTour.name));
        }
      }

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
      let venueDetailExtra = null; // non-null: extra descriptive segment, not a real mismatch
      if (venueLink) {
        try {
          const venueHref  = venueLink.getAttribute('href');
          const venueDoc   = await fetchPage(`${location.protocol}//${location.host}${venueHref}`);
          const venueName  = venueDoc.querySelector('#page-title')?.textContent.trim() ?? '';
          if (venueName) {
            const rawVenuePartM   = rawDetailName.match(/^\d{4}-\d{2}-\d{2}\s*(?:-\s*)?(.*)/s);
            const detailVenuePart = rawVenuePartM ? rawVenuePartM[1].trim() : '';
            const match           = !!detailVenuePart && venueName === detailVenuePart;
            if (!match) venueDetailExtra = findVenueDetailExtra(venueName, detailVenuePart);
            const anchorEl        = element.closest('p') || element.parentNode;
            const venuePrefix = eventType === 'recording' ? 'Recording session'
                                            : eventType === 'nogig'     ? 'No gig'
                                            : eventType === 'nobruce'   ? 'No Bruce'
                                            : '';
            renderVenueInfo(lastScheduledDiv || anchorEl, venueHref, venueName, match, detailVenuePart, venuePrefix, venueDetailExtra);
            _venueTabDoc  = venueDoc;
            _venueTabHref = venueHref;
            _venueTabName = venueName;
          }
        } catch (e) {
          logWarn(`  Venue page fetch failed: ${e.message}`);
        }
      }

      // ── Clickable icons ──────────────────────────────────────────────────
      wireIconHandlers(element, doc, onstageResult, venueDetailExtra);

      // ── Venue tab buttons ─────────────────────────────────────────────────
      if (_venueTabDoc) {
        const section = element.closest('.bb-section-processed');
        if (section) addVenueTabButtons(_venueTabDoc, _venueTabHref, _venueTabName, section);
      }

      // ── Setlist check ────────────────────────────────────────────────────
      let yearSections = [];
      if (setlistEls.length > 0) {
        yearSections            = parseYearSetlist(setlistEls);
        const detailSections    = parseDetailSetlist(doc);
        const yearFlat          = yearSections.flatMap(s => s.songs);
        const yearRawFlat       = yearSections.flatMap(s => s.rawSongs);
        const yearPremFlat      = yearSections.flatMap(s => s.premieres);
        const detailFlat        = detailSections.flatMap(s => s.songs);
        const detailUrlFlat     = detailSections.flatMap(s => s.songUrls || s.songs.map(() => null));
        const detailPremFlat    = detailSections.flatMap(s => s.premieres || s.songs.map(() => false));
        log(`  Setlist: ${yearFlat.length} year songs, ${detailFlat.length} detail songs`);

        if (yearFlat.length > 0 || detailFlat.length > 0) {
          const diffItems = mergeCharDiffs(lcsDiff(yearFlat, detailFlat));
          const detailParaFlat = detailSections.flatMap(s => s.songs.map(() => !!s.paragraphBased));
          let yp = 0, dp = 0;
          for (const item of diffItems) {
            if (item.type !== 'detail-only') {
              item.rawYearSong    = yearRawFlat[yp];
              item.yearIsPremiere = !!yearPremFlat[yp];
              yp++;
            }
            if (item.type !== 'year-only') {
              item.paragraphBased   = detailParaFlat[dp];
              item.detailSongUrl    = detailUrlFlat[dp];
              item.detailIsPremiere = !!detailPremFlat[dp];
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

          // Setlist songs with no corresponding DETAIL-page tag, flagged
          // inline next to the song name (opt-in, mirrors the DETAIL page's
          // own Setlist-tab annotation in annotateDetailPageTags).
          let unmatchedSongNames = null;
          if (Lib.settings.bbp_enable_setlist_tag_warnings) {
            const tagLinks   = [...(doc.querySelector('.page-tags')?.querySelectorAll('a[href]') ?? [])];
            const actualTags = new Set(tagLinks.map(a => a.textContent.trim().toLowerCase()));
            const unmatched  = checkSetlistSongTags(detailSections, actualTags).filter(r => !r.matchedTag);
            unmatchedSongNames = new Set(unmatched.map(r => r.song.toLowerCase()));
          }
          renderYearSetlist(yearSections, diffItems, unmatchedSongNames);
        }
      }

      // ── Relation participants ─────────────────────────────────────────────
      // yearSections is [] for no-setlist events; injectEventRelations handles
      // that by appending relation blocks directly to processedDiv.
      {
        const relGroups = extractRelations(doc);
        if (relGroups.length > 0) {
          const processedDiv = element.closest('.bb-section-processed');
          if (processedDiv) injectEventRelations(processedDiv, relGroups, yearSections);
        }
      }

      // ── Anchor consistency check ─────────────────────────────────────────
      if (anchorEl && anchorName) {
        checkYearAnchorConsistency(doc, anchorName, anchorEl, eventDate);
      }

      // ── Event title warning annotation ───────────────────────────────────
      const processedDivForWarn = element.closest('.bb-section-processed');
      if (processedDivForWarn) annotateEventTitleWithWarnings(element, processedDivForWarn);
    } catch (e) {
      logErr(`  Failed to process "${yearName}":`, e.message);
      addWarningGlyph(element, e.message, eventType);
    }
  }

  // ── Setlist rendering — YEAR page ─────────────────────────────────────────

  function renderYearSetlist(yearSections, diffItems, unmatchedSongNames = null) {
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

    yearSections.forEach((sec, sIdx) => renderSetlistElement(sec.sourceEl, sec.label, sectionItems[sIdx], sec.detailLabel, unmatchedSongNames));
  }

  // detailLabel: the corresponding detail section label (original case), or null if
  // the detail page has no section at this index, or undefined if not applicable.
  // Renders a raw YEAR-page token that contains a list connective (", and/or", etc.).
  // Each song part gets .bb-song-match colouring; the separators stay plain (original colour).
  // yearIsPremiere wraps each song part (not the separators) in <strong> — mirrors the
  // plain-match branch below (see renderSetlistElement's 'match' case).
  function renderMatchWithConnectives(raw, yearSong, detailSong, yearIsPremiere = false, detailIsPremiere = false) {
    const parts = raw.split(/(,\s+(?:(?:and\/or|and|or)\s+)?)/gi);
    return parts.map((part, i) => {
      if (i % 2 !== 0) return esc(part);
      const span = `<span class="bb-song-match" data-year-song="${esc(yearSong)}" data-detail-song="${esc(detailSong)}" data-year-premiere="${yearIsPremiere ? '1' : '0'}" data-detail-premiere="${detailIsPremiere ? '1' : '0'}">${esc(part.trim())}</span>`;
      return yearIsPremiere ? `<strong>${span}</strong>` : span;
    }).join('');
  }

  function renderSetlistElement(el, label, items, detailLabel, unmatchedSongNames = null) {
    let html    = '';
    let isFirst = true;
    let songNum = 0;

    const labelLc = label.toLowerCase();

    // Section-label mismatch warning (YEAR page mode only, when detailLabel is set).
    // Rules:
    //  - 'recording' sections appear as part of 'show' on DETAIL pages — never flag.
    //  - 'show' vs 'show' (the implicit default) — no flag regardless of case.
    //  - All other labels use case-sensitive comparison so capitalisation differences
    //    (e.g. 'with Willie Nile' vs 'With Willie Nile') are caught.
    let labelWarnMsg = null;
    let labelDiffTarget = null; // detailLabel, only set for a real char-diffable mismatch
    if (detailLabel !== undefined && labelLc !== 'recording') {
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
          labelDiffTarget = detailLabel;
        }
      }
    }

    if (labelLc === 'soundcheck') {
      html += '<span class="bb-section-label">Soundcheck: </span>';
    } else if (labelLc !== 'show' && labelLc !== 'recording') {
      // A real mismatch (labelDiffTarget set) gets case-sensitive char-diff
      // highlighting (buildLabelCharDiffHtml) — only the differing
      // characters are colorized, the rest renders as plain original text.
      const labelInner = labelDiffTarget ? buildLabelCharDiffHtml(label, labelDiffTarget) : esc(label);
      html += `<span class="bb-section-label">${labelInner}: </span>`;
    }

    if (labelWarnMsg) {
      // data-year-label/data-detail-label (real mismatch only) drive the rich
      // aligned tooltip below; the "missing entirely" variants have neither
      // and keep a plain native title instead.
      const labelAttrs = labelDiffTarget
        ? ` data-year-label="${esc(label)}" data-detail-label="${esc(labelDiffTarget)}"`
        : '';
      const titleAttr = labelDiffTarget ? '' : ` title="${esc(labelWarnMsg)}"`;
      html += `<span class="bb-section-label-warn bb-para-warn" data-msg="${esc(labelWarnMsg)}"${labelAttrs}${titleAttr}>⚠️</span> `;
    }

    for (const item of items) {
      if (!isFirst) html += '<span class="bb-sep"> / </span>';
      isFirst = false;
      // detail-only songs don't exist on the YEAR page and must not consume a
      // counter slot — the same principle as the DETAIL page fix (v2.40).
      if (item.type !== 'detail-only') songNum++;

      // Song number: clickable when a song page URL is known, plain otherwise.
      // detail-only songs show a bullet (•) rather than a sequential index.
      const numSongHref = item.detailSongUrl ?? null;
      const numSongName = item.yearSong ?? item.detailSong ?? '';
      if (numSongHref) {
        const numLabel = item.type === 'detail-only' ? '•' : `${songNum}.`;
        html += `<a href="${esc(numSongHref)}" class="bb-song-num" data-sn="${esc(numSongName)}">${numLabel}</a>`;
      } else {
        html += `<span class="bb-song-num-plain">${songNum}.</span>`;
      }

      const paraWarn = item.paragraphBased
        ? ` <span class="bb-para-warn" data-msg="Detail page lists this song as a paragraph (&lt;p&gt;) instead of a list item (&lt;ol&gt;/&lt;li&gt;). Setlist may be incomplete." title="Detail page lists this song as a paragraph (&lt;p&gt;) instead of a list item (&lt;ol&gt;/&lt;li&gt;). Setlist may be incomplete.">⚠️</span>`
        : '';
      const yearPrem   = item.yearIsPremiere   ? '1' : '0';
      const detailPrem = item.detailIsPremiere ? '1' : '0';
      if (item.type === 'match') {
        const raw = item.rawYearSong || item.yearSong;
        // Test on the cleaned name so that ", and" inside a "(with ...)" suffix
        // does not trigger the connective split.
        if (/,\s+(?:and\/or|and|or)\s+/i.test(item.yearSong)) {
          html += renderMatchWithConnectives(raw, item.yearSong, item.detailSong, item.yearIsPremiere, item.detailIsPremiere) + paraWarn;
        } else {
          const rawSuffix = item.rawYearSong ? esc(item.rawYearSong.slice(item.yearSong.length)) : '';
          const matchData = `data-year-song="${esc(item.yearSong)}" data-detail-song="${esc(item.detailSong)}" data-year-premiere="${yearPrem}" data-detail-premiere="${detailPrem}"`;
          // BruceBase renders a tour-premiere song in bold (<strong>) on the YEAR
          // page itself — restore that here (lost otherwise, since this whole
          // element is rebuilt from the diff rather than the original markup).
          const inner = item.detailSongUrl
            ? `<a href="${esc(item.detailSongUrl)}" class="bb-song-match" ${matchData}>${esc(item.yearSong)}</a>`
            : `<span class="bb-song-match" ${matchData}>${esc(item.yearSong)}</span>`;
          html += (item.yearIsPremiere ? `<strong>${inner}</strong>` : inner) + rawSuffix + paraWarn;
        }
      } else if (item.type === 'year-only') {
        const display = item.rawYearSong || item.yearSong;
        const inner = `<span class="bb-song-year-only" data-year-song="${esc(item.yearSong)}" data-year-premiere="${yearPrem}">${esc(display)}</span>`;
        html += item.yearIsPremiere ? `<strong>${inner}</strong>` : inner;
      } else if (item.type === 'detail-only') {
        // Not on the YEAR page at all, so nothing to visually bold here — the
        // data attribute only feeds the tooltip's tour-premiere comparison.
        html += `<span class="bb-song-detail-only" data-detail-song="${esc(item.detailSong)}" data-detail-premiere="${detailPrem}">${esc(item.detailSong)}</span>${paraWarn}`;
      } else if (item.type === 'char-diff') {
        const diffHtml = buildCharDiffHtml(item.yearSong, item.detailSong);
        const inner = `<span class="bb-song-char-diff" data-year-song="${esc(item.yearSong)}" data-detail-song="${esc(item.detailSong)}" data-year-premiere="${yearPrem}" data-detail-premiere="${detailPrem}">${diffHtml}</span>`;
        html += (item.yearIsPremiere ? `<strong>${inner}</strong>` : inner) + paraWarn;
      }
    }

    // Preserve <sup><em> footnote nodes (e.g. "Setlist incomplete.") that were
    // inside the element before we overwrite innerHTML.
    const supHtml = [...el.querySelectorAll('sup')].map(s => s.outerHTML).join('');
    el.innerHTML = supHtml ? html + '<br>' + supHtml : html;

    // Flag setlist songs with no corresponding DETAIL-page tag (opt-in via
    // bbp_enable_setlist_tag_warnings). [data-detail-song] covers every
    // relevant variant (.bb-song-match as <a> or <span>, .bb-song-detail-only,
    // .bb-song-char-diff); .bb-song-year-only has no data-detail-song and is
    // correctly excluded — it has no corresponding DETAIL-page song to check.
    if (unmatchedSongNames && unmatchedSongNames.size > 0) {
      el.querySelectorAll('[data-detail-song]').forEach(node => {
        const detailSong = node.dataset.detailSong;
        if (detailSong && unmatchedSongNames.has(detailSong.toLowerCase())) {
          node.after(makeSetlistSongTagWarningGlyph(`No tag found for setlist song "${detailSong}" on this event's DETAIL page.`));
        }
      });
    }

    // Wire song-number click handlers so clicking loads the song tab row.
    const numSection = el.closest('.bb-section-processed');
    if (numSection) {
      el.querySelectorAll('a.bb-song-num').forEach(numLink => {
        const songHref = numLink.getAttribute('href');
        const songName = numLink.dataset.sn || '';
        numLink.title = `${songName} — click to load song page tabs`;
        numLink.addEventListener('click', e => {
          e.preventDefault();
          fetchAndToggleSongTabRow(songHref, songName, numSection, numLink);
        });
      });
    }

    // (.bb-para-warn carries its own native title tooltip — no listener needed,
    // except the real section-label-mismatch case below, which gets the rich
    // aligned tooltip instead; the "missing entirely" variants keep native title.)
    el.querySelectorAll('.bb-song-match, .bb-song-year-only, .bb-song-detail-only, .bb-song-char-diff').forEach(span => {
      span.addEventListener('mouseenter', e => showSongTooltip(e, span));
      span.addEventListener('mouseleave', hideTooltip);
    });

    // Section-label mismatch warning: rich aligned tooltip instead of native
    // title, matching the char-diff highlighting given to the label text
    // itself above. [data-year-label] is only present for a real mismatch.
    el.querySelectorAll('.bb-section-label-warn[data-year-label]').forEach(span => {
      span.addEventListener('mouseenter', e => showLabelMismatchTooltip(e, span.dataset.yearLabel, span.dataset.detailLabel));
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

      const allYearNamedAnchors = [...yearContent.querySelectorAll('a[name]')];
      const nextAnchor = allYearNamedAnchors
        .find(a => eventLink.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING);
      log(`  Next anchor: ${nextAnchor ? `name="${nextAnchor.getAttribute('name')}"` : 'none (end of page)'}`);

      const detailTabMap = buildTabMap(document);
      const onstageResult = await fetchOnstageCompanionTags(path, detailEventType, detailTabMap);
      const detailDateM  = yearNameUpper.match(/^(\d{4}-\d{2}-\d{2})/);
      const detailHasHelp = eventHasHelpIcon(eventLink, nextAnchor, yearContent);
      const detailHasFeatured = eventHasFeaturedIcon(eventLink, nextAnchor, yearContent);

      // ── Venue name check on DETAIL page ────────────────────────────────────
      // Computed here (before annotateDetailPageTags) so venueDetailExtra can
      // suppress a spurious "Venue detail" missing-tag report there; the glyph
      // itself is still rendered later, in its original position after the
      // anchor consistency check.
      const detailVenueLink = findVenueLink(document);
      let detailVenueName = '', detailVenueMatch = false, detailVenuePart = '', venueDetailExtra = null;
      if (detailVenueLink) {
        try {
          const venueHref = detailVenueLink.getAttribute('href');
          const venueDoc  = await fetchPage(`${location.protocol}//${location.host}${venueHref}`);
          detailVenueName = venueDoc.querySelector('#page-title')?.textContent.trim() ?? '';
          if (detailVenueName) {
            const rawVenuePartM = rawDetailName.match(/^\d{4}-\d{2}-\d{2}\s*(?:-\s*)?(.*)/s);
            detailVenuePart = rawVenuePartM ? rawVenuePartM[1].trim() : '';
            detailVenueMatch = !!detailVenuePart && detailVenueName === detailVenuePart;
            if (!detailVenueMatch) venueDetailExtra = findVenueDetailExtra(detailVenueName, detailVenuePart);
            log(`  Venue: "${detailVenueName}" ${detailVenueMatch ? '✅' : venueDetailExtra ? '⚠️(info)' : '⚠️'} vs detail "${detailVenuePart}"`);
          }
        } catch (e) {
          logWarn(`  Venue page fetch failed: ${e.message}`);
        }
      }

      if (detailDateM) {
        const tagResult = annotateDetailPageTags(detailTabMap, detailDateM[1], detailEventType, detailSections, rawDetailName, onstageResult, detailHasHelp, detailHasFeatured, venueDetailExtra);
        if (tagResult.additionalTags.length > 0) {
          addOnstageTagsGlyph(tagResult.additionalTags, tagResult.onstageUrl);
        }
        if (tagResult.eventAlias) {
          addEventAliasSpan(tagResult.eventAlias);
        }
        if (tagResult.tourCheck && !tagResult.tourCheck.isTourNo && tagResult.tourCheck.mostSpecificTour) {
          addTourNameSpan(tagResult.tourCheck.mostSpecificTour.name);
          // Tag-source-highlight: .bb-tour-name doesn't exist until the line
          // above runs, so this can't be wired inside annotateDetailPageTags
          // itself — tourTagAnchors (the tour tag's own <a> link(s) in
          // .page-tags) was computed there and returned for exactly this.
          if (Lib.settings.bbp_enable_tag_source_highlight && tagResult.tourTagAnchors?.length) {
            const tourNameEl = document.querySelector('#page-title .bb-tour-name');
            if (tourNameEl) for (const a of tagResult.tourTagAnchors) wireTagSourceHighlight(a, tourNameEl);
          }
        }
      }

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
            // One row per check ({label, value, ok}) — rendered as a
            // .bb-tip-table by showAnchorCheckTooltip, so "Info & Setlist"'s
            // and "YEAR page"'s values line up regardless of which checks ran.
            const anchorChecks = [];

            if (detailAnchorRef === yearAnchorName) {
              anchorChecks.push({ label: 'Anchor', value: `#${detailAnchorRef} matches YEAR page anchor #${yearAnchorName}`, ok: true });
            } else {
              anchorChecks.push({ label: 'Anchor', value: `Info & Setlist refs #${detailAnchorRef}, YEAR page anchor is #${yearAnchorName}`, ok: false });
            }

            const eventDateForDetail = yearNameUpper.match(/^(\d{4}-\d{2}-\d{2})/);
            if (eventDateForDetail) {
              const theoretical = dateToAnchor(eventDateForDetail[1]);
              if (theoretical) {
                if (detailAnchorRef.startsWith(theoretical)) {
                  anchorChecks.push({ label: 'Date-derived anchor', value: `#${theoretical} (from ${eventDateForDetail[1]})`, ok: true });
                } else {
                  anchorChecks.push({ label: 'Date-derived anchor', value: `expected #${theoretical} (from ${eventDateForDetail[1]}), Info & Setlist refs #${detailAnchorRef}`, ok: false });
                }
              }
              const hrefPathM = href.match(/^\/([^#]+)#/);
              if (hrefPathM) {
                const hrefYear = hrefPathM[1];
                const dateYear = eventDateForDetail[1].slice(0, 4);
                if (yearMatchesHrefSlug(dateYear, hrefYear)) {
                  anchorChecks.push({ label: 'Href year', value: `${hrefYear} matches event date year ${dateYear}`, ok: true });
                } else {
                  anchorChecks.push({ label: 'Href year', value: `event date year ${dateYear} ≠ href year ${hrefYear}`, ok: false });
                }
              }
            }

            const anchorAllOk = anchorChecks.every(c => c.ok);
            if (!anchorAllOk) {
              logWarn(`  Anchor/year issue(s): ${anchorChecks.filter(c => !c.ok).map(c => `${c.label}: ${c.value}`).join('; ')}`);
              addAnchorWarnDetail(infoLink, anchorChecks);
            } else {
              log(`  Anchor MATCH ✅`);
              addAnchorMatchDetail(infoLink, anchorChecks);
            }
          }
        } else {
          log(`  Anchor check: no "Info & Setlist" link found on this detail page`);
        }
      }

      // ── Venue glyph on DETAIL page ─────────────────────────────────────────
      // Uses the venue check computed earlier (before annotateDetailPageTags).
      if (detailVenueLink && detailVenueName) {
        addVenueGlyphDetail(detailVenueLink, detailVenueName, detailVenueMatch, detailVenuePart, venueDetailExtra);
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
      const yearPremFlat  = yearSections.flatMap(s => s.premieres);
      const detailFlat    = detailSections.flatMap(s => s.songs);
      const detailPremFlat = detailSections.flatMap(s => s.premieres || s.songs.map(() => false));
      log(`Detail mode: ${yearFlat.length} year songs, ${detailFlat.length} detail songs`);
      log(`  Year songs:   ${JSON.stringify(yearFlat)}`);
      log(`  Detail songs: ${JSON.stringify(detailFlat)}`);

      const diffItems = mergeCharDiffs(lcsDiff(yearFlat, detailFlat));
      log(`  Diff: ${diffItems.map(i => `${i.type}(${i.yearSong || i.detailSong})`).join(', ')}`);
      const detailParaFlat = detailSections.flatMap(s => s.songs.map(() => !!s.paragraphBased));
      let yp = 0, dp = 0;
      for (const item of diffItems) {
        if (item.type !== 'detail-only') {
          item.rawYearSong    = yearRawFlat[yp];
          item.yearIsPremiere = !!yearPremFlat[yp];
          yp++;
        }
        if (item.type !== 'year-only') {
          item.paragraphBased   = detailParaFlat[dp];
          item.detailIsPremiere = !!detailPremFlat[dp];
          dp++;
        }
      }

      // Snapshot td content just before rendering so the original is unmodified.
      _detailOriginalHtml = td ? td.innerHTML : '';

      renderDetailSetlist(diffItems);
      flagDetailSectionHeaders(yearSections, detailSections, diffItems);
      annotateSetlistTab(nameMatch, true);

      detailSaveBtn.disabled = false;
    }

    // Auto-process on page load. insertDetailToggle runs unconditionally
    // afterward (not just on the setlist happy path above) so the "⇄
    // Original Page" button still appears on pages with no setlist at all
    // (most interview pages, or a sparsely-documented early gig) — those
    // still get title/tag/icon annotations toggled via body.bb-original-view.
    await runDetailProcessing();
    insertDetailToggle(_detailOriginalHtml);
    annotatePageTitleWithWarnings();
  }

  // ════════════════════════════════════════════════════════════════════════════
  // VENUE PAGE MODE
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Runs on /venue:… pages.
   * Adds #bb-btn-container (⇄ Original Page | 💾 Save | 📂 Load) and annotates
   * .page-tags with venue tag consistency checks inline on the page.
   */
  async function runVenuePage() {
    log('[DBG] runVenuePage: entered');
    const pageTitle = document.getElementById('page-title');
    log('[DBG] runVenuePage: #page-title =', pageTitle);
    if (!pageTitle) { logWarn('[DBG] runVenuePage: no #page-title — aborting'); return; }
    const venueName = pageTitle.textContent.trim();
    log('[DBG] runVenuePage: venueName =', JSON.stringify(venueName));
    const content   = document.getElementById('page-content');
    log('[DBG] runVenuePage: #page-content =', content);
    if (!content) { logWarn('[DBG] runVenuePage: no #page-content — aborting'); return; }

    const originalHtml = content.innerHTML;

    // Annotate .page-tags with missing / spurious venue tags.
    annotateVenuePageTags(venueName);

    // Build button container.
    const globalBtn = document.createElement('button');
    globalBtn.id        = 'bb-global-toggle';
    globalBtn.className = 'bb-toggle-btn';
    globalBtn.textContent = '⇄ Original Page';
    globalBtn.title = 'Toggle between the original page and the annotated view';

    const [saveBtn, loadBtn] = makeSaveLoadBtns('venue', () => content, () => originalHtml);
    loadBtn.addEventListener('click', () =>
      triggerLoadCache(data => loadPageCache('venue', content, null, data))
    );
    saveBtn.disabled = false;

    const btnContainer = document.createElement('div');
    btnContainer.id = 'bb-btn-container';
    btnContainer.append(globalBtn, saveBtn, loadBtn);
    log('[DBG] runVenuePage: calling pageTitle.after(btnContainer)');
    pageTitle.after(btnContainer);
    log('[DBG] runVenuePage: #bb-btn-container in DOM =', document.getElementById('bb-btn-container'));
    log('[DBG] runVenuePage: pageTitle.nextElementSibling =', pageTitle.nextElementSibling);

    setupAnnotationOnlyToggle(globalBtn);
    annotatePageTitleWithWarnings();
    log('[DBG] runVenuePage: done');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // RETAIL PAGE MODE
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Runs on /retail:… pages.
   * Adds #bb-btn-container (⇄ Original Page | 💾 Save | 📂 Load) and annotates
   * .page-tags with retail tag consistency checks inline on the page.
   */
  async function runRetailPage() {
    log('[DBG] runRetailPage: entered');
    const pageTitle = document.getElementById('page-title');
    log('[DBG] runRetailPage: #page-title =', pageTitle);
    if (!pageTitle) { logWarn('[DBG] runRetailPage: no #page-title — aborting'); return; }
    const retailName = pageTitle.textContent.trim();
    log('[DBG] runRetailPage: retailName =', JSON.stringify(retailName));
    const content    = document.getElementById('page-content');
    log('[DBG] runRetailPage: #page-content =', content);
    if (!content) { logWarn('[DBG] runRetailPage: no #page-content — aborting'); return; }

    const originalHtml = content.innerHTML;

    // Annotate .page-tags with missing / spurious retail tags.
    annotateRetailPageTags(retailName);

    // Build button container.
    const globalBtn = document.createElement('button');
    globalBtn.id        = 'bb-global-toggle';
    globalBtn.className = 'bb-toggle-btn';
    globalBtn.textContent = '⇄ Original Page';
    globalBtn.title = 'Toggle between the original page and the annotated view';

    const [saveBtn, loadBtn] = makeSaveLoadBtns('retail', () => content, () => originalHtml);
    loadBtn.addEventListener('click', () =>
      triggerLoadCache(data => loadPageCache('retail', content, null, data))
    );
    saveBtn.disabled = false;

    const btnContainer = document.createElement('div');
    btnContainer.id = 'bb-btn-container';
    btnContainer.append(globalBtn, saveBtn, loadBtn);
    log('[DBG] runRetailPage: calling pageTitle.after(btnContainer)');
    pageTitle.after(btnContainer);
    log('[DBG] runRetailPage: #bb-btn-container in DOM =', document.getElementById('bb-btn-container'));
    log('[DBG] runRetailPage: pageTitle.nextElementSibling =', pageTitle.nextElementSibling);

    setupAnnotationOnlyToggle(globalBtn);
    log('[DBG] runRetailPage: done');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SONG PAGE MODE
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Runs on /song:… pages.
   * Adds #bb-btn-container (⇄ Original Page | 💾 Save | 📂 Load) and annotates
   * .page-tags with song tag consistency checks inline on the page.
   */
  async function runSongPage() {
    const pageTitle = document.getElementById('page-title');
    if (!pageTitle) return;
    const content = document.getElementById('page-content');
    if (!content) return;

    const originalHtml = content.innerHTML;

    const songName = pageTitle.textContent.trim();
    const songTabMap = buildTabMap(document);
    annotateSongPageTags(songName, songTabMap);

    const globalBtn = document.createElement('button');
    globalBtn.id        = 'bb-global-toggle';
    globalBtn.className = 'bb-toggle-btn';
    globalBtn.textContent = '⇄ Original Page';
    globalBtn.title = 'Toggle between the original page and the annotated view';

    const [saveBtn, loadBtn] = makeSaveLoadBtns('song', () => content, () => originalHtml);
    loadBtn.addEventListener('click', () =>
      triggerLoadCache(data => loadPageCache('song', content, null, data))
    );
    saveBtn.disabled = false;

    const btnContainer = document.createElement('div');
    btnContainer.id = 'bb-btn-container';
    btnContainer.append(globalBtn, saveBtn, loadBtn);
    pageTitle.after(btnContainer);

    setupAnnotationOnlyToggle(globalBtn);
    annotatePageTitleWithWarnings();
  }

  // ════════════════════════════════════════════════════════════════════════════
  // RELATION PAGE MODE
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Runs on /relation:… pages.
   * Adds #bb-btn-container (⇄ Original Page | 💾 Save | 📂 Load) and annotates
   * .page-tags with relation tag consistency checks inline on the page.
   */
  async function runRelationPage() {
    const pageTitle = document.getElementById('page-title');
    if (!pageTitle) return;
    const content = document.getElementById('page-content');
    if (!content) return;

    const originalHtml = content.innerHTML;

    annotateRelationPageTags();
    annotateEmptyRelationTabs();

    const globalBtn = document.createElement('button');
    globalBtn.id        = 'bb-global-toggle';
    globalBtn.className = 'bb-toggle-btn';
    globalBtn.textContent = '⇄ Original Page';
    globalBtn.title = 'Toggle between the original page and the annotated view';

    const [saveBtn, loadBtn] = makeSaveLoadBtns('relation', () => content, () => originalHtml);
    loadBtn.addEventListener('click', () =>
      triggerLoadCache(data => loadPageCache('relation', content, null, data))
    );
    saveBtn.disabled = false;

    const btnContainer = document.createElement('div');
    btnContainer.id = 'bb-btn-container';
    btnContainer.append(globalBtn, saveBtn, loadBtn);
    pageTitle.after(btnContainer);

    setupAnnotationOnlyToggle(globalBtn);
    annotatePageTitleWithWarnings();
  }

  // ════════════════════════════════════════════════════════════════════════════
  // RECENT CHANGES PAGE MODE
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Runs on /system:recent-changes.
   * Inserts #bb-sticky-bar with a "⊞ Table View" button. When clicked, collects
   * up to 1000 recent changes (5 pages × 200 revisions) via DOM-driven pagination
   * and renders them in the SmartTable.
   */
  async function runRecentChangesPage() {
    const pageTitle = document.getElementById('page-title');
    if (!pageTitle) return;

    const tableViewBtn = document.createElement('button');
    tableViewBtn.id        = 'bb-rc-table-btn';
    tableViewBtn.className = 'bb-toggle-btn';
    tableViewBtn.textContent = '⊞ Table View';
    tableViewBtn.title = 'Collect the last 1000 recent changes and show in a sortable SmartTable';

    const progressEl = document.createElement('span');
    progressEl.style.cssText = 'font-size:0.85em;margin-left:8px;color:#555;';

    const btnContainer = document.createElement('div');
    btnContainer.id = 'bb-btn-container';
    btnContainer.append(tableViewBtn);
    if (Lib.settings.bbp_enable_keyboard_shortcuts) addShortcutsHelpButton(btnContainer);

    const controlsEl = document.createElement('div');
    controlsEl.id = 'bb-controls';
    controlsEl.append(btnContainer, progressEl);

    const stickyBar = document.createElement('div');
    stickyBar.id = 'bb-sticky-bar';
    stickyBar.appendChild(controlsEl);

    if (pageTitle.parentNode) {
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

    tableViewBtn.addEventListener('click', async () => {
      tableViewBtn.disabled = true;
      const allRows = await collectRecentChanges(progressEl);
      document.body.style.cursor = '';   // reset any Wikidot AJAX loading cursor
      if (allRows.length === 0) {
        progressEl.textContent = 'No data collected.';
        tableViewBtn.disabled = false;
        return;
      }
      progressEl.textContent = `Done — ${allRows.length} changes collected`;

      if (typeof SmartTable !== 'undefined') {
        const stHost = document.createElement('div');
        stHost.id = 'bb-rc-smarttable-host';
        stickyBar.after(stHost);
        SmartTable.render({
          columns:   RECENT_CHANGES_COLUMNS,
          rows:      allRows,
          container: stHost,
          options:   { stickyOffset: 'calc(var(--bb-header-h) + var(--bb-sticky-bar-h))' },
        });
        const stBtn = stHost.querySelector('.st-btn-trigger');
        if (stBtn) {
          btnContainer.appendChild(stBtn);
          stBtn.click();
        }
      } else {
        progressEl.textContent += ' — SmartTable not available';
      }
      tableViewBtn.remove();
    });
  }

  /**
   * Scrapes 10 successive pages of #site-changes-list
   * via DOM clicks on the "next »" pager link, collecting up to 1000 rows total.
   * Uses MutationObserver to detect each AJAX reload before proceeding.
   * @param {HTMLElement} progressEl  Status span updated during collection.
   * @returns {Promise<object[]>}
   */
  async function collectRecentChanges(progressEl) {
    const allRows = [];
    const changesList = document.getElementById('site-changes-list');
    if (!changesList) {
      logErr('RC: #site-changes-list not found');
      return allRows;
    }

    /** Resolves after the first childList mutation on `node`, or rejects on timeout. */
    function waitForMutation(node, timeout = 12000) {
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => { obs.disconnect(); reject(new Error('timeout')); }, timeout);
        const obs = new MutationObserver(() => { clearTimeout(t); obs.disconnect(); resolve(); });
        obs.observe(node, { childList: true, subtree: true });
      });
    }

    /** Parses all .changes-list-item entries currently in the live DOM. */
    function parseCurrentPage() {
      const rows = [];
      document.querySelectorAll('#site-changes-list .changes-list-item').forEach(item => {
        const titleEl  = item.querySelector('td.title a');
        if (!titleEl) return;
        const flagEls  = [...item.querySelectorAll('td.flags .spantip')];
        const dateEl   = item.querySelector('td.mod-date .odate');
        const revEl    = item.querySelector('td.revision-no');
        const authorEl = item.querySelector('td.mod-by .printuser a');
        const commentEl = item.querySelector('.comments');

        const revText  = revEl?.textContent.trim() || '';
        const revMatch = revText.match(/\d+/);

        rows.push({
          title:    titleEl.textContent.trim(),
          url:      titleEl.href || '',
          flags:    flagEls.map(s => s.title || s.textContent.trim()).join(', '),
          date:     dateEl?.textContent.trim() || '',
          revision: revMatch ? parseInt(revMatch[0], 10) : 0,
          author:   authorEl?.textContent.trim() || '',
          comment:  commentEl?.textContent.trim() || '',
        });
      });
      return rows;
    }

    // ── Scrape 10 pages via pager clicks ───────────────────────────────────
    for (let page = 1; page <= 10; page++) {
      progressEl.textContent = `Collecting page ${page} of 10…`;
      const pageRows = parseCurrentPage();
      allRows.push(...pageRows);
      log(`RC: page ${page} — ${pageRows.length} rows`);

      if (page === 10) break;

      const nextLink = [...document.querySelectorAll('.pager .target a')]
        .find(a => /next/i.test(a.textContent));
      if (!nextLink) { log('RC: no "next" link — stopping at page', page); break; }

      const mut = waitForMutation(changesList);
      nextLink.click();
      try { await mut; } catch { logWarn('RC: timeout waiting for page', page + 1); break; }
      await new Promise(r => setTimeout(r, 600));
    }

    return allRows;
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
          // Highlight the DETAIL page's own label text with a case-sensitive
          // char-diff (symmetric to renderSetlistElement) — only the
          // differing characters are colorized, diffed against the YEAR
          // page's label; matching characters stay plain original text.
          strong.innerHTML = buildLabelCharDiffHtml(detailLabel, yearSec.label);
        }

        if (msg) {
          const warn = document.createElement('span');
          // bb-section-label-warn (also used on the YEAR page's own
          // renderSetlistElement) lets annotateSetlistTab detect label
          // issues on this live DETAIL page for its "Setlist" tab ⚠️.
          warn.className = 'bb-para-warn bb-section-label-warn';
          warn.textContent = ' ⚠️';
          warn.dataset.msg = msg;
          el.appendChild(warn);
          if (yearSec && yearSec.label !== detailLabel) {
            // Real mismatch: data-year-label/data-detail-label mark this as
            // a genuine two-sided mismatch (vs. "missing entirely" below) —
            // annotateSetlistTab keys off their presence — and drive the
            // rich aligned tooltip, matching the char-diff highlighting above.
            warn.dataset.yearLabel   = yearSec.label;
            warn.dataset.detailLabel = detailLabel;
            warn.addEventListener('mouseenter', e => showLabelMismatchTooltip(e, yearSec.label, detailLabel));
            warn.addEventListener('mouseleave', hideTooltip);
          } else {
            warn.title = msg; // "missing entirely" variants keep the native tooltip
          }
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
      // bb-section-label-warn: see the matching comment in Case A above —
      // lets annotateSetlistTab detect this as a label issue too.
      warn.className = 'bb-para-warn bb-section-label-warn';
      warn.textContent = ' ⚠️';
      warn.dataset.msg = msg;
      warn.title = msg;

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
        newEl.dataset.yearPremiere = item.yearIsPremiere ? '1' : '0';
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

    // Year-only <li> items must not consume a counter slot in the <ol>.
    // Setting explicit `value` attributes on every non-year-only <li> is the
    // most reliable cross-browser approach (CSS counter-increment override is
    // not honoured for the built-in list-item counter in all browsers).
    if (!isParagraphBased) {
      td.querySelectorAll('ol').forEach(ol => {
        let counter = 0;
        ol.querySelectorAll(':scope > li').forEach(li => {
          if (!li.classList.contains('bb-song-year-only')) {
            li.value = ++counter;
          }
        });
      });
    }
  }

  function addParaStructureWarning(el) {
    const span = document.createElement('span');
    span.className = 'bb-para-warn';
    span.textContent = ' ⚠️';
    span.dataset.msg = 'Unusual format: song listed as a paragraph (<p>) instead of a list item (<ol>/<li>). Setlist may be incomplete.';
    span.title = span.dataset.msg;
    el.appendChild(span);
  }

  function styleDetailLi(li, item) {
    // The DETAIL page's own bold (<strong>) tour-premiere marking is already
    // structurally intact at this point (this function only adds classes/
    // dataset to existing nodes, never rebuilds markup) — both flags are
    // still threaded through as datasets (rather than reading the DETAIL
    // side back off the DOM via closest('strong')) so showSongTooltip has
    // one consistent way to read both sides on either page.
    const yearPrem   = item.yearIsPremiere   ? '1' : '0';
    const detailPrem = item.detailIsPremiere ? '1' : '0';
    if (item.type === 'match') {
      // Prefer adding the match class to individual song links so that
      // descriptive <span> nodes (e.g. "(parts)") don't inherit the green colour.
      // When no /song: link exists (plain-text <li>), fall back to the <li> itself.
      const songLinks = [...li.querySelectorAll('a[href^="/song:"]')];
      const matchEls  = songLinks.length > 0 ? songLinks : [li];
      for (const el of matchEls) {
        el.classList.add('bb-song-match');
        el.dataset.yearSong       = item.yearSong;
        el.dataset.detailSong     = item.detailSong;
        el.dataset.yearPremiere   = yearPrem;
        el.dataset.detailPremiere = detailPrem;
        el.addEventListener('mouseenter', e => showSongTooltip(e, el));
        el.addEventListener('mouseleave', hideTooltip);
      }
    } else if (item.type === 'detail-only') {
      li.classList.add('bb-song-detail-only');
      li.dataset.detailSong     = item.detailSong;
      li.dataset.detailPremiere = detailPrem;
      li.addEventListener('mouseenter', e => showSongTooltip(e, li));
      li.addEventListener('mouseleave', hideTooltip);
    } else if (item.type === 'char-diff') {
      li.classList.add('bb-song-char-diff');
      li.dataset.yearSong       = item.yearSong;
      li.dataset.detailSong     = item.detailSong;
      li.dataset.yearPremiere   = yearPrem;
      li.dataset.detailPremiere = detailPrem;
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
          premieres: pendingSongs.map(s => !!s.premiere),
          paragraphBased: true,
          hasExplicitLabel
        });
        pendingSongs = [];
        hasExplicitLabel = false;
        currentLabel = 'show';
      }
    }

    // A song entry is a tour premiere when BruceBase wraps it in <strong> —
    // either the song link itself (standard <ol>/<li> layout) or, for a
    // plain-text entry with no dedicated song page, the whole <li>/<p>
    // (mirrors countTourPremiereSongs's aggregate DETAIL-page count, at
    // per-song granularity here). Medley entries (multiple links in one
    // li/p) are flagged only when the WHOLE entry is bold — a premiere
    // affecting just one half of a medley isn't distinguishable this way.
    function isPremiereEntry(container, links) {
      if (links.length > 0) return links.every(a => !!a.closest('strong'));
      return !!container.querySelector(':scope > strong');
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
        if (name) songs.push({ name, url, premiere: isPremiereEntry(li, links) });
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
            if (name) pendingSongs.push({ name, url, premiere: isPremiereEntry(child, links) });
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
            premieres: songItems.map(s => !!s.premiere),
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
          songUrls: songItems.map(s => s.url),
          premieres: songItems.map(s => !!s.premiere)
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
    mismatchBtn.textContent = '⚡ Issues';
    mismatchBtn.title = 'Filter to show only events with detected issues (name mismatches, setlist differences, anchor/venue warnings, etc.)';
    mismatchBtn.disabled = true;

    const [listSaveBtn, listLoadBtn] = makeSaveLoadBtns(
      'list', () => content, () => originalHtml
    );
    listLoadBtn.addEventListener('click', () =>
      triggerLoadCache(data => loadPageCache('list', content, progressEl, data))
    );

    btnContainer.append(globalBtn, mismatchBtn, listSaveBtn, listLoadBtn);
    if (Lib.settings.bbp_enable_keyboard_shortcuts) addShortcutsHelpButton(btnContainer);

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

    const listFilterBar = createFilterBar('list');
    stickyBar.appendChild(listFilterBar.el);

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

    const listFilterState = {
      mismatchActive: false,
      textMatcher:    null,
      filterQuery:    '',
      filterOptions:  { caseSensitive: false, useRegex: false, exclude: false, fullText: false },
    };
    const listApplyFn = () => listFilterBar.setCount(applyListFilters(listFilterState, listEvents));
    setupListMismatchFilter(mismatchBtn, listEvents, listFilterState, listApplyFn);
    setupListTextFilter(listFilterBar, listFilterState, listApplyFn);
    listFilterBar.setTotal(listEvents.length);
    listApplyFn();

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

  /**
   * Case-sensitive character-level LCS diff for section labels — unlike
   * buildCharDiffHtml (which upper-cases both sides, since song names are
   * matched/displayed case-insensitively), a label mismatch is typically
   * *only* a case difference (e.g. "with Willie Nile" vs "With Willie
   * Nile"), so the comparison must be case-sensitive or every character
   * would wrongly show as matching. Renders `a`'s own original-case
   * characters; matched characters render as plain text (the label is the
   * same wording, not a different value, so no green highlighting), only
   * the actually-differing characters get `.bb-char-diff` (bold red,
   * light-red background).
   * @param {string} a - Text to render (e.g. this page's own label).
   * @param {string} b - Text to diff against (e.g. the other page's label).
   * @returns {string} HTML
   */
  function buildLabelCharDiffHtml(a, b) {
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
      if (c.match) return esc(c.ch);
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

  /**
   * @returns {HTMLElement} the inserted match/mismatch/variant glyph span
   *   (`.bb-glyph` or, for the isEarlyLate case, `.bb-variant-info`), so
   *   callers can insert further glyphs (e.g. the onstage-tags glyph)
   *   right after it via `glyphSpan.after(...)`.
   */
  function addYearGlyph(element, match, isEarlyLate, yearName, normalizedDetailName, rawDetailName, eventType, alias, anchorName = null) {
    const typeSpan  = makeEventTypeSpan(eventType);
    const glyphSpan = match ? makeGlyphSpan('✅') : isEarlyLate ? makeVariantInfoGlyphSpan() : makeGlyphSpan('❌');
    const nodes     = alias ? [typeSpan, glyphSpan, makeAliasSpan(alias)] : [typeSpan, glyphSpan];
    element.after(...nodes);
    addCollapseToggle(element.parentElement);
    const enter = e => showYearTooltip(e, yearName, normalizedDetailName, rawDetailName, eventType, match, isEarlyLate, anchorName);
    [element, typeSpan, glyphSpan].forEach(n => {
      n.addEventListener('mouseenter', enter);
      n.addEventListener('mouseleave', hideTooltip);
    });
    return glyphSpan;
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
    addCollapseToggle(element.parentElement);
    const msg = `Unknown event type: "${eventType}"\n${url}`;
    [element, glyphSpan].forEach(n => {
      n.addEventListener('mouseenter', e => showErrorTooltip(e, msg));
      n.addEventListener('mouseleave', hideTooltip);
    });
  }

  /**
   * Wraps all DOM siblings after headingP (until the next .bb-event-heading or
   * parent boundary) inside a .bb-event-content div for collapse/expand.
   * Idempotent — returns the existing wrapper if already created.
   * Returns null when there is no content to wrap.
   * @param {HTMLElement} headingP  The .bb-event-heading <p> element
   * @returns {HTMLElement|null}
   */
  function getOrWrapEventContent(headingP) {
    const existing = headingP.nextElementSibling;
    if (existing?.classList.contains('bb-event-content')) return existing;
    const toWrap = [];
    let sib = headingP.nextSibling;
    while (sib) {
      if (sib.nodeType === Node.ELEMENT_NODE && sib.classList.contains('bb-event-heading')) break;
      toWrap.push(sib);
      sib = sib.nextSibling;
    }
    if (toWrap.length === 0) return null;
    const wrapper = document.createElement('div');
    wrapper.className = 'bb-event-content';
    headingP.after(wrapper);
    toWrap.forEach(n => wrapper.appendChild(n));
    return wrapper;
  }

  /**
   * Collapses or uncollapses one event's content wrapper.
   * Uses style.display directly for guaranteed cross-CSS reliability.
   * On collapse, absorbs any siblings that were appended to section after the
   * wrapper was created (lazy panels, song-tab rows, etc. all use
   * section.appendChild and therefore land outside the wrapper).
   * @param {HTMLElement} headingP          The .bb-event-heading <p> element
   * @param {boolean|null} [force=null]     true = collapse, false = expand, null = toggle
   */
  function setEventCollapsed(headingP, force) {
    const wrapper = getOrWrapEventContent(headingP);
    if (!wrapper) return;
    const wasCollapsed = wrapper.style.display === 'none';
    const collapsed    = (force !== null && force !== undefined) ? force : !wasCollapsed;
    if (collapsed) {
      // Absorb any siblings appended to section after the wrapper was created.
      let sib = wrapper.nextSibling;
      while (sib) {
        if (sib.nodeType === Node.ELEMENT_NODE && sib.classList.contains('bb-event-heading-p')) break;
        const next = sib.nextSibling;
        wrapper.appendChild(sib);
        sib = next;
      }
      wrapper.style.display = 'none';
    } else {
      wrapper.style.display = '';
    }
    const toggle = headingP.querySelector('.bb-event-collapse-toggle');
    if (toggle) {
      toggle.textContent = collapsed ? ' ▸' : ' ▾';
      toggle.title = collapsed
        ? 'Click to expand · Ctrl+Click to expand all events'
        : 'Click to collapse · Ctrl+Click to collapse all events';
    }
  }

  /**
   * Collapses or expands every event heading <p> on the YEAR page.
   * @param {boolean} collapse  true = collapse all, false = expand all
   */
  function setAllEventsCollapsed(collapse) {
    document.querySelectorAll('.bb-event-heading-p').forEach(h => setEventCollapsed(h, collapse));
  }

  /**
   * Appends a ▾/▸ collapse-toggle span after the glyph/alias and wires collapse
   * behaviour.  The toggle is appended to innerEl (direct parent of the event link,
   * e.g. a <strong>), but sibling-walking for collapsing is done on the containing
   * <p> (headingP), which is found via closest('p').  Idempotent.
   * @param {HTMLElement} innerEl  element.parentElement — direct parent of event <a>
   */
  function addCollapseToggle(innerEl) {
    if (!innerEl) return;
    const headingP = innerEl.closest('p') || innerEl;
    if (headingP.classList.contains('bb-event-heading-p')) return;
    headingP.classList.add('bb-event-heading-p', 'bb-event-heading');
    const toggle = document.createElement('span');
    toggle.className = 'bb-event-collapse-toggle';
    toggle.textContent = ' ▾';
    toggle.title = 'Click to collapse · Ctrl+Click to collapse all events';
    toggle.addEventListener('click', e => {
      e.stopPropagation();
      if (e.ctrlKey) {
        const existingWrapper = headingP.nextElementSibling;
        const isCollapsed = existingWrapper?.classList.contains('bb-event-content') &&
                            existingWrapper.style.display === 'none';
        setAllEventsCollapsed(!isCollapsed);
      } else {
        setEventCollapsed(headingP, null);
      }
    });
    innerEl.appendChild(toggle);
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

  /**
   * Builds the YEAR page's opt-in tour-name span (see
   * bbp_show_tour_name_on_year_page / checkEventTourTags). Same italic/bold
   * " — Text" shape as makeAliasSpan's event-alias span, but its own
   * ".bb-year-tour-name" class colors it to match the DETAIL page's
   * ".bb-tour-name" (blue, `#06c`) instead of the alias's gray — so a tour
   * name reads as a tour name on either page, distinct from an alias, while
   * the YEAR page's font-size stays unscaled (that page's event-heading
   * line was never oversized to begin with, unlike DETAIL's `#page-title`).
   * @param {string} tourName
   * @returns {HTMLSpanElement}
   */
  function makeYearTourNameSpan(tourName) {
    const span = document.createElement('span');
    span.className = 'bb-year-tour-name';
    span.textContent = ` — ${tourName}`;
    return span;
  }

  /**
   * Checks FUZZY_SUBSTRING_TAGS against the event alias (see
   * extractEventAlias). A tag is "verified" only when it's both present on
   * the page AND at least one of its configured substrings occurs
   * case-insensitively in `alias` — e.g. tag "grammy" verified by alias
   * "68th Annual Grammy Awards Ceremony" (substring "grammy"), or tag
   * "private" verified by alias "Closed Rehearsal" (substring "closed").
   * Tags that don't match are simply omitted (never reported as missing —
   * see FUZZY_SUBSTRING_TAGS doc).
   * @param {string|null} alias
   * @param {Set<string>} actualTags
   * @returns {{tag: string, label: string, matched: string}[]}
   */
  function checkAliasSubstringTags(alias, actualTags) {
    if (!alias) return [];
    const aliasLower = alias.toLowerCase();
    const results = [];
    for (const [tag, substrings] of Object.entries(FUZZY_SUBSTRING_TAGS)) {
      if (!isTagPresent(tag, actualTags)) continue;
      const matched = substrings.find(s => aliasLower.includes(s));
      if (matched) {
        results.push({ tag, label: `matches event alias "${alias}" (contains "${matched}", case-insensitive)`, matched });
      }
    }
    return results;
  }

  /**
   * Checks FUZZY_SUBSTRING_TAGS against a page's free-text notes preamble
   * (see extractPageNotesText). Same "verified, never missing" semantics as
   * checkAliasSubstringTags, just sourced from the notes text instead of the
   * event alias — e.g. tag "benefit" verified by a notes paragraph
   * mentioning "...the twenty-sixth annual Light Of Day Benefit."
   * @param {string} notesText
   * @param {Set<string>} actualTags
   * @returns {{tag: string, label: string, matched: string}[]}
   */
  function checkNotesSubstringTags(notesText, actualTags) {
    if (!notesText) return [];
    const notesLower = notesText.toLowerCase();
    const results = [];
    for (const [tag, substrings] of Object.entries(FUZZY_SUBSTRING_TAGS)) {
      if (!isTagPresent(tag, actualTags)) continue;
      const matched = substrings.find(s => notesLower.includes(s));
      if (matched) {
        results.push({ tag, label: `matches page notes (contains "${matched}", case-insensitive)`, matched });
      }
    }
    return results;
  }

  // ── Relation participant extraction and rendering ──────────────────────────

  /**
   * Parses #wiki-tab-0-0 of a DETAIL page and returns an array of relation groups.
   * Each group has an optional header (from <p><strong>…</strong></p> dividers)
   * and a list of RelItem objects. Multiple consecutive <ul> blocks without an
   * intervening header are merged into the same group (case b: Guest pattern).
   * Stops at <hr> or <ol> (setlist area begins).
   * @param {Document} doc
   * @returns {Array<{header:string|null, items:Array<{href:string, name:string, extra:string|null, el:Element, members:Array<{href:string,name:string,extra:string|null,el:Element}>}>}>}
   */
  function extractRelations(doc) {
    const tab = doc.getElementById('wiki-tab-0-0');
    if (!tab) return [];

    const kids = [...tab.children];
    // Skip alias block: <p><strong>…</strong></p> followed by <hr>
    let startIdx = 0;
    if (kids.length >= 2 && kids[0].tagName === 'P' && kids[1].tagName === 'HR') {
      const strong = kids[0].querySelector('strong');
      if (strong && kids[0].textContent.trim() === strong.textContent.trim()) {
        startIdx = 2;
      }
    }

    const groups = [];
    let currentGroup = null;

    for (let i = startIdx; i < kids.length; i++) {
      const el = kids[i];
      if (el.tagName === 'HR' || el.tagName === 'OL') break;
      if (el.tagName === 'P') {
        const strong = el.querySelector('strong');
        if (!strong) break; // prose paragraph — setlist area
        currentGroup = { header: strong.textContent.trim(), items: [] };
        groups.push(currentGroup);
      } else if (el.tagName === 'UL') {
        if (!currentGroup) {
          currentGroup = { header: null, items: [] };
          groups.push(currentGroup);
        }
        for (const li of el.querySelectorAll(':scope > li')) {
          const a = li.querySelector(':scope > a[href^="/relation:"]');
          if (!a) continue;
          const extraEl = li.querySelector('span[style*="font-size"]');
          const memberUl = li.querySelector(':scope > ul');
          const members = memberUl
            ? [...memberUl.querySelectorAll(':scope > li')].map(mli => {
                const ma = mli.querySelector(':scope > a[href^="/relation:"]');
                if (!ma) return null;
                const mExtra = mli.querySelector('span[style*="font-size"]');
                return {
                  href:    ma.getAttribute('href'),
                  name:    ma.textContent.trim(),
                  extra:   mExtra ? mExtra.textContent.trim() : null,
                  extraEl: mExtra || null,
                  el:      ma,
                };
              }).filter(Boolean)
            : [];
          currentGroup.items.push({
            href:    a.getAttribute('href'),
            name:    a.textContent.trim(),
            extra:   extraEl ? extraEl.textContent.trim() : null,
            extraEl: extraEl || null,
            el:      a,
            members
          });
        }
        // Do NOT reset currentGroup — consecutive ULs without a header merge
        // into the same group (handles the "(Guest)" second-block pattern).
      }
    }

    return groups.filter(g => g.items.length > 0);
  }

  /**
   * Flattens extractRelations(doc)'s groups into a unique list of relation
   * names (top-level items and their band members alike), for the "On
   * Stage" tab tag consistency check.
   * @param {Document} doc
   * @returns {string[]}
   */
  function extractOnStageRelationNames(doc) {
    const names = [];
    for (const group of extractRelations(doc)) {
      for (const item of group.items) {
        names.push(item.name);
        for (const m of item.members) names.push(m.name);
      }
    }
    return [...new Set(names)];
  }

  /**
   * Returns the names of every relation entry (top-level or band member)
   * in extractRelations(doc) whose "extra" annotation mentions "Guest",
   * e.g. `<li><a href="/relation:bruce-springsteen">Bruce Springsteen</a>
   * <span style="font-size:80%;"><em>(Guest)</em></span></li>`. Not
   * limited to any specific person — ANY relation marked "(Guest)" (Bruce
   * Springsteen himself, a sit-in musician, etc.) means the page's own
   * "guest" tag is expected (see checkOnStageRelationTags).
   * @param {Document} doc
   * @returns {string[]}
   */
  function extractGuestMarkedRelationNames(doc) {
    const names = [];
    for (const group of extractRelations(doc)) {
      for (const item of group.items) {
        if (item.extra && /guest/i.test(item.extra)) names.push(item.name);
        for (const m of item.members) {
          if (m.extra && /guest/i.test(m.extra)) names.push(m.name);
        }
      }
    }
    return [...new Set(names)];
  }

  /**
   * Lowercase, punctuation/whitespace-stripped, accent-stripped slug for a
   * relation name, e.g. "Steven Van Zandt" -> "stevenvanzandt",
   * "Jörgen Johansson" -> "jorgenjohansson".
   * @param {string} name
   * @returns {string}
   */
  function relationTagSlug(name) {
    return stripDiacritics(name).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /**
   * Checks a single relation name (no "&") against its expected tag, per
   * these rules:
   * 1. Exact match: lowercase, punctuation/whitespace-stripped relation
   *    name, e.g. `"Steven Van Zandt"` -> `"stevenvanzandt"`.
   * 2. Same as #1, but with a leading `"The "` stripped first, e.g.
   *    `"The E Street Band"` -> `"estreetband"`.
   * 3. Same as #1, but with a trailing generational suffix (Jr./Sr./II/
   *    III/IV) stripped first, e.g. `"Curtis King Jr."` -> `"curtisking"`.
   * 4. Same as #1, but with a quoted nickname removed first, e.g.
   *    `Steve "Muddy" Shews` -> `"steveshews"`.
   * 5. The dotted "first.last" form (`ESTREETBAND_DOTTED_TAG_OVERRIDES`),
   *    for the specific E Street Band members listed there, e.g.
   *    `"Charles Giordano"` -> `"charles.giordano"`.
   * 6. Manual override (`RELATION_TAG_ALIAS_OVERRIDES`) for the rare case
   *    where BruceBase's real tag matches none of the above, e.g. a plain
   *    typo/irregularity in the real tag itself.
   * Rules 1-5 are tried in that order (first match wins) — both the plain
   * and dotted forms are always tried regardless of context, so an
   * exception (e.g. a non-dotted "Roy Bittan" on a page that otherwise
   * prefers dotted tags) still matches. `preferDottedTag`, when true, only
   * affects which form is *reported* as the expected tag when NEITHER is
   * present (see checkOnStageRelationTags's preferDottedEStreetTag).
   * @param {string}      name
   * @param {Set<string>} actualTags
   * @param {boolean}     [preferDottedTag] - Report the dotted tag (not the
   *   plain one) as the expected/missing tag when this name is one of
   *   ESTREETBAND_DOTTED_TAG_OVERRIDES and neither form is present.
   * @returns {{label: string, candidateTag: string, matchedTag: string|null, method: 'exact'|'the-stripped'|'suffix-stripped'|'nickname-stripped'|'estreetband-dotted'|'override'|null, names: string[]}}
   */
  function checkSingleRelationName(name, actualTags, preferDottedTag = false) {
    const theStripped = name.replace(/^the\s+/i, '');
    const suffixStripped = name.replace(/\s+(?:Jr\.?|Sr\.?|III|II|IV)$/i, '').trim();
    const nicknameStripped = name.replace(/\s*"[^"]*"\s*/g, ' ').replace(/\s+/g, ' ').trim();
    const dottedTag = ESTREETBAND_DOTTED_TAG_OVERRIDES[name.toLowerCase().trim()] || null;
    const candidates = [
      { tag: relationTagSlug(name), method: 'exact' },
      { tag: relationTagSlug(theStripped), method: 'the-stripped' },
      { tag: relationTagSlug(suffixStripped), method: 'suffix-stripped' },
      { tag: relationTagSlug(nicknameStripped), method: 'nickname-stripped' },
    ];
    if (dottedTag) candidates.push({ tag: dottedTag, method: 'estreetband-dotted' });
    const seen = new Set();
    let match = null;
    for (const c of candidates) {
      if (seen.has(c.tag)) continue;
      seen.add(c.tag);
      if (isTagPresent(c.tag, actualTags)) { match = c; break; }
    }
    if (match) {
      return { label: `Relation: ${name}`, candidateTag: match.tag, matchedTag: match.tag, method: match.method, names: [name] };
    }
    const overrideTag = RELATION_TAG_ALIAS_OVERRIDES[name.toLowerCase().trim()];
    if (overrideTag && isTagPresent(overrideTag, actualTags)) {
      return { label: `Relation: ${name}`, candidateTag: overrideTag, matchedTag: overrideTag, method: 'override', names: [name] };
    }
    const fallbackTag = (preferDottedTag && dottedTag) ? dottedTag : candidates[0].tag;
    return { label: `Relation: ${name}`, candidateTag: fallbackTag, matchedTag: null, method: null, names: [name] };
  }

  /**
   * Checks a relation name (as it appears in extractOnStageRelationNames'
   * flattened output, or a single extractRelations entry's own name) against
   * its expected tag(s), handling an "&"-joined name (e.g. "Joe Grushecky &
   * The Houserockers") by splitting it into two independent checks first,
   * falling back to the combined name only if neither half matches.
   * Factored out of checkOnStageRelationTags's inline loop so a single name
   * can be checked without re-deriving the whole tab's relationResults array
   * — used by colorizeOnStageRelationNames for the live-DOM name-coloring
   * pass.
   * @param {string}      name
   * @param {Set<string>} actualTags
   * @param {boolean}     [preferDottedTag] - See checkSingleRelationName.
   * @returns {{label: string, candidateTag: string, matchedTag: string|null, method: string|null, names: string[]}[]}
   */
  function checkRelationNameTags(name, actualTags, preferDottedTag = false) {
    const ampM = name.match(/^(.+?)\s*&\s*(.+)$/);
    if (!ampM) return [checkSingleRelationName(name, actualTags, preferDottedTag)];
    const partA = checkSingleRelationName(ampM[1].trim(), actualTags, preferDottedTag);
    const partB = checkSingleRelationName(ampM[2].trim(), actualTags, preferDottedTag);
    if (partA.matchedTag && partB.matchedTag) return [partA, partB];
    const combinedTag = relationTagSlug(name.replace(/^the\s+/i, '').replace(/\s*&\s*/g, ''));
    if (isTagPresent(combinedTag, actualTags)) {
      return [{ label: `Relation: ${name}`, candidateTag: combinedTag, matchedTag: combinedTag, method: 'ampersand-combined', names: [ampM[1].trim(), ampM[2].trim()] }];
    }
    return [partA, partB];
  }

  /**
   * Computes whether ESTREETBAND_DOTTED_TAG_OVERRIDES's members should be
   * expected under their dotted tag on this page — see
   * checkOnStageRelationTags's preferDottedEStreetTag. Factored out so
   * colorizeOnStageRelationNames can use the exact same rule without
   * re-running checkOnStageRelationTags.
   * @param {Map<string, number>} tabMap
   * @param {string[]}            relationNames - extractOnStageRelationNames(doc) result.
   * @param {string}              [eventType]
   * @returns {boolean}
   */
  function computePreferDottedEStreetTag(tabMap, relationNames, eventType) {
    return tabMap.has('On Stage')
      && (eventType === 'gig' || eventType === 'rehearsal')
      && !relationNames.some(n => n.toLowerCase() === 'the e street band');
  }

  /**
   * Checks that a DETAIL page's "On Stage" (gig/rehearsal/interview), "In
   * Studio" (recording, audio session), "On Set" (recording, video session),
   * or "On Audio" (nogig) tab relation names each have a corresponding tag.
   * When the matched tab has a `fixedTag` configured (see
   * RELATION_TAB_CONFIGS — `"onstage"` for "On Stage", `"studio"` for
   * "In Studio", none for "On Audio"/"On Set"), that tag is always expected,
   * independent of any relation name — EXCEPT on interview pages, where an
   * "On Stage" tab is common but the "onstage" tag itself is never expected
   * (confirmed against several live interview pages that have the tab but
   * no "onstage" tag; unlike gig/rehearsal, an interview isn't itself an
   * on-stage performance). If ANY relation listed there — not just Bruce
   * Springsteen, any of them — is marked `"(Guest)"` (see
   * `extractGuestMarkedRelationNames`), `"guest"` is also expected — this
   * one DOES apply to interview pages too (confirmed against a live
   * interview page that marks Bruce Springsteen "(Guest)" and carries the
   * "guest" tag). Every other relation name is checked via
   * `checkSingleRelationName` — except a name containing `" & "` (e.g.
   * `"Joe Grushecky & The Houserockers"`), which is first split into two
   * independent names, each checked separately (`"Joe Grushecky"` ->
   * `joegrushecky`, `"The Houserockers"` -> `houserockers` via the existing
   * "The "-stripped rule); only when *both* halves fail to match does it
   * fall back to the combined name with `" & "` removed and a leading
   * `"The "` stripped, e.g. `"Hall & Oates"` -> `halloates`.
   * Returns `[]` when the page has none of RELATION_TAB_CONFIGS's tabs.
   * On a gig/rehearsal "On Stage" tab that doesn't explicitly list "The E
   * Street Band" itself, ESTREETBAND_DOTTED_TAG_OVERRIDES's members are
   * expected under their dotted tag rather than the usual plain one — see
   * checkSingleRelationName's preferDottedTag parameter.
   * @param {Document}            doc
   * @param {Map<string, number>} tabMap
   * @param {Set<string>}         actualTags
   * @param {string}              [eventType] - DETAIL page event type
   *   (e.g. "gig", "interview"). Used to suppress the "On Stage" tab's
   *   fixedTag expectation for interview pages, and to scope the dotted-tag
   *   preference to gig/rehearsal pages only.
   * @returns {{label: string, candidateTag: string, matchedTag: string|null, method: string|null, tabLabel: string, names: string[]}[]}
   */
  function checkOnStageRelationTags(doc, tabMap, actualTags, eventType) {
    const tabEntry = Object.entries(RELATION_TAB_CONFIGS).find(([label]) => tabMap.has(label));
    if (!tabEntry) return [];
    const [tabLabel, config] = tabEntry;
    const items = [];
    const relationNames = extractOnStageRelationNames(doc);
    const suppressFixedTag = tabLabel === 'On Stage' && eventType === 'interview';
    const preferDottedEStreetTag = computePreferDottedEStreetTag(tabMap, relationNames, eventType);
    if (config.fixedTag && !suppressFixedTag) {
      items.push({
        label: `Tab: ${tabLabel}`,
        candidateTag: config.fixedTag,
        matchedTag: isTagPresent(config.fixedTag, actualTags) ? config.fixedTag : null,
        method: 'fixed',
        tabLabel,
        names: [], // no single relation — tab-wide fixed tag, no artefact to highlight
      });
    }
    const guestNames = extractGuestMarkedRelationNames(doc);
    if (guestNames.length > 0) {
      items.push({
        label: guestNames.length === 1
          ? `Relation: ${guestNames[0]} (Guest)`
          : `Relations marked (Guest): ${guestNames.join(', ')}`,
        candidateTag: 'guest',
        matchedTag: isTagPresent('guest', actualTags) ? 'guest' : null,
        method: 'guest',
        tabLabel,
        names: guestNames,
      });
    }
    for (const name of relationNames) {
      for (const r of checkRelationNameTags(name, actualTags, preferDottedEStreetTag)) {
        items.push({ ...r, tabLabel });
      }
    }
    return items;
  }

  /**
   * Colorizes every relation name link under a DETAIL page's "On Stage"/
   * "In Studio"/"On Audio"/"On Set" tab (see extractRelations) green when
   * its derived tag (checkRelationNameTags) is present in actualTags, or
   * appends a ⚠️ warning span with a descriptive tooltip when it's
   * missing. A name marked "(Guest)" (e.g. Bruce Springsteen) is also
   * checked against the "guest" tag specifically, on top of its own name
   * tag. No-op when the page has no relation-listing tab at all.
   * @param {Document}    doc
   * @param {Set<string>} actualTags
   * @param {boolean}     preferDottedTag - See checkSingleRelationName /
   *   computePreferDottedEStreetTag.
   */
  function colorizeOnStageRelationNames(doc, actualTags, preferDottedTag) {
    for (const group of extractRelations(doc)) {
      for (const item of group.items) {
        colorizeRelationEntry(item, actualTags, preferDottedTag);
        for (const m of item.members) colorizeRelationEntry(m, actualTags, preferDottedTag);
      }
    }
  }

  /**
   * Colorizes a single extractRelations item/member's own <a> link — see
   * colorizeOnStageRelationNames.
   * @param {{name:string, extra:string|null, el:Element}} entry
   * @param {Set<string>} actualTags
   * @param {boolean}     preferDottedTag
   */
  function colorizeRelationEntry(entry, actualTags, preferDottedTag) {
    if (!entry.el) return;
    const results      = checkRelationNameTags(entry.name, actualTags, preferDottedTag);
    const guestMarked  = !!entry.extra && /guest/i.test(entry.extra);
    const guestMissing = guestMarked && !isTagPresent('guest', actualTags);
    const allMatched   = results.every(r => r.matchedTag);
    if (allMatched && !guestMissing) {
      entry.el.classList.add('bb-relation-name-ok');
      const tags = results.map(r => `"${r.matchedTag}"`).join(' and ');
      entry.el.title = guestMarked
        ? `Verified: matches tag ${tags} and marked "(Guest)" with "guest" tag present`
        : `Verified: matches tag${results.length > 1 ? 's' : ''} ${tags}`;
      return;
    }
    const reasons = results.filter(r => !r.matchedTag).map(r => `expected tag "${r.candidateTag}" not found`);
    if (guestMissing) reasons.push('marked "(Guest)" but "guest" tag not found');
    const warn = document.createElement('span');
    warn.className = 'bb-relation-name-warn';
    warn.textContent = ' ⚠️';
    warn.title = reasons.join('; ');
    entry.el.after(warn);
  }

  /**
   * Returns an HTML string for the flat one-line relation view of a single group.
   * Top-level entries use "•" (bb-rel-main); band members use "◦" (bb-rel-member).
   * Extra annotations (e.g. "(Guest)") are rendered as .bb-rel-extra spans.
   * @param {{header:string|null, items:Array}} group
   * @returns {string}
   */
  function renderRelationsFlatHtml(group) {
    const parts = [];
    for (const item of group.items) {
      const extra = item.extra
        ? ` <span class="bb-rel-extra">${esc(item.extra)}</span>`
        : '';
      // Bullet: span (click → Relation tab row).  Name: link (click → relation page).
      parts.push(
        `<span class="bb-rel-bullet bb-rel-main" data-rel-href="${esc(item.href)}" data-rel-name="${esc(item.name)}">•</span> <a href="${esc(item.href)}" class="bb-rel-name">${esc(item.name)}</a>${extra}`
      );
      for (const m of item.members) {
        const mExtra = m.extra
          ? ` <span class="bb-rel-extra">${esc(m.extra)}</span>`
          : '';
        parts.push(
          `<span class="bb-rel-bullet bb-rel-member" data-rel-href="${esc(m.href)}" data-rel-name="${esc(m.name)}">◦</span> <a href="${esc(m.href)}" class="bb-rel-name">${esc(m.name)}</a>${mExtra}`
        );
      }
    }
    return parts.join('<span class="bb-sep"> / </span>');
  }

  /**
   * Returns a <ul class="bb-relations-list-ul"> DOM element for the nested list
   * view of a single relation group. Top-level items use "•" bullets; band
   * members use "◦" bullets in an indented nested <ul>.
   * @param {{header:string|null, items:Array}} group
   * @returns {HTMLUListElement}
   */
  function renderRelationsListEl(group) {
    const ul = document.createElement('ul');
    ul.className = 'bb-relations-list-ul';
    for (const item of group.items) {
      const li = document.createElement('li');
      const extra = item.extra
        ? ` <span class="bb-rel-extra">${esc(item.extra)}</span>`
        : '';
      li.innerHTML =
        `<span class="bb-rel-bullet bb-rel-main" data-rel-href="${esc(item.href)}" data-rel-name="${esc(item.name)}">•</span>` +
        ` <a href="${esc(item.href)}" class="bb-rel-name">${esc(item.name)}</a>${extra}`;
      if (item.members.length > 0) {
        const memberUl = document.createElement('ul');
        memberUl.className = 'bb-relations-list-ul';
        for (const m of item.members) {
          const mli = document.createElement('li');
          const mExtra = m.extra
            ? ` <span class="bb-rel-extra">${esc(m.extra)}</span>`
            : '';
          mli.innerHTML =
            `<span class="bb-rel-bullet bb-rel-member" data-rel-href="${esc(m.href)}" data-rel-name="${esc(m.name)}">◦</span>` +
            ` <a href="${esc(m.href)}" class="bb-rel-name">${esc(m.name)}</a>${mExtra}`;
          memberUl.appendChild(mli);
        }
        li.appendChild(memberUl);
      }
      ul.appendChild(li);
    }
    return ul;
  }

  /**
   * Injects relation participant blocks into processedDiv, one per eligible year
   * section (indexed after filtering out "setlist" preview sections for case d).
   * Each injection is a pair: <p class="bb-relations-flat"> (visible by default)
   * and <div class="bb-relations-list"> (hidden; shown by the ☰ List toggle).
   * @param {Element} processedDiv
   * @param {Array} relGroups  — from extractRelations()
   * @param {Array} yearSections — from parseYearSetlist()
   */
  function injectEventRelations(processedDiv, relGroups, yearSections) {
    if (!relGroups.length) return;
    // Exclude "setlist" preview sections (case d) and "soundcheck" sections:
    // relations describe show participants, not soundcheck performers.
    // Fall back to soundcheck-inclusive if no other sections exist.
    const noSoundcheck = yearSections.filter(s => {
      const lc = s.label.toLowerCase();
      return lc !== 'setlist' && lc !== 'soundcheck';
    });
    const eligible = noSoundcheck.length > 0
      ? noSoundcheck
      : yearSections.filter(s => s.label.toLowerCase() !== 'setlist');

    // No setlist at all: inject all groups appended to processedDiv.
    const noSetlist = eligible.length === 0;
    const n = noSetlist ? relGroups.length : Math.min(relGroups.length, eligible.length);

    const headingHref = (processedDiv.querySelector('.bb-event-heading a[href]')
      ?.getAttribute('href') || '');
    const isRecordingEvent = headingHref.startsWith('/recording:');

    for (let i = 0; i < n; i++) {
      const group = relGroups[i];
      if (!group.items.length) continue;

      // Use <blockquote> for the flat relation block on recording events so the
      // relation line is visually indented alongside the recording setlist blockquote.
      const useBlockquote = noSetlist
        ? isRecordingEvent
        : eligible[i].sourceEl.tagName === 'BLOCKQUOTE';
      const flatEl = document.createElement(useBlockquote ? 'blockquote' : 'p');
      flatEl.className = 'bb-relations-flat';
      flatEl.innerHTML = renderRelationsFlatHtml(group);

      // "Relations:" label shown above the nested list in list view
      const relLabelP = document.createElement('p');
      relLabelP.className = 'bb-list-label';
      const relLabelSpan = document.createElement('span');
      relLabelSpan.className = 'bb-section-label';
      relLabelSpan.textContent = 'Relations:';
      relLabelP.appendChild(relLabelSpan);

      const listEl = document.createElement('div');
      listEl.className = 'bb-relations-list';
      listEl.style.display = 'none';
      listEl.appendChild(relLabelP);
      listEl.appendChild(renderRelationsListEl(group));

      if (noSetlist) {
        const scheduledDiv = processedDiv.querySelector('.bb-scheduled');
        if (scheduledDiv) {
          scheduledDiv.after(flatEl, listEl);
        } else {
          processedDiv.appendChild(flatEl);
          processedDiv.appendChild(listEl);
        }
      } else {
        eligible[i].sourceEl.before(flatEl, listEl);
      }

      // Wire bullet click handlers: • / ◦ open a Relation: tab row panel
      for (const container of [flatEl, listEl]) {
        container.querySelectorAll('.bb-rel-bullet').forEach(span => {
          span.addEventListener('click', () => {
            fetchAndToggleRelationTabRow(span.dataset.relHref, span.dataset.relName, processedDiv, span);
          });
        });
      }
    }
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
   * @param {string}      [prefix]       Optional text prepended to a newly-created container
   * @param {string|null} [extra]        When match is false, a non-null value from
   *   findVenueDetailExtra means the only difference is expected extra text (a show-variant
   *   suffix like "(Late)", or a descriptive "venue detail" segment) — rendered as an
   *   informational green glyph instead of an orange mismatch, and excluded from mismatch
   *   counting / tooltips (see bb-venue-info).
   */
  function renderVenueInfo(afterEl, venueHref, venueName, match, detailVenuePart, prefix = '', extra = null) {
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

    // Plain-text summary for dataset.msg (read by collectSectionWarnings and
    // rewireLoadedPage's post-cache-load fallback) — the live hover tooltip
    // itself uses showVenueTooltip's .bb-tip-table instead (see below).
    let msg, glyphClass, glyphChar;
    if (match) {
      msg = `Venue match ✅\nVENUE page: "${venueName}"\nDETAIL event: "${detailVenuePart}"`;
      glyphClass = 'bb-glyph';
      glyphChar  = ' ✅';
    } else if (extra) {
      msg = `Extra text "${extra}" on DETAIL page not present on VENUE page — informational only, not a mismatch\nVENUE page: "${venueName}"\nDETAIL event: "${detailVenuePart}"`;
      glyphClass = 'bb-venue-info';
      glyphChar  = ' ⚠︎'; // text-presentation warning sign (colorable via CSS, unlike the emoji form)
    } else {
      msg = `Venue mismatch ⚠️\nVENUE page: "${venueName}"\nDETAIL event: "${detailVenuePart}"`;
      glyphClass = 'bb-glyph bb-venue-warn';
      glyphChar  = ' ⚠️';
    }
    const glyph = document.createElement('span');
    glyph.className = glyphClass;
    glyph.textContent = glyphChar;
    glyph.style.cursor = 'help';
    glyph.dataset.msg = msg;
    glyph.addEventListener('mouseenter', e => showVenueTooltip(e, venueName, detailVenuePart, match, extra));
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

  /**
   * For "gig"/"rehearsal"/"interview" DETAIL pages that have an "On Stage"
   * tab, fetches the companion "onstage:" page (same date-slug, type
   * swapped to "onstage", "/noredirect/true" appended) and returns the tags
   * found in its own .page-tags. BruceBase caps tags-per-page, so some tags
   * for an event with many combined tags only exist on this separate page
   * — interview pages have the same "On Stage" tab as gig/rehearsal pages
   * and can overflow onto a companion page the same way, even though most
   * don't (no companion page is simply a 404, handled like any other
   * fetch failure below). Returns null when not applicable (wrong event
   * type, no "On Stage" tab) or the fetch fails.
   * @param {string}             path     - Current page's path, no leading slash, e.g. "gig:2025-10-26-stone-pony-asbury-park-nj".
   * @param {string}             eventType
   * @param {Map<string,number>} tabMap   - buildTabMap(document) result.
   * @returns {Promise<{url: string, tags: Set<string>}|null>}
   */
  async function fetchOnstageCompanionTags(path, eventType, tabMap) {
    if (eventType !== 'gig' && eventType !== 'rehearsal' && eventType !== 'interview') return null;
    if (!tabMap.has('On Stage')) return null;
    const onstagePath = path.replace(/^(gig|rehearsal|interview):/, 'onstage:') + '/noredirect/true';
    const url = `${location.protocol}//${location.host}/${onstagePath}`;
    try {
      const onstageDoc = await fetchPage(url);
      const tagLinks    = [...onstageDoc.querySelectorAll('.page-tags a[href]')];
      const tags        = new Set(tagLinks.map(a => a.textContent.trim().toLowerCase()));
      log(`  Onstage companion page fetched: ${url} (${tags.size} tags)`);
      return { url, tags };
    } catch (e) {
      logWarn(`  Onstage companion page fetch failed: ${e.message}`);
      return null;
    }
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
      /ticket/i.test(img.src) || /\/(?:files:)?pass/i.test(img.src)
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
      // list-pages content is loaded dynamically by wikidot JS; a static fetch
      // yields an empty box. Check the boxes specifically — preamble text outside
      // the boxes (e.g. an introductory paragraph) must not be counted as content.
      const boxes = [...clone.querySelectorAll('.list-pages-box')];
      if (boxes.length > 0 && boxes.every(box => !box.textContent.trim())) return null;
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
        const retailDoc   = await fetchPage('http://brucebase.wikidot.com' + href);
        const retailTitle = retailDoc.querySelector('#page-title')?.textContent.trim() || '';
        const content     = retailDoc.querySelector('#page-content');
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

          // Strip top-level list-pages-box containers (Wikidot dynamic discography
          // navigators) — they render as meaningless release icons in this context.
          clone.querySelectorAll(':scope > .list-pages-box').forEach(el => el.remove());

          // Flatten each YUI navset into labeled collapsible sections. A
          // DocumentFragment unwraps the content flat — no bb-retail-tabs wrapper
          // div — so wirePanelCollapsibles can wire each label as a toggle.
          clone.querySelectorAll('.yui-navset').forEach(navset => {
            const labels = [...navset.querySelectorAll('ul.yui-nav li')]
              .map(li => li.querySelector('em')?.textContent.trim() ?? li.textContent.trim());
            const panels = [...(navset.querySelector('div.yui-content')?.children ?? [])];
            const frag   = document.createDocumentFragment();
            panels.forEach((panel, i) => {
              if (labels[i]) {
                const lbl = document.createElement('p');
                lbl.innerHTML = `<strong class="bb-retail-tab-label">${esc(labels[i])}</strong>`;
                frag.appendChild(lbl);
              }
              panel.style.removeProperty('display');
              frag.appendChild(panel.cloneNode(true));
            });
            navset.replaceWith(frag);
          });

          const titleHtml = retailTitle
            ? `<div class="bb-retail-page-title">${esc(retailTitle)}</div>` : '';
          html += `<hr style="margin:8px 0;">${titleHtml}${clone.innerHTML}`;
        }
      } catch (e) {
        html += `<p style="color:#c00">Failed to fetch ${esc(href)}: ${esc(e.message)}</p>`;
      }
    }
    return { type: 'html', caption: 'Retail', html };
  }

  /**
   * Wires each .bb-retail-tab-label <strong> inside panel as a collapse toggle
   * for the <div> immediately following its <p> parent. All sections start
   * collapsed; clicking a label expands/collapses its content and toggles the
   * bb-retail-tab-open class for visual feedback.
   * @param {HTMLElement} panel  The bb-icon-panel element just inserted into the DOM.
   */
  function wirePanelCollapsibles(panel) {
    panel.querySelectorAll('.bb-retail-tab-label').forEach(strong => {
      const p = strong.closest('p');
      const contentDiv = p?.nextElementSibling;
      if (!contentDiv || contentDiv.tagName !== 'DIV') return;
      contentDiv.style.display = 'none';
      strong.addEventListener('click', () => {
        const open = contentDiv.style.display !== 'none';
        contentDiv.style.display = open ? 'none' : '';
        strong.classList.toggle('bb-retail-tab-open', !open);
      });
    });
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
      warn.title = 'Retail icon on YEAR page but no retail reference found in the Recording tab of DETAIL page.';
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
        wirePanelCollapsibles(icon._bbPanel);
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
    // "00" is BruceBase's convention for an unknown day-of-month, alongside real days 1-31.
    if (/^\d{1,2}$/.test(tag) && parseInt(tag, 10) >= 0 && parseInt(tag, 10) <= 31) return true;
    // Tour-premiere-count tag ("1".."9"/"9+" — see TOUR_PREMIERE_TAG_VALUES). Bare
    // single digits are already covered by the day-number rule above; only "9+"
    // needs its own check here.
    if (tag === '9+') return true;
    // Single lowercase letter: the day-suffix (a/b/c/…) distinguishing multiple
    // same-day events (see extractEventDaySuffix), mirroring isManagedRetailTag's
    // identical rule for retail pages' alphabetical-index tags.
    if (/^[a-z]$/.test(tag)) return true;
    // Tour association tag (see TOUR_DEFINITIONS/checkEventTourTags) or the
    // special "not part of the tour" exception tag.
    if (tag === TOUR_NO_TAG || TOUR_TAG_SET.has(tag)) return true;
    return false;
  }

  /**
   * Builds a human-readable tooltip message for a tag that is present on the
   * page but whose expected condition is NOT met (a "spurious" tag).
   * @param {string}      tag
   * @param {Set<string>} expectedTags - Result of computeExpectedTags().
   * @param {ReturnType<typeof checkEventTourTags>} [tourCheck] - Precomputed
   *   by the caller, needed only for the TOUR_NO_TAG/TOUR_TAG_SET messages
   *   below (every other tag ignores this param).
   * @returns {string}
   */
  function spuriousTagMsg(tag, expectedTags, tourCheck = null) {
    if (SPURIOUS_TAG_REASONS[tag]) return `Tag "${tag}" is present but: ${SPURIOUS_TAG_REASONS[tag]}`;
    if (tag === TOUR_NO_TAG) {
      if (!tourCheck) return `Tag "${TOUR_NO_TAG}" is present but this event's date doesn't fall within any known tour's date range — there's nothing for it to exclude`;
      const names = tourCheck.matchedTours.map(t => `"${t.name}"`).join(', ');
      return `Tag "${TOUR_NO_TAG}" is present but this event's date falls within ${names} and no exclusion (event alias, or a TOUR_NO_OVERRIDES entry) was found — this looks like a genuine tour event`;
    }
    if (TOUR_TAG_SET.has(tag)) {
      const def  = TOUR_DEFINITIONS.find(t => t.tag === tag);
      const name = def ? def.name : tag;
      if (tourCheck?.isTourNo) {
        const reason = tourCheck.alias ? `event alias "${tourCheck.alias}" found on this page` : 'marked via TOUR_NO_OVERRIDES';
        return `Tag "${tag}" is present but this event is excluded from the "${name}" tour (${reason}) — expected "${TOUR_NO_TAG}" instead`;
      }
      return `Tag "${tag}" is present but this event's date is outside the "${name}" tour's date range`;
    }
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
    // Tour-premiere-count tags are always bare (no leading zero) — "1".."9" or
    // "9+" — while an expected day-of-month tag is always the zero-padded
    // 2-digit form (e.g. "03"), so the two never collide on shape: checking
    // this first lets a bare digit like "6" report the right reason instead
    // of being misread as a day-of-month mismatch.
    if (/^[1-9]$/.test(tag) || tag === '9+') {
      const exp = [...expectedTags].find(t => TOUR_PREMIERE_TAG_VALUES.has(t));
      return exp
        ? `Tour premiere-count tag "${tag}" present but ${exp} tour-premiere song(s) (bold-marked in the Setlist tab) were found, expected "${exp}"`
        : `Tour premiere-count tag "${tag}" present but no tour-premiere songs (bold-marked) were found in the Setlist tab`;
    }
    if (/^\d{1,2}$/.test(tag) && parseInt(tag, 10) <= 31) {
      const exp = [...expectedTags].find(t => /^\d{2}$/.test(t)) || '?';
      return `Day tag "${tag}" present but event day is "${exp}"`;
    }
    if (/^[a-z]$/.test(tag)) {
      const exp = [...expectedTags].find(t => /^[a-z]$/.test(t));
      return exp
        ? `Day-suffix tag "${tag}" present but the event's URL day-suffix is "${exp}"`
        : `Day-suffix tag "${tag}" present but the event's URL has no day-suffix letter`;
    }
    const expType = [...expectedTags].find(t => KNOWN_EVENT_TYPES.has(t));
    if (expType) return `Event-type tag "${tag}" present but event type is "${expType}"`;
    return `Tag "${tag}" is present but its expected condition was not detected`;
  }

  /**
   * Builds a human-readable tooltip message for a tag that is present on the
   * page and whose expected condition IS met (a "passing" tag).
   * @param {string}      tag
   * @param {Set<string>} expectedTags - Result of computeExpectedTags().
   * @param {ReturnType<typeof checkEventTourTags>} [tourCheck] - Precomputed
   *   by the caller, needed only for the TOUR_NO_TAG/TOUR_TAG_SET messages
   *   below (every other tag ignores this param).
   * @returns {string}
   */
  function passingTagMsg(tag, expectedTags, tourCheck = null) {
    if (PASSING_TAG_REASONS[tag]) return `Tag "${tag}" verified: ${PASSING_TAG_REASONS[tag]}`;
    if (tag === TOUR_NO_TAG) {
      return tourCheck?.alias
        ? `Tag "${TOUR_NO_TAG}" verified: event alias "${tourCheck.alias}" found — not considered part of the tour(s) that otherwise cover this date`
        : `Tag "${TOUR_NO_TAG}" verified: manually marked as not part of the tour (TOUR_NO_OVERRIDES)`;
    }
    if (TOUR_TAG_SET.has(tag)) {
      const def = TOUR_DEFINITIONS.find(t => t.tag === tag);
      return `Tag "${tag}" verified: matches the "${def ? def.name : tag}" tour's date range`;
    }
    if (/^\d{4}$/.test(tag))       return `Year tag "${tag}" verified: matches the event date`;
    if (MONTH_NAMES.includes(tag)) return `Month tag "${tag}" verified: matches the event date`;
    if (DAY_NAMES.includes(tag))   return `Weekday tag "${tag}" verified: matches the event date`;
    // Checked before the day-number rule below (see the matching comment in
    // spuriousTagMsg) — but only when `tag` is the literal expected premiere
    // value, not merely premiere-shaped, so a bare-digit day tag that happens
    // to pass via isTagPresent's zero-pad fallback still gets the day message.
    if (TOUR_PREMIERE_TAG_VALUES.has(tag) && expectedTags.has(tag))
                                    return `Tour premiere-count tag "${tag}" verified: matches the number of tour-premiere songs (bold-marked in the Setlist tab)`;
    if (/^\d{1,2}$/.test(tag) && parseInt(tag, 10) <= 31)
                                    return `Day tag "${tag}" verified: matches the event date`;
    if (/^[a-z]$/.test(tag))       return `Day-suffix tag "${tag}" verified: matches the event's URL day-suffix (distinguishes multiple same-day events)`;
    if (KNOWN_EVENT_TYPES.has(tag)) return `Event-type tag "${tag}" verified: matches the event type`;
    return `Tag "${tag}" verified: matches its expected condition`;
  }

  /**
   * Returns the live #page-title <h1> (or the #page-title container itself
   * as a fallback), for the tag-source-highlight feature's "whole title"
   * artefact (bbp_enable_tag_source_highlight) — used wherever a matched tag
   * was deduced from the page's own title (event-name/venue-name location
   * parts, a song page's exact-title-slug/derived-alias tag, etc.) rather
   * than a specific sub-element, since the title isn't split into
   * per-component spans.
   * @param {Document} [doc=document]
   * @returns {Element|null}
   */
  function getPageTitleElement(doc = document) {
    return doc.querySelector('#page-title h1') || doc.getElementById('page-title');
  }

  /**
   * Wraps the first occurrence of `substring` (exact, case-sensitive) found
   * among `parent`'s own DIRECT text-node children in a new
   * `<span class="bb-tag-source-part">`, via `Text.splitText`. Deliberately
   * does NOT recurse into child elements — this is what makes repeated
   * calls against the same `parent` safe: once a substring is wrapped, its
   * text is no longer a text-node child of `parent` (it's inside the new
   * span), so a later call can't match inside it or re-wrap it, and a
   * pre-existing sibling element (e.g. `.bb-event-type-detail`,
   * `.bb-tour-name`) can never be searched into by accident.
   * @param {Element} parent
   * @param {string}  substring
   * @returns {Element|null} the new span, or null if `substring` wasn't found.
   */
  function wrapTextSubstring(parent, substring) {
    if (!substring) return null;
    for (const node of [...parent.childNodes]) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const idx = node.textContent.indexOf(substring);
      if (idx === -1) continue;
      const match = node.splitText(idx);
      match.splitText(substring.length);
      const span = document.createElement('span');
      span.className = 'bb-tag-source-part';
      match.replaceWith(span);
      span.appendChild(match);
      return span;
    }
    return null;
  }

  /**
   * Resolves a `checkParsedLocationTags` result (`{label, candidateTag,
   * matchedTag, method}` — see `checkVenuePageLocationTags`/
   * `checkEventNameLocationTags`) to its tag-source-highlight artefact:
   * wraps and returns the specific substring of `scope`'s text that the
   * result was deduced from (venue name, the "At The" split halves, venue
   * detail, city, or state abbreviation / bare-country name), by matching
   * `r.label`'s prefix — mirrors (without duplicating) the exact label
   * strings `checkLocationNameTag`/`checkVenueNameTag`/`checkParsedLocationTags`
   * build. Falls back to `fallbackEl` (the whole title, or the whole
   * venue-string span on DETAIL pages) for the `usa`/`canada`/
   * `COUNTRY_EXTRA_TAGS` ("Region: ...") results, which have no literal
   * substring in the title at all — and for any label this function
   * doesn't recognize, or where the expected substring isn't actually
   * found (e.g. already consumed by an earlier wrap).
   * @param {{label: string}} r
   * @param {ReturnType<typeof parseLocationParts>} loc
   * @param {Element} scope - where to search for the substring.
   * @param {Element} fallbackEl
   * @returns {Element|null}
   */
  function resolveLocationSourceEl(r, loc, scope, fallbackEl) {
    if (!loc) return fallbackEl;
    if (r.label === 'Country: USA' || r.label === 'Country: Canada' || r.label.startsWith('Region:')) {
      return fallbackEl;
    }
    let substring = null;
    if (r.label.startsWith('Venue part before') || r.label.startsWith('Venue part after')) {
      const m = loc.venueName.match(/^(.+?)\s+at\s+the\s+(.+)$/i);
      if (m) substring = r.label.startsWith('Venue part before') ? m[1].trim() : m[2].trim();
    } else if (r.label.startsWith('Venue detail:')) {
      substring = loc.venueDetail;
    } else if (r.label.startsWith('Venue:')) {
      substring = loc.venueName;
    } else if (r.label.startsWith('City:')) {
      substring = loc.city;
    } else if (r.label.startsWith('State:')) {
      substring = loc.stateAbbr;
    } else if (r.label.startsWith('Country:')) {
      substring = loc.country;
    }
    return (substring && wrapTextSubstring(scope, substring)) || fallbackEl;
  }

  /**
   * Same shape-matching logic as extractEventAlias, but returns the live
   * <strong> element instead of its text — for the tag-source-highlight
   * feature's (bbp_enable_tag_source_highlight) FUZZY_SUBSTRING_TAGS
   * alias-match artefact resolution.
   * @param {Document} doc
   * @returns {Element|null}
   */
  function findEventAliasElement(doc) {
    const tab = doc.getElementById('wiki-tab-0-0');
    if (!tab) return null;
    const kids = tab.children;
    if (kids.length < 2 || kids[1].tagName !== 'HR') return null;
    const first = kids[0];
    if (first.tagName !== 'P') return null;
    const strong = first.querySelector('strong');
    if (!strong || first.textContent.trim() !== strong.textContent.trim()) return null;
    return strong;
  }

  /**
   * Descends into `el`'s own children to find the deepest/most specific
   * descendant that still contains `substringLower` in its `textContent`,
   * stopping as soon as no child does — i.e. `el` itself, once none of its
   * children contain the match. Needed because BruceBase wraps virtually
   * all free-text content in nested `<div class="list-pages-box"><div
   * class="list-pages-item">...</div></div>` wrappers, whose OWN direct
   * text-node children are empty (all real text lives 2+ levels deeper) —
   * `wrapTextSubstring` only ever scans a parent's direct text nodes (by
   * design), so handing it one of these outer wrapper divs always silently
   * fails to find anything. Used by both findPageNotesSourceElements and
   * findYearEventNotesSourceElements.
   * @param {Element} el
   * @param {string}  substringLower
   * @returns {Element}
   */
  function findDeepestTextContainer(el, substringLower) {
    for (const child of el.children) {
      if ((child.textContent || '').toLowerCase().includes(substringLower)) {
        return findDeepestTextContainer(child, substringLower);
      }
    }
    return el;
  }

  /**
   * Live-DOM counterpart to extractPageNotes: returns the deepest elements
   * (see findDeepestTextContainer) among the actual top-level #page-content
   * children (before the first .yui-navset) whose own text contains the
   * given (lowercase) substring — for the tag-source-highlight feature's
   * FUZZY_SUBSTRING_TAGS notes-match artefact resolution. Unlike
   * extractPageNotes, these are the live elements themselves, not detached
   * clones.
   * @param {Document} doc
   * @param {string} substringLower
   * @returns {Element[]}
   */
  function findPageNotesSourceElements(doc, substringLower) {
    const pageContent = doc.querySelector('#page-content');
    if (!pageContent) return [];
    const matches = [];
    for (const child of pageContent.children) {
      if (child.classList.contains('yui-navset')) break;
      if ((child.textContent || '').toLowerCase().includes(substringLower)) {
        matches.push(findDeepestTextContainer(child, substringLower));
      }
    }
    return matches;
  }

  /**
   * YEAR-page counterpart to findPageNotesSourceElements: unlike the DETAIL
   * page (where the free-text notes preamble lives in #page-content, wholly
   * separate from the .yui-navset tab widget), the YEAR page embeds an
   * event's entire native write-up — heading, setlist, notes prose, "Help
   * Us" icon, etc. — as flat sibling children of one .bb-section-processed,
   * with no boundary marker distinguishing "notes" from the rest. Skips this
   * script's own injected UI (bb-* rows/panels) and any child containing a
   * setlist song ([data-detail-song]), so a song name mentioning a
   * FUZZY_SUBSTRING_TAGS word can't be mistaken for prose.
   * @param {Element} section - .bb-section-processed for one event.
   * @param {string}  substringLower
   * @returns {Element[]}
   */
  function findYearEventNotesSourceElements(section, substringLower) {
    const skipClasses = ['bb-event-heading', 'bb-scheduled', 'bb-relations-flat', 'bb-relations-list',
      'bb-event-tab-row', 'bb-venue-tab-row', 'bb-song-tab-row', 'bb-relation-tab-row', 'bb-icon-panel'];
    const matches = [];
    for (const child of section.children) {
      if (skipClasses.some(c => child.classList.contains(c))) continue;
      if (child.querySelector('[data-detail-song]')) continue;
      if ((child.textContent || '').toLowerCase().includes(substringLower)) {
        matches.push(findDeepestTextContainer(child, substringLower));
      }
    }
    return matches;
  }

  /**
   * Resolves a FUZZY_SUBSTRING_TAGS match (checkAliasSubstringTags's/
   * checkNotesSubstringTags's `matched` field — always lowercase, since
   * it's one of the literal substrings from the FUZZY_SUBSTRING_TAGS table)
   * back to its original-cased occurrence in `el`'s live text, then wraps
   * just that substring. Returns null when `el` is null or doesn't actually
   * contain it (shouldn't happen — the check just confirmed it does — but
   * defensive, since this runs after other wraps may have already
   * consumed part of the text).
   * @param {Element|null} el
   * @param {string} matched - lowercase substring to find.
   * @returns {Element|null}
   */
  function wrapFuzzyMatchSubstring(el, matched) {
    if (!el) return null;
    const idx = el.textContent.toLowerCase().indexOf(matched);
    if (idx === -1) return null;
    return wrapTextSubstring(el, el.textContent.slice(idx, idx + matched.length));
  }

  /**
   * Wires a verified tag <a> (already marked .bb-tag-ok by
   * markPassingTagLinks) so hovering it also draws a highlight box around
   * the tag itself and around the "source" element(s) it was verified
   * against (e.g. the matching setlist song or relation name). Deliberately
   * does NOT switch tabs to reveal a hidden source — an earlier version
   * did (via a click-simulated tab switch), but hovering between tags
   * belonging to different tabs made the page constantly jump tabs, losing
   * scroll position/focus; the box on a hidden source now sits inert in the
   * DOM until the user switches tabs themselves. No-op when `source` is
   * null/empty. The listener bodies are wrapped in try/catch: a failure
   * here must never take down the rest of the page's tag annotation (only
   * this optional hover effect).
   * @param {HTMLAnchorElement} tagEl
   * @param {Element|Element[]} source
   */
  function wireTagSourceHighlight(tagEl, source) {
    const sources = (Array.isArray(source) ? source : [source]).filter(Boolean);
    if (!sources.length) return;
    tagEl.addEventListener('mouseenter', () => {
      try {
        tagEl.classList.add('bb-tag-hover-highlight');
        for (const el of sources) el.classList.add('bb-tag-source-highlight');
      } catch (e) {
        logErr('wireTagSourceHighlight/mouseenter', e);
      }
    });
    tagEl.addEventListener('mouseleave', () => {
      try {
        tagEl.classList.remove('bb-tag-hover-highlight');
        for (const el of sources) el.classList.remove('bb-tag-source-highlight');
      } catch (e) {
        logErr('wireTagSourceHighlight/mouseleave', e);
      }
    });
  }

  /**
   * Styles tag <a> links that passed their consistency check in green and
   * sets a native title tooltip explaining what was verified (single-line
   * message — native tooltip only, no custom rich tooltip needed).
   * Optionally (bbp_enable_tag_source_highlight) also wires a hover
   * highlight around the tag and its verification source(s) — see
   * wireTagSourceHighlight. Used wherever a single source (or one shared by
   * every link in `links`) applies; a batch covering tags with different
   * sources instead layers wireTagSourceHighlight directly on top after the
   * call (see e.g. annotateRetailPageTags/annotateRelationPageTags).
   * @param {HTMLAnchorElement[]}     links - Tag links confirmed to match their expected condition.
   * @param {(tag: string) => string} msgFn - Builds the explanatory tooltip message for a tag.
   * @param {Element|Element[]|null} [sourceEl] - The on-page verification
   *   source element(s) for every link in `links`, when identifiable.
   */
  function markPassingTagLinks(links, msgFn, sourceEl = null) {
    for (const a of links) {
      const tag = a.textContent.trim().toLowerCase();
      a.classList.add('bb-tag-ok');
      a.style.color = '#2a2';
      a.style.fontWeight = 'bold';
      a.style.cursor = 'help';
      a.title = msgFn(tag);
      if (sourceEl && Lib.settings.bbp_enable_tag_source_highlight) {
        wireTagSourceHighlight(a, sourceEl);
      }
    }
  }

  /**
   * Removes accents/diacritics from a string, e.g. "JOLÉ BLON" -> "JOLE BLON".
   * @param {string} str
   * @returns {string}
   */
  function stripDiacritics(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  /**
   * Lowercase, punctuation/whitespace-stripped, accent-stripped slug for a
   * song title, e.g. "JOLÉ BLON" -> "joleblon".
   * @param {string} title
   * @returns {string}
   */
  function songTagSlug(title) {
    return stripDiacritics(title).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /**
   * Derives a tag alias for a song title using BruceBase's apparent acronym
   * convention. See SONG_TAG_ALIAS_OVERRIDES doc comment for the escape hatch
   * when this doesn't match reality.
   * @param {string} title - Song title (as found in parseDetailSetlist output).
   * @returns {string} Lowercase alias, e.g. "AMERICAN SKIN (41 SHOTS)" -> "as41s".
   */
  function computeSongTagAlias(title) {
    const rawWords = stripDiacritics(title).trim().split(/\s+/);
    let alias = '';
    for (const raw of rawWords) {
      if (/^([A-Za-z]\.)+$/.test(raw)) {
        alias += raw.replace(/\./g, '').toLowerCase();   // dotted initialism: all letters
        continue;
      }
      const word = raw.replace(/[()'\-&,.]/g, '');        // delete punctuation, no space
      if (!word) continue;
      alias += /^\d+$/.test(word) ? word : word[0].toLowerCase();
    }
    return alias;
  }

  /**
   * Checks a single song title against its expected tag, trying exact match,
   * then derived alias, then a manual override, in that order.
   * @param {string}      song       - Song title.
   * @param {Set<string>} actualTags - Lowercase tags present on the page.
   * @returns {{song: string, matchedTag: string|null, method: 'exact'|'alias'|'override'|null}}
   */
  function checkOneSongTag(song, actualTags) {
    const exactTag = songTagSlug(song);
    if (isTagPresent(exactTag, actualTags)) return { song, matchedTag: exactTag, method: 'exact' };

    const aliasTag = computeSongTagAlias(song);
    if (aliasTag && isTagPresent(aliasTag, actualTags)) return { song, matchedTag: aliasTag, method: 'alias' };

    const overrideTag = SONG_TAG_ALIAS_OVERRIDES[song.toLowerCase().trim()];
    if (overrideTag && isTagPresent(overrideTag, actualTags)) return { song, matchedTag: overrideTag, method: 'override' };

    return { song, matchedTag: null, method: null };
  }

  /**
   * Checks that every unique setlist song (from an already-parsed
   * parseDetailSetlist result) has a corresponding tag.
   *
   * Before splitting, each raw (unsplit) song string is checked against
   * `SONG_COMBINATION_TAG_OVERRIDES` — a medley/tribute string joined by
   * " - " that BruceBase tags as a single fixed value for the whole
   * combination (e.g. "LAND OF HOPE AND DREAMS - PEOPLE GET READY" →
   * `"lohad.pgr"`) is checked as one unit against that tag and never split.
   * Otherwise, a song string containing " - " (the multi-song
   * medley/tribute separator also used by `songCompareKey`) is split into
   * independent songs, each checked on its own via `checkOneSongTag` — so
   * an ordinary medley entry can require two separate tags, one per song.
   * @param {Section[]}   detailSections - Result of parseDetailSetlist(doc).
   * @param {Set<string>} actualTags     - Lowercase tags present on the page.
   * @returns {{song: string, matchedTag: string|null, method: 'exact'|'alias'|'override'|'combination'|null}[]}
   */
  function checkSetlistSongTags(detailSections, actualTags) {
    const uniqueRaw = [...new Set(detailSections.flatMap(s => s.songs))];
    const results = [];
    const seenIndividual = new Set();
    for (const raw of uniqueRaw) {
      const comboTag = SONG_COMBINATION_TAG_OVERRIDES[raw.toLowerCase().trim()];
      if (comboTag !== undefined) {
        results.push({ song: raw, matchedTag: isTagPresent(comboTag, actualTags) ? comboTag : null, method: 'combination' });
        continue;
      }
      for (const part of raw.split(/\s+-\s+/)) {
        if (seenIndividual.has(part)) continue;
        seenIndividual.add(part);
        results.push(checkOneSongTag(part, actualTags));
      }
    }
    return results;
  }

  /**
   * Checks the SONG page's exact-title-slug tag — a hard requirement, unlike
   * the alias recognition below. E.g. "BORN TO RUN" -> "borntorun" must be
   * present among the page's tags.
   * @param {string}      songName   - Text from the song page's #page-title.
   * @param {Set<string>} actualTags - Lowercase tags present on the page.
   * @returns {{tag: string, matchedTag: string|null}}
   */
  function checkSongExactTitleTag(songName, actualTags) {
    const tag = songTagSlug(songName);
    return { tag, matchedTag: (tag && isTagPresent(tag, actualTags)) ? tag : null };
  }

  /**
   * Recognizes (but does not require) one additional SONG-page tag
   * convention: the derived first-letter-per-word alias (computeSongTagAlias)
   * — e.g. "BORN TO RUN" -> "btr". Not a hard requirement — real SONG pages
   * sometimes carry only the exact-title tag, or neither — so this never
   * contributes to a missing-tag list; it only reports whether the alias
   * happens to already be present, for green "recognized" marking.
   * @param {string}      songName   - Text from the song page's #page-title.
   * @param {Set<string>} actualTags - Lowercase tags present on the page.
   * @param {string}      exactTag   - The exact-title tag (from checkSongExactTitleTag), to avoid duplicate reporting when they're equal.
   * @returns {{tag: string, matchedTag: string|null}|null} null when the alias equals the exact-title tag.
   */
  function checkSongAliasTagRecognition(songName, actualTags, exactTag) {
    const aliasTag = computeSongTagAlias(songName);
    if (!aliasTag || aliasTag === exactTag) return null;
    return { tag: aliasTag, matchedTag: isTagPresent(aliasTag, actualTags) ? aliasTag : null };
  }

  /**
   * Slugifies a venue/city/state name into BruceBase's tag convention: drop a
   * leading/trailing "The"/"Le"/"De" article, lowercase, strip accents,
   * delete every non-alphanumeric character (no acronym — unlike
   * computeSongTagAlias).
   * @param {string} str
   * @returns {string} e.g. "West Long Branch" -> "westlongbranch", "Adelphi (The)" -> "adelphi".
   */
  function toLocationTagSlug(str) {
    const stripped = str.trim()
      .replace(/^(the|le|de)\s+/i, '')
      .replace(/\s*\((?:the|le|de)\)\s*$/i, '');
    return stripDiacritics(stripped).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /**
   * Turns already-comma-split, trimmed title parts into location components.
   * Handles both the 3-part (no venue detail) and 4-part (with detail) shape.
   * @param {string[]} parts - e.g. ["Pollak Theatre","Monmouth University","West Long Branch","NJ"].
   * @returns {{venueName: string, venueDetail: string|null, city: string, stateAbbr: string|null, country: string|null}|null}
   */
  function parseLocationParts(parts) {
    if (parts.length < 3) return null;
    const last     = parts[parts.length - 1];
    const abbrM    = last.match(/^([A-Z]{2})$/);
    const stateAbbr = abbrM && (US_STATE_NAMES[abbrM[1]] || CA_PROVINCE_NAMES[abbrM[1]]) ? abbrM[1] : null;
    const country   = stateAbbr ? null : last;
    const city       = parts[parts.length - 2];
    const venueName  = parts[0];
    const venueDetail = parts.length >= 4 ? parts.slice(1, -2).join(', ') : null;
    return { venueName, venueDetail, city, stateAbbr, country };
  }

  /**
   * Parses a DETAIL page's event-name title into its location components.
   * Strips a trailing "(Early)"/"(Late)"/"(Afternoon)"/"(Evening)"
   * disambiguation suffix (used for multiple same-day shows, e.g. "…,
   * Asbury Park, NJ (Late)") first — otherwise it glues onto the state
   * abbreviation as its own comma-part's tail ("NJ (Late)"), breaking
   * parseLocationParts's exact 2-letter state-abbreviation match and
   * leaving the state/country tags unchecked.
   * @param {string} pageTitle - e.g. "2026-04-18 Pollak Theatre, Monmouth University, West Long Branch, NJ".
   * @returns {ReturnType<typeof parseLocationParts>}
   */
  function parseEventNameLocation(pageTitle) {
    const m = pageTitle.trim().match(/^\d{4}-\d{2}-\d{2}\s+(.+)$/);
    if (!m) return null;
    const withoutSuffix = m[1].replace(/\s*\((?:Early|Late|Afternoon|Evening)\)\s*$/i, '');
    return parseLocationParts(withoutSuffix.split(',').map(s => s.trim()).filter(Boolean));
  }

  /**
   * Parses a VENUE page's own title into its location components. Unlike
   * parseEventNameLocation, there is no date prefix and no venue-detail
   * segment ever appears — always exactly venueName, city, state/country.
   * @param {string} venueTitle - e.g. "Pollak Theatre, West Long Branch, NJ".
   * @returns {ReturnType<typeof parseLocationParts>}
   */
  function parseVenuePageLocation(venueTitle) {
    return parseLocationParts(venueTitle.trim().split(',').map(s => s.trim()).filter(Boolean));
  }

  /**
   * Detects whether a DETAIL page's venue-part-of-title differs from the
   * actual VENUE page title only by some extra descriptive text that's
   * expected to legitimately differ, not a real mismatch. Two cases:
   *
   * 1. A trailing show-variant suffix — "(Early)"/"(Late)"/"(Afternoon)"/
   *    "(Evening)" — used to disambiguate multiple same-day shows (e.g.
   *    "D'Scene, South Amboy, NJ (Late)" vs. the venue page's own "D'Scene,
   *    South Amboy, NJ"). VENUE page titles never carry this suffix.
   * 2. An extra descriptive "venue detail" segment inserted between the
   *    venue name and city/state/country — e.g. "University Of Michigan"
   *    in "Crisler Arena, University Of Michigan, Ann Arbor, MI" vs. the
   *    venue page's own "Crisler Arena, Ann Arbor, MI". Reuses
   *    parseLocationParts's venueDetail extraction so this stays in
   *    lock-step with the venue-detail tag check (checkParsedLocationTags)
   *    — same derivation, same value.
   * @param {string} venueName       VENUE page's own #page-title text.
   * @param {string} detailVenuePart Venue portion of the DETAIL page's title.
   * @returns {string|null} The extra text found (the suffix or the venue-detail
   *   segment), else null.
   */
  function findVenueDetailExtra(venueName, detailVenuePart) {
    const suffixM = detailVenuePart.match(/\s*(\((?:Early|Late|Afternoon|Evening)\))\s*$/i);
    if (suffixM) {
      const withoutSuffix = detailVenuePart.slice(0, suffixM.index).trim();
      if (withoutSuffix === venueName) return suffixM[1];
    }

    const loc = parseLocationParts(detailVenuePart.split(',').map(s => s.trim()).filter(Boolean));
    if (!loc || !loc.venueDetail) return null;
    const tail = loc.stateAbbr || loc.country;
    if (!tail) return null;
    const withoutDetail = `${loc.venueName}, ${loc.city}, ${tail}`;
    return withoutDetail === venueName ? loc.venueDetail : null;
  }

  /**
   * Checks a single venue/detail/city name against its expected tag, honoring
   * VENUE_TAG_ALIAS_OVERRIDES (including explicit `null` = "not expected").
   * When `cityHint` is given and `name` begins with it (e.g. venue "Ocean
   * Grove Youth Temple" in city "Ocean Grove"), and the plain full-name slug
   * isn't found, also tries the slug of just the remainder after the city
   * prefix ("youthtemple") — BruceBase sometimes only tags the venue-specific
   * part since the city itself already has its own tag.
   * @param {string}      label      - Human-readable field name, e.g. "Venue".
   * @param {string}      name       - Raw name text, e.g. "West Long Branch".
   * @param {Set<string>} actualTags - Lowercase tags present on the page.
   * @param {string|null} [cityHint] - City name to strip as a leading prefix, if present.
   * @returns {{label: string, candidateTag: string, matchedTag: string|null, method: string|null}|null} null if suppressed by an override.
   */
  function checkLocationNameTag(label, name, actualTags, cityHint = null) {
    const key = name.toLowerCase().trim();
    if (Object.prototype.hasOwnProperty.call(VENUE_TAG_ALIAS_OVERRIDES, key)) {
      const override = VENUE_TAG_ALIAS_OVERRIDES[key];
      if (override === null) return null; // explicitly not expected
      return { label: `${label}: ${name}`, candidateTag: override, matchedTag: isTagPresent(override, actualTags) ? override : null, method: 'override' };
    }
    const slug = toLocationTagSlug(name);
    if (isTagPresent(slug, actualTags)) {
      return { label: `${label}: ${name}`, candidateTag: slug, matchedTag: slug, method: 'exact' };
    }
    if (cityHint) {
      const trimmedName = name.trim();
      const cityPrefix  = cityHint.trim();
      if (trimmedName.toLowerCase().startsWith(`${cityPrefix.toLowerCase()} `)) {
        const remainderSlug = toLocationTagSlug(trimmedName.slice(cityPrefix.length).trim());
        if (remainderSlug) {
          return { label: `${label}: ${name}`, candidateTag: remainderSlug, matchedTag: isTagPresent(remainderSlug, actualTags) ? remainderSlug : null, method: 'exact' };
        }
      }
    }
    return { label: `${label}: ${name}`, candidateTag: slug, matchedTag: null, method: slug ? 'exact' : null };
  }

  /**
   * Checks a venue name against its expected tag(s). Handles a descriptive
   * "At The" middle part (e.g. "Blue Cross Arena At The War Memorial") by
   * splitting into two independently-checked names ("Blue Cross Arena" and
   * "War Memorial", each expecting its own tag — "bluecrossarena" and
   * "warmemorial") instead of a single combined-name tag; otherwise falls
   * back to the plain single-name check (including the city-prefix rule).
   * @param {string}      name       - Raw venue name text.
   * @param {string|null} cityHint   - City name, for checkLocationNameTag's city-prefix fallback.
   * @param {Set<string>} actualTags - Lowercase tags present on the page.
   * @returns {{label: string, candidateTag: string, matchedTag: string|null, method: string|null}[]}
   */
  function checkVenueNameTag(name, cityHint, actualTags) {
    const atTheM = name.match(/^(.+?)\s+at\s+the\s+(.+)$/i);
    if (atTheM) {
      return [
        checkLocationNameTag(`Venue part before "At The" in "${name}"`, atTheM[1].trim(), actualTags, cityHint),
        checkLocationNameTag(`Venue part after "At The" in "${name}"`, atTheM[2].trim(), actualTags, cityHint),
      ].filter(Boolean);
    }
    const item = checkLocationNameTag('Venue', name, actualTags, cityHint);
    return item ? [item] : [];
  }

  /**
   * Checks a parsed location (venue, venue detail, city, state/province,
   * country/region) against actualTags. Shared by the DETAIL-page and
   * VENUE-page location checks; mirrors checkSetlistSongTags's result shape.
   * @param {ReturnType<typeof parseLocationParts>} loc
   * @param {Set<string>} actualTags
   * @returns {{label: string, candidateTag: string, matchedTag: string|null, method: string|null}[]}
   */
  function checkParsedLocationTags(loc, actualTags) {
    if (!loc) return [];
    const items = [];
    items.push(...checkVenueNameTag(loc.venueName, loc.city, actualTags));
    if (loc.venueDetail) {
      const detailItem = checkLocationNameTag('Venue detail', loc.venueDetail, actualTags);
      if (detailItem) items.push(detailItem);
    }
    items.push(checkLocationNameTag('City', loc.city, actualTags));

    if (loc.stateAbbr) {
      const isUS      = !!US_STATE_NAMES[loc.stateAbbr];
      const fullName   = isUS ? US_STATE_NAMES[loc.stateAbbr] : CA_PROVINCE_NAMES[loc.stateAbbr];
      const stateTag   = `${toLocationTagSlug(fullName)}(${loc.stateAbbr.toLowerCase()})`;
      items.push({ label: `State: ${loc.stateAbbr}`, candidateTag: stateTag, matchedTag: isTagPresent(stateTag, actualTags) ? stateTag : null, method: 'exact' });
      const countryTag = isUS ? 'usa' : 'canada';
      items.push({ label: `Country: ${isUS ? 'USA' : 'Canada'}`, candidateTag: countryTag, matchedTag: isTagPresent(countryTag, actualTags) ? countryTag : null, method: 'exact' });
    } else if (loc.country) {
      const countryTag = toLocationTagSlug(loc.country);
      items.push({ label: `Country: ${loc.country}`, candidateTag: countryTag, matchedTag: isTagPresent(countryTag, actualTags) ? countryTag : null, method: 'exact' });
      for (const extra of COUNTRY_EXTRA_TAGS[loc.country] || []) {
        items.push({ label: `Region: ${extra}`, candidateTag: extra, matchedTag: isTagPresent(extra, actualTags) ? extra : null, method: 'exact' });
      }
    }
    return items;
  }

  /**
   * Checks that a DETAIL page's event-name title has a corresponding tag for
   * each location component (venue, venue detail, city, state/country).
   * @param {string} pageTitle
   * @param {Set<string>} actualTags
   * @returns {{label: string, matchedTag: string|null, method: string|null}[]}
   */
  function checkEventNameLocationTags(pageTitle, actualTags) {
    return checkParsedLocationTags(parseEventNameLocation(pageTitle), actualTags);
  }

  /**
   * Checks that a VENUE page's own title has a corresponding tag for each
   * location component (venue name, city, state/province, country/region).
   * @param {string} venueTitle
   * @param {Set<string>} actualTags
   * @returns {{label: string, matchedTag: string|null, method: string|null}[]}
   */
  function checkVenuePageLocationTags(venueTitle, actualTags) {
    return checkParsedLocationTags(parseVenuePageLocation(venueTitle), actualTags);
  }

  /**
   * Extracts the single-letter day-suffix from an event type:date-slug href
   * or path, e.g. `"b"` from `"/rehearsal:1976-12-00b-telegraph-hill-
   * studio-holmdel-nj"` or `"rehearsal:1976-12-00b-telegraph-hill-studio-
   * holmdel-nj"`. BruceBase appends this letter (a/b/c/…) to distinguish
   * multiple events on the same day (or same "00" unknown-day month) —
   * see computeExpectedTags. Returns `null` when there's no such suffix.
   * @param {string} hrefOrPath
   * @returns {string|null}
   */
  function extractEventDaySuffix(hrefOrPath) {
    const m = (hrefOrPath || '').match(/^\/?[a-z]+:\d{4}-\d{2}-\d{2}([a-z])(?:-|$)/);
    return m ? m[1] : null;
  }

  // ── Tour association tag check ────────────────────────────────────────────
  // (Springsteen concert tour, e.g. "Land Of Hope And Dreams" — NOT to be
  // confused with the setlist tour-*premiere* check above, a song's live debut.)

  /**
   * Returns every TOUR_DEFINITIONS entry with a date range covering eventDate.
   * Plain string comparison is safe here: eventDate/start/end are always
   * "YYYY-MM-DD", and lexical order matches chronological order for that format.
   * @param {string} eventDate - "YYYY-MM-DD"
   * @returns {typeof TOUR_DEFINITIONS}
   */
  function findMatchingTours(eventDate) {
    return TOUR_DEFINITIONS.filter(t => t.ranges.some(([start, end]) => eventDate >= start && eventDate <= end));
  }

  /**
   * Picks the "most specific" tour among several TOUR_DEFINITIONS entries
   * matching the same date — the one with the smallest total day-span
   * across its own ranges wins, e.g. "Land Of Hope And Dreams - No Kings"
   * (a single ~2-month leg) over the umbrella "Land Of Hope And Dreams"
   * (~4 months combined across its two legs) for a date inside their
   * overlap. A heuristic, not a guarantee — ties (and any case it gets
   * wrong) break toward whichever entry appears first in TOUR_DEFINITIONS;
   * refine here if a future addition to that end-user-extensible table
   * needs a different rule.
   * @param {typeof TOUR_DEFINITIONS} tours
   * @returns {typeof TOUR_DEFINITIONS[0]|null}
   */
  function pickMostSpecificTour(tours) {
    if (tours.length === 0) return null;
    const spanDays = t => t.ranges.reduce((sum, [s, e]) => sum + (Date.parse(e) - Date.parse(s)), 0);
    return tours.reduce((best, t) => spanDays(t) < spanDays(best) ? t : best);
  }

  /**
   * Determines this event's tour tag(s) from its date (see TOUR_DEFINITIONS),
   * resolving to the special TOUR_NO_TAG instead when an event alias (see
   * extractEventAlias) — or a manual TOUR_NO_OVERRIDES entry — indicates the
   * event isn't actually part of the tour(s) that otherwise cover its date
   * (e.g. a one-off charity gig or award ceremony during an otherwise
   * continuous tour). Takes the already-extracted `alias` (rather than a
   * `doc` to extract it from) since every call site already computes it for
   * the existing FUZZY_SUBSTRING_TAGS alias-substring check.
   * @param {string|null} eventDate - "YYYY-MM-DD".
   * @param {string}      eventPath - "type:date-slug" (no leading slash), for TOUR_NO_OVERRIDES lookup.
   * @param {string|null} alias     - Result of extractEventAlias(doc).
   * @returns {{
   *   expectedTags: Set<string>,
   *   isTourNo: boolean,
   *   alias: string|null,
   *   matchedTours: typeof TOUR_DEFINITIONS,
   *   mostSpecificTour: typeof TOUR_DEFINITIONS[0]|null
   * }|null} null when eventDate falls outside every known tour's range — nothing to check.
   */
  function checkEventTourTags(eventDate, eventPath, alias) {
    const matchedTours = findMatchingTours(eventDate || '');
    if (matchedTours.length === 0) return null;

    const override = TOUR_NO_OVERRIDES[eventPath];
    const isTourNo = override !== undefined ? override : !!alias;

    return {
      expectedTags: isTourNo ? new Set([TOUR_NO_TAG]) : new Set(matchedTours.map(t => t.tag)),
      isTourNo,
      alias: isTourNo ? alias : null,
      matchedTours,
      mostSpecificTour: isTourNo ? null : pickMostSpecificTour(matchedTours),
    };
  }

  /**
   * Computes the set of tags expected on a DETAIL page, derived from the
   * event date/type and tab content (Recording, News/Memorabilia, setlist,
   * Storyteller, Eyewitness). Also expects "underconstruction" when doc
   * shows BruceBase's "Under Construction" banner (see hasUnderConstructionBanner),
   * a tour-premiere-count tag (see computeTourPremiereTagValue) matching
   * the number of Setlist tab songs rendered in bold, and — when
   * `tourExpectedTags` is given — the tour association tag(s) it names
   * (see checkEventTourTags).
   * @param {Document}            doc
   * @param {Map<string,number>}  tabMap
   * @param {string|null}         eventDate  - "YYYY-MM-DD" (no day-suffix letter).
   * @param {string}              eventType
   * @param {string|null}         [daySuffix] - Single-letter day-suffix (see
   *   extractEventDaySuffix), e.g. "b" for same-day event #2. When present,
   *   it's always expected as its own tag.
   * @param {boolean}             [hasHelp] - Whether the YEAR page shows a
   *   "Help Us" call-to-action icon for this event (see hasHelpIcon /
   *   eventHasHelpIcon). When true, "help" is always expected as a tag.
   * @param {boolean}             [hasFeatured] - Whether the YEAR page shows
   *   a "Featured" icon for this event (see hasFeaturedIcon /
   *   eventHasFeaturedIcon). When true, "featured" is always expected as a tag.
   * @param {Set<string>|null}    [tourExpectedTags] - Result of
   *   checkEventTourTags(...).expectedTags, precomputed by the caller (same
   *   pattern as hasHelp/hasFeatured) since it needs the event alias/path,
   *   which computeExpectedTags itself doesn't have.
   * @returns {Set<string>}
   */
  function computeExpectedTags(doc, tabMap, eventDate, eventType, daySuffix = null, hasHelp = false, hasFeatured = false, tourExpectedTags = null) {
    const expected = new Set();

    const dm = (eventDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dm) {
      const [, yr, mo, dd] = dm;
      const moNum = parseInt(mo, 10);
      const ddNum = parseInt(dd, 10);
      expected.add(yr);
      if (moNum > 0) expected.add(MONTH_NAMES[moNum - 1]);
      // Always expect the 2-digit day tag, including "00" (unknown day of month).
      expected.add(dd);
      if (ddNum > 0 && moNum > 0) {
        const d = new Date(parseInt(yr, 10), moNum - 1, ddNum);
        if (!isNaN(d.getTime())) expected.add(DAY_NAMES[d.getDay()]);
      }
    }
    if (daySuffix) expected.add(daySuffix);
    if (hasHelp) expected.add('help');
    if (hasFeatured) expected.add('featured');
    if (hasUnderConstructionBanner(doc)) expected.add('underconstruction');

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
      const imgs = [...newsMemTab.querySelectorAll('img')];
      // "memorabilia" requires actual image content, not just the tab being
      // labeled "News/Memorabilia" — a tab with only a text "Links" section
      // (news article links, no images) is news-only, not memorabilia.
      if (tabMap.has('News/Memorabilia') && imgs.length > 0) expected.add('memorabilia');
      if (imgs.some(img => /ticket/i.test(img.src) || /\/(?:files:)?pass/i.test(img.src))) expected.add('ticket');
      const setlistImgs = imgs.filter(img => /setlist/i.test(img.src) && !/ticket/i.test(img.src));
      if (setlistImgs.length > 0) {
        expected.add('setlist');
        if (setlistImgs.some(img => /handwritten/i.test(img.src))) expected.add('handwritten');
        if (setlistImgs.some(img => /printed/i.test(img.src)))     expected.add('printed');
      }
    }

    // Soundcheck section: the standard DETAIL page format is a
    // <p><strong>Soundcheck</strong></p> header (no colon) in the setlist
    // container. Also accept the older "Soundcheck:" text label as a fallback.
    const setlistContainer = getSetlistContainer(doc);
    const pageContent = doc.querySelector('#page-content') || doc.body;
    const hasSoundcheckHeader = setlistContainer
      ? [...setlistContainer.querySelectorAll('p strong')]
          .some(s => /^soundcheck$/i.test(s.textContent.trim()))
      : false;
    if (hasSoundcheckHeader || /\bsoundcheck\s*:/i.test(pageContent.textContent)) {
      expected.add('soundcheck');
    }

    // Rescheduled: the free-text notes preamble mentions "rescheduled from"
    // (e.g. "This show was rescheduled from March 12, 2020.").
    if (/rescheduled\s+from/i.test(extractPageNotesText(doc))) {
      expected.add('rescheduled');
    }

    // Storyteller tab.
    const storytellerTab = getTabEl(doc, tabMap, 'Storyteller');
    if (storytellerTab && !SORRY_RE.test(storytellerTab.textContent.trim())) expected.add('storyteller');

    // Eyewitness tab.
    const eyewitnessTab = getTabEl(doc, tabMap, 'Eyewitness');
    if (eyewitnessTab && !SORRY_RE.test(eyewitnessTab.textContent.trim())) expected.add('eyewitness');

    // Tour-premiere count: number of Setlist tab songs BruceBase renders in
    // bold (its own convention for a song's tour debut). "prem" itself is
    // always expected alongside the count tag whenever there's at least one.
    const premiereCount = countTourPremiereSongs(doc);
    const premiereTag   = computeTourPremiereTagValue(premiereCount);
    if (premiereTag) {
      expected.add(premiereTag);
      expected.add('prem');
    }

    // Tour association: which known Springsteen tour(s) this event's date
    // falls within (or the tour_no exception) — see checkEventTourTags.
    if (tourExpectedTags) for (const t of tourExpectedTags) expected.add(t);

    return expected;
  }

  /**
   * Counts songs rendered in bold (`<strong>`) within a DETAIL page's Setlist
   * tab — BruceBase's own convention for flagging a song's tour debut ("tour
   * premiere"). Scoped to the setlist container (see getSetlistContainer) so
   * unrelated bold text elsewhere on the page (e.g. a Storyteller quote) is
   * never counted.
   * @param {Document} doc
   * @returns {number}
   */
  function countTourPremiereSongs(doc) {
    const container = getSetlistContainer(doc);
    if (!container) return 0;
    return container.querySelectorAll('strong a[href^="/song:"]').length;
  }

  /**
   * Converts a tour-premiere song count into BruceBase's tag-value
   * convention (see TOUR_PREMIERE_TAG_VALUES): bare "1".."9" for 1-9
   * premieres, "9+" for more than 9. Returns null when there are no
   * premieres at all — no count tag is expected in that case.
   * @param {number} count
   * @returns {string|null}
   */
  function computeTourPremiereTagValue(count) {
    if (count <= 0) return null;
    return count <= 9 ? String(count) : '9+';
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
   * @param {string|null}        [venueDetailExtra] - Non-null when the venue check found
   *   this event's venue-detail segment (e.g. "University Of Michigan") is the only
   *   difference from the VENUE page title (see findVenueDetailExtra) — suppresses the
   *   corresponding "Venue detail" entry from the missing-tag report below, since it's
   *   informational rather than a genuinely expected tag.
   */
  function addTagsButton(doc, tabMap, section, eventLink, onstageResult = null, venueDetailExtra = null) {
    const tagsEl = doc.querySelector('.page-tags');
    if (!tagsEl) return;
    const tagLinks = [...tagsEl.querySelectorAll('a[href]')];
    if (tagLinks.length === 0) return;

    const href      = eventLink.getAttribute('href') || '';
    const typeM     = href.match(/^\/([a-z]+):/);
    const eventType = typeM ? typeM[1] : '';
    const dateM     = eventLink.textContent.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    const eventDate = dateM ? dateM[1] : null;
    const daySuffix = extractEventDaySuffix(href);
    // Checks both the YEAR page's own per-event block AND the DETAIL page's
    // content — BruceBase shows this icon in either place: the YEAR-page
    // boilerplate "please get in touch" note for undocumented events, OR a
    // tab-specific note on the DETAIL page itself (e.g. "Complete lineup of
    // performers is not known" inside the "On Stage" tab).
    const hasHelp     = hasHelpIcon(section) || hasHelpIcon(doc);
    const hasFeatured = hasFeaturedIcon(section) || hasFeaturedIcon(doc);

    const actualTags   = new Set(tagLinks.map(a => a.textContent.trim().toLowerCase()));

    // Merge in tags found on the "onstage:" companion page so the panel
    // shows ALL tags for this event, not just the ones on this page.
    const onstageAdditionalTags = onstageResult
      ? [...onstageResult.tags].filter(t => !actualTags.has(t))
      : [];
    for (const t of onstageAdditionalTags) actualTags.add(t);

    // Tour association: which known Springsteen tour(s) (if any) this
    // event's date falls within, or the tour_no exception — see
    // checkEventTourTags. eventAlias is reused below for the fuzzy
    // substring alias check, so it's extracted once, here.
    const eventAlias = extractEventAlias(doc);
    const eventPath  = href.replace(/^\//, '');
    const tourCheck  = checkEventTourTags(eventDate, eventPath, eventAlias);

    const expectedTags = computeExpectedTags(doc, tabMap, eventDate, eventType, daySuffix, hasHelp, hasFeatured, tourCheck?.expectedTags);
    const missingTags  = [...expectedTags].filter(t => !isTagPresent(t, actualTags)).sort();

    // Setlist song → tag check: every song in the Setlist tab should have a
    // corresponding tag (exact match, derived alias, or manual override).
    const songResults      = checkSetlistSongTags(parseDetailSetlist(doc), actualTags);
    const matchedSongsByTag = new Map(songResults.filter(r => r.matchedTag).map(r => [r.matchedTag, r]));
    const unmatchedSongs    = songResults.filter(r => !r.matchedTag);
    const songMethodLabel   = { exact: 'exact match', alias: 'derived alias', override: 'manual override', combination: 'song combination override' };

    // Event-name → tag check: venue/city/state/country parts of the page
    // title should each have a corresponding tag (exact match or manual override).
    const rawEventName          = extractDetailEventName(doc, href);
    const locationResults       = checkEventNameLocationTags(rawEventName, actualTags);
    const matchedLocationsByTag = new Map(locationResults.filter(r => r.matchedTag).map(r => [r.matchedTag, r]));
    const unmatchedLocations    = locationResults.filter(r =>
      !r.matchedTag && !(venueDetailExtra && r.label === `Venue detail: ${venueDetailExtra}`)
    );

    // "On Stage"/"In Studio"/"On Audio" tab → relation tag check: the tab's
    // fixed tag (if any — "onstage"/"studio") plus every relation name
    // listed there should each have a corresponding tag.
    const relationResults       = checkOnStageRelationTags(doc, tabMap, actualTags, eventType);
    const matchedRelationsByTag = new Map(relationResults.filter(r => r.matchedTag).map(r => [r.matchedTag, r]));
    const unmatchedRelations    = relationResults.filter(r => !r.matchedTag);

    // Alias-substring tag check: generic tags (FUZZY_SUBSTRING_TAGS) that are
    // present AND a case-insensitive substring of the event alias (e.g.
    // "grammy" matched by "68th Annual Grammy Awards Ceremony") are verified.
    const aliasResults         = checkAliasSubstringTags(eventAlias, actualTags);
    const matchedAliasByTag    = new Map(aliasResults.map(r => [r.tag, r]));

    // Notes-substring tag check: same FUZZY_SUBSTRING_TAGS table, checked
    // against the fetched DETAIL page's free-text notes preamble instead of
    // its alias (e.g. "benefit" matched by a notes paragraph mentioning
    // "...Light Of Day Benefit."). Mirrors annotateDetailPageTags's
    // notesResults check, previously missing here entirely — without it, a
    // tag only verifiable via notes text (not the alias) was never
    // recognized as passing on the YEAR page.
    const notesResults      = checkNotesSubstringTags(extractPageNotesText(doc), actualTags);
    const matchedNotesByTag = new Map(notesResults.map(r => [r.tag, r]));

    // Merge existing tag links (with spurious/passing flag) + missing placeholders → sorted.
    const existingItems = tagLinks.map(a => {
      const tag         = a.textContent.trim().toLowerCase();
      const songMatch     = matchedSongsByTag.get(tag);
      const locationMatch = matchedLocationsByTag.get(tag);
      const relationMatch = matchedRelationsByTag.get(tag);
      const aliasMatch  = matchedAliasByTag.get(tag);
      const notesMatch  = matchedNotesByTag.get(tag);
      const spurious    = isManagedTag(tag) && !isTagPresent(tag, expectedTags) && !relationMatch;
      const passing     = (isManagedTag(tag) && isTagPresent(tag, expectedTags)) || !!songMatch || !!locationMatch || !!relationMatch || !!aliasMatch || !!notesMatch;
      if (passing) {
        a.style.color = '#2a2';
        a.style.fontWeight = 'bold';
        a.title = songMatch
          ? `Tag "${tag}" verified: matches setlist song "${songMatch.song}" (${songMethodLabel[songMatch.method]})`
          : locationMatch
          ? `Tag "${tag}" verified: matches event ${locationMatch.label}`
          : relationMatch
          ? `Tag "${tag}" verified: ${relationMatch.label} — ${relationMethodLabel(relationMatch.method, relationMatch.tabLabel)}`
          : aliasMatch
          ? `Tag "${tag}" verified: ${aliasMatch.label}`
          : notesMatch
          ? `Tag "${tag}" verified: ${notesMatch.label}`
          : passingTagMsg(tag, expectedTags, tourCheck);
      }
      return { tag, html: a.outerHTML, missing: false, spurious, tooltip: spurious ? spuriousTagMsg(tag, expectedTags, tourCheck) : '' };
    });
    const missingItems = [
      ...missingTags.map(tag => ({ tag, html: null, missing: true, spurious: false, tooltip: '' })),
      ...unmatchedSongs.map(r => {
        if (r.method === 'combination') {
          const candidate = SONG_COMBINATION_TAG_OVERRIDES[r.song.toLowerCase().trim()];
          return { tag: candidate, html: null, missing: true, spurious: false,
            tooltip: `No tag found for setlist song combination "${r.song}" (expected SONG_COMBINATION_TAG_OVERRIDES tag "${candidate}")` };
        }
        const candidate = computeSongTagAlias(r.song) || songTagSlug(r.song);
        return { tag: candidate, html: null, missing: true, spurious: false,
          tooltip: `No tag found for setlist song "${r.song}" (tried exact match and derived alias "${candidate}")` };
      }),
      ...unmatchedLocations.map(r => ({ tag: r.candidateTag, html: null, missing: true, spurious: false,
        tooltip: `No tag found for ${r.label}` })),
      ...unmatchedRelations.map(r => ({ tag: r.candidateTag, html: null, missing: true, spurious: false,
        tooltip: `No tag found for ${r.label}` })),
    ];
    // Onstage-companion tags: present (just not on this page), so rendered
    // like an existing tag link rather than a missing/spurious one. When one
    // ALSO matches a song/location/relation check, render it green (bb-tag-ok)
    // with that verification tooltip instead of the plain "found on companion
    // page" one — otherwise a relation like "stevenvanzandt" that only exists
    // via the companion page would never show as verified in this panel.
    const onstageItems = onstageAdditionalTags.map(tag => {
      const songMatch     = matchedSongsByTag.get(tag);
      const locationMatch = matchedLocationsByTag.get(tag);
      const relationMatch = matchedRelationsByTag.get(tag);
      if (songMatch || locationMatch || relationMatch) {
        const title = songMatch
          ? `Tag "${tag}" verified: matches setlist song "${songMatch.song}" (${songMethodLabel[songMatch.method]})`
          : locationMatch
          ? `Tag "${tag}" verified: matches event ${locationMatch.label}`
          : `Tag "${tag}" verified: ${relationMatch.label} — ${relationMethodLabel(relationMatch.method, relationMatch.tabLabel)}`;
        return { tag, html: `<a href="/system:page-tags/tag/${esc(tag)}#pages" class="bb-tag-onstage bb-tag-ok" style="color:#2a2; font-weight:bold; cursor:help;" title="${esc(title)}">${esc(tag)}</a>`,
          missing: false, spurious: false, tooltip: '' };
      }
      return { tag, html: `<a href="/system:page-tags/tag/${esc(tag)}#pages" class="bb-tag-onstage" title="${esc(`Tag "${tag}" found on the companion "On Stage" page (${onstageResult.url})`)}">${esc(tag)}</a>`,
        missing: false, spurious: false, tooltip: '' };
    });

    // Tag-source-highlight (bbp_enable_tag_source_highlight): live-DOM
    // counterpart to annotateDetailPageTags's highlightOn block (see
    // doc/TAGS.md), resolving each verified tag's on-page source against
    // THIS event's own live YEAR-page elements (eventLink/section) instead
    // of the fetched `doc`. Built lazily by buildYearTagSourceMap() below,
    // called at first panel-open time rather than here — addTagsButton runs
    // from wireIconHandlers, which processOneYearEvent calls BEFORE
    // renderYearSetlist/injectEventRelations render the setlist/relation
    // blocks into `section`, so building this map eagerly here would find
    // no setlist/relation elements yet. By the time a user can actually
    // click the button, that event's whole processing pipeline has long
    // finished, so section/eventLink are guaranteed fully rendered.
    const highlightOn = Lib.settings.bbp_enable_tag_source_highlight;

    /**
     * Builds the tag -> Element|Element[] source map for this event's Tags
     * panel (see the highlightOn comment above for why this runs lazily).
     * Wrapped in try/catch by the caller — a resolution failure here must
     * never break the Tags button itself.
     */
    function buildYearTagSourceMap() {
      const tagSourceMap = new Map();

      const songAnchorByName = new Map([...section.querySelectorAll('[data-detail-song]')]
        .map(el => [el.dataset.detailSong.toLowerCase(), el]));

      // .bb-rel-name appears twice per relation (visible .bb-relations-flat
      // + hidden .bb-relations-list), so collect into arrays — both get
      // boxed on hover, same as wireTagSourceHighlight's multi-source support.
      const relationElByName = new Map();
      const guestElByName    = new Map();
      for (const a of section.querySelectorAll('.bb-rel-name')) {
        const name = a.textContent.trim().toLowerCase();
        if (!relationElByName.has(name)) relationElByName.set(name, []);
        relationElByName.get(name).push(a);
        if (a.nextElementSibling?.classList.contains('bb-rel-extra')) {
          if (!guestElByName.has(name)) guestElByName.set(name, []);
          guestElByName.get(name).push(a.nextElementSibling);
        }
      }

      const dateSpan = wrapTextSubstring(eventLink, eventDate);
      let dateTagMap = null;
      if (dateSpan) {
        const [yr, mo, dd] = eventDate.split('-');
        const yearSpan  = wrapTextSubstring(dateSpan, yr);
        const monthSpan = wrapTextSubstring(dateSpan, mo);
        const daySpan   = wrapTextSubstring(dateSpan, dd);
        dateTagMap = new Map();
        dateTagMap.set(yr, yearSpan || dateSpan);
        const moNum = parseInt(mo, 10);
        if (moNum >= 1 && moNum <= 12) dateTagMap.set(MONTH_NAMES[moNum - 1], monthSpan || dateSpan);
        dateTagMap.set(dd, daySpan || dateSpan);
      }

      // Venue/city/state/country substrings: wrapped within eventLink's own
      // (untouched-until-now) text — parsed from eventLink's OWN text
      // (yearRawName), not rawEventName (the DETAIL page's title used for
      // the tag-check above): the YEAR page renders its own event link in
      // ALL CAPS with a "- " separator between date and venue (e.g.
      // "2016-01-00 - EXPO THEATER, FORT MONMOUTH, NJ"), neither of which
      // match rawEventName's DETAIL-style "date, then a single space, then
      // Title Case venue" format (e.g. "2016-01-00 Expo Theater, Fort
      // Monmouth, NJ") — parseEventNameLocation's regex requires the latter,
      // so reusing rawEventName here would find nothing to wrap. matchedTag
      // lookups above stay anchored to rawEventName/DETAIL truth; only the
      // highlight SOURCE is re-derived against what's actually on this page.
      let venueLoc = null, venueStringSpan = null;
      const yearRawName = eventLink.textContent.trim();
      const venueM = yearRawName.match(/^\d{4}-\d{2}-\d{2}\s*-?\s*(.+)$/);
      if (venueM) {
        const withoutSuffix = venueM[1].replace(/\s*\((?:Early|Late|Afternoon|Evening)\)\s*$/i, '');
        venueLoc = parseLocationParts(withoutSuffix.split(',').map(s => s.trim()).filter(Boolean));
        venueStringSpan = wrapTextSubstring(eventLink, venueM[1]);
      }

      const eventTypeEl = section.querySelector('.bb-event-type');
      const tourNameEl  = section.querySelector('.bb-year-tour-name');
      const aliasEl     = section.querySelector('.bb-event-alias');
      const helpIconEl  = section.querySelector('img.image[title="Help Us"]');
      // Soundcheck section label: renderSetlistElement renders one
      // <span class="bb-section-label"> per setlist section (e.g.
      // "Show:"/"Soundcheck:"/"Recording:"), so filter by text rather than
      // just taking the first one found.
      const soundcheckEl = [...section.querySelectorAll('.bb-section-label')]
        .find(s => /^soundcheck/i.test(s.textContent.trim())) || null;
      // Every setlist song this event's diff-merge marked as a tour premiere
      // (renderSetlistElement/renderMatchWithConnectives sets
      // data-year-premiere="1" on the song's own name element).
      const premiereEls = [...section.querySelectorAll('[data-year-premiere="1"]')];

      for (const [tag, r] of matchedSongsByTag) {
        const src = songAnchorByName.get(r.song.toLowerCase());
        if (src) tagSourceMap.set(tag, src);
      }
      for (const [tag, r] of matchedLocationsByTag) {
        if (!venueStringSpan) continue;
        const src = resolveLocationSourceEl(r, venueLoc, venueStringSpan, venueStringSpan);
        if (src) tagSourceMap.set(tag, src);
      }
      for (const [tag, r] of matchedRelationsByTag) {
        const nameMap = r.method === 'guest' ? guestElByName : relationElByName;
        const src = r.names.flatMap(n => nameMap.get(n.toLowerCase()) || []);
        if (src.length) tagSourceMap.set(tag, src);
      }
      for (const [tag, r] of matchedAliasByTag) {
        const src = aliasEl ? wrapFuzzyMatchSubstring(aliasEl, r.matched) : null;
        if (src) tagSourceMap.set(tag, src);
      }
      for (const [tag, r] of matchedNotesByTag) {
        const src = wrapFuzzyMatchSubstring(findYearEventNotesSourceElements(section, r.matched)[0], r.matched);
        if (src) tagSourceMap.set(tag, src);
      }

      // Generic managed tags (date/weekday/event-type/tour): gated on
      // isManagedTag+isTagPresent(expectedTags), same predicate
      // existingItems uses for its "passing" flag, so a spurious tag that
      // happens to equal e.g. a weekday name never gets wired as if verified.
      if (eventTypeEl) {
        const t = eventType.toLowerCase();
        if (isManagedTag(t) && isTagPresent(t, expectedTags)) tagSourceMap.set(t, eventTypeEl);
      }
      if (dateTagMap) {
        for (const [t, el] of dateTagMap) {
          if (isManagedTag(t) && isTagPresent(t, expectedTags)) tagSourceMap.set(t, el);
        }
      }
      if (dateSpan) {
        for (const day of DAY_NAMES) {
          if (isManagedTag(day) && isTagPresent(day, expectedTags)) tagSourceMap.set(day, dateSpan);
        }
      }
      if (tourNameEl && tourCheck && !tourCheck.isTourNo) {
        for (const t of tourCheck.expectedTags) {
          if (TOUR_TAG_SET.has(t) && isManagedTag(t) && isTagPresent(t, expectedTags)) tagSourceMap.set(t, tourNameEl);
        }
      }
      if (soundcheckEl && isManagedTag('soundcheck') && isTagPresent('soundcheck', expectedTags)) {
        tagSourceMap.set('soundcheck', soundcheckEl);
      }
      // "prem" + whichever bare-number/"9+" tag matches the actual premiere
      // count (TOUR_PREMIERE_TAG_VALUES) both point at the same set of
      // premiere song elements — day-of-month tags never collide with these
      // since BruceBase always zero-pads the day tag ("03") while premiere
      // counts are always bare ("3").
      if (premiereEls.length) {
        for (const t of ['prem', ...TOUR_PREMIERE_TAG_VALUES]) {
          if (isManagedTag(t) && isTagPresent(t, expectedTags)) tagSourceMap.set(t, premiereEls);
        }
      }
      // "help" tag: the native "Help Us" call-to-action <img> BruceBase
      // itself renders on the YEAR page for undocumented events (same
      // element hasHelpIcon(section) already checks for). No live source
      // when the icon only exists on the fetched DETAIL page instead (see
      // addTagsButton's hasHelp = hasHelpIcon(section) || hasHelpIcon(doc)).
      if (helpIconEl && isManagedTag('help') && isTagPresent('help', expectedTags)) {
        tagSourceMap.set('help', helpIconEl);
      }
      return tagSourceMap;
    }

    const allItems = [...existingItems, ...onstageItems, ...missingItems].sort((a, b) => a.tag.localeCompare(b.tag));

    const spuriousCount = existingItems.filter(i => i.spurious).length;
    const totalMissing  = missingTags.length + unmatchedSongs.length + unmatchedLocations.length + unmatchedRelations.length;
    const issueParts = [];
    if (totalMissing > 0)  issueParts.push(`${totalMissing} missing`);
    if (spuriousCount > 0) issueParts.push(`${spuriousCount} spurious`);

    let html = '';
    if (totalMissing > 0) {
      html += '<p style="color:red; font-weight:bold; margin:0 0 6px 0">⚠️ Missing expected tags:</p>';
    }
    html += '<ol class="bb-tags-list" style="margin:4px 0; padding-left:18px;">';
    for (const item of allItems) {
      if (item.missing) {
        const style     = `color:red; font-weight:bold${item.tooltip ? '; cursor:help' : ''}`;
        const titleAttr = item.tooltip ? ` title="${esc(item.tooltip)}"` : '';
        html += `<li style="${style}"${titleAttr}>⚠️ ${esc(item.tag)}</li>`;
      } else if (item.spurious) {
        html += `<li>${item.html} <span style="color:darkorange; font-weight:bold; cursor:help" title="${esc(item.tooltip)}">⚠️</span></li>`;
      } else {
        html += `<li>${item.html}</li>`;
      }
    }
    html += '</ol>';

    const content = { type: 'html', caption: `${rawEventName} Tags`, html };
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
      : 'All tags verified — click to expand/collapse the Tags panel';
    if (issueParts.length > 0) btn.dataset.msg = `Tag issues: ${issueParts.join(', ')}`;
    if (totalMissing > 0)            btn.style.color = 'red';
    else if (spuriousCount > 0)      btn.style.color = 'darkorange';
    else                             btn.style.color = '#2a2';

    btn.addEventListener('click', () => {
      if (!btn._bbPanel) {
        btn._bbPanel = buildIconPanel(content);
        btn._bbPanel._bbIcon = btn;
        section.appendChild(btn._bbPanel);
        if (highlightOn) {
          try {
            const tagSourceMap = buildYearTagSourceMap();
            for (const a of btn._bbPanel.querySelectorAll('.bb-tags-list a')) {
              const source = tagSourceMap.get(a.textContent.trim().toLowerCase());
              if (source) wireTagSourceHighlight(a, source);
            }
          } catch (e) {
            logErr('addTagsButton/tag-source-highlight wiring', e);
          }
        }
      }
      const open = btn._bbPanel.style.display !== 'none';
      btn._bbPanel.style.display = open ? 'none' : '';
      btn.classList.toggle('bb-icon-active', !open);
    });

    row.appendChild(btn);
  }

  /**
   * Returns the set of lowercase tags expected for a venue page.
   * Currently: "venue" (always), the first letter of the venue name, and
   * "underconstruction" when the page shows BruceBase's "Under
   * Construction" banner (see hasUnderConstructionBanner).
   * Location tags (venue name/city/state/country slugs) are checked
   * separately via checkVenuePageLocationTags — see annotateVenuePageTags
   * / addVenueTagsButton.
   * @param {string}   venueName  - Text from the venue page's #page-title.
   * @param {Document} [doc=document] - Defaults to the live document; pass
   *   a fetched venueDoc for the YEAR page's nested "Tags" button.
   * @returns {Set<string>}
   */
  function computeExpectedVenueTags(venueName, doc = document) {
    const expected = new Set(['venue']);
    const first = (venueName || '').trim()[0];
    if (first && /[a-z]/i.test(first)) expected.add(first.toLowerCase());
    if (hasUnderConstructionBanner(doc)) expected.add('underconstruction');
    return expected;
  }

  /**
   * Returns true for venue-page tags whose presence can be verified:
   * the "venue" tag, "underconstruction", and single lowercase letter
   * tags (first-letter index).
   * @param {string} tag
   * @returns {boolean}
   */
  function isManagedVenueTag(tag) {
    return tag === 'venue' || tag === 'underconstruction' || /^[a-z]$/.test(tag);
  }

  /**
   * Extracts the free-text preamble from a fetched page's #page-content —
   * all direct children before the first .yui-navset, with relative hrefs
   * absolutised and <script> tags stripped.
   * @param {Document} doc
   * @returns {string|null}  HTML string, or null when the preamble is empty.
   */
  function extractPageNotes(doc) {
    const pageContent = doc.querySelector('#page-content');
    if (!pageContent) return null;
    const wrapper = document.createElement('div');
    for (const child of pageContent.children) {
      if (child.classList.contains('yui-navset')) break;
      const cl = child.cloneNode(true);
      cl.querySelectorAll('script').forEach(s => s.remove());
      wrapper.appendChild(cl);
    }
    if (!wrapper.textContent.trim()) return null;
    return wrapper.innerHTML
      .replace(/href="\//g, `href="${location.protocol}//${location.host}/`);
  }

  /**
   * Plain-text version of extractPageNotes, for fuzzy substring matching
   * (see checkNotesSubstringTags) rather than display.
   * @param {Document} doc
   * @returns {string} '' when there's no notes preamble.
   */
  function extractPageNotesText(doc) {
    const html = extractPageNotes(doc);
    if (!html) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || '';
  }

  /**
   * Builds a "Notes" toggle button that opens a panel with the preamble content
   * from extractPageNotes. Returns null when the preamble is empty.
   * @param {Document}    doc      - Parsed page document.
   * @param {string}      caption  - Panel header (e.g. "Venue: Notes").
   * @param {string}      btnClass - CSS class for the button.
   * @param {HTMLElement} section  - .bb-section-processed container (panel host).
   * @returns {HTMLButtonElement|null}
   */
  function buildNotesButton(doc, caption, btnClass, section) {
    const notesHtml = extractPageNotes(doc);
    if (!notesHtml) return null;
    const content = { type: 'html', caption, html: notesHtml };
    const btn = document.createElement('button');
    btn.className = btnClass;
    btn.textContent = 'Notes';
    btn.title = 'Page introduction — click to expand/collapse';
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
    return btn;
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

    const venueNotesBtn = buildNotesButton(venueDoc, 'Venue: Notes', 'bb-venue-tab-btn', section);
    if (venueNotesBtn) row.appendChild(venueNotesBtn);

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
    const expectedTags = computeExpectedVenueTags(venueName, venueDoc);
    const missingTags  = [...expectedTags].filter(t => !actualTags.has(t)).sort();

    // Venue-name → tag check: venue/city/state/country parts of the venue
    // page's own title should each have a corresponding tag.
    const locationResults       = checkVenuePageLocationTags(venueName, actualTags);
    const matchedLocationsByTag = new Map(locationResults.filter(r => r.matchedTag).map(r => [r.matchedTag, r]));
    const unmatchedLocations    = locationResults.filter(r => !r.matchedTag);

    const existingItems = tagLinks.map(a => {
      const tag           = a.textContent.trim().toLowerCase();
      const locationMatch = matchedLocationsByTag.get(tag);
      const spurious = isManagedVenueTag(tag) && !expectedTags.has(tag);
      const passing  = (isManagedVenueTag(tag) && expectedTags.has(tag)) || !!locationMatch;
      const tooltip  = spurious ? `Tag "${tag}" is present but not expected for this venue` : '';
      if (passing) {
        a.style.color = '#2a2';
        a.style.fontWeight = 'bold';
        a.title = locationMatch
          ? `Tag "${tag}" verified: matches venue ${locationMatch.label}`
          : tag === 'venue'
          ? 'Tag "venue" verified: this is a venue page'
          : `Tag "${tag}" verified: matches the first letter of venue name "${venueName}"`;
      }
      return { tag, html: a.outerHTML, missing: false, spurious, tooltip };
    });
    const missingItems = [
      ...missingTags.map(tag => ({ tag, html: null, missing: true, spurious: false, tooltip: '' })),
      ...unmatchedLocations.map(r => ({ tag: r.candidateTag, html: null, missing: true, spurious: false,
        tooltip: `No tag found for ${r.label}` })),
    ];
    const allItems = [...existingItems, ...missingItems].sort((a, b) => a.tag.localeCompare(b.tag));

    const spuriousCount = existingItems.filter(i => i.spurious).length;
    const totalMissing  = missingTags.length + unmatchedLocations.length;
    const issueParts = [];
    if (totalMissing > 0)  issueParts.push(`${totalMissing} missing`);
    if (spuriousCount > 0) issueParts.push(`${spuriousCount} spurious`);

    let html = '';
    if (totalMissing > 0) {
      html += '<p style="color:red; font-weight:bold; margin:0 0 6px 0">⚠️ Missing expected venue tags:</p>';
    }
    html += '<ol class="bb-tags-list" style="margin:4px 0; padding-left:18px;">';
    for (const item of allItems) {
      if (item.missing) {
        const style     = `color:red; font-weight:bold${item.tooltip ? '; cursor:help' : ''}`;
        const titleAttr = item.tooltip ? ` title="${esc(item.tooltip)}"` : '';
        html += `<li style="${style}"${titleAttr}>⚠️ ${esc(item.tag)}</li>`;
      } else if (item.spurious) {
        html += `<li>${item.html} <span style="color:darkorange; font-weight:bold; cursor:help" title="${esc(item.tooltip)}">⚠️</span></li>`;
      } else {
        html += `<li>${item.html}</li>`;
      }
    }
    html += '</ol>';

    const content = { type: 'html', caption: `${venueName} Tags`, html };
    const btn = document.createElement('button');
    btn.className = 'bb-venue-tab-btn';
    btn.textContent = issueParts.length > 0 ? `Tags ⚠️ (${issueParts.join(', ')})` : 'Tags';
    btn.title = issueParts.length > 0
      ? `Venue Tags panel — issues detected: ${issueParts.join(', ')}`
      : 'All tags verified — click to expand/collapse the Venue Tags panel';
    if (totalMissing > 0)       btn.style.color = 'red';
    else if (spuriousCount > 0)  btn.style.color = 'darkorange';
    else                         btn.style.color = '#2a2';

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
   * Returns the set of lowercase tags expected on a SONG page: "song"
   * (always), the first letter of the song name, "lyricsheet" when the
   * Gallery tab has an image whose filename contains "lyricsheet", and
   * "underconstruction" when the page shows BruceBase's "Under
   * Construction" banner (see hasUnderConstructionBanner). Used by the
   * YEAR page's nested "Song Tags" button (against a fetched `songDoc`)
   * and, via computeExpectedSongTags, by the live SONG page's own annotation
   * (against the live `document`).
   * @param {Document}           songDoc
   * @param {Map<string,number>} songTabMap
   * @param {string}             songName  - Display name from the <a> text.
   * @returns {Set<string>}
   */
  function computeExpectedYearSongTags(songDoc, songTabMap, songName) {
    const expected = new Set(['song']);
    const first = (songName || '').trim()[0];
    if (first && /[a-z]/i.test(first)) expected.add(first.toLowerCase());

    // lyricsheet: Gallery tab has images with "lyricsheet" in src.
    const galleryTab = getTabEl(songDoc, songTabMap, 'Gallery');
    if (galleryTab && [...galleryTab.querySelectorAll('img')]
        .some(img => /lyricsheet/i.test(img.src || img.getAttribute('src') || ''))) {
      expected.add('lyricsheet');
    }

    if (hasUnderConstructionBanner(songDoc)) expected.add('underconstruction');

    return expected;
  }

  /**
   * Returns true for song-page tags whose presence can be verified: "song",
   * "lyricsheet", "underconstruction", and single lowercase letter tags
   * (first-letter index). Used by the YEAR page's nested "Song Tags"
   * button, and, via isManagedSongTag, by the live SONG page's own
   * annotation.
   * @param {string} tag
   * @returns {boolean}
   */
  function isManagedYearSongTag(tag) {
    return tag === 'song' || tag === 'lyricsheet' || tag === 'underconstruction' || /^[a-z]$/.test(tag);
  }

  /**
   * Appends a "Tags" button (inside row) for the song page's .page-tags.
   * Consistency checks: "song", first-letter, "lyricsheet", and the
   * exact-title-slug tag are managed/required; the derived-alias tag is
   * recognized (green if present) but not required.
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
    const expectedTags = computeExpectedYearSongTags(songDoc, songTabMap, songName);
    const missingTags  = [...expectedTags].filter(t => !actualTags.has(t)).sort();

    // Exact-title-slug tag: a hard requirement, e.g. "BORN TO RUN" -> "borntorun".
    const exactCheck = checkSongExactTitleTag(songName, actualTags);
    // Derived-alias tag: recognized (but not required) — e.g. "BORN TO RUN" -> "btr".
    const aliasCheck = checkSongAliasTagRecognition(songName, actualTags, exactCheck.tag);

    const existingItems = tagLinks.map(a => {
      const tag           = a.textContent.trim().toLowerCase();
      const isExactMatch   = exactCheck.matchedTag === tag;
      const isAliasMatch   = aliasCheck && aliasCheck.matchedTag === tag;
      const spurious = isManagedYearSongTag(tag) && !expectedTags.has(tag);
      const passing  = (isManagedYearSongTag(tag) && expectedTags.has(tag)) || isExactMatch || isAliasMatch;
      const tooltip  = spurious ? `Tag "${tag}" is present but not expected for this song` : '';
      if (passing) {
        a.style.color = '#2a2';
        a.style.fontWeight = 'bold';
        a.title = isExactMatch
          ? `Tag "${tag}" verified: matches the song name "${songName}" (lowercase, punctuation stripped)`
          : isAliasMatch
          ? `Tag "${tag}" recognized: matches the derived first-letter-per-word alias of song name "${songName}"`
          : tag === 'song'
          ? 'Tag "song" verified: this is a song page'
          : tag === 'lyricsheet'
            ? 'Tag "lyricsheet" verified: Gallery tab has lyricsheet image(s)'
            : `Tag "${tag}" verified: matches the first letter of song name "${songName}"`;
      }
      return { tag, html: a.outerHTML, missing: false, spurious, tooltip };
    });
    const missingItems = [
      ...missingTags.map(tag => ({ tag, html: null, missing: true, spurious: false, tooltip: '' })),
      ...(!exactCheck.matchedTag ? [{ tag: exactCheck.tag, html: null, missing: true, spurious: false,
        tooltip: `Tag "${exactCheck.tag}" expected (exact match of song name "${songName}") but not present` }] : []),
    ];
    const allItems = [...existingItems, ...missingItems].sort((a, b) => a.tag.localeCompare(b.tag));

    const spuriousCount = existingItems.filter(i => i.spurious).length;
    const totalMissing  = missingTags.length + (exactCheck.matchedTag ? 0 : 1);
    const issueParts = [];
    if (totalMissing > 0)  issueParts.push(`${totalMissing} missing`);
    if (spuriousCount > 0) issueParts.push(`${spuriousCount} spurious`);

    let html = '';
    if (totalMissing > 0) {
      html += '<p style="color:red; font-weight:bold; margin:0 0 6px 0">⚠️ Missing expected song tags:</p>';
    }
    html += '<ol class="bb-tags-list" style="margin:4px 0; padding-left:18px;">';
    for (const item of allItems) {
      if (item.missing) {
        const style     = `color:red; font-weight:bold${item.tooltip ? '; cursor:help' : ''}`;
        const titleAttr = item.tooltip ? ` title="${esc(item.tooltip)}"` : '';
        html += `<li style="${style}"${titleAttr}>⚠️ ${esc(item.tag)}</li>`;
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
      : 'All tags verified — click to expand/collapse the Song Tags panel';
    if (totalMissing > 0)       btn.style.color = 'red';
    else if (spuriousCount > 0)  btn.style.color = 'darkorange';
    else                         btn.style.color = '#2a2';

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

    const songNotesBtn = buildNotesButton(songDoc, `${songName} — Notes`, 'bb-song-tab-btn', section);
    if (songNotesBtn) row.appendChild(songNotesBtn);

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
   * Returns the set of lowercase tags expected on a RELATION page, as checked
   * from the YEAR page's nested "Tags" button (distinct from the live RELATION
   * page's own computeExpectedRelationTags(), which reads the live document's
   * tabs instead of a fetched relDoc).
   * @param {Document} relDoc - Parsed relation page document.
   * @returns {Set<string>}
   */
  function computeExpectedYearRelationTags(relDoc) {
    const tabLabels = new Set(
      [...relDoc.querySelectorAll('.yui-nav em')].map(em => em.textContent.trim())
    );
    const expected = new Set();
    if (tabLabels.has('Bands'))   expected.add('person');
    if (tabLabels.has('Members')) expected.add('band');
    if (hasUnderConstructionBanner(relDoc)) expected.add('underconstruction');
    return expected;
  }

  /**
   * Appends a "Tags" button (inside row) for the relation page's .page-tags.
   * Consistency checks, based on relDoc's own tab set: "person" (if a
   * "Bands" tab exists) or "band" (if a "Members" tab exists), plus the
   * name-derived tags from computeExpectedRelationNameTags (surname-letter/
   * Name+Surname for a person, band-letter/member Name+Surname for a band).
   * No-op when neither tab is present (page type can't be determined) or
   * there are no tags.
   * @param {Document}    relDoc   - Parsed relation page document.
   * @param {string}      relName  - Display name for the row label.
   * @param {HTMLElement} section  - .bb-section-processed container (panel host).
   * @param {HTMLElement} row      - .bb-relation-tab-row to append the button to.
   */
  function addRelationTagsButton(relDoc, relName, section, row) {
    const tagsEl = relDoc.querySelector('.page-tags');
    if (!tagsEl) return;
    const tagLinks = [...tagsEl.querySelectorAll('a[href]')];
    if (tagLinks.length === 0) return;

    const actualTags       = new Set(tagLinks.map(a => a.textContent.trim().toLowerCase()));
    const expectedTags     = computeExpectedYearRelationTags(relDoc);
    const expectedNameTags = computeExpectedRelationNameTags(relDoc);
    const allExpectedTags  = new Set([...expectedTags, ...expectedNameTags.keys()]);
    if (allExpectedTags.size === 0) return;   // can't determine person vs band — skip
    const missingTags  = [...allExpectedTags].filter(t => !actualTags.has(t)).sort();

    const existingItems = tagLinks.map(a => {
      const tag      = a.textContent.trim().toLowerCase();
      const spurious = isManagedRelationTag(tag) && !expectedTags.has(tag);
      const passing  = (isManagedRelationTag(tag) && expectedTags.has(tag)) || expectedNameTags.has(tag);
      const tooltip  = spurious ? `Tag "${tag}" is present but not expected for this relation page` : '';
      if (passing) {
        a.style.color = '#2a2';
        a.style.fontWeight = 'bold';
        a.title = expectedNameTags.get(tag)?.message || (tag === 'person'
          ? 'Tag "person" verified: page has a "Bands" tab (this entry belongs to bands)'
          : tag === 'band'
          ? 'Tag "band" verified: page has a "Members" tab (this entry has members)'
          : 'Tag "underconstruction" verified: page shows the "Under Construction" banner');
      }
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
      html += '<p style="color:red; font-weight:bold; margin:0 0 6px 0">⚠️ Missing expected relation tags:</p>';
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

    const content = { type: 'html', caption: `${relName} — Tags`, html };
    const btn = document.createElement('button');
    btn.className = 'bb-relation-tab-btn';
    btn.textContent = issueParts.length > 0 ? `Tags ⚠️ (${issueParts.join(', ')})` : 'Tags';
    btn.title = issueParts.length > 0
      ? `Relation Tags — issues: ${issueParts.join(', ')}`
      : 'All tags verified — click to expand/collapse the Relation Tags panel';
    if (missingTags.length > 0)  btn.style.color = 'red';
    else if (spuriousCount > 0)  btn.style.color = 'darkorange';
    else                         btn.style.color = '#2a2';

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
   * Tests whether a relation-page tab panel has no meaningful content.
   * A tab is NOT considered empty when it embeds actual media (img, iframe,
   * object, embed, video, audio) even if that leaves no text behind (e.g. a
   * Media tab holding only a YouTube <iframe>, or a Gallery tab holding only
   * <img> thumbnails) — text presence alone is not a reliable emptiness test.
   * @param {HTMLElement|null} tab
   * @returns {boolean}
   */
  function isRelationTabEmpty(tab) {
    if (!tab) return true;
    const text = tab.textContent.trim();
    if (SORRY_RE.test(text)) return true;
    if (tab.querySelector('img, iframe, object, embed, video, audio')) return false;
    const lBoxes = [...tab.querySelectorAll('.list-pages-box')];
    if (lBoxes.length > 0) return lBoxes.every(box => !box.textContent.trim());
    return !text;
  }

  /**
   * Builds a .bb-relation-tab-row containing one button per non-empty tab on
   * the relation page. Appended to section; returns the row (or null if empty).
   * @param {Document}    relDoc    - Parsed relation page document.
   * @param {string}      relName   - Display name for the row label.
   * @param {HTMLElement} section   - .bb-section-processed container.
   * @returns {HTMLElement|null}
   */
  function addRelationTabButtons(relDoc, relName, section) {
    const tabMap = buildTabMap(relDoc);
    const row = document.createElement('div');
    row.className = 'bb-relation-tab-row';
    row.appendChild(makeTabRowLabel(relName + ':'));

    const relNotesBtn = buildNotesButton(relDoc, `${relName}: Notes`, 'bb-relation-tab-btn', section);
    if (relNotesBtn) row.appendChild(relNotesBtn);

    for (const [label] of tabMap) {
      const tab = getTabEl(relDoc, tabMap, label);
      const btn = document.createElement('button');
      btn.className = 'bb-relation-tab-btn';
      btn.textContent = label;

      // Wikidot sometimes omits the content panel (#wiki-tab-0-N) entirely for
      // empty tabs — only the nav label is present. Treat a null panel the same
      // as an empty one: render a flagged, non-interactive button.
      const isEmpty = isRelationTabEmpty(tab);

      if (isEmpty) {
        // Empty or "Sorry, no…" tabs are still rendered as buttons but flagged.
        btn.classList.add('bb-relation-tab-empty');
        const msg = !tab
          ? `Tab "${label}" has no content (panel not rendered by server).`
          : SORRY_RE.test(tab.textContent.trim())
            ? `Tab "${label}" reports no content available.`
            : `Tab "${label}" is empty.`;
        btn.dataset.msg = msg;
        btn.title = msg;
        const warnSpan = document.createElement('span');
        warnSpan.textContent = ' ⚠️';
        btn.appendChild(warnSpan);
      } else {
        const html = tab.innerHTML
          .replace(/href="\//g, `href="${location.protocol}//${location.host}/`);
        const content = { type: 'html', caption: `${relName}: ${label}`, html };
        btn.title = `Relation page tab — click to expand/collapse: ${label}`;
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
      }

      row.appendChild(btn);
    }

    addRelationTagsButton(relDoc, relName, section, row);

    if (row.children.length <= 1) return null;
    section.appendChild(row);
    return row;
  }

  /**
   * Fetches a relation page on demand (first click on a bullet) or toggles an
   * already-loaded row. Relation tab rows are cached on section._bbRelRows.
   * @param {string}      relHref   e.g. "/relation:bruce-springsteen"
   * @param {string}      relName   Display name for the row label
   * @param {HTMLElement} section   .bb-section-processed container
   * @param {HTMLElement} bullet    The .bb-rel-bullet span that was clicked
   */
  async function fetchAndToggleRelationTabRow(relHref, relName, section, bullet) {
    if (!section._bbRelRows) section._bbRelRows = new Map();

    const existing = section._bbRelRows.get(relHref);
    if (existing) {
      const visible = existing.style.display !== 'none';
      existing.style.display = visible ? 'none' : '';
      bullet.classList.toggle('bb-icon-active', !visible);
      return;
    }

    bullet.classList.add('bb-rel-loading');
    try {
      const url    = `${location.protocol}//${location.host}${relHref}`;
      const relDoc = await fetchPage(url);
      const row    = addRelationTabButtons(relDoc, relName, section);
      bullet.classList.remove('bb-rel-loading');
      if (row) {
        section._bbRelRows.set(relHref, row);
        bullet.classList.add('bb-icon-active');
      }
    } catch (e) {
      bullet.classList.remove('bb-rel-loading');
      logWarn(`  Relation page fetch failed for ${relHref}:`, e.message);
    }
  }

  /**
   * Reorganizes a DETAIL page's `.page-tags` `<span>` — which otherwise
   * renders every tag as one long unbroken line — into multiple lines, one
   * per group of tags sharing the same lowercase first character (digit-led
   * tags like "17"/"2026" grouped under "#"), each line prefixed with a
   * small bold group-letter label (`.bb-tag-group-label`). Runs as a final
   * layout pass over whatever annotateDetailPageTags has already built:
   * plain `<a>` tags, `.bb-tag-ok`/`.bb-tag-onstage` matched tags,
   * `.bb-tag-missing` placeholders (text `" ⚠️tagname"`, no `<a>`), and
   * `.bb-tag-spurious` warning-icon `<span>`s that immediately follow their
   * `<a>` (kept attached to it as one group so the icon stays adjacent to
   * its tag). `.bb-tag-group-line` uses `display: contents` under
   * `.bb-original-view` (see addStyles) so the "⇄ Original Page" toggle
   * still shows BruceBase's original single-line flow.
   * @param {Element} tagsContainer - `.page-tags` element.
   */
  function groupTagsIntoLines(tagsContainer) {
    const span = tagsContainer.querySelector('span') || tagsContainer;
    const elems = [...span.children];
    if (elems.length === 0) return;

    const items = [];
    for (let i = 0; i < elems.length; i++) {
      const el = elems[i];
      if (el.tagName === 'SPAN' && el.classList.contains('bb-tag-spurious')) continue;
      const group = [el];
      const next = elems[i + 1];
      if (next && next.tagName === 'SPAN' && next.classList.contains('bb-tag-spurious')) {
        group.push(next);
        i++;
      }
      const tagText = el.textContent.replace(/^\s*⚠️/, '').trim();
      const first   = tagText.charAt(0).toLowerCase();
      const key     = (first >= 'a' && first <= 'z') ? first : '#';
      items.push({ key, group });
    }
    // Stable sort: ties (same first letter) keep their original DOM order.
    items.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

    span.textContent = '';
    let currentKey = null;
    let lineDiv     = null;
    for (const item of items) {
      if (item.key !== currentKey) {
        currentKey = item.key;
        lineDiv = document.createElement('div');
        lineDiv.className = 'bb-tag-group-line';
        const label = document.createElement('span');
        label.className = 'bb-tag-group-label';
        label.textContent = currentKey.toUpperCase();
        lineDiv.appendChild(label);
        span.appendChild(lineDiv);
      }
      for (const node of item.group) lineDiv.appendChild(node);
    }
  }

  /**
   * On DETAIL pages: wraps .page-tags in a yellow warning box and appends
   * expected-but-missing tags as bold-red spans inside the tag container,
   * then always regroups the tag list into per-letter lines (see
   * groupTagsIntoLines) regardless of whether any issues were found — the
   * warning-box wrapping is skipped when all expected tags are present, but
   * the line-grouping is not.
   * @param {Map<string,number>} tabMap
   * @param {string}             eventDate      - "YYYY-MM-DD"
   * @param {string}             eventType      - "gig" | "recording" | etc.
   * @param {Section[]}          detailSections - Result of parseDetailSetlist(document).
   * @param {string}             rawDetailName
   * @param {{url: string, tags: Set<string>}|null} [onstageResult] - fetchOnstageCompanionTags result, if any.
   * @param {boolean}             [hasHelp] - Whether the YEAR page shows a "Help Us"
   *   call-to-action icon for this event (see eventHasHelpIcon). ORed with a check
   *   of the live DETAIL page's own content (see hasHelpIcon) — BruceBase also shows
   *   this icon directly inside a DETAIL page tab (e.g. "Complete lineup of performers
   *   is not known" in the "On Stage" tab), not just on the YEAR page. When either is
   *   true, "help" is always expected as a tag.
   * @param {boolean}             [hasFeatured] - Whether the YEAR page shows a
   *   "Featured" icon for this event (see eventHasFeaturedIcon). ORed with a check
   *   of the live DETAIL page's own content (see hasFeaturedIcon). When either is
   *   true, "featured" is always expected as a tag.
   * @param {string|null} [venueDetailExtra] - Non-null when the venue check found this
   *   event's venue-detail segment is the only difference from the VENUE page title
   *   (see findVenueDetailExtra) — suppresses the corresponding "Venue detail" entry
   *   from the missing-tag report below, since it's informational, not a real gap.
   * @returns {{
   *   additionalTags: string[],
   *   onstageUrl: string|null,
   *   tourCheck: ReturnType<typeof checkEventTourTags>,
   *   eventAlias: string|null
   * }} `additionalTags`/`onstageUrl`: tags found only on the onstage companion
   *   page, for addOnstageTagsGlyph. `tourCheck`/`eventAlias`: for
   *   runDetailProcessing to render the tour-name/event-alias page-title spans.
   */
  function annotateDetailPageTags(tabMap, eventDate, eventType, detailSections, rawDetailName, onstageResult = null, hasHelp = false, hasFeatured = false, venueDetailExtra = null) {
    // Extracted up front (rather than down where the tour check/fuzzy
    // substring alias check need it) so it's always returned to the caller
    // regardless of the early-return paths below — runDetailProcessing uses
    // it to render the event alias next to the page title independently of
    // whether a .page-tags block even exists.
    const eventAlias = extractEventAlias(document);

    const tagsContainer = document.querySelector('.page-tags');
    if (!tagsContainer) return { additionalTags: [], onstageUrl: null, tourCheck: null, eventAlias, tourTagAnchors: [] };
    hasHelp = hasHelp || hasHelpIcon(document);
    hasFeatured = hasFeatured || hasFeaturedIcon(document);

    const tagLinks     = [...tagsContainer.querySelectorAll('a[href]')];
    const actualTags   = new Set(tagLinks.map(a => a.textContent.trim().toLowerCase()));
    // tag string -> anchor element, for the matched-tag marking loops below.
    // Extended (not replaced) as onstage-companion tags are rendered in, so
    // a song/location/relation match against a tag that only exists via the
    // companion page can still be found and colored green.
    const tagToAnchor  = new Map(tagLinks.map(a => [a.textContent.trim().toLowerCase(), a]));

    // Merge in tags found on the "onstage:" companion page (BruceBase caps
    // tags-per-page, so some tags for a gig/rehearsal spill onto that page).
    const additionalTags = onstageResult
      ? [...onstageResult.tags].filter(t => !actualTags.has(t))
      : [];
    for (const t of additionalTags) actualTags.add(t);
    const onstageUrl = onstageResult ? onstageResult.url : null;

    // Render the additional tags into .page-tags itself, alongside the
    // original ones, then re-sort the combined list alphabetically to match
    // BruceBase's own tag ordering convention.
    if (additionalTags.length > 0) {
      const tagsSpan = tagsContainer.querySelector('span') || tagsContainer;
      for (const tag of additionalTags) {
        const a = document.createElement('a');
        a.href = `/system:page-tags/tag/${tag}#pages`;
        a.textContent = tag;
        a.className = 'bb-tag-onstage';
        a.title = `Tag "${tag}" found on the companion "On Stage" page (${onstageUrl})`;
        tagsSpan.appendChild(a);
        tagToAnchor.set(tag, a);
      }
      [...tagsSpan.querySelectorAll('a[href]')]
        .sort((x, y) => {
          const tx = x.textContent.trim(), ty = y.textContent.trim();
          return tx < ty ? -1 : tx > ty ? 1 : 0;
        })
        .forEach(a => tagsSpan.appendChild(a));
    }

    // "On Stage"/"In Studio" tab → relation tag check: the tab's fixed tag
    // ("onstage"/"studio", suppressed on interview pages — see
    // checkOnStageRelationTags) plus every relation name listed there
    // should each have a corresponding tag. Computed here (before
    // spurious/passing) because "onstage" is also a member of
    // MANAGED_CONTENT_TAGS (used on actual /onstage: pages) but is never
    // added to computeExpectedTags for these pages — without this
    // exclusion, the generic spurious-tag check below would incorrectly
    // flag it orange even while this check marks it green.
    const relationResults    = checkOnStageRelationTags(document, tabMap, actualTags, eventType);
    const matchedRelationTagSet = new Set(relationResults.filter(r => r.matchedTag).map(r => r.matchedTag));
    const unmatchedRelations = relationResults.filter(r => !r.matchedTag);

    // Colorize each relation name link under the "On Stage"/"In Studio"/
    // "On Audio" tab itself (not just its tag in .page-tags) green when it
    // passes, or flag it ⚠️ when it doesn't — mirrors the tag-side check
    // above but applied directly to the tab's own name links.
    colorizeOnStageRelationNames(
      document, actualTags,
      computePreferDottedEStreetTag(tabMap, extractOnStageRelationNames(document), eventType)
    );
    // Mirrors annotateSetlistTab, but for the event's first tab ("On
    // Stage"/"In Studio"/"On Audio"/"On Set") — must run after
    // colorizeOnStageRelationNames above, since it looks for the
    // .bb-relation-name-warn spans that call just rendered.
    annotateFirstTab(tabMap);

    // Tour association: which known Springsteen tour(s) (if any) this
    // event's date falls within, or the tour_no exception — see
    // checkEventTourTags. eventAlias was already extracted at the top of
    // this function (before the .page-tags early return).
    const tourCheck = checkEventTourTags(eventDate, path, eventAlias);

    const expectedTags = computeExpectedTags(document, tabMap, eventDate, eventType, extractEventDaySuffix(path), hasHelp, hasFeatured, tourCheck?.expectedTags);
    const missingTags  = [...expectedTags].filter(t => !isTagPresent(t, actualTags)).sort();
    const spuriousLinks = tagLinks.filter(a => {
      const tag = a.textContent.trim().toLowerCase();
      return isManagedTag(tag) && !isTagPresent(tag, expectedTags) && !matchedRelationTagSet.has(tag);
    });
    const passingLinks = tagLinks.filter(a => {
      const tag = a.textContent.trim().toLowerCase();
      return isManagedTag(tag) && isTagPresent(tag, expectedTags);
    });
    markPassingTagLinks(passingLinks, tag => passingTagMsg(tag, expectedTags, tourCheck));

    // Tag-source-highlight artefact lookups (bbp_enable_tag_source_highlight)
    // — only built when the setting is on, since each is an extra DOM scan
    // (several of them mutate #page-title's text into wrapped spans via
    // wrapTextSubstring). Wrapped in try/catch: any failure resolving an
    // optional highlight source must never break the tag annotation that follows.
    const highlightOn = Lib.settings.bbp_enable_tag_source_highlight;
    let songAnchorByName = null;
    let relationElByName = null;
    let guestElByName = null;
    let eventTypeEl = null;
    let dateTagMap = null; // tag ("1980"/"october"/"03") -> span; whole-date span for weekday tags
    let dateSpan = null;
    let venueLoc = null;
    let venueStringSpan = null; // whole "Venue, City, ST" portion of the title, after the date
    let tourTagAnchors = []; // <a> link(s) for whichever TOUR_TAG_SET tag(s) matched — .bb-tour-name
    // doesn't exist yet at this point (added by the caller, runDetailProcessing,
    // after this function returns), so the caller wires these post-hoc.
    let soundcheckEl = null; // the <strong>Soundcheck</strong> header in the Setlist tab, if any
    let premiereEls = []; // every <strong><a href="/song:...">...</a></strong> in the Setlist tab
    if (highlightOn) {
      try {
        songAnchorByName = new Map([...(getSetlistContainer(document)?.querySelectorAll('a[href^="/song:"]') ?? [])]
          .map(a => [a.textContent.trim().toLowerCase(), a]));
        relationElByName = new Map();
        guestElByName = new Map();
        for (const group of extractRelations(document)) {
          for (const item of group.items) {
            relationElByName.set(item.name.toLowerCase(), item.el);
            if (item.extraEl) guestElByName.set(item.name.toLowerCase(), item.extraEl);
            for (const m of item.members) {
              relationElByName.set(m.name.toLowerCase(), m.el);
              if (m.extraEl) guestElByName.set(m.name.toLowerCase(), m.extraEl);
            }
          }
        }

        // Same containers countTourPremiereSongs/computeExpectedTags's
        // soundcheck-header check already use — see doc/TAGS.md.
        const setlistContainer = getSetlistContainer(document);
        soundcheckEl = [...(setlistContainer?.querySelectorAll('p strong') ?? [])]
          .find(s => /^soundcheck$/i.test(s.textContent.trim())) || null;
        premiereEls = [...(setlistContainer?.querySelectorAll('strong a[href^="/song:"]') ?? [])];

        eventTypeEl = document.querySelector('#page-title .bb-event-type-detail');

        const h1 = getPageTitleElement();
        if (h1) {
          dateSpan = wrapTextSubstring(h1, eventDate);
          if (dateSpan) {
            const [yr, mo, dd] = eventDate.split('-');
            const yearSpan  = wrapTextSubstring(dateSpan, yr);
            const monthSpan = wrapTextSubstring(dateSpan, mo);
            const daySpan   = wrapTextSubstring(dateSpan, dd);
            dateTagMap = new Map();
            dateTagMap.set(yr, yearSpan || dateSpan);
            const moNum = parseInt(mo, 10);
            if (moNum >= 1 && moNum <= 12) dateTagMap.set(MONTH_NAMES[moNum - 1], monthSpan || dateSpan);
            dateTagMap.set(dd, daySpan || dateSpan);
          }

          const dateM = rawDetailName.trim().match(/^\d{4}-\d{2}-\d{2}\s+(.+)$/);
          if (dateM) {
            venueLoc = parseEventNameLocation(rawDetailName);
            venueStringSpan = wrapTextSubstring(h1, dateM[1]);
          }
        }

        if (tourCheck && !tourCheck.isTourNo) {
          for (const t of tourCheck.expectedTags) {
            if (TOUR_TAG_SET.has(t)) {
              const a = tagToAnchor.get(t);
              if (a) tourTagAnchors.push(a);
            }
          }
        }
      } catch (e) {
        logErr('annotateDetailPageTags/tag-source-highlight setup', e);
        songAnchorByName = null; relationElByName = null; guestElByName = null;
        eventTypeEl = null; dateTagMap = null; dateSpan = null;
        venueLoc = null; venueStringSpan = null; tourTagAnchors = [];
        soundcheckEl = null; premiereEls = [];
      }
    }

    // Generic managed tags (date/weekday/event-type/tour/soundcheck/prem/etc.):
    // most have no single identifiable source, so this is layered on top via
    // a direct wireTagSourceHighlight loop rather than threaded through the
    // markPassingTagLinks call above (same pattern as RETAIL's date tags).
    if (highlightOn) {
      for (const a of passingLinks) {
        const tag = a.textContent.trim().toLowerCase();
        let source = null;
        if (tag === eventType.toLowerCase()) source = eventTypeEl;
        else if (dateTagMap?.has(tag)) source = dateTagMap.get(tag);
        else if (DAY_NAMES.includes(tag)) source = dateSpan;
        else if (tag === 'soundcheck') source = soundcheckEl;
        else if ((tag === 'prem' || TOUR_PREMIERE_TAG_VALUES.has(tag)) && premiereEls.length) source = premiereEls;
        if (source) wireTagSourceHighlight(a, source);
      }
    }

    // Setlist song → tag check: every song in the Setlist tab should have a
    // corresponding tag (exact match, derived alias, or manual override).
    const songResults   = checkSetlistSongTags(detailSections, actualTags);
    const matchedSongs   = songResults.filter(r => r.matchedTag);
    const unmatchedSongs = songResults.filter(r => !r.matchedTag);
    const songMethodLabel = { exact: 'exact match', alias: 'derived alias', override: 'manual override', combination: 'song combination override' };
    for (const r of matchedSongs) {
      const a = tagToAnchor.get(r.matchedTag);
      if (a) markPassingTagLinks([a], tag => `Tag "${tag}" verified: matches setlist song "${r.song}" (${songMethodLabel[r.method]})`,
        songAnchorByName?.get(r.song.toLowerCase()) ?? null);
    }

    // Event-name → tag check: venue/city/state/country parts of the page
    // title should each have a corresponding tag (exact match or manual
    // override) — each result is resolved to its own substring of the
    // venue-string portion of the title (resolveLocationSourceEl), falling
    // back to the whole venue-string span for usa/canada/COUNTRY_EXTRA_TAGS
    // results, which have no literal substring at all.
    const locationResults    = checkEventNameLocationTags(rawDetailName, actualTags);
    const matchedLocations   = locationResults.filter(r => r.matchedTag);
    const unmatchedLocations = locationResults.filter(r =>
      !r.matchedTag && !(venueDetailExtra && r.label === `Venue detail: ${venueDetailExtra}`)
    );
    for (const r of matchedLocations) {
      const a = tagToAnchor.get(r.matchedTag);
      const source = (highlightOn && venueStringSpan) ? resolveLocationSourceEl(r, venueLoc, venueStringSpan, venueStringSpan) : null;
      if (a) markPassingTagLinks([a], tag => `Tag "${tag}" verified: matches event ${r.label}`, source);
    }

    // "On Stage"/"In Studio" tab relation matches (computed earlier, before
    // spurious/passing). The "guest" method's source is the "(Guest)"
    // marker(s) next to whichever relation(s) it names, not the relation
    // name link(s) itself (used by every other method).
    for (const r of relationResults.filter(res => res.matchedTag)) {
      const a = tagToAnchor.get(r.matchedTag);
      const map = r.method === 'guest' ? guestElByName : relationElByName;
      const sources = map ? r.names.map(n => map.get(n.toLowerCase())).filter(Boolean) : null;
      if (a) markPassingTagLinks([a], tag => `Tag "${tag}" verified: ${r.label} — ${relationMethodLabel(r.method, r.tabLabel)}`, sources);
    }

    // Fuzzy substring tag check: generic tags (FUZZY_SUBSTRING_TAGS) that are
    // present AND a case-insensitive substring of the event alias (e.g.
    // "grammy" matched by "68th Annual Grammy Awards Ceremony") or the
    // page's free-text notes (e.g. "benefit" matched by a notes paragraph
    // mentioning "...Light Of Day Benefit.") are verified. Never
    // contributes to missingTags — absence is not flagged. The
    // tag-source-highlight artefact is just the matched word itself
    // (wrapFuzzyMatchSubstring), not the whole alias/notes element.
    const aliasEl = highlightOn ? findEventAliasElement(document) : null;
    const aliasResults = checkAliasSubstringTags(eventAlias, actualTags);
    for (const r of aliasResults) {
      const a = tagToAnchor.get(r.tag);
      const source = highlightOn ? wrapFuzzyMatchSubstring(aliasEl, r.matched) : null;
      if (a) markPassingTagLinks([a], tag => `Tag "${tag}" verified: ${r.label}`, source);
    }
    const notesResults = checkNotesSubstringTags(extractPageNotesText(document), actualTags);
    for (const r of notesResults) {
      const a = tagToAnchor.get(r.tag);
      const source = highlightOn
        ? wrapFuzzyMatchSubstring(findPageNotesSourceElements(document, r.matched)[0], r.matched)
        : null;
      if (a) markPassingTagLinks([a], tag => `Tag "${tag}" verified: ${r.label}`, source);
    }

    if (missingTags.length === 0 && spuriousLinks.length === 0 && unmatchedSongs.length === 0
        && unmatchedLocations.length === 0 && unmatchedRelations.length === 0) {
      const okWrapper = document.createElement('div');
      okWrapper.className = 'bb-tags-box';
      // BruceBase's own `.page-tags{clear:both}` rule clears the floated
      // #side-bar navigation column (needed on the *unwrapped* page so the
      // global #footer, which also clears it, doesn't visually collide with
      // it). #main-content is offset via margin-left, not float, so nothing
      // actually needs .page-tags itself to clear — #footer (which follows
      // right after in the DOM and carries the same clear:both) still does
      // that job on its own. Cancel the clear entirely here so this wrapper
      // renders immediately after the preceding content instead of leaving a
      // gap (either inside the border, or above it) sized to the sidebar.
      okWrapper.style.cssText = 'border:3px solid #2a2; background:#fffbe6; padding:6px 10px; border-radius:4px; margin:4px 0;';
      tagsContainer.parentNode.insertBefore(okWrapper, tagsContainer);
      okWrapper.appendChild(tagsContainer);
      tagsContainer.style.clear = 'none';
      groupTagsIntoLines(tagsContainer);
      return { additionalTags, onstageUrl, tourCheck, eventAlias, tourTagAnchors };
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'bb-tags-warn-box';
    // BruceBase's own `.page-tags{clear:both}` rule clears the floated
    // #side-bar navigation column (needed on the *unwrapped* page so the
    // global #footer, which also clears it, doesn't visually collide with
    // it). #main-content is offset via margin-left, not float, so nothing
    // actually needs .page-tags itself to clear — #footer (which follows
    // right after in the DOM and carries the same clear:both) still does
    // that job on its own. Cancel the clear entirely here so this wrapper
    // renders immediately after the preceding content instead of leaving a
    // gap (either inside the border, or above it) sized to the sidebar.
    wrapper.style.cssText = 'border:3px solid gold; background:#fffbe6; padding:6px 10px; border-radius:4px; margin:4px 0;';
    tagsContainer.parentNode.insertBefore(wrapper, tagsContainer);
    wrapper.appendChild(tagsContainer);
    tagsContainer.style.clear = 'none';

    // Flag spurious tags with an orange ⚠️ icon next to the tag link.
    for (const a of spuriousLinks) {
      const tag     = a.textContent.trim().toLowerCase();
      const msg     = spuriousTagMsg(tag, expectedTags, tourCheck);
      const warnSpan = document.createElement('span');
      warnSpan.className = 'bb-tag-spurious';
      warnSpan.style.cssText = 'color:darkorange; font-weight:bold; cursor:help; margin:0 2px;';
      warnSpan.textContent = '⚠️';
      warnSpan.title = msg;
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

    // Append one missing-tag span per setlist song with no corresponding tag,
    // showing the derived-alias candidate so it's clear what to look for/add.
    // Optionally (bbp_enable_setlist_tag_warnings) also flag the song's own
    // link in the live "Setlist" tab with the same ⚠️/tooltip.
    const setlistAnchorByName = Lib.settings.bbp_enable_setlist_tag_warnings
      ? new Map([...(getSetlistContainer(document)?.querySelectorAll('a[href^="/song:"]') ?? [])]
          .map(a => [a.textContent.trim().toLowerCase(), a]))
      : null;
    for (const r of unmatchedSongs) {
      const candidate = r.method === 'combination'
        ? SONG_COMBINATION_TAG_OVERRIDES[r.song.toLowerCase().trim()]
        : (computeSongTagAlias(r.song) || songTagSlug(r.song));
      const msg = r.method === 'combination'
        ? `No tag found for setlist song combination "${r.song}" (expected SONG_COMBINATION_TAG_OVERRIDES tag "${candidate}")`
        : `No tag found for setlist song "${r.song}" (tried exact match and derived alias "${candidate}")`;
      const missingSpan = document.createElement('span');
      missingSpan.className = 'bb-tag-missing';
      missingSpan.style.cssText = 'color:red; font-weight:bold; margin:0 3px;';
      missingSpan.title = msg;
      missingSpan.textContent = ` ⚠️${candidate}`;
      span.appendChild(missingSpan);

      if (setlistAnchorByName) {
        const a = setlistAnchorByName.get(r.song.toLowerCase());
        if (a) a.after(makeSetlistSongTagWarningGlyph(msg));
      }
    }

    // Append one missing-tag span per unmatched event-name location part
    // (venue, venue detail, city, state/country/region).
    for (const r of unmatchedLocations) {
      const missingSpan = document.createElement('span');
      missingSpan.className = 'bb-tag-missing';
      missingSpan.style.cssText = 'color:red; font-weight:bold; margin:0 3px;';
      missingSpan.title = `No tag found for ${r.label} (expected "${r.candidateTag}")`;
      missingSpan.textContent = ` ⚠️${r.candidateTag}`;
      span.appendChild(missingSpan);
    }

    // Append one missing-tag span per unmatched "On Stage"/"In Studio" tab
    // relation (or the tab's always-expected fixed tag itself).
    for (const r of unmatchedRelations) {
      const missingSpan = document.createElement('span');
      missingSpan.className = 'bb-tag-missing';
      missingSpan.style.cssText = 'color:red; font-weight:bold; margin:0 3px;';
      missingSpan.title = `No tag found for ${r.label} (expected "${r.candidateTag}")`;
      missingSpan.textContent = ` ⚠️${r.candidateTag}`;
      span.appendChild(missingSpan);
    }

    groupTagsIntoLines(tagsContainer);
    return { additionalTags, onstageUrl, tourCheck, eventAlias, tourTagAnchors };
  }

  /**
   * On VENUE pages: wraps .page-tags in a yellow warning box and annotates
   * missing / spurious venue tags inline on the live page.
   * No-op when all expected tags are present and no spurious managed tags exist.
   * @param {string} venueName - Text from the venue page's #page-title.
   */
  function annotateVenuePageTags(venueName) {
    const tagsContainer = document.querySelector('.page-tags');
    if (!tagsContainer) return;

    const tagLinks      = [...tagsContainer.querySelectorAll('a[href]')];
    const actualTags    = new Set(tagLinks.map(a => a.textContent.trim().toLowerCase()));
    const expectedTags  = computeExpectedVenueTags(venueName);
    const missingTags   = [...expectedTags].filter(t => !actualTags.has(t)).sort();
    const spuriousLinks = tagLinks.filter(a => {
      const tag = a.textContent.trim().toLowerCase();
      return isManagedVenueTag(tag) && !expectedTags.has(tag);
    });
    const passingLinks = tagLinks.filter(a => {
      const tag = a.textContent.trim().toLowerCase();
      return isManagedVenueTag(tag) && expectedTags.has(tag);
    });
    markPassingTagLinks(passingLinks, tag => {
      if (tag === 'venue') return 'Tag "venue" verified: this is a venue page';
      if (tag === 'underconstruction') return 'Tag "underconstruction" verified: page shows the "Under Construction" banner';
      return `Tag "${tag}" verified: matches the first letter of venue name "${venueName}"`;
    });

    // Tag-source-highlight setup (bbp_enable_tag_source_highlight) — wrapped
    // in try/catch: a failure resolving an optional highlight source must
    // never break the tag annotation/box-wrapping that follows.
    const highlightOn = Lib.settings.bbp_enable_tag_source_highlight;
    let titleEl = null, venueLoc = null;
    if (highlightOn) {
      try {
        titleEl = getPageTitleElement();
        venueLoc = parseVenuePageLocation(venueName);
      } catch (e) {
        logErr('annotateVenuePageTags/tag-source-highlight setup', e);
        titleEl = null; venueLoc = null;
      }
    }

    // Venue-name → tag check: venue/city/state/country parts of the venue
    // page's own title should each have a corresponding tag — each result
    // is resolved to its own substring of the title (resolveLocationSourceEl),
    // falling back to the whole title for usa/canada/COUNTRY_EXTRA_TAGS
    // results, which have no literal substring at all. Captures the
    // venue-name span (if created) for the first-letter tag below, which
    // must nest its highlight inside it — wrapping the venue name AFTER
    // the first character was already wrapped separately would fail to
    // find it (no longer a contiguous run of plain text).
    const locationResults    = checkVenuePageLocationTags(venueName, actualTags);
    const matchedLocations   = locationResults.filter(r => r.matchedTag);
    const unmatchedLocations = locationResults.filter(r => !r.matchedTag);
    let venueNameSpan = null;
    for (const r of matchedLocations) {
      const a = tagLinks.find(l => l.textContent.trim().toLowerCase() === r.matchedTag);
      let source = null;
      if (highlightOn && titleEl) {
        try {
          source = resolveLocationSourceEl(r, venueLoc, titleEl, titleEl);
          if (r.label.startsWith('Venue:') || r.label.startsWith('Venue part before')) venueNameSpan = source;
        } catch (e) {
          logErr('annotateVenuePageTags/tag-source-highlight location', e);
        }
      }
      if (a) markPassingTagLinks([a], tag => `Tag "${tag}" verified: matches venue ${r.label}`, source);
    }

    // Tag-source-highlight: the venue title's first character, for the
    // first-letter tag — layered on top via a direct wireTagSourceHighlight
    // call, same pattern as RETAIL's date tags/RELATION's name tags (the
    // batch above covers other tags with no single source, so it isn't
    // threaded through markPassingTagLinks). Nested inside venueNameSpan
    // when one was created above; falls back to titleEl directly when the
    // venue tag itself didn't match (so no venue-name span was wrapped).
    if (highlightOn && titleEl) {
      try {
        const firstChar = (venueName || '').trim()[0];
        if (firstChar && /[a-z]/i.test(firstChar)) {
          const a = passingLinks.find(l => l.textContent.trim().toLowerCase() === firstChar.toLowerCase());
          const span = a && wrapTextSubstring(venueNameSpan || titleEl, firstChar);
          if (span) wireTagSourceHighlight(a, span);
        }
      } catch (e) {
        logErr('annotateVenuePageTags/tag-source-highlight first-letter', e);
      }
    }

    // Fuzzy substring tag check: generic tags (FUZZY_SUBSTRING_TAGS) that are
    // present AND a case-insensitive substring of the event alias or the
    // page's free-text notes are verified. Never contributes to
    // missingTags — absence is not flagged.
    const aliasResults = checkAliasSubstringTags(extractEventAlias(document), actualTags);
    for (const r of aliasResults) {
      const a = tagLinks.find(l => l.textContent.trim().toLowerCase() === r.tag);
      if (a) markPassingTagLinks([a], tag => `Tag "${tag}" verified: ${r.label}`);
    }
    const notesResults = checkNotesSubstringTags(extractPageNotesText(document), actualTags);
    for (const r of notesResults) {
      const a = tagLinks.find(l => l.textContent.trim().toLowerCase() === r.tag);
      if (a) markPassingTagLinks([a], tag => `Tag "${tag}" verified: ${r.label}`);
    }

    if (missingTags.length === 0 && spuriousLinks.length === 0 && unmatchedLocations.length === 0) {
      const okWrapper = document.createElement('div');
      okWrapper.className = 'bb-tags-box';
      // BruceBase's own `.page-tags{clear:both}` rule clears the floated
      // #side-bar navigation column (needed on the *unwrapped* page so the
      // global #footer, which also clears it, doesn't visually collide with
      // it). #main-content is offset via margin-left, not float, so nothing
      // actually needs .page-tags itself to clear — #footer (which follows
      // right after in the DOM and carries the same clear:both) still does
      // that job on its own. Cancel the clear entirely here so this wrapper
      // renders immediately after the preceding content instead of leaving a
      // gap (either inside the border, or above it) sized to the sidebar.
      okWrapper.style.cssText = 'border:3px solid #2a2; background:#fffbe6; padding:6px 10px; border-radius:4px; margin:4px 0;';
      tagsContainer.parentNode.insertBefore(okWrapper, tagsContainer);
      okWrapper.appendChild(tagsContainer);
      tagsContainer.style.clear = 'none';
      groupTagsIntoLines(tagsContainer);
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'bb-tags-warn-box';
    // BruceBase's own `.page-tags{clear:both}` rule clears the floated
    // #side-bar navigation column (needed on the *unwrapped* page so the
    // global #footer, which also clears it, doesn't visually collide with
    // it). #main-content is offset via margin-left, not float, so nothing
    // actually needs .page-tags itself to clear — #footer (which follows
    // right after in the DOM and carries the same clear:both) still does
    // that job on its own. Cancel the clear entirely here so this wrapper
    // renders immediately after the preceding content instead of leaving a
    // gap (either inside the border, or above it) sized to the sidebar.
    wrapper.style.cssText = 'border:3px solid gold; background:#fffbe6; padding:6px 10px; border-radius:4px; margin:4px 0;';
    tagsContainer.parentNode.insertBefore(wrapper, tagsContainer);
    wrapper.appendChild(tagsContainer);
    tagsContainer.style.clear = 'none';

    for (const a of spuriousLinks) {
      const tag      = a.textContent.trim().toLowerCase();
      const msg      = `Tag "${tag}" is present but not expected for this venue`;
      const warnSpan = document.createElement('span');
      warnSpan.className = 'bb-tag-spurious';
      warnSpan.style.cssText = 'color:darkorange; font-weight:bold; cursor:help; margin:0 2px;';
      warnSpan.textContent = '⚠️';
      warnSpan.title = msg;
      a.after(warnSpan);
    }

    const span = tagsContainer.querySelector('span') || tagsContainer;
    for (const tag of missingTags) {
      const missingSpan = document.createElement('span');
      missingSpan.className = 'bb-tag-missing';
      missingSpan.style.cssText = 'color:red; font-weight:bold; margin:0 3px;';
      missingSpan.title = `Tag "${tag}" expected for this venue but not present`;
      missingSpan.textContent = ` ⚠️${tag}`;
      span.appendChild(missingSpan);
    }

    // Append one missing-tag span per unmatched venue-title location part
    // (venue name, city, state/country/region).
    for (const r of unmatchedLocations) {
      const missingSpan = document.createElement('span');
      missingSpan.className = 'bb-tag-missing';
      missingSpan.style.cssText = 'color:red; font-weight:bold; margin:0 3px;';
      missingSpan.title = `No tag found for ${r.label} (expected "${r.candidateTag}")`;
      missingSpan.textContent = ` ⚠️${r.candidateTag}`;
      span.appendChild(missingSpan);
    }

    groupTagsIntoLines(tagsContainer);
  }

  /**
   * Parses every "Month DD, YYYY" occurrence from the retail page's
   * "Commercially Released:" line in its metadata `<div class="code"><pre>
   * <code>…</code></pre></div>` block. A single retail page can list more
   * than one release date for different formats, each optionally followed
   * by a "(Label)" annotation, e.g. `"Commercially Released: April 18,
   * 2026 (Vinyl) / May 29, 2026 (CD)"`. Returns `[]` when no such line is
   * found.
   * @param {Document} [doc=document]
   * @returns {{month: string, day: string, year: string, label: string|null, raw: string, monthRaw: string, dayRaw: string}[]}
   */
  function parseRetailReleaseDates(doc = document) {
    const codeEl = doc.querySelector('div.code pre code, pre code');
    if (!codeEl) return [];
    const line = codeEl.textContent.split('\n').find(l => /^Commercially Released:/i.test(l));
    if (!line) return [];
    const dateRe = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})(?:\s*\(([^)]+)\))?/g;
    const dates = [];
    let m;
    while ((m = dateRe.exec(line)) !== null) {
      const monthIdx = MONTH_NAMES.indexOf(m[1].toLowerCase());
      if (monthIdx === -1) continue;
      dates.push({
        month: MONTH_NAMES[monthIdx],
        day:   m[2].padStart(2, '0'),
        year:  m[3],
        label: m[4] ? m[4].trim() : null,
        raw:   m[0].trim(),
        // Literal, unnormalized text as it actually appears in the source
        // line — `month`/`day` above are normalized (lowercase name,
        // zero-padded) for tag comparison, not verbatim, so the
        // tag-source-highlight feature (bbp_enable_tag_source_highlight)
        // uses these instead to find-and-wrap the real substring.
        monthRaw: m[1],
        dayRaw:   m[2],
      });
    }
    return dates;
  }

  /**
   * Returns the set of lowercase tags expected on a retail page: "retail"
   * + first-letter index tag, always; the lowercase month name, zero-
   * padded day-of-month, and year of every "Commercially Released" date
   * found by parseRetailReleaseDates (one page can list several, one per
   * release format); and "underconstruction" when the page shows
   * BruceBase's "Under Construction" banner (see hasUnderConstructionBanner).
   * @param {string}   retailName - Text from the retail page's #page-title.
   * @param {Document} [doc]      - Defaults to the live document.
   * @returns {Set<string>}
   */
  function computeExpectedRetailTags(retailName, doc = document) {
    const expected = new Set(['retail']);
    const first = (retailName || '').trim()[0];
    if (first && /[a-z]/i.test(first)) expected.add(first.toLowerCase());

    for (const d of parseRetailReleaseDates(doc)) {
      expected.add(d.month);
      expected.add(d.day);
      expected.add(d.year);
    }

    if (hasUnderConstructionBanner(doc)) expected.add('underconstruction');

    return expected;
  }

  /**
   * Returns true for retail-page tags whose presence can be verified:
   * the "retail" tag, "underconstruction", single lowercase letter tags
   * (first-letter index), month names, 4-digit years, and day-of-month
   * numbers (1–31).
   * @param {string} tag
   * @returns {boolean}
   */
  function isManagedRetailTag(tag) {
    if (tag === 'retail') return true;
    if (tag === 'underconstruction') return true;
    if (/^[a-z]$/.test(tag)) return true;
    if (MONTH_NAMES.includes(tag)) return true;
    if (/^\d{4}$/.test(tag)) return true;
    if (/^\d{1,2}$/.test(tag) && parseInt(tag, 10) >= 1 && parseInt(tag, 10) <= 31) return true;
    return false;
  }

  /**
   * On RETAIL pages: wraps .page-tags in a yellow warning box and annotates
   * missing / spurious retail tags inline on the live page.
   * No-op when all expected tags are present and no spurious managed tags exist.
   * @param {string} retailName - Text from the retail page's #page-title.
   */
  function annotateRetailPageTags(retailName) {
    const tagsContainer = document.querySelector('.page-tags');
    if (!tagsContainer) return;

    const tagLinks      = [...tagsContainer.querySelectorAll('a[href]')];
    const actualTags    = new Set(tagLinks.map(a => a.textContent.trim().toLowerCase()));
    const releaseDates  = parseRetailReleaseDates(document);
    const expectedTags  = computeExpectedRetailTags(retailName);
    const missingTags   = [...expectedTags].filter(t => !actualTags.has(t)).sort();
    const spuriousLinks = tagLinks.filter(a => {
      const tag = a.textContent.trim().toLowerCase();
      return isManagedRetailTag(tag) && !expectedTags.has(tag);
    });
    const passingLinks = tagLinks.filter(a => {
      const tag = a.textContent.trim().toLowerCase();
      return isManagedRetailTag(tag) && expectedTags.has(tag);
    });

    // Describes which "Commercially Released" date(s) a month/day/year tag
    // matches, naming the specific date (with its "(Label)" if any) so a
    // page listing several release dates gets an unambiguous tooltip.
    const describeDateTag = (tag, verb) => {
      const matches = releaseDates.filter(d => d.month === tag || d.day === tag || d.year === tag);
      if (matches.length === 0) return null;
      const kind   = MONTH_NAMES.includes(tag) ? 'Month' : /^\d{4}$/.test(tag) ? 'Year' : 'Day';
      const plural = matches.length > 1 ? 's' : '';
      const dates  = matches.map(d => d.raw).join(' and ');
      return verb === 'verified'
        ? `${kind} tag "${tag}" verified: matches "Commercially Released" date${plural} ${dates}`
        : `${kind} tag "${tag}" expected: matches "Commercially Released" date${plural} ${dates} but not present`;
    };

    markPassingTagLinks(passingLinks, tag => {
      if (tag === 'retail') return 'Tag "retail" verified: this is a retail page';
      if (tag === 'underconstruction') return 'Tag "underconstruction" verified: page shows the "Under Construction" banner';
      if (/^[a-z]$/.test(tag)) return `Tag "${tag}" verified: matches the first letter of retail name "${retailName}"`;
      return describeDateTag(tag, 'verified') || `Tag "${tag}" verified: matches the "Commercially Released" date`;
    });

    // Tag-source-highlight (bbp_enable_tag_source_highlight): each date's
    // month/day/year gets its own substring wrapped — first the whole raw
    // match (e.g. "April 18, 2026 (Vinyl)"), then month/day/year nested
    // within it, so a page listing several dates on one line still
    // highlights only the specific date/component a tag matches. The
    // first-letter tag gets the title's first character. "retail"/
    // "underconstruction" have no single source — layered on top of the
    // generic marking above rather than threaded through it. Wrapped in
    // try/catch: a failure here must never break the tag annotation/
    // box-wrapping that follows.
    if (Lib.settings.bbp_enable_tag_source_highlight) {
      try {
        const codeEl = document.querySelector('div.code pre code, pre code');
        if (codeEl) {
          for (const d of releaseDates) {
            const rawSpan = wrapTextSubstring(codeEl, d.raw);
            if (!rawSpan) continue;
            const monthSpan = wrapTextSubstring(rawSpan, d.monthRaw);
            const daySpan   = wrapTextSubstring(rawSpan, d.dayRaw);
            const yearSpan  = wrapTextSubstring(rawSpan, d.year);
            for (const a of passingLinks) {
              const tag = a.textContent.trim().toLowerCase();
              if (tag === d.month)     wireTagSourceHighlight(a, monthSpan || rawSpan);
              else if (tag === d.day)  wireTagSourceHighlight(a, daySpan || rawSpan);
              else if (tag === d.year) wireTagSourceHighlight(a, yearSpan || rawSpan);
            }
          }
        }
        const titleEl = getPageTitleElement();
        if (titleEl) {
          const firstChar = (retailName || '').trim()[0];
          if (firstChar && /[a-z]/i.test(firstChar)) {
            const a = passingLinks.find(l => l.textContent.trim().toLowerCase() === firstChar.toLowerCase());
            const span = a && wrapTextSubstring(titleEl, firstChar);
            if (span) wireTagSourceHighlight(a, span);
          }
        }
      } catch (e) {
        logErr('annotateRetailPageTags/tag-source-highlight', e);
      }
    }

    if (missingTags.length === 0 && spuriousLinks.length === 0) {
      const okWrapper = document.createElement('div');
      okWrapper.className = 'bb-tags-box';
      // BruceBase's own `.page-tags{clear:both}` rule clears the floated
      // #side-bar navigation column (needed on the *unwrapped* page so the
      // global #footer, which also clears it, doesn't visually collide with
      // it). #main-content is offset via margin-left, not float, so nothing
      // actually needs .page-tags itself to clear — #footer (which follows
      // right after in the DOM and carries the same clear:both) still does
      // that job on its own. Cancel the clear entirely here so this wrapper
      // renders immediately after the preceding content instead of leaving a
      // gap (either inside the border, or above it) sized to the sidebar.
      okWrapper.style.cssText = 'border:3px solid #2a2; background:#fffbe6; padding:6px 10px; border-radius:4px; margin:4px 0;';
      tagsContainer.parentNode.insertBefore(okWrapper, tagsContainer);
      okWrapper.appendChild(tagsContainer);
      tagsContainer.style.clear = 'none';
      groupTagsIntoLines(tagsContainer);
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'bb-tags-warn-box';
    // BruceBase's own `.page-tags{clear:both}` rule clears the floated
    // #side-bar navigation column (needed on the *unwrapped* page so the
    // global #footer, which also clears it, doesn't visually collide with
    // it). #main-content is offset via margin-left, not float, so nothing
    // actually needs .page-tags itself to clear — #footer (which follows
    // right after in the DOM and carries the same clear:both) still does
    // that job on its own. Cancel the clear entirely here so this wrapper
    // renders immediately after the preceding content instead of leaving a
    // gap (either inside the border, or above it) sized to the sidebar.
    wrapper.style.cssText = 'border:3px solid gold; background:#fffbe6; padding:6px 10px; border-radius:4px; margin:4px 0;';
    tagsContainer.parentNode.insertBefore(wrapper, tagsContainer);
    wrapper.appendChild(tagsContainer);
    tagsContainer.style.clear = 'none';

    for (const a of spuriousLinks) {
      const tag      = a.textContent.trim().toLowerCase();
      const msg      = `Tag "${tag}" is present but not expected for this retail page`;
      const warnSpan = document.createElement('span');
      warnSpan.className = 'bb-tag-spurious';
      warnSpan.style.cssText = 'color:darkorange; font-weight:bold; cursor:help; margin:0 2px;';
      warnSpan.textContent = '⚠️';
      warnSpan.title = msg;
      a.after(warnSpan);
    }

    const span = tagsContainer.querySelector('span') || tagsContainer;
    for (const tag of missingTags) {
      const missingSpan = document.createElement('span');
      missingSpan.className = 'bb-tag-missing';
      missingSpan.style.cssText = 'color:red; font-weight:bold; margin:0 3px;';
      missingSpan.title = tag === 'underconstruction'
        ? 'Tag "underconstruction" expected: page shows the "Under Construction" banner but the tag is not present'
        : (describeDateTag(tag, 'expected') || `Tag "${tag}" expected for this retail page but not present`);
      missingSpan.textContent = ` ⚠️${tag}`;
      span.appendChild(missingSpan);
    }

    groupTagsIntoLines(tagsContainer);
  }

  // ── Song page tag helpers ─────────────────────────────────────────────────

  /**
   * Returns the set of lowercase tags expected on a song page: "song"
   * (always), the first letter of the song title, and "lyricsheet" when the
   * Gallery tab has an image whose filename contains "lyricsheet". Delegates
   * to computeExpectedYearSongTags (used by the YEAR page's nested "Song
   * Tags" button) since the rules are identical, just against the live
   * `document` instead of a fetched one.
   * @param {string}             songName - Text from the song page's #page-title.
   * @param {Map<string,number>} tabMap   - buildTabMap(document) result.
   * @returns {Set<string>}
   */
  function computeExpectedSongTags(songName, tabMap) {
    return computeExpectedYearSongTags(document, tabMap, songName);
  }

  /**
   * Returns true for song-page tags whose presence can be verified: "song",
   * "lyricsheet", and single lowercase letter tags (first-letter index).
   * Delegates to isManagedYearSongTag — see computeExpectedSongTags.
   * @param {string} tag
   * @returns {boolean}
   */
  function isManagedSongTag(tag) {
    return isManagedYearSongTag(tag);
  }

  /**
   * On SONG pages: wraps .page-tags in a yellow warning box and annotates
   * missing / spurious song tags inline on the live page. Also requires the
   * exact-title-slug tag (checkSongExactTitleTag) and recognizes (without
   * requiring) the derived-alias tag (checkSongAliasTagRecognition), marking
   * either green when present.
   * No-op when all expected tags are present and no spurious managed tags exist.
   * @param {string}             songName - Text from the song page's #page-title.
   * @param {Map<string,number>} tabMap   - buildTabMap(document) result.
   */
  function annotateSongPageTags(songName, tabMap) {
    const tagsContainer = document.querySelector('.page-tags');
    if (!tagsContainer) return;

    const tagLinks     = [...tagsContainer.querySelectorAll('a[href]')];
    const actualTags   = new Set(tagLinks.map(a => a.textContent.trim().toLowerCase()));
    const expectedTags = computeExpectedSongTags(songName, tabMap);
    const missingTags  = [...expectedTags].filter(t => !actualTags.has(t)).sort();
    const spuriousLinks = tagLinks.filter(a => {
      const tag = a.textContent.trim().toLowerCase();
      return isManagedSongTag(tag) && !expectedTags.has(tag);
    });
    const passingLinks = tagLinks.filter(a => {
      const tag = a.textContent.trim().toLowerCase();
      return isManagedSongTag(tag) && expectedTags.has(tag);
    });
    markPassingTagLinks(passingLinks, tag => tag === 'song'
      ? 'Tag "song" verified: this is a song page'
      : tag === 'lyricsheet'
      ? 'Tag "lyricsheet" verified: Gallery tab has lyricsheet image(s)'
      : tag === 'underconstruction'
      ? 'Tag "underconstruction" verified: page shows the "Under Construction" banner'
      : `Tag "${tag}" verified: matches the first letter of song title "${songName}"`);

    // Tag-source-highlight (bbp_enable_tag_source_highlight): both title-
    // derived tags below share the whole title element as their artefact,
    // same "no per-component split" reasoning as the DETAIL/VENUE location
    // check. Wrapped in try/catch: a failure here must never break the tag
    // annotation/box-wrapping that follows.
    const highlightOn = Lib.settings.bbp_enable_tag_source_highlight;
    let titleEl = null;
    if (highlightOn) {
      try {
        titleEl = getPageTitleElement();
        // First-letter tag: just the title's first character — layered on
        // top via a direct wireTagSourceHighlight call (the batch above
        // covers "song"/"lyricsheet"/"underconstruction" too, which have
        // no single source, so it isn't threaded through markPassingTagLinks).
        if (titleEl) {
          const firstChar = (songName || '').trim()[0];
          if (firstChar && /[a-z]/i.test(firstChar)) {
            const a = passingLinks.find(l => l.textContent.trim().toLowerCase() === firstChar.toLowerCase());
            const span = a && wrapTextSubstring(titleEl, firstChar);
            if (span) wireTagSourceHighlight(a, span);
          }
        }
      } catch (e) {
        logErr('annotateSongPageTags/tag-source-highlight', e);
      }
    }

    // Exact-title-slug tag: a hard requirement, e.g. "BORN TO RUN" -> "borntorun".
    const exactCheck = checkSongExactTitleTag(songName, actualTags);
    if (exactCheck.matchedTag) {
      const a = tagLinks.find(l => l.textContent.trim().toLowerCase() === exactCheck.matchedTag);
      if (a) markPassingTagLinks([a], tag => `Tag "${tag}" verified: matches the song title "${songName}" (lowercase, punctuation stripped)`, titleEl);
    }

    // Derived-alias tag: recognized (but not required) — e.g. "BORN TO RUN" -> "btr".
    const aliasCheck = checkSongAliasTagRecognition(songName, actualTags, exactCheck.tag);
    if (aliasCheck && aliasCheck.matchedTag) {
      const a = tagLinks.find(l => l.textContent.trim().toLowerCase() === aliasCheck.matchedTag);
      if (a) markPassingTagLinks([a], tag => `Tag "${tag}" recognized: matches the derived first-letter-per-word alias of song title "${songName}"`, titleEl);
    }

    // Fuzzy substring tag check: generic tags (FUZZY_SUBSTRING_TAGS) that are
    // present AND a case-insensitive substring of the event alias or the
    // page's free-text notes are verified. Never contributes to
    // missingTags — absence is not flagged.
    const aliasResults = checkAliasSubstringTags(extractEventAlias(document), actualTags);
    for (const r of aliasResults) {
      const a = tagLinks.find(l => l.textContent.trim().toLowerCase() === r.tag);
      if (a) markPassingTagLinks([a], tag => `Tag "${tag}" verified: ${r.label}`);
    }
    const notesResults = checkNotesSubstringTags(extractPageNotesText(document), actualTags);
    for (const r of notesResults) {
      const a = tagLinks.find(l => l.textContent.trim().toLowerCase() === r.tag);
      if (a) markPassingTagLinks([a], tag => `Tag "${tag}" verified: ${r.label}`);
    }

    if (missingTags.length === 0 && spuriousLinks.length === 0 && exactCheck.matchedTag) {
      const okWrapper = document.createElement('div');
      okWrapper.className = 'bb-tags-box';
      // BruceBase's own `.page-tags{clear:both}` rule clears the floated
      // #side-bar navigation column (needed on the *unwrapped* page so the
      // global #footer, which also clears it, doesn't visually collide with
      // it). #main-content is offset via margin-left, not float, so nothing
      // actually needs .page-tags itself to clear — #footer (which follows
      // right after in the DOM and carries the same clear:both) still does
      // that job on its own. Cancel the clear entirely here so this wrapper
      // renders immediately after the preceding content instead of leaving a
      // gap (either inside the border, or above it) sized to the sidebar.
      okWrapper.style.cssText = 'border:3px solid #2a2; background:#fffbe6; padding:6px 10px; border-radius:4px; margin:4px 0;';
      tagsContainer.parentNode.insertBefore(okWrapper, tagsContainer);
      okWrapper.appendChild(tagsContainer);
      tagsContainer.style.clear = 'none';
      groupTagsIntoLines(tagsContainer);
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'bb-tags-warn-box';
    // BruceBase's own `.page-tags{clear:both}` rule clears the floated
    // #side-bar navigation column (needed on the *unwrapped* page so the
    // global #footer, which also clears it, doesn't visually collide with
    // it). #main-content is offset via margin-left, not float, so nothing
    // actually needs .page-tags itself to clear — #footer (which follows
    // right after in the DOM and carries the same clear:both) still does
    // that job on its own. Cancel the clear entirely here so this wrapper
    // renders immediately after the preceding content instead of leaving a
    // gap (either inside the border, or above it) sized to the sidebar.
    wrapper.style.cssText = 'border:3px solid gold; background:#fffbe6; padding:6px 10px; border-radius:4px; margin:4px 0;';
    tagsContainer.parentNode.insertBefore(wrapper, tagsContainer);
    wrapper.appendChild(tagsContainer);
    tagsContainer.style.clear = 'none';

    for (const a of spuriousLinks) {
      const tag      = a.textContent.trim().toLowerCase();
      const msg      = `Tag "${tag}" is present but not expected for this song page`;
      const warnSpan = document.createElement('span');
      warnSpan.className = 'bb-tag-spurious';
      warnSpan.style.cssText = 'color:darkorange; font-weight:bold; cursor:help; margin:0 2px;';
      warnSpan.textContent = '⚠️';
      warnSpan.title = msg;
      a.after(warnSpan);
    }

    const span = tagsContainer.querySelector('span') || tagsContainer;
    for (const tag of missingTags) {
      const missingSpan = document.createElement('span');
      missingSpan.className = 'bb-tag-missing';
      missingSpan.style.cssText = 'color:red; font-weight:bold; margin:0 3px;';
      missingSpan.title = `Tag "${tag}" expected for this song page but not present`;
      missingSpan.textContent = ` ⚠️${tag}`;
      span.appendChild(missingSpan);
    }

    if (!exactCheck.matchedTag) {
      const missingSpan = document.createElement('span');
      missingSpan.className = 'bb-tag-missing';
      missingSpan.style.cssText = 'color:red; font-weight:bold; margin:0 3px;';
      missingSpan.title = `Tag "${exactCheck.tag}" expected (exact match of song title "${songName}") but not present`;
      missingSpan.textContent = ` ⚠️${exactCheck.tag}`;
      span.appendChild(missingSpan);
    }

    groupTagsIntoLines(tagsContainer);
  }

  // ── Relation page tag helpers ─────────────────────────────────────────────

  /**
   * Returns the set of lowercase tags expected on a relation page.
   * Presence of a "Bands" tab → expects "person".
   * Presence of a "Members" tab → expects "band".
   * Also expects "underconstruction" when the page shows BruceBase's
   * "Under Construction" banner (see hasUnderConstructionBanner).
   * Uses the live document's .yui-nav to detect tab labels.
   * @returns {Set<string>}
   */
  function computeExpectedRelationTags() {
    const tabLabels = new Set(
      [...document.querySelectorAll('.yui-nav em')].map(em => em.textContent.trim())
    );
    const expected = new Set();
    if (tabLabels.has('Bands'))   expected.add('person');
    if (tabLabels.has('Members')) expected.add('band');
    if (hasUnderConstructionBanner(document)) expected.add('underconstruction');
    return expected;
  }

  /**
   * Returns true for relation-page tags whose presence can be verified.
   * @param {string} tag
   * @returns {boolean}
   */
  function isManagedRelationTag(tag) {
    return tag === 'person' || tag === 'band' || tag === 'underconstruction';
  }

  /**
   * Parses a person relation page's "<Surname>, <Name>" #page-title text
   * (e.g. "Federici, Danny") into its parts. Returns null when the title
   * isn't a single comma-separated "Surname, Name" pair (e.g. band titles
   * like "E Street Band, The", which use the same comma but aren't a person).
   * @param {string} titleText
   * @returns {{surname:string, name:string}|null}
   */
  function parseRelationPersonTitle(titleText) {
    const parts = titleText.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length !== 2) return null;
    const [surname, name] = parts;
    return surname && name ? { surname, name } : null;
  }

  /**
   * Strips a trailing ", The" from a band name, e.g. "E Street Band, The" ->
   * "E Street Band". Case-insensitive; leaves other names unchanged.
   * @param {string} name
   * @returns {string}
   */
  function stripTrailingThe(name) {
    return name.replace(/,\s*The$/i, '').trim();
  }

  /**
   * Strips a leading "The " from a name, e.g. "The Houserockers" ->
   * "Houserockers". Case-insensitive; leaves other names unchanged.
   * @param {string} name
   * @returns {string}
   */
  function stripLeadingThe(name) {
    return name.replace(/^The\s+/i, '').trim();
  }

  /**
   * Splits a band name on " & " into its independent parts (e.g. "Joe
   * Grushecky & The Houserockers" -> ["Joe Grushecky", "The Houserockers"]),
   * or returns the name as its own single-element array when there's no
   * "&". Each part still needs stripLeadingThe/stripTrailingThe applied.
   * @param {string} name
   * @returns {string[]}
   */
  function splitAmpersandName(name) {
    return name.split(' & ').map(s => s.trim()).filter(Boolean);
  }

  /**
   * Normalizes a person/band name into its expected tag form: lowercase,
   * accent-stripped, with all whitespace and "." removed, e.g. "Dr. Zoom"
   * -> "drzoom", "Jörgen Johansson" -> "jorgenjohansson".
   * @param {string} name
   * @returns {string}
   */
  function normalizeRelationTagName(name) {
    return stripDiacritics(name).toLowerCase().replace(/[.\s]/g, '');
  }

  /**
   * Returns the "/relation:..." links within a relation-page tab that
   * represent a clean, single-entry list item — i.e. links whose immediate
   * parent element's text is exactly the link's own text, with no extra
   * prose attached (a role annotation like "(piano)", a date range, etc.).
   * This is what distinguishes a genuine band/member list entry (e.g.
   * "<li><a>The Rogues</a></li>") from an incidental relation mention
   * inside free-text content that some tabs append after the real list —
   * e.g. a band's "Members" tab followed by a lineup timeline listing
   * "<li><a>Clarence Clemons</a> (saxophone)</li>" for people who aren't
   * all necessarily current/actual members. Deliberately not restricted to
   * any single wrapper element, since some tabs render their primary list
   * as a bare <ul> (not wrapped in .list-pages-box) and follow it with a
   * second, still-relevant list — e.g. a person's "Bands" tab can have an
   * unwrapped list of their own bands followed by a .list-pages-box-wrapped
   * "Other Bands" list; both are picked up equally by this check.
   * @param {HTMLElement|null} tab
   * @returns {HTMLAnchorElement[]}
   */
  function collectRelationListLinks(tab) {
    if (!tab) return [];
    const norm = s => s.trim().replace(/\s+/g, ' ');
    return [...tab.querySelectorAll('a[href^="/relation:"]')].filter(a =>
      norm(a.parentElement ? a.parentElement.textContent : '') === norm(a.textContent)
    );
  }

  /**
   * Returns additional lowercase tags expected on a relation page, keyed to
   * a human-readable reason plus the source `<a>` link(s) that produced the
   * tag, if any (so callers can show the same "verified" message used for
   * the managed person/band tags, and also colorize the corresponding
   * band/member name link on the "Bands"/"Members" tab — see
   * annotateRelationPageTags):
   *
   * - Person relation (has a "Bands" tab, #page-title is "<Surname>,
   *   <Name>"): the first letter of the Surname, the concatenation of
   *   Name+Surname (neither has a source link — derived from #page-title,
   *   not a tab entry), and one or two tags per band listed on the "Bands"
   *   tab. A band name containing " & " is first split into its two
   *   independent parts (e.g. "Joe Grushecky & The Houserockers" -> "Joe
   *   Grushecky" and "The Houserockers"), each becoming its own expected
   *   tag sharing the same source link; a name without "&" yields a single
   *   tag. Either way each part gets a leading "The " and/or a trailing
   *   ", The" stripped before deriving the tag.
   * - Band relation (has a "Members" tab, #page-title is the band name,
   *   optionally with a trailing ", The"): the first letter of the band
   *   name (", The" stripped first; no source link), and one Name+Surname
   *   concatenation tag per member listed on the "Members" tab (each in the
   *   same "<Surname>, <Name>" format as a person #page-title).
   *
   * Band/member link extraction uses collectRelationListLinks, so multi-list
   * tabs (e.g. a person's own bands followed by an "Other Bands" list) are
   * fully covered while trailing unrelated content (e.g. a "Members" tab's
   * lineup timeline) is excluded. Returns an empty map when neither tab is
   * present or the title/list can't be parsed.
   * @param {Document} [doc=document] - Relation page document (defaults to
   *   the live document; pass a fetched relDoc for the YEAR page's nested
   *   relation "Tags" button — see addRelationTagsButton).
   * @returns {Map<string, {message: string, links: HTMLAnchorElement[]}>}
   */
  function computeExpectedRelationNameTags(doc = document) {
    const expected = new Map();
    const addExpected = (tag, message, link) => {
      if (expected.has(tag)) {
        if (link) expected.get(tag).links.push(link);
      } else {
        expected.set(tag, { message, links: link ? [link] : [] });
      }
    };
    // `links` above is also read by annotateRelationPageTags' unconditional
    // "colorize every real name link green" loop — a span wrapped purely
    // for tag-source-highlight is NOT a real name link, so it must never go
    // into `links` (doing so once made a hover-only highlight look
    // permanently green/bold instead). setHighlightSpan stores it in its
    // own field, read only by the separate hover-highlight wiring.
    const setHighlightSpan = (tag, span) => {
      if (span && expected.has(tag)) expected.get(tag).highlightSpan = span;
    };

    const tabLabels = new Set(
      [...doc.querySelectorAll('.yui-nav em')].map(em => em.textContent.trim())
    );
    const titleEl = doc.getElementById('page-title');
    const titleText = titleEl ? titleEl.textContent.trim() : '';
    const tabMap = buildTabMap(doc);
    // Tag-source-highlight (bbp_enable_tag_source_highlight), live page
    // only — this function is also called with a detached fetched
    // Document (YEAR page's nested Relation Tags button), where wrapping
    // text would be pointless (never hovered). safeWrapFirstChar is
    // try/catch-guarded: this function's result feeds the actual expected-
    // tag computation (missingTags etc.), so a highlight-only failure must
    // never propagate and break that.
    const highlightOn = doc === document && Lib.settings.bbp_enable_tag_source_highlight;
    const titleH1 = highlightOn ? getPageTitleElement(doc) : null;
    const safeWrapFirstChar = (text) => {
      if (!titleH1 || !text) return null;
      try {
        return wrapTextSubstring(titleH1, text.trim()[0]);
      } catch (e) {
        logErr('computeExpectedRelationNameTags/tag-source-highlight', e);
        return null;
      }
    };

    if (tabLabels.has('Bands')) {
      const person = parseRelationPersonTitle(titleText);
      if (person) {
        const letterTag = person.surname[0].toLowerCase();
        addExpected(letterTag, `Tag "${letterTag}" verified: first letter of surname "${person.surname}"`, null);
        setHighlightSpan(letterTag, safeWrapFirstChar(person.surname));
        const nameTag = normalizeRelationTagName(person.name + person.surname);
        addExpected(nameTag, `Tag "${nameTag}" verified: lowercase concatenation of "${person.name}" + "${person.surname}"`, null);
      }

      for (const a of collectRelationListLinks(getTabEl(doc, tabMap, 'Bands'))) {
        const rawBandName = a.textContent.trim();
        for (const part of splitAmpersandName(rawBandName)) {
          const bandName = stripLeadingThe(stripTrailingThe(part));
          if (!bandName) continue;
          const tag = normalizeRelationTagName(bandName);
          addExpected(tag, `Tag "${tag}" verified: page lists "${rawBandName}" on the "Bands" tab`, a);
        }
      }
    }

    if (tabLabels.has('Members')) {
      const bandName = stripTrailingThe(titleText);
      if (bandName) {
        const letterTag = bandName[0].toLowerCase();
        addExpected(letterTag, `Tag "${letterTag}" verified: first letter of band name "${bandName}"`, null);
        setHighlightSpan(letterTag, safeWrapFirstChar(bandName));
      }

      for (const a of collectRelationListLinks(getTabEl(doc, tabMap, 'Members'))) {
        const member = parseRelationPersonTitle(a.textContent.trim());
        if (!member) continue;
        const tag = normalizeRelationTagName(member.name + member.surname);
        addExpected(tag, `Tag "${tag}" verified: page lists "${member.surname}, ${member.name}" on the "Members" tab`, a);
      }
    }

    return expected;
  }

  /**
   * On RELATION pages: wraps .page-tags in a yellow warning box and annotates
   * missing / spurious relation tags inline on the live page.
   * No-op when all expected tags are present, no spurious managed tags exist,
   * or when no determinate tab ("Bands" / "Members") is found.
   */
  /**
   * Scans the YUI tabs on the live RELATION page and appends a ⚠️ to the nav
   * label of any tab whose content panel is absent or effectively empty.
   */
  function annotateEmptyRelationTabs() {
    const tabMap = buildTabMap(document);
    if (!tabMap.size) return;
    const navEms = [...document.querySelectorAll('.yui-nav em')];
    for (const [label, idx] of tabMap) {
      const em  = navEms[idx];
      if (!em) continue;
      const tab     = document.getElementById(`wiki-tab-0-${idx}`);
      if (!isRelationTabEmpty(tab)) continue;
      const msg = !tab
        ? `Tab "${label}" has no content (panel not rendered by server).`
        : SORRY_RE.test(tab.textContent.trim())
          ? `Tab "${label}" reports no content available.`
          : `Tab "${label}" is empty.`;
      const warn = document.createElement('span');
      warn.className = 'bb-relation-tab-warn';
      warn.textContent = ' ⚠️';
      warn.dataset.msg = msg;
      warn.title = msg;
      warn.style.cursor = 'help';
      em.appendChild(warn);
    }
  }

  function annotateRelationPageTags() {
    const tagsContainer = document.querySelector('.page-tags');
    if (!tagsContainer) return;

    const tagLinks         = [...tagsContainer.querySelectorAll('a[href]')];
    const actualTags       = new Set(tagLinks.map(a => a.textContent.trim().toLowerCase()));
    const expectedTags     = computeExpectedRelationTags();
    const expectedNameTags = computeExpectedRelationNameTags();
    const allExpectedTags  = new Set([...expectedTags, ...expectedNameTags.keys()]);
    if (allExpectedTags.size === 0) return;   // can't determine person vs band — skip
    const missingTags  = [...allExpectedTags].filter(t => !actualTags.has(t)).sort();
    const spuriousLinks = tagLinks.filter(a => {
      const tag = a.textContent.trim().toLowerCase();
      return isManagedRelationTag(tag) && !expectedTags.has(tag);
    });
    const passingLinks = tagLinks.filter(a => {
      const tag = a.textContent.trim().toLowerCase();
      return isManagedRelationTag(tag) && expectedTags.has(tag);
    });
    markPassingTagLinks(passingLinks, tag => tag === 'person'
      ? 'Tag "person" verified: page has a "Bands" tab (this entry belongs to bands)'
      : tag === 'band'
      ? 'Tag "band" verified: page has a "Members" tab (this entry has members)'
      : 'Tag "underconstruction" verified: page shows the "Under Construction" banner');

    const passingNameLinks = tagLinks.filter(a =>
      expectedNameTags.has(a.textContent.trim().toLowerCase())
    );
    markPassingTagLinks(passingNameLinks, tag => expectedNameTags.get(tag).message);

    // Tag-source-highlight (bbp_enable_tag_source_highlight): each name tag
    // has its own source band/member link(s) (expectedNameTags's `links`) —
    // heterogeneous per tag, so layered on top via a follow-up loop rather
    // than threaded through the batch markPassingTagLinks call above. The
    // own-title letter tag's source is `highlightSpan` instead (a synthetic
    // wrapper span, deliberately NOT in `links` — see computeExpectedRelationNameTags —
    // so the colorization loop below doesn't also mark it permanently green).
    if (Lib.settings.bbp_enable_tag_source_highlight) {
      for (const a of passingNameLinks) {
        const info = expectedNameTags.get(a.textContent.trim().toLowerCase());
        const sources = [...(info?.links ?? []), ...(info?.highlightSpan ? [info.highlightSpan] : [])];
        if (sources.length) wireTagSourceHighlight(a, sources);
      }
    }

    // Colorize each verified tag's own source band/member name link(s) on
    // the "Bands"/"Members" tab (e.g. "The Rogues", "Bittan, Roy") green.
    for (const [tag, info] of expectedNameTags) {
      if (!actualTags.has(tag)) continue;
      for (const nameLink of info.links) {
        nameLink.classList.add('bb-relation-name-ok');
        nameLink.title = `Verified: tag "${tag}" is present in this page's tags`;
      }
    }

    // Fuzzy substring tag check: generic tags (FUZZY_SUBSTRING_TAGS) that are
    // present AND a case-insensitive substring of the event alias or the
    // page's free-text notes are verified. Never contributes to
    // missingTags — absence is not flagged.
    const aliasResults = checkAliasSubstringTags(extractEventAlias(document), actualTags);
    for (const r of aliasResults) {
      const a = tagLinks.find(l => l.textContent.trim().toLowerCase() === r.tag);
      if (a) markPassingTagLinks([a], tag => `Tag "${tag}" verified: ${r.label}`);
    }
    const notesResults = checkNotesSubstringTags(extractPageNotesText(document), actualTags);
    for (const r of notesResults) {
      const a = tagLinks.find(l => l.textContent.trim().toLowerCase() === r.tag);
      if (a) markPassingTagLinks([a], tag => `Tag "${tag}" verified: ${r.label}`);
    }

    if (missingTags.length === 0 && spuriousLinks.length === 0) {
      const okWrapper = document.createElement('div');
      okWrapper.className = 'bb-tags-box';
      // BruceBase's own `.page-tags{clear:both}` rule clears the floated
      // #side-bar navigation column (needed on the *unwrapped* page so the
      // global #footer, which also clears it, doesn't visually collide with
      // it). #main-content is offset via margin-left, not float, so nothing
      // actually needs .page-tags itself to clear — #footer (which follows
      // right after in the DOM and carries the same clear:both) still does
      // that job on its own. Cancel the clear entirely here so this wrapper
      // renders immediately after the preceding content instead of leaving a
      // gap (either inside the border, or above it) sized to the sidebar.
      okWrapper.style.cssText = 'border:3px solid #2a2; background:#fffbe6; padding:6px 10px; border-radius:4px; margin:4px 0;';
      tagsContainer.parentNode.insertBefore(okWrapper, tagsContainer);
      okWrapper.appendChild(tagsContainer);
      tagsContainer.style.clear = 'none';
      groupTagsIntoLines(tagsContainer);
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'bb-tags-warn-box';
    // BruceBase's own `.page-tags{clear:both}` rule clears the floated
    // #side-bar navigation column (needed on the *unwrapped* page so the
    // global #footer, which also clears it, doesn't visually collide with
    // it). #main-content is offset via margin-left, not float, so nothing
    // actually needs .page-tags itself to clear — #footer (which follows
    // right after in the DOM and carries the same clear:both) still does
    // that job on its own. Cancel the clear entirely here so this wrapper
    // renders immediately after the preceding content instead of leaving a
    // gap (either inside the border, or above it) sized to the sidebar.
    wrapper.style.cssText = 'border:3px solid gold; background:#fffbe6; padding:6px 10px; border-radius:4px; margin:4px 0;';
    tagsContainer.parentNode.insertBefore(wrapper, tagsContainer);
    wrapper.appendChild(tagsContainer);
    tagsContainer.style.clear = 'none';

    for (const a of spuriousLinks) {
      const tag      = a.textContent.trim().toLowerCase();
      const msg      = `Tag "${tag}" is present but not expected for this relation page`;
      const warnSpan = document.createElement('span');
      warnSpan.className = 'bb-tag-spurious';
      warnSpan.style.cssText = 'color:darkorange; font-weight:bold; cursor:help; margin:0 2px;';
      warnSpan.textContent = '⚠️';
      warnSpan.title = msg;
      a.after(warnSpan);
    }

    const span = tagsContainer.querySelector('span') || tagsContainer;
    for (const tag of missingTags) {
      const missingSpan = document.createElement('span');
      missingSpan.className = 'bb-tag-missing';
      missingSpan.style.cssText = 'color:red; font-weight:bold; margin:0 3px;';
      missingSpan.title = `Tag "${tag}" expected for this relation page but not present`;
      missingSpan.textContent = ` ⚠️${tag}`;
      span.appendChild(missingSpan);
    }

    groupTagsIntoLines(tagsContainer);
  }

  /**
   * Flags a YEAR page's "Featured" icon with a ⚠️ warning glyph (and
   * tooltip) when the linked DETAIL page (doc) doesn't have the "featured"
   * tag. No-op when the tag is present — computeExpectedTags/
   * MANAGED_CONTENT_TAGS already colorizes it green in .page-tags on the
   * DETAIL page itself, and no icon-side annotation is needed there.
   * @param {HTMLImageElement} icon - The "Featured" <img class="image"> on the YEAR page.
   * @param {Document}         doc  - Fetched DETAIL page document.
   */
  function flagFeaturedIconIfTagMissing(icon, doc) {
    const tagLinks   = [...(doc.querySelector('.page-tags')?.querySelectorAll('a[href]') ?? [])];
    const actualTags = new Set(tagLinks.map(a => a.textContent.trim().toLowerCase()));
    if (actualTags.has('featured')) return;
    const warn = document.createElement('span');
    warn.className = 'bb-glyph bb-icon-sorry';
    warn.textContent = '⚠️';
    warn.dataset.msg = 'Featured icon on YEAR page but DETAIL page has no "featured" tag.';
    warn.title = warn.dataset.msg;
    icon.after(warn);
  }

  /**
   * Builds a ⚠️ warning glyph span for a setlist song lacking a tag, matching
   * the style of flagFeaturedIconIfTagMissing's icon. Gated behind
   * bbp_enable_setlist_tag_warnings (default off) at both call sites (DETAIL
   * page's Setlist tab, YEAR page's inline setlist).
   * @param {string} msg
   * @returns {HTMLSpanElement}
   */
  function makeSetlistSongTagWarningGlyph(msg) {
    const warn = document.createElement('span');
    warn.className = 'bb-glyph bb-icon-sorry';
    warn.textContent = ' ⚠️';
    warn.dataset.msg = msg;
    warn.title = msg;
    return warn;
  }

  function wireIconHandlers(eventLink, doc, onstageResult = null, venueDetailExtra = null) {
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

      // "Featured" isn't a tab-content icon (not in ICON_TITLE_MAP) — it's a
      // gold-star call-out whose only expectation is the "featured" tag.
      if (rawTitle === 'Featured') {
        flagFeaturedIconIfTagMissing(icon, doc);
        continue;
      }

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
        // Always grey out icons whose content couldn't be extracted — the icon is
        // present but non-interactive, so dim it to make that immediately obvious.
        icon.style.opacity = '0.45';
        // Additionally flag icons whose tab explicitly says "Sorry, no X available".
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
            warn.title = warn.dataset.msg;
            icon.after(warn);
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
    addTagsButton(doc, tabMap, section, eventLink, onstageResult, venueDetailExtra);
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
  // @param {Array<{label: string, value: string, ok: boolean}>} checks
  function addAnchorWarnDetail(linkEl, checks) {
    const span = document.createElement('span');
    span.className = 'bb-anchor-warn';
    span.textContent = ' ⚠️';
    // Plain-text summary for dataset.msg (read by collectSectionWarnings) —
    // the live hover tooltip uses showAnchorCheckTooltip's .bb-tip-table.
    span.dataset.msg = checks.map(c => `${c.label}: ${c.value}${c.ok ? ' ✅' : ' ⚠️'}`).join('\n');
    span.addEventListener('mouseenter', e => showAnchorCheckTooltip(e, checks, false));
    span.addEventListener('mouseleave', hideTooltip);
    linkEl.after(span);
  }

  // Appends a ✅ glyph immediately after the "Info & Setlist" link on the
  // DETAIL page when all anchor, DateToAnchor, and year checks pass.
  // @param {Array<{label: string, value: string, ok: boolean}>} checks
  function addAnchorMatchDetail(linkEl, checks) {
    const span = document.createElement('span');
    span.className = 'bb-anchor-match';
    span.textContent = ' ✅';
    span.dataset.msg = 'Anchor checks passed:\n' + checks.map(c => `${c.label}: ${c.value} ✅`).join('\n');
    span.addEventListener('mouseenter', e => showAnchorCheckTooltip(e, checks, true));
    span.addEventListener('mouseleave', hideTooltip);
    linkEl.after(span);
  }

  /**
   * Appends a ✅, ⚠️, or informational green glyph after the Venue link on
   * the DETAIL page.
   * @param {HTMLAnchorElement} linkEl
   * @param {string} venueName      VENUE page #page-title text
   * @param {boolean} match
   * @param {string} detailVenuePart Raw venue part from the DETAIL event name
   * @param {string|null} [extra]   Non-null when the only difference from an
   *   exact match is expected extra text — a show-variant suffix like "(Late)" or a
   *   descriptive "venue detail" segment (see findVenueDetailExtra) — rendered as
   *   bb-venue-info instead of bb-venue-warn.
   */
  function addVenueGlyphDetail(linkEl, venueName, match, detailVenuePart, extra = null) {
    // Plain-text summary for dataset.msg (read by collectSectionWarnings and
    // rewireLoadedPage's post-cache-load fallback) — the live hover tooltip
    // itself uses showVenueTooltip's .bb-tip-table instead (see below).
    let msg, spanClass, spanChar;
    if (match) {
      msg = `Venue match ✅\nVENUE page: "${venueName}"\nDETAIL event: "${detailVenuePart}"`;
      spanClass = 'bb-anchor-match';
      spanChar  = ' ✅';
    } else if (extra) {
      msg = `Extra text "${extra}" on DETAIL page not present on VENUE page — informational only, not a mismatch\nVENUE page: "${venueName}"\nDETAIL event: "${detailVenuePart}"`;
      spanClass = 'bb-venue-info';
      spanChar  = ' ⚠︎'; // text-presentation warning sign (colorable via CSS, unlike the emoji form)
    } else {
      msg = `Venue mismatch ⚠️\nVENUE page: "${venueName}"\nDETAIL event: "${detailVenuePart}"`;
      spanClass = 'bb-venue-warn';
      spanChar  = ' ⚠️';
    }
    const span = document.createElement('span');
    span.className = spanClass;
    span.textContent = spanChar;
    span.dataset.msg = msg;
    span.style.cursor = 'help';
    span.addEventListener('mouseenter', e => showVenueTooltip(e, venueName, detailVenuePart, match, extra));
    span.addEventListener('mouseleave', hideTooltip);
    linkEl.after(span);
  }

  function makeGlyphSpan(char) {
    const span = document.createElement('span');
    span.className = 'bb-glyph';
    span.textContent = ' ' + char;
    return span;
  }

  /**
   * Builds the informational green glyph for an event name that differs from
   * the YEAR page only by a trailing show-variant suffix — "(Early)"/"(Late)"/
   * "(Afternoon)"/"(Evening)" — i.e. isEarlyLate. Deliberately not
   * bb-glyph (isYearMismatch's generic .bb-glyph ⚠️/❌/❓ text scan would
   * otherwise count it as a real mismatch); uses the text-presentation ⚠︎ so
   * it's actually colorable via CSS, unlike the ⚠️ emoji form.
   * @returns {HTMLSpanElement}
   */
  function makeVariantInfoGlyphSpan() {
    const span = document.createElement('span');
    span.className = 'bb-variant-info';
    span.textContent = ' ⚠︎';
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

    const glyphSpan = nameMatch ? makeGlyphSpan('✅') : isEarlyLate ? makeVariantInfoGlyphSpan() : makeGlyphSpan('❌');
    h1.appendChild(glyphSpan);

    const enter = e => showYearTooltip(e, yearNameUpper, normalizedDetailName, rawDetailName, eventType, nameMatch, isEarlyLate, anchorName);
    [typeSpan, glyphSpan].forEach(n => {
      n.addEventListener('mouseenter', enter);
      n.addEventListener('mouseleave', hideTooltip);
    });
  }

  /**
   * Builds (but does not insert) a 🏷️ glyph span noting that additional tags
   * were found on the "onstage:" companion page (see
   * fetchOnstageCompanionTags), with a rich tooltip (showOnstageTagsTooltip)
   * grouping them by first letter the same way .page-tags itself does
   * (groupTagsIntoLines / .bb-tag-group-label). Callers insert it wherever
   * appropriate (e.g. `h1.appendChild(...)` on DETAIL pages,
   * `glyphSpan.after(...)` right after the existing match/mismatch glyph on
   * YEAR pages).
   * @param {string[]} additionalTags - Extra tags found on the onstage page, not already on this page.
   * @param {string}   onstageUrl
   * @returns {HTMLElement}
   */
  function makeOnstageTagsGlyphSpan(additionalTags, onstageUrl) {
    const glyphSpan = makeGlyphSpan('🏷️');
    glyphSpan.addEventListener('mouseenter', e => showOnstageTagsTooltip(e, additionalTags, onstageUrl));
    glyphSpan.addEventListener('mouseleave', hideTooltip);
    return glyphSpan;
  }

  /**
   * Appends a 🏷️ glyph to the DETAIL page's <h1> (inside #page-title) noting
   * that additional tags were found on the "onstage:" companion page.
   * @param {string[]} additionalTags
   * @param {string}   onstageUrl
   */
  function addOnstageTagsGlyph(additionalTags, onstageUrl) {
    const pageTitle = document.getElementById('page-title');
    if (!pageTitle) return;
    const h1 = pageTitle.querySelector('h1') || pageTitle;
    h1.appendChild(makeOnstageTagsGlyphSpan(additionalTags, onstageUrl));
  }

  /**
   * Appends the most-specific matching tour's official name (see
   * checkEventTourTags/pickMostSpecificTour), prefixed with " — " (same
   * visual convention as makeAliasSpan's event-alias span), to the DETAIL
   * page's <h1> (inside #page-title). Only called when the event is
   * confirmed part of a real tour (not the tour_no exception) — see
   * runDetailProcessing.
   * @param {string} tourName
   */
  function addTourNameSpan(tourName) {
    const pageTitle = document.getElementById('page-title');
    if (!pageTitle) return;
    const h1 = pageTitle.querySelector('h1') || pageTitle;
    const span = document.createElement('span');
    span.className = 'bb-tour-name';
    span.textContent = ` — ${tourName}`;
    h1.appendChild(span);
  }

  /**
   * Appends the event alias (see extractEventAlias) to the DETAIL page's
   * <h1> (inside #page-title), reusing makeAliasSpan — the same
   * ".bb-event-alias" element/styling the YEAR page already shows in its
   * event heading — so the two pages present the alias identically. Font
   * size is corrected for the DETAIL page's larger title context via the
   * `#page-title .bb-event-alias` CSS override (see addStyles); the YEAR
   * page's own usage is untouched.
   * @param {string} alias
   */
  function addEventAliasSpan(alias) {
    const pageTitle = document.getElementById('page-title');
    if (!pageTitle) return;
    const h1 = pageTitle.querySelector('h1') || pageTitle;
    h1.appendChild(makeAliasSpan(alias));
  }

  // ── Tooltip ───────────────────────────────────────────────────────────────

  function showYearTooltip(evt, yearName, normalizedDetailName, rawDetailName, eventType, match, isEarlyLate = false, anchorName = null) {
    const tip = document.getElementById('bb-tooltip');
    if (!tip) return;
    const detailHtml = match ? esc(normalizedDetailName) : buildDiffHtml(yearName, normalizedDetailName);
    const resultHtml = match
      ? '<span class="bb-ok">Match ✅</span>'
      : isEarlyLate
        ? '<span style="color:green;">Event variant on same day (informational, not a mismatch)</span>'
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

  /**
   * Rich tooltip for the Venue check (match / mismatch / extra-text), same
   * .bb-tip-table convention as showYearTooltip/showListTooltip — a proper
   * table aligns "VENUE page:"/"DETAIL event:" via the <th> column (no manual
   * space-padding needed) and values render in the tooltip's default
   * near-white color (no quote marks or red wrapper needed to make them
   * legible against .bb-fail).
   * @param {Event}       evt
   * @param {string}      venueName        VENUE page's own name.
   * @param {string}      detailVenuePart  DETAIL page's venue text.
   * @param {boolean}     match
   * @param {string|null} extra            Non-null: informational venue-detail extra (see findVenueDetailExtra).
   */
  function showVenueTooltip(evt, venueName, detailVenuePart, match, extra) {
    const tip = document.getElementById('bb-tooltip');
    if (!tip) return;
    const resultHtml = match
      ? '<span class="bb-ok">Match ✅</span>'
      : extra
        ? `<span style="color:green;">Extra text "${esc(extra)}" on DETAIL page (informational, not a mismatch)</span>`
        : '<span class="bb-fail">Mismatch ⚠️</span>';
    tip.innerHTML = `
      <table class="bb-tip-table">
        <tr><th>VENUE page:</th><td>${esc(venueName)}</td></tr>
        <tr><th>DETAIL event:</th><td>${esc(detailVenuePart)}</td></tr>
        <tr><th>Result:</th><td>${resultHtml}</td></tr>
      </table>`;
    positionTooltip(tip, evt);
    tip.style.display = 'block';
  }

  /**
   * Rich tooltip for the "Info & Setlist" anchor/date/year checks, same
   * .bb-tip-table convention as showVenueTooltip/showYearTooltip — one row
   * per check (failed checks' value in red), plus an overall Result row.
   * @param {Event} evt
   * @param {Array<{label: string, value: string, ok: boolean}>} checks
   * @param {boolean} allOk
   */
  function showAnchorCheckTooltip(evt, checks, allOk) {
    const tip = document.getElementById('bb-tooltip');
    if (!tip) return;
    const rows = checks.map(c => {
      const valueHtml = c.ok ? esc(c.value) : `<span class="bb-fail">${esc(c.value)}</span>`;
      return `<tr><th>${esc(c.label)}:</th><td>${valueHtml} ${c.ok ? '✅' : '⚠️'}</td></tr>`;
    }).join('');
    const resultHtml = allOk
      ? '<span class="bb-ok">Match ✅</span>'
      : '<span class="bb-fail">Mismatch ⚠️</span>';
    tip.innerHTML = `
      <table class="bb-tip-table">
        ${rows}
        <tr><th>Result:</th><td>${resultHtml}</td></tr>
      </table>`;
    positionTooltip(tip, evt);
    tip.style.display = 'block';
  }

  /**
   * Rich tooltip for the 🏷️ "additional tags found on the onstage companion
   * page" glyph (makeOnstageTagsGlyphSpan) — groups the tags by lowercase
   * first character (digit/symbol-led tags under "#"), same convention as
   * groupTagsIntoLines, and renders each group with the same
   * .bb-tag-group-label styling used in .page-tags itself, instead of a
   * plain comma-joined list wrapped entirely in .bb-fail red. Values inherit
   * the tooltip's normal near-white color.
   * @param {Event}    evt
   * @param {string[]} additionalTags
   * @param {string}   onstageUrl
   */
  function showOnstageTagsTooltip(evt, additionalTags, onstageUrl) {
    const tip = document.getElementById('bb-tooltip');
    if (!tip) return;
    const count = additionalTags.length;
    const buckets = new Map();
    for (const tag of [...additionalTags].sort()) {
      const first = tag.charAt(0).toLowerCase();
      const key = (first >= 'a' && first <= 'z') ? first : '#';
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(tag);
    }
    const groupsHtml = [...buckets.entries()]
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, tags]) => `<div class="bb-tag-group-line"><span class="bb-tag-group-label">${key.toUpperCase()}</span>${tags.map(esc).join(', ')}</div>`)
      .join('');
    tip.innerHTML = `
      <div>${count} additional tag${count === 1 ? '' : 's'} found on the companion "On Stage" page (${esc(onstageUrl)}):</div>
      ${groupsHtml}`;
    positionTooltip(tip, evt);
    tip.style.display = 'block';
  }

  /**
   * Returns all warning messages found within a single .bb-section-processed div,
   * in DOM order, deduplicated. Covers anchor, venue, para, icon-sorry, and
   * synthetic setlist-diff messages.
   * @param {HTMLElement} processedDiv
   * @returns {string[]}
   */
  function collectSectionWarnings(processedDiv) {
    const seen = new Set();
    const msgs = [];
    const add = msg => {
      const t = (msg || '').trim();
      if (t && !seen.has(t)) { seen.add(t); msgs.push(t); }
    };
    processedDiv.querySelectorAll('.bb-anchor-warn, .bb-venue-warn, .bb-para-warn').forEach(el =>
      add(el.dataset.msg || el.title)
    );
    processedDiv.querySelectorAll('.bb-glyph.bb-icon-sorry[data-msg]').forEach(el =>
      add(el.dataset.msg)
    );
    processedDiv.querySelectorAll('button.bb-event-tab-btn[data-msg]').forEach(el =>
      add(el.dataset.msg)
    );
    if (processedDiv.querySelector('.bb-song-year-only'))   add('Year page song(s) not found in DETAIL setlist');
    if (processedDiv.querySelector('.bb-song-detail-only')) add('DETAIL page song(s) not found in YEAR setlist');
    if (processedDiv.querySelector('.bb-song-char-diff'))   add('Song name character differences between YEAR and DETAIL page');
    return msgs;
  }

  /**
   * Appends a ⚠️ glyph to the event title line inside a .bb-section-processed div
   * when any warning elements exist within it. Inserted after the last of the
   * bb-glyph / bb-event-type / bb-event-alias siblings that immediately follow
   * the event link element. Hovering shows a rich tooltip listing all issues.
   * No-op when there are no warnings.
   * @param {HTMLElement} element      The event <a> link element on the YEAR page
   * @param {HTMLElement} processedDiv The .bb-section-processed container
   */
  function annotateEventTitleWithWarnings(element, processedDiv) {
    const msgs = collectSectionWarnings(processedDiv);
    if (msgs.length === 0) return;

    // Walk forward from element to find the last glyph/type/alias sibling.
    let insertAfter = element;
    let sib = element.nextSibling;
    while (sib) {
      if (sib.nodeType === Node.ELEMENT_NODE &&
          (sib.classList.contains('bb-event-type') ||
           sib.classList.contains('bb-glyph') ||
           sib.classList.contains('bb-variant-info') ||
           sib.classList.contains('bb-event-alias'))) {
        insertAfter = sib;
      } else {
        break;
      }
      sib = sib.nextSibling;
    }

    const n = msgs.length;
    const listItems = msgs.map(m => `<li>${esc(m).replace(/\n/g, '<br>')}</li>`).join('');
    const tipHtml =
      `<div style="max-width:900px">` +
      `<strong>⚠️ ${n} issue${n > 1 ? 's' : ''} found for this event:</strong>` +
      `<ol style="margin:6px 0 0;padding-left:18px;white-space:normal;">${listItems}</ol>` +
      `</div>`;

    const warn = document.createElement('span');
    warn.className = 'bb-event-title-warn';
    warn.textContent = ' ⚠️';
    warn.style.cursor = 'help';
    warn.addEventListener('mouseenter', e => {
      const tip = document.getElementById('bb-tooltip');
      if (!tip) return;
      tip.innerHTML = tipHtml;
      positionTooltip(tip, e);
      tip.style.display = 'block';
    });
    warn.addEventListener('mouseleave', hideTooltip);
    insertAfter.after(warn);
  }

  /**
   * Returns all warning messages found in the live page DOM, in document order,
   * deduplicated. Covers tag, anchor, venue, para, and empty-tab warnings.
   * @returns {string[]}
   */
  function collectPageWarnings() {
    const seen = new Set();
    const msgs = [];
    const add = msg => {
      const t = (msg || '').trim();
      if (t && !seen.has(t)) { seen.add(t); msgs.push(t); }
    };
    document.querySelectorAll(
      '.bb-tag-missing, .bb-tag-spurious, .bb-anchor-warn, .bb-venue-warn, .bb-para-warn'
    ).forEach(el => add(el.dataset.msg || el.title));
    // Empty-tab warning spans injected by annotateEmptyRelationTabs
    document.querySelectorAll('.yui-nav em span[data-msg]').forEach(el => add(el.dataset.msg));
    return msgs;
  }

  /**
   * Appends a ⚠️ warning glyph to #page-title when any warning elements exist on
   * the page. Hovering over the glyph shows a rich HTML tooltip listing every
   * problem in document order, so issues at the bottom of a long page are always
   * visible without scrolling.
   * No-op when there are no warnings.
   */
  function annotatePageTitleWithWarnings() {
    const pageTitle = document.getElementById('page-title');
    if (!pageTitle) return;
    const msgs = collectPageWarnings();
    if (msgs.length === 0) return;
    const n = msgs.length;
    const listItems = msgs
      .map(m => `<li>${esc(m).replace(/\n/g, '<br>')}</li>`)
      .join('');
    const tipHtml =
      `<div style="max-width:900px">` +
      `<strong>⚠️ ${n} issue${n > 1 ? 's' : ''} found on this page:</strong>` +
      `<ol style="margin:6px 0 0;padding-left:18px;white-space:normal;">${listItems}</ol>` +
      `</div>`;
    const warn = document.createElement('span');
    warn.className = 'bb-page-title-warn';
    warn.textContent = ' ⚠️';
    warn.style.cursor = 'help';
    warn.addEventListener('mouseenter', e => {
      const tip = document.getElementById('bb-tooltip');
      if (!tip) return;
      tip.innerHTML = tipHtml;
      positionTooltip(tip, e);
      tip.style.display = 'block';
    });
    warn.addEventListener('mouseleave', hideTooltip);
    pageTitle.appendChild(warn);
  }

  /**
   * Builds the optional "Tour premiere" row for showSongTooltip's .bb-tip-table
   * (bb-song-match / bb-song-char-diff — the two types where both a YEAR-page
   * and a DETAIL-page premiere flag are always known). Omitted entirely when
   * neither side is a tour premiere, so an ordinary song's tooltip isn't
   * cluttered with a "No · No" line. When exactly one side is bold, that's a
   * genuine inconsistency between the two pages, flagged the same way as any
   * other song check (Match ✅ / Mismatch ❌).
   * @param {boolean} yearPrem
   * @param {boolean} detailPrem
   * @returns {string}
   */
  function buildTourPremiereRow(yearPrem, detailPrem) {
    if (!yearPrem && !detailPrem) return '';
    const yesNo = v => v ? 'Yes 🌟' : 'No';
    const resultHtml = yearPrem === detailPrem
      ? '<span class="bb-ok">Match ✅</span>'
      : '<span class="bb-fail">Mismatch ❌</span>';
    return `<tr><th>Tour premiere:</th><td>YEAR: ${yesNo(yearPrem)} · DETAIL: ${yesNo(detailPrem)} — ${resultHtml}</td></tr>`;
  }

  function showSongTooltip(evt, el) {
    const tip = document.getElementById('bb-tooltip');
    if (!tip) return;
    const cls        = el.className || '';
    const yearSong   = el.dataset.yearSong   || '';
    const detailSong = el.dataset.detailSong || '';
    const yearPrem   = el.dataset.yearPremiere   === '1';
    const detailPrem = el.dataset.detailPremiere === '1';
    let html = '';

    if (cls.includes('bb-song-match')) {
      html = `<table class="bb-tip-table">
        <tr><th>YEAR page:</th><td>${esc(yearSong || el.textContent.trim())}</td></tr>
        <tr><th>DETAIL page:</th><td>${esc(detailSong || yearSong || el.textContent.trim())}</td></tr>
        <tr><th>Result:</th><td><span class="bb-ok">Match ✅</span></td></tr>
        ${buildTourPremiereRow(yearPrem, detailPrem)}
      </table>`;
    } else if (cls.includes('bb-song-year-only')) {
      html = `<span class="bb-fail">Only on YEAR page (missing from detail):</span><br>${esc(yearSong || el.textContent.trim())}` +
        (yearPrem ? '<br>🌟 Tour premiere on the YEAR page' : '');
    } else if (cls.includes('bb-song-detail-only')) {
      html = `<span class="bb-fail">Only on DETAIL page (missing from year):</span><br>${esc(detailSong || el.textContent.trim())}` +
        (detailPrem ? '<br>🌟 Tour premiere on the DETAIL page' : '');
    } else if (cls.includes('bb-song-char-diff')) {
      html = `<table class="bb-tip-table">
        <tr><th>YEAR page:</th><td>${esc(yearSong)}</td></tr>
        <tr><th>DETAIL page:</th><td>${esc(detailSong)}</td></tr>
        <tr><th>Diff:</th><td>${buildDiffHtml(yearSong.toUpperCase(), detailSong.toUpperCase())}</td></tr>
        ${buildTourPremiereRow(yearPrem, detailPrem)}
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

  /**
   * Rich tooltip for a section-label mismatch: YEAR/DETAIL variants shown as
   * aligned rows (same .bb-tip-table shape as showSongTooltip's match/
   * char-diff rows), each row diff-highlighting its own text against the
   * other side via buildLabelCharDiffHtml.
   * @param {Event}  evt
   * @param {string} yearLabel
   * @param {string} detailLabel
   */
  function showLabelMismatchTooltip(evt, yearLabel, detailLabel) {
    const tip = document.getElementById('bb-tooltip');
    if (!tip) return;
    tip.innerHTML = `<table class="bb-tip-table">
      <tr><th>YEAR page:</th><td>${buildLabelCharDiffHtml(yearLabel, detailLabel)}</td></tr>
      <tr><th>DETAIL page:</th><td>${buildLabelCharDiffHtml(detailLabel, yearLabel)}</td></tr>
    </table>`;
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
      .bb-event-type        { color: #888; font-style: italic; font-weight: normal; }
      .bb-event-type-detail { font-size: 0.6em; font-weight: normal; color: #666; font-style: italic; vertical-align: middle; }
      .bb-event-alias       { font-style: italic; font-weight: bold; color: ${Lib.settings.bbp_event_alias_color}; }
      .bb-tour-name         { font-style: italic; font-weight: bold; color: ${Lib.settings.bbp_tour_name_color}; font-size: 0.6em; vertical-align: middle; }
      /* On the DETAIL page, .bb-event-alias sits directly inside the large
         #page-title <h1> (unlike its YEAR-page usage, inside a much smaller
         event-heading line) and would otherwise inherit that oversized font
         — match .bb-event-type-detail/.bb-tour-name's proportions instead. */
      #page-title .bb-event-alias { font-size: 0.6em; vertical-align: middle; }
      .bb-year-tour-name    { font-style: italic; font-weight: bold; color: ${Lib.settings.bbp_tour_name_color}; }
      .bb-glyph { cursor: default; font-style: normal; margin-left: 4px; }
      .bb-event-title-warn { cursor: help; font-style: normal; margin-left: 2px; }
      /* Informational (not a real mismatch) venue-detail glyph — see findVenueDetailExtra.
         Deliberately excluded from .bb-glyph / .bb-venue-warn so it's never counted as an
         issue (isYearMismatch, collectSectionWarnings/collectPageWarnings, #bb-mismatch-toggle). */
      .bb-venue-info { color: green; cursor: help; font-style: normal; margin-left: 4px; }
      /* Informational (not a real mismatch) event-name glyph for the isEarlyLate case
         (name differs from the YEAR page only by a trailing show-variant suffix).
         Deliberately excluded from .bb-glyph so it's never counted as an issue
         (isYearMismatch, collectSectionWarnings/collectPageWarnings, #bb-mismatch-toggle). */
      .bb-variant-info { color: green; cursor: default; font-style: normal; margin-left: 4px; }
      .bb-scheduled { font-size: 0.9em; font-family: monospace; color: #555; margin: 1px 0 3px; }
      .bb-event-heading { background: #f0f0f0; border-radius: 2px; padding: 1px 4px; }
      .bb-event-collapse-toggle { display: inline-block; cursor: pointer; user-select: none; padding: 0 10px 0 6px; color: #999; font-size: 0.9em; font-style: normal; }
      .bb-event-collapse-toggle:hover { color: #333; }

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
      div.bb-section-list  { margin-top: 0.6em; }
      .bb-list-label       { margin: 2px 0 1px; }
      ol.bb-list-view      { list-style: none; margin: 0 0 4px 0; padding: 0; }
      ol.bb-list-view li   { margin: 1px 0; display: flex; align-items: baseline; flex-wrap: wrap; }
      ol.bb-list-view li sup { vertical-align: baseline; font-size: 0.85em; width: 100%; }
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
      .bb-song-match       { color: #2a2; cursor: default; }
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
      .bb-setlist-tab-match { color: #2a2; font-weight: bold; cursor: help; }

      /* First tab ("On Stage"/"In Studio"/"On Audio"/"On Set") label
         decoration (DETAIL page) — see annotateFirstTab */
      .bb-first-tab-match { color: #2a2; font-weight: bold; cursor: help; }

      /* Tag that passed its consistency check (DETAIL/VENUE/RETAIL/SONG/RELATION pages) */
      .bb-tag-ok { color: #2a2 !important; font-weight: bold; cursor: help; }

      /* bbp_enable_tag_source_highlight: hovering a verified (.bb-tag-ok)
         tag draws this box around the tag itself, and — via
         wireTagSourceHighlight — the same box around the on-page source
         element(s) it was verified against. outline (not border) so it
         never affects layout/reflows the surrounding text. */
      .bb-tag-hover-highlight,
      .bb-tag-source-highlight {
        outline: 2px solid #2a2;
        outline-offset: 1px;
        border-radius: 3px;
      }
      .bb-tag-source-highlight { background: rgba(42, 170, 42, 0.12); }

      /* RELATION page: a band/member name link under the "Bands"/"Members"
         tab whose derived tag is verified present in .page-tags. Also used
         on DETAIL pages for a relation name link under the "On Stage"/"In
         Studio"/"On Audio" tab (see colorizeOnStageRelationNames). */
      .bb-relation-name-ok { color: #2a2 !important; font-weight: bold; cursor: help; }

      /* DETAIL page: ⚠️ appended after a relation name link under the "On
         Stage"/"In Studio"/"On Audio" tab whose derived tag is missing */
      .bb-relation-name-warn { cursor: help; }

      /* Tag rendered from the "onstage:" companion page, not this page's own .page-tags */
      .bb-tag-onstage { color: steelblue !important; font-style: italic; cursor: help; }

      /* A companion-page tag that ALSO passed a consistency check: same green
         as .bb-tag-ok (higher specificity than either single-class rule, so
         it wins regardless of declaration order — both use !important on
         color, and .bb-tag-onstage alone would otherwise win by being
         declared later), but keep the italic from .bb-tag-onstage. */
      .bb-tag-onstage.bb-tag-ok { color: #2a2 !important; }

      /* DETAIL page .page-tags regrouped into one line per first-letter
         group (see groupTagsIntoLines), each prefixed with a small bold
         group-letter label — instead of one long unbroken line. */
      .bb-tag-group-line  { display: block; margin: 2px 0; }
      .bb-tag-group-label { display: inline-block; min-width: 1.2em; margin-right: 6px; font-weight: bold; color: #888; }

      /* "Original Page" mode on DETAIL pages — hide all script annotations */
      .bb-original-view .bb-glyph,
      .bb-original-view .bb-anchor-match,
      .bb-original-view .bb-anchor-warn,
      .bb-original-view .bb-venue-warn,
      .bb-original-view .bb-venue-info,
      .bb-original-view .bb-variant-info,
      .bb-original-view .bb-tag-missing,
      .bb-original-view .bb-tag-spurious,
      .bb-original-view .bb-tag-onstage,
      .bb-original-view .bb-icon-sorry,
      .bb-original-view .bb-relation-tab-warn,
      .bb-original-view .bb-relation-name-warn,
      .bb-original-view .bb-setlist-tab-ann,
      .bb-original-view .bb-first-tab-ann { display: none !important; }
      .bb-original-view .bb-tags-warn-box   { border: none !important; background: none !important; padding: 0 !important; }
      .bb-original-view .bb-tags-box        { border: none !important; background: none !important; padding: 0 !important; }
      /* .bb-setlist-tab-match sits on an <em> nested inside the tab's own
         <a href="javascript:;">, so 'inherit' correctly picks up that
         parent's already-plain color/cursor. .bb-tag-ok/.bb-relation-name-ok
         sit directly on the real <a href> elements themselves, where
         'inherit' pulls from a non-link ancestor (<li>/<ul>) instead of the
         special "this is a link" cursor/color the browser/site would
         otherwise apply — 'revert' rolls the property back past our (and
         the site's) author rules to the browser's native link styling
         (blue, underlined, pointer cursor), restoring the exact "clickable
         hyperlink" look these had before we ever touched them. */
      .bb-original-view .bb-setlist-tab-match,
      .bb-original-view .bb-first-tab-match { color: inherit !important; font-weight: inherit !important; cursor: inherit !important; }
      .bb-original-view .bb-tag-ok,
      .bb-original-view .bb-relation-name-ok { color: revert !important; font-weight: revert !important; cursor: revert !important; }
      /* Original view: collapse the letter-grouped lines back into
         BruceBase's original single flowing line (display:contents makes
         the wrapper divs transparent to layout, keeping only their tag
         children in flow) and hide the group-letter labels. */
      .bb-original-view .bb-tag-group-line  { display: contents; }
      .bb-original-view .bb-tag-group-label { display: none !important; }

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
      .bb-retail-page-title { font-weight: bold; font-size: 0.95em; color: #333; border-bottom: 1px solid #ccc; margin: 6px 0 4px; padding: 2px 0; }
      .bb-retail-tab-label { font-size: 0.82em; color: #444; display: block; margin: 6px 0 0; padding: 3px 8px; background: #e8e8e8; border-radius: 2px; cursor: pointer; user-select: none; }
      .bb-retail-tab-label:hover { background: #dce8ff; }
      .bb-retail-tab-open { background: #c8daf0 !important; }
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

      /* ── Filter bar ────────────────────────────────────────────────────────── */
      #bb-filter-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 3px 0 2px; font-size: 0.88em; border-top: 1px solid #e0e0e0; margin-top: 3px; }
      #bb-filter-count { font-family: monospace; font-size: 1.05em; font-weight: bold; color: #444; white-space: nowrap; min-width: 7em; cursor: default; }
      #bb-filter-input-wrap { display: inline-flex; align-items: center; border: 1px solid #bbb; border-radius: 4px; background: #fff; padding: 3px 7px; }
      #bb-filter-input { border: none; outline: none; font-size: 1em; font-family: monospace; width: 22em; padding: 1px 2px; background: transparent; }
      #bb-filter-clear { background: none; border: none; cursor: pointer; font-size: 1em; color: #999; padding: 0 2px; line-height: 1; display: none; }
      #bb-filter-clear.visible { display: inline; }
      .bb-filter-cb-label { display: inline-flex; align-items: center; gap: 3px; cursor: pointer; font-size: 0.88em; color: #333; user-select: none; }
      .bb-filter-cb-label input[type="checkbox"] { margin: 0; cursor: pointer; }
      .bb-filter-sep { color: #bbb; font-size: 1.1em; padding: 0 2px; user-select: none; }
      mark.bb-filter-match { background: #ffe066; color: inherit; border-radius: 2px; padding: 0 1px; }

      /* ── Relation participant blocks ───────────────────────────────────── */
      .bb-relations-flat { margin: 0.6em 0 2px; font-size: 0.9em; color: #555; }
      .bb-relations-list { margin: 0.6em 0 4px; }
      ul.bb-relations-list-ul { list-style: none; margin: 0; padding: 0; }
      ul.bb-relations-list-ul ul.bb-relations-list-ul { padding-left: 1.2em; }
      .bb-rel-bullet { text-decoration: none; color: #888; cursor: pointer; }
      .bb-rel-bullet:hover { text-decoration: underline; }
      .bb-rel-name { color: inherit; text-decoration: none; }
      .bb-rel-name:hover { text-decoration: underline; }
      .bb-rel-extra { color: #888; font-style: italic; font-size: 0.85em; }
      .bb-rel-loading { opacity: 0.5; cursor: wait; }
      .bb-relation-tab-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin: 4px 0; }
      .bb-relation-tab-btn { font-size: 0.8em; padding: 1px 6px; cursor: pointer; border: 1px solid #999; border-radius: 3px; background: #f5f5f5; }
      .bb-relation-tab-btn:hover, .bb-relation-tab-btn.bb-icon-active { background: #dce8ff; border-color: #66a; }
      .bb-relation-tab-btn.bb-relation-tab-empty { opacity: 0.55; cursor: default; color: #888; }
      .bb-relation-tab-btn.bb-relation-tab-empty:hover { background: #f5f5f5; border-color: #999; }
      ol.bb-list-view + p.bb-list-label { margin-top: 0.5em; }
      /* Global "Hide Relations" sticky-bar toggle */
      body.bb-relations-hidden .bb-relations-flat,
      body.bb-relations-hidden .bb-relations-list { display: none !important; }
      /* Per-event "Hide Relations" section-controls toggle */
      .bb-rel-hidden .bb-relations-flat,
      .bb-rel-hidden .bb-relations-list { display: none !important; }
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
