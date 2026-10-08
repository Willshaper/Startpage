// Startpage: Constants, settings + storage (load/save/normalize), cached DOM ($), shared helpers.
// Classic script sharing globals with the others; load order is set in index.html.

const STORAGE_KEY = 'startpage_v1';
const TRACKER_URL = 'https://willshaper.github.io/Weekly-Tracker/';   // the standalone Weekly-Tracker site
const TILE_COLS_MIN = 4, TILE_COLS_MAX = 40;   // tiles-per-line slider bounds (max fills a 4K row of compact tiles)
const clampCols = v => Math.max(TILE_COLS_MIN, Math.min(TILE_COLS_MAX, Math.round(Number(v) || 8)));
const FORCE_LETTER = 'letter';   // sentinel for link.icon: always show the coloured letter, never a favicon
const ENGINES = {
  google:     { name: 'Google',     url: 'https://www.google.com/search?q=' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  bing:       { name: 'Bing',       url: 'https://www.bing.com/search?q=' },
  brave:      { name: 'Brave',      url: 'https://search.brave.com/search?q=' },
  ecosia:     { name: 'Ecosia',     url: 'https://www.ecosia.org/search?q=' },
};
const DEFAULT_LINKS = [
  { name: 'Gmail',     url: 'https://mail.google.com' },
  { name: 'YouTube',   url: 'https://youtube.com' },
  { name: 'GitHub',    url: 'https://github.com' },
  { name: 'Reddit',    url: 'https://reddit.com' },
  { name: 'Wikipedia', url: 'https://wikipedia.org' },
  { name: 'Maps',      url: 'https://maps.google.com' },
];
const DEFAULT_SETTINGS = {
  greetingName: '', engine: 'google', newTab: false, seconds: true,
  theme: 'dark', background: '', bgUrls: [], bgInterval: 0, bgMode: 'none', lang: 'en', hideAdd: false,
  searchEnabled: true, accent: '',
  tileOpacity: 1, widgetOpacity: 1, searchOpacity: 1, clockOpacity: 0,
  tileColumns: 8, tileCompact: false, tileVAlign: 'middle',
  clock:   { enabled: true, valign: 'middle' },
  groups: [],
  rss:     { enabled: false, urls: [], position: 'mr', highlight: '', blacklist: '' },
  note:    { enabled: false, position: 'ml', text: '', checklist: false },
  weather: { enabled: false, position: 'tr', units: 'c', location: null },
  countdown: { enabled: false, position: 'br', items: [] },
  tracker: { enabled: false, position: 'tl' },
  anime:   { enabled: false, position: 'bl' },   // filled in by normalizeAnime
};
const MAX_FEEDS  = 15;
const MAX_GROUPS = 10;
const MAX_COUNTDOWNS = 10;
const ALL_POSITIONS = ['tl','ml','bl','tr','mr','br'];
const WIDGET_KEYS = ['rss','note','weather','countdown','tracker','anime'];
// Anime feed: AniList media formats + origin countries the user can toggle
const ANIME_FORMATS   = ['TV','TV_SHORT','MOVIE','SPECIAL','OVA','ONA','MUSIC'];
const ANIME_COUNTRIES = ['JP','CN','KR'];
// Weekly-Tracker (willshaper.github.io/Weekly-Tracker) shares this origin's
// localStorage, so the tracker widget reads its data straight from this key.
const TRACKER_KEY = 'weekly_tracker';
const TRACKER_COLORS = { '1':'#e05555', '2':'#e89440', '3':'#4db87a', '4':'#4a9ee8', '5':'#9b6bd4' };
// Bare-token TLDs we'll treat as a URL to navigate to (otherwise → web search).
// Keeps things like "vue.js" or "3.14" as searches, while "github.com" navigates.
const COMMON_TLDS = new Set(['com','org','net','io','dev','app','co','edu','gov','mil',
  'int','info','biz','me','tv','xyz','ai','gg','online','site','tech','blog','shop',
  'store','news','uk','us','ca','de','fr','jp','cn','ru','br','au','nl','se','no','dk',
  'fi','is','it','es','eu','ch','at','be','pl','in','kr','mx','nz','ie','pt','cz','gr','tr','za']);

function L() { return I18N[settings.lang] || I18N.en; }
function applyLanguage() {
  const t = L();
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const v = t[el.dataset.i18n];
    if (typeof v === 'string') el.textContent = v;
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const v = t[el.dataset.i18nPh];
    if (typeof v === 'string') el.placeholder = v;
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const v = t[el.dataset.i18nTitle];
    if (typeof v === 'string') el.title = v;
  });
  // Re-render dynamic lists/widgets so placeholders, button titles and
  // generated text pick up the new language
  if (typeof renderFeedList      === 'function') renderFeedList();
  if (typeof renderGroupList     === 'function') renderGroupList();
  if (typeof renderNoteList      === 'function') renderNoteList();
  if (typeof renderWeather       === 'function') renderWeather();
  if (typeof renderCountdownList === 'function') renderCountdownList();
  if (typeof updateCountdown     === 'function') updateCountdown();
  if (typeof renderTracker       === 'function') renderTracker();
  if (typeof syncWidgetPositions === 'function') syncWidgetPositions();
  if (typeof renderFeedUpdated   === 'function') renderFeedUpdated();
  if (typeof renderAnime         === 'function') renderAnime();
  if (typeof renderAnimeSettings === 'function') renderAnimeSettings();
}

let links     = [];
let nextId     = 1;
let settings   = { ...DEFAULT_SETTINGS };
let ctxId      = null;
let editingId  = null;
let modalIcon  = '';   // working icon value while the link modal is open

// ── Cached DOM ────────────────────────────────────────────────────────────────
const $ = {
  greeting:  document.getElementById('greeting'),
  clock:     document.getElementById('clock'),
  date:      document.getElementById('date'),
  tiles:     document.getElementById('tiles'),
  clockBlock:   document.getElementById('clock-block'),
  contentBlock: document.getElementById('content-block'),
  searchForm:document.getElementById('search-form'),
  searchEng: document.getElementById('search-engine'),
  searchIn:  document.getElementById('search-input'),
  topControls: document.querySelector('.top-controls'),
  ctxMenu:   document.getElementById('ctx-menu'),
  linkModal: document.getElementById('link-modal'),
  linkTitle: document.getElementById('link-modal-title'),
  linkName:  document.getElementById('link-name'),
  linkUrl:   document.getElementById('link-url'),
  linkSave:  document.getElementById('link-save'),
  iconUrl:   document.getElementById('link-icon-url'),
  iconPrev:  document.getElementById('icon-preview'),
  iconPrevImg:   document.getElementById('icon-preview-img'),
  iconPrevLetter:document.getElementById('icon-preview-letter'),
  setModal:  document.getElementById('settings-modal'),
  setName:   document.getElementById('set-name'),
  setEngine: document.getElementById('set-engine'),
  setNewtab: document.getElementById('set-newtab'),
  setSeconds:document.getElementById('set-seconds'),
  setShowAdd:document.getElementById('set-showadd'),
  setBgMode:    document.getElementById('set-bg-mode'),
  setBgUrls:    document.getElementById('set-bg-urls'),
  setBgInterval:document.getElementById('set-bg-interval'),
  setLang:   document.getElementById('set-lang'),
  hint:      document.querySelector('.hint'),
  rssPanel:  document.getElementById('rss-panel'),
  rssList:   document.getElementById('rss-list'),
  rssUpdated:document.getElementById('rss-updated'),
  rssRefresh:document.getElementById('rss-refresh'),
  setRss:    document.getElementById('set-rss'),
  setRssUrl: document.getElementById('set-rss-url'),
  setRssHighlight: document.getElementById('set-rss-highlight'),
  setRssBlacklist: document.getElementById('set-rss-blacklist'),
  feedList:  document.getElementById('feed-list'),
  feedCount: document.getElementById('feed-count'),
  feedAddBtn:document.getElementById('feed-add-btn'),
  // Note widget
  notePanel: document.getElementById('note-panel'),
  noteText:  document.getElementById('note-text'),
  noteList:  document.getElementById('note-list'),
  noteAddRow:document.getElementById('note-add-row'),
  noteAddInput:document.getElementById('note-add-input'),
  noteModeBtn:document.getElementById('note-mode-btn'),
  setNote:   document.getElementById('set-note'),
  setNoteChecklist:document.getElementById('set-note-checklist'),
  // Weather widget
  weatherPanel:  document.getElementById('weather-panel'),
  weatherBody:   document.getElementById('weather-body'),
  weatherRefresh:document.getElementById('weather-refresh'),
  setWeather:    document.getElementById('set-weather'),
  setWeatherUnits:document.getElementById('set-weather-units'),
  setWeatherLoc: document.getElementById('set-weather-loc'),
  // Countdown widget
  countdownPanel: document.getElementById('countdown-panel'),
  countdownBody:  document.getElementById('countdown-body'),
  setCountdown:    document.getElementById('set-countdown'),
  setCountdownLabel: document.getElementById('set-countdown-label'),
  setCountdownTarget:document.getElementById('set-countdown-target'),
  countdownList:   document.getElementById('countdown-list'),
  countdownCount:  document.getElementById('countdown-count'),
  countdownAddBtn: document.getElementById('countdown-add-btn'),
  // Weekly-Tracker widget
  trackerPanel:  document.getElementById('tracker-panel'),
  trackerHeader: document.getElementById('tracker-header'),
  trackerBody:   document.getElementById('tracker-body'),
  setTracker:    document.getElementById('set-tracker'),
  // Anime feed widget
  animePanel:    document.getElementById('anime-panel'),
  animeList:     document.getElementById('anime-list'),
  animeUpdated:  document.getElementById('anime-updated'),
  animeRefresh:  document.getElementById('anime-refresh'),
  animeCtx:      document.getElementById('anime-ctx'),
  animeCtxReset: document.getElementById('anime-ctx-reset'),
  animeLinkModal:document.getElementById('anime-link-modal'),
  animeLinkTitle:document.getElementById('anime-link-title'),
  animeLinkUrl:  document.getElementById('anime-link-url'),
  setAnime:      document.getElementById('set-anime'),
  setAnimeSource:document.getElementById('set-anime-source'),
  setAnimeUser:  document.getElementById('set-anime-user'),
  animeUserRow:  document.getElementById('anime-user-row'),
  setAnimeFormats:   document.getElementById('set-anime-formats'),
  setAnimeCountries: document.getElementById('set-anime-countries'),
  setAnimeHighlight: document.getElementById('set-anime-highlight'),
  animeShowList: document.getElementById('anime-show-list'),
  animeBlList:   document.getElementById('anime-bl-list'),
  animeCtxTrack: document.getElementById('anime-ctx-track'),
  animeCtxTime:  document.getElementById('anime-ctx-time'),
  animeShowAdd:    document.getElementById('anime-show-add'),
  animeShowAddBtn: document.getElementById('anime-show-add-btn'),
  animeShowAddMsg: document.getElementById('anime-show-add-msg'),
  animeTrackListBtn: document.getElementById('anime-track-list-btn'),
  trackTimeModal:document.getElementById('track-time-modal'),
  trackTimeTitle:document.getElementById('track-time-title'),
  trackTimeDay:  document.getElementById('track-time-day'),
  trackTimeTime: document.getElementById('track-time-time'),
  setTrackerAnime: document.getElementById('set-tracker-anime'),
  animeSubnav:   document.getElementById('anime-subnav'),
  animeCtxHl:    document.getElementById('anime-ctx-hl'),
  animeManager:  document.getElementById('anime-manager'),
  animeShowFilter: document.getElementById('anime-show-filter'),
  animeAddBar:     document.getElementById('anime-add-bar'),
  animeBlCtx:      document.getElementById('anime-bl-ctx'),
  animeWidgetOff:  document.getElementById('anime-widget-off'),
  // Tile groups
  linkGroup: document.getElementById('link-group'),
  groupList: document.getElementById('group-list'),
  groupCount:document.getElementById('group-count'),
  groupInput:document.getElementById('set-group-input'),
  groupAddBtn:document.getElementById('group-add-btn'),
  // Appearance
  setTileOp:    document.getElementById('set-tile-opacity'),
  setWidgetOp:  document.getElementById('set-widget-opacity'),
  setSearchOp:  document.getElementById('set-search-opacity'),
  setClockOp:   document.getElementById('set-clock-opacity'),
  tileOpVal:    document.getElementById('tile-opacity-val'),
  widgetOpVal:  document.getElementById('widget-opacity-val'),
  searchOpVal:  document.getElementById('search-opacity-val'),
  clockOpVal:   document.getElementById('clock-opacity-val'),
  setShowSearch:document.getElementById('set-showsearch'),
  setAccent:    document.getElementById('set-accent'),
  setTileCols:    document.getElementById('set-tile-cols'),
  setTileColsVal: document.getElementById('tile-cols-val'),
  setTileCompact: document.getElementById('set-tile-compact'),
  setThemeSeg:  document.getElementById('set-theme-seg'),
  setValignSeg: document.getElementById('set-valign-seg'),
  setClock:     document.getElementById('set-clock'),
  setClockValignSeg: document.getElementById('set-clock-valign-seg'),
};

// ── Storage ───────────────────────────────────────────────────────────────────
function normalizeLink(l) {
  if (!l || typeof l.id !== 'number') return null;
  return {
    id:    l.id,
    name:  typeof l.name  === 'string' ? l.name  : '',
    url:   typeof l.url   === 'string' ? l.url   : '',
    icon:  typeof l.icon  === 'string' ? l.icon  : '',
    group: typeof l.group === 'string' ? l.group : '',
  };
}
function normalizeRss(r) {
  r = r || {};
  let feeds = Array.isArray(r.urls)
    ? r.urls.map(u => {
        if (typeof u === 'string') return { url: u.trim(), filter: '' };
        if (u && typeof u === 'object' && typeof u.url === 'string') return { url: u.url.trim(), filter: typeof u.filter === 'string' ? u.filter.trim() : '' };
        return null;
      }).filter(f => f && f.url)
    : [];
  // legacy single-url migration
  if (!feeds.length && typeof r.url === 'string' && r.url.trim()) feeds = [{ url: r.url.trim(), filter: '' }];
  return {
    enabled:   !!r.enabled,
    urls:      feeds.slice(0, MAX_FEEDS),
    position:  ALL_POSITIONS.includes(r.position) ? r.position : 'mr',
    highlight: typeof r.highlight === 'string' ? r.highlight : '',  // global exact-match highlight phrases
    blacklist: typeof r.blacklist === 'string' ? r.blacklist : '',  // global substring words that hide items
  };
}
function normalizeNote(n) {
  n = n || {};
  return {
    enabled:   !!n.enabled,
    position:  ALL_POSITIONS.includes(n.position) ? n.position : 'ml',
    text:      typeof n.text === 'string' ? n.text : '',
    checklist: !!n.checklist,
  };
}
function normalizeWeather(w) {
  w = w || {};
  let loc = null;
  if (w.location && typeof w.location === 'object') {
    const lat = Number(w.location.lat), lon = Number(w.location.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      loc = { lat, lon, name: typeof w.location.name === 'string' ? w.location.name : '' };
    }
  }
  return {
    enabled:  !!w.enabled,
    position: ALL_POSITIONS.includes(w.position) ? w.position : 'tr',
    units:    w.units === 'f' ? 'f' : 'c',
    location: loc,
  };
}
function normalizeCountdown(c) {
  c = c || {};
  const clean = it => (it && typeof it === 'object' && typeof it.target === 'string' && it.target)
    ? { label: typeof it.label === 'string' ? it.label.slice(0, 60) : '', target: it.target }
    : null;
  let items = Array.isArray(c.items) ? c.items.map(clean).filter(Boolean) : [];
  // migrate the old single-countdown shape { label, target }
  if (!items.length && typeof c.target === 'string' && c.target) {
    items = [{ label: typeof c.label === 'string' ? c.label.slice(0, 60) : '', target: c.target }];
  }
  return {
    enabled:  !!c.enabled,
    position: ALL_POSITIONS.includes(c.position) ? c.position : 'br',
    items:    items.slice(0, MAX_COUNTDOWNS),
  };
}
function normalizeTracker(t) {
  t = t || {};
  return {
    enabled:  !!t.enabled,
    position: ALL_POSITIONS.includes(t.position) ? t.position : 'tl',
    anime:    t.anime !== false,   // show seasons tracked in the Anime Feed (on unless turned off)
    upcoming: !!t.upcoming,        // header toggle: also list today's not-yet-aired anime
  };
}
function normalizeAnime(a) {
  a = a || {};
  // Per-season settings keyed by AniList media id. `shows` holds every season the
  // user has configured: { id, title, last, track, hl, url, day, time } — tracked
  // (Weekly Tracker), highlighted, a custom link, and an optional day (0=Sun..6) +
  // "HH:MM" overriding AniList's air time (day null = AniList). `blacklist` holds
  // hidden seasons { id, title, last }. The title is kept so settings can list them
  // offline; `last` (unix s) is when the season last aired an episode we've seen,
  // which splits the Anime Manager into "Airing" and "Archived".
  const nowSec = Math.floor(Date.now() / 1000);
  const validId = x => (x && typeof x === 'object' && Number.isInteger(Number(x.id)) && Number(x.id) > 0) ? Number(x.id) : 0;
  const titleOf = x => typeof x.title === 'string' ? x.title.slice(0, 200) : '';
  const lastOf  = x => Number.isFinite(x.last) && x.last > 0 ? Math.floor(x.last) : 0;
  const blacklist = [], blSeen = new Set();
  for (const x of Array.isArray(a.blacklist) ? a.blacklist : []) {
    const id = validId(x);
    if (!id || blSeen.has(id)) continue;
    blSeen.add(id);
    blacklist.push({ id, title: titleOf(x), last: lastOf(x) || nowSec });
  }
  const shows = new Map();
  const showFor = x => {
    const id = validId(x);
    if (!id) return null;
    let s = shows.get(id);
    if (!s) { s = { id, title: '', last: 0, track: false, hl: false, url: '', day: null, time: '' }; shows.set(id, s); }
    if (!s.title) s.title = titleOf(x);
    s.last = Math.max(s.last, lastOf(x));
    return s;
  };
  const slotOf = (s, x) => {
    const day  = Number.isInteger(x.day) && x.day >= 0 && x.day <= 6 ? x.day : null;
    const time = typeof x.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(x.time) ? x.time : '';
    if (day !== null && time) { s.day = day; s.time = time; }
  };
  for (const x of Array.isArray(a.shows) ? a.shows : []) {
    const s = showFor(x); if (!s) continue;
    s.track = !!x.track; s.hl = !!x.hl;
    if (typeof x.url === 'string') s.url = x.url.trim();
    slotOf(s, x);
  }
  // Older settings kept separate links / hlSeasons / tracked lists — merge them in
  for (const x of Array.isArray(a.links) ? a.links : []) { const s = showFor(x); if (s && typeof x.url === 'string' && x.url.trim()) s.url = x.url.trim(); }
  for (const x of Array.isArray(a.hlSeasons) ? a.hlSeasons : []) { const s = showFor(x); if (s) s.hl = true; }
  for (const x of Array.isArray(a.tracked) ? a.tracked : []) { const s = showFor(x); if (s) { s.track = true; slotOf(s, x); } }
  for (const s of shows.values()) if (!s.last) s.last = nowSec;
  return {
    enabled:   !!a.enabled,
    position:  ALL_POSITIONS.includes(a.position) ? a.position : 'bl',
    source:    a.source === 'user' ? 'user' : 'all',
    user:      typeof a.user === 'string' ? a.user.trim().slice(0, 40) : '',
    formats:   Array.isArray(a.formats)   ? ANIME_FORMATS.filter(f => a.formats.includes(f))     : ANIME_FORMATS.filter(f => f !== 'MUSIC'),
    countries: Array.isArray(a.countries) ? ANIME_COUNTRIES.filter(c => a.countries.includes(c)) : [...ANIME_COUNTRIES],
    highlight: typeof a.highlight === 'string' ? a.highlight : '',
    shows:     [...shows.values()],
    blacklist,
  };
}
function normalizeGroups(g) {
  if (!Array.isArray(g)) return [];
  // Keep only non-empty strings, dedupe preserving order, cap at MAX_GROUPS
  const seen = new Set();
  const out  = [];
  for (const v of g) {
    if (typeof v !== 'string') continue;
    const name = v.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length >= MAX_GROUPS) break;
  }
  return out;
}
// Pre-merge migration of stored settings (old field names -> current shape),
// applied BEFORE the DEFAULT_SETTINGS merge so old values aren't masked by defaults.
function migrateStored(s) {
  s = s || {};
  if (s.clock == null && typeof s.showClock === 'boolean') s.clock = { enabled: s.showClock, valign: 'middle' };
  // Background used to be a single active source; derive the new mode from what was set.
  if (s.bgMode == null) s.bgMode = (Array.isArray(s.bgUrls) && s.bgUrls.length) ? 'urls' : (s.background ? 'upload' : 'none');
  return s;
}
// Defensive type-coercion for top-level scalars — fixes hand-edited or stale
// backups before they get used or save()'d back. Object subfields are handled
// separately by normalizeAllSubfields.
function normalizeSettings(s) {
  const asBool = (v, dflt) => typeof v === 'boolean' ? v : dflt;
  s.theme         = s.theme === 'light' ? 'light' : 'dark';
  s.lang          = I18N[s.lang] ? s.lang : 'en';
  s.greetingName  = typeof s.greetingName === 'string' ? s.greetingName : '';
  s.background    = typeof s.background === 'string' ? s.background : '';
  s.newTab        = asBool(s.newTab,        false);
  s.seconds       = asBool(s.seconds,       true);
  s.hideAdd       = asBool(s.hideAdd,       false);
  s.searchEnabled = asBool(s.searchEnabled, true);
  s.tileCompact   = asBool(s.tileCompact,   false);
  s.tileColumns   = clampCols(s.tileColumns);
  s.tileVAlign    = ['top','middle','bottom'].includes(s.tileVAlign) ? s.tileVAlign : 'middle';
  // Clock is a widget now: { enabled, valign }. Migrate the old top-level showClock.
  const c = (s.clock && typeof s.clock === 'object') ? s.clock : {};
  s.clock = {
    enabled: asBool(c.enabled, asBool(s.showClock, true)),
    valign: ['top','middle','bottom'].includes(c.valign) ? c.valign : 'middle',
  };
  delete s.showClock;
  s.tileOpacity   = clampOpacity(s.tileOpacity);
  s.widgetOpacity = clampOpacity(s.widgetOpacity);
  s.searchOpacity = clampOpacity(s.searchOpacity);
  s.clockOpacity  = clampOpacity(s.clockOpacity);
  if (!ENGINES[s.engine]) s.engine = 'google';                       // guard against stale/removed engines
  s.accent = (typeof s.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.accent)) ? s.accent : '';
  s.bgUrls = Array.isArray(s.bgUrls) ? s.bgUrls.map(u => String(u || '').trim()).filter(Boolean) : [];
  s.bgInterval = [0, 5, 15, 30, 60].includes(Number(s.bgInterval)) ? Number(s.bgInterval) : 0;
  s.bgMode = ['none', 'upload', 'urls'].includes(s.bgMode) ? s.bgMode : 'none';
  return s;
}
// Apply every object-subfield normalizer + side-collision resolution in one place,
// shared by load() and importData() so they can't drift apart.
function normalizeAllSubfields() {
  settings.rss       = normalizeRss(settings.rss);
  settings.note      = normalizeNote(settings.note);
  settings.weather   = normalizeWeather(settings.weather);
  settings.countdown = normalizeCountdown(settings.countdown);
  settings.tracker   = normalizeTracker(settings.tracker);
  settings.anime     = normalizeAnime(settings.anime);
  settings.groups    = normalizeGroups(settings.groups);
  resolveWidgetPositions();  // resolve any overlapping widget positions from imported/old data
}
function safeNextId(stored) {
  const maxId = links.reduce((m, l) => Math.max(m, l.id), 0);
  return Math.max(Number(stored) || 0, maxId + 1);
}
function load() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch {}
  if (data && Array.isArray(data.links)) {
    links    = data.links.map(normalizeLink).filter(Boolean);
    nextId   = safeNextId(data.nextId);
    settings = { ...DEFAULT_SETTINGS, ...migrateStored(data.settings) };
    normalizeSettings(settings);
    normalizeAllSubfields();
  } else {
    links  = DEFAULT_LINKS.map((l, i) => ({ id: i + 1, name: l.name, url: l.url, icon: '', group: '' }));
    nextId = links.length + 1;
    normalizeSettings(settings);   // own copies of the nested defaults (clock, lists), not shared with DEFAULT_SETTINGS
    normalizeAllSubfields();       // fill in every widget's defaults (anime formats/lists, tracker options, …)
  }
}
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ links, nextId, settings }));
    return true;
  } catch { return false; }
}

// ── Image helper — downscale to keep localStorage small ───────────────────────
function processImageFile(file, maxDim, mime, quality, cb) {
  if (!file || !file.type.startsWith('image/')) { cb(null); return; }
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxDim || h > maxDim) {
        const r = Math.min(maxDim / w, maxDim / h);
        w = Math.round(w * r); h = Math.round(h * r);
      }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      try { cb(c.toDataURL(mime, quality)); } catch { cb(null); }
    };
    img.onerror = () => cb(null);
    img.src = e.target.result;
  };
  reader.onerror = () => cb(null);
  reader.readAsDataURL(file);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// Pass through anything that already carries a scheme we allow (http/https/file);
// otherwise assume a bare domain and prefix https://. file:// links let tiles point
// at local files, e.g. file:///C:/Users/me/Desktop/page.html
function withProtocol(url) { return /^(https?|file):\/\//i.test(url) ? url : 'https://' + url; }
function faviconSources(url) {
  let host = '';
  try {
    const u = new URL(withProtocol(url));
    if (u.protocol === 'file:') return [];   // local files have no favicon host
    host = u.hostname;
  } catch { return []; }
  if (!host) return [];
  return [
    `https://icons.duckduckgo.com/ip3/${host}.ico`,      // real site favicon, fails cleanly when absent
    `https://www.google.com/s2/favicons?domain=${host}&sz=64`, // broad fallback
  ];
}
// Advance an <img> through its remaining favicon sources; hide it (revealing the letter) when exhausted
function nextIcon(img) {
  const list = img.dataset.fb ? img.dataset.fb.split('|').filter(Boolean) : [];
  if (list.length) {
    img.dataset.fb = list.slice(1).join('|');
    img.src = list[0];
  } else {
    img.style.display = 'none';
  }
}
function colorFor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360}, 42%, 46%)`;
}
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
// Decide whether a typed query is a URL to navigate to (vs. a web search).
// A scheme always counts; a bare token only counts if its TLD is a known one,
// so "vue.js" / "3.14" still search while "github.com" / "bbc.co.uk" navigate.
function looksLikeUrl(q) {
  if (/\s/.test(q)) return false;
  if (/^(https?|file):\/\//i.test(q)) return true;
  const host = q.split(/[/?#]/)[0];
  if (!/^[\w-]+(\.[\w-]+)+$/.test(host)) return false;
  return COMMON_TLDS.has(host.split('.').pop().toLowerCase());
}
// Only http(s) links are safe to put in an href — blocks javascript:/data: etc.
// from untrusted RSS content (clicking those would run in our origin).
function safeHttpLink(link) {
  return /^https?:\/\//i.test(String(link || '').trim()) ? String(link).trim() : '';
}
