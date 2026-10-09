// Startpage: Anime Feed widget: AniList fetch/cache, right-click menu, link editor, adding shows.
// Classic script sharing globals with the others; load order is set in index.html.

// ── Anime feed (AniList airing schedule) ─────────────────────────────────────
// Episodes that have aired, newest first: either everything on AniList ("all") or
// only seasons on one user's AniList lists ("user"). Clicking a row opens that
// season's link — a custom one set via right-click, else an r/anime search for its
// discussion thread; the small button opens the AniList entry. A tracked season with
// a custom day + time counts its episodes as out at that slot (earlier or later than
// AniList's), like the tracker does.
// AniList keeps the full airing history, so the local cache only gives an instant
// first paint and lets filter changes refill without a fetch; it can always be rebuilt.
const ANILIST_API      = 'https://graphql.anilist.co';
const ANIME_CACHE_KEY  = 'startpage_animecache';
const ANIME_REFRESH_MS = 15 * 60 * 1000;
const ANIME_SHOW       = 100;    // rows shown (after filters + blacklist)
const ANIME_CACHE_MIN  = 300;    // raw entries kept so filter changes can refill from cache
const ANIME_CACHE_MAX  = 1500;   // hard cap, for very narrow filters that need deep history
const ANIME_MAX_PAGES  = 10;     // requests per refresh (50 entries each), well under AniList's rate limit
const ANIME_LIST_Q     = 'query($u:String){MediaListCollection(userName:$u,type:ANIME){lists{entries{mediaId}}}}';
const ANIME_FIELDS     = 'pageInfo{hasNextPage} airingSchedules(airingAt_lesser:$to,%IDS%sort:[TIME_DESC,ID_DESC]){id episode airingAt media{id format countryOfOrigin siteUrl title{english romaji}}}';
// AniList errors on a null mediaId_in, so "all airing" uses a variant without it
const ANIME_SCHED_ALL  = 'query($p:Int,$to:Int){Page(page:$p,perPage:50){' + ANIME_FIELDS.replace('%IDS%', '') + '}}';
const ANIME_SCHED_USER = 'query($p:Int,$to:Int,$ids:[Int]){Page(page:$p,perPage:50){' + ANIME_FIELDS.replace('%IDS%', 'mediaId_in:$ids,') + '}}';

let animeItems = [];         // cached entries, newest first: { id, m (media id), ep, at (unix s), t (title), f, c, u }
let animeShown = [];         // rows currently rendered (context-menu lookup)
let animeNextDue = Infinity; // earliest held-back episode (custom slot still ahead), unix s
let animeSigLoaded = null;   // source signature the in-memory items belong to
let animeFetchedSig = '';    // signature fetched this page load (applyAnime runs often; fetch once + timer)
let animeUpdatedAt = 0;      // last successful fetch
let animeExhausted = false;  // AniList has no entries older than our oldest
let animeListKey = '';       // user mode: fingerprint of the list's media ids (a change → rebuild)
let animeBusy = false, animeAgain = false, animeErr = '';
let animeTimer = null, animeFillDebounce = null, animeCtxItem = null, animeEditItem = null;

function animeSig() {
  const a = settings.anime;
  return a.source === 'user' ? 'user:' + a.user.toLowerCase() : 'all';
}
function loadAnimeCache() {
  animeItems = []; animeUpdatedAt = 0; animeExhausted = false; animeListKey = '';
  try {
    const c = JSON.parse(localStorage.getItem(ANIME_CACHE_KEY) || 'null');
    if (c && c.sig === animeSig() && Array.isArray(c.items)) {
      animeItems = c.items.filter(it => it && Number.isInteger(it.id) && Number.isInteger(it.m) && typeof it.t === 'string');
      animeUpdatedAt = typeof c.fetchedAt === 'number' ? c.fetchedAt : 0;
      animeExhausted = !!c.exhausted;
      animeListKey   = typeof c.listKey === 'string' ? c.listKey : '';
    }
  } catch {}
}
function saveAnimeCache() {
  try {
    localStorage.setItem(ANIME_CACHE_KEY, JSON.stringify({
      sig: animeSig(), fetchedAt: animeUpdatedAt, exhausted: animeExhausted, listKey: animeListKey, items: animeItems,
    }));
  } catch {}
}
function hashIds(ids) {
  let h = 5381;
  for (const n of [...ids].sort((a, b) => a - b)) h = ((h << 5) + h + n) | 0;
  return ids.length + ':' + (h >>> 0).toString(36);
}

// Filters: format + country toggles (unknown values pass) and the season blacklist
function animeVisible(items) {
  const a = settings.anime, bl = new Set(a.blacklist.map(b => b.id));
  return items.filter(it =>
    (!ANIME_FORMATS.includes(it.f)   || a.formats.includes(it.f)) &&
    (!ANIME_COUNTRIES.includes(it.c) || a.countries.includes(it.c)) &&
    !bl.has(it.m));
}
// Default link: r/anime search for the season's discussion threads. The name is an
// exact-phrase match (quoted), which r/anime's "English • Romaji - Episode N
// discussion" thread titles hit cleanly. Symbols like ☆ ★ ♪ and any quotes in the
// title become spaces so they can't break the phrase.
function animeSearchUrl(title) {
  const name = title.replace(/\p{So}/gu, ' ').replace(/"/g, ' ').replace(/\s+/g, ' ').trim();
  return 'https://www.reddit.com/r/anime/search?' + new URLSearchParams({
    q: `"${name}" episode discussion`, restrict_sr: 'on', include_over_18: 'on', sort: 'new', t: 'week',
  });
}
function animeLinkFor(it) {
  const s = animeShow(it.m);
  return s && s.url ? withProtocol(s.url) : animeSearchUrl(it.t);
}
// The user's per-season settings ("Shows"): look one up, or create it on first use
function animeShow(m) { return settings.anime.shows.find(s => s.id === m); }
function ensureShow(m, title) {
  let s = animeShow(m);
  if (!s) {
    s = { id: m, title, last: animeSeasonLast(m), track: false, hl: false, url: '', day: null, time: '' };
    settings.anime.shows.push(s);
  }
  return s;
}
function trackedShows() { return settings.anime.shows.filter(s => s.track); }
// Tracked seasons with a custom day + time, by id (an untracked show's kept slot isn't in use)
function customSlots() {
  return new Map(trackedShows().filter(s => s.day !== null && s.time).map(s => [s.id, s]));
}
// When an episode is out for the user: AniList's time, or for a season in `slots` the
// occurrence of its custom slot nearest AniList's time (the tracker pairs them the same way)
function animeOutAt(it, slots) {
  const s = slots.get(it.m);
  if (!s) return it.at;
  const [h, m] = s.time.split(':').map(Number), aired = it.at * 1000;
  const slot = new Date(aired); slot.setHours(h, m, 0, 0);
  slot.setDate(slot.getDate() + s.day - slot.getDay());   // the slot in that week (Sun–Sat)
  let best = +slot;
  for (const k of [-7, 7]) {
    const c = new Date(slot); c.setDate(c.getDate() + k);
    if (Math.abs(c - aired) < Math.abs(best - aired)) best = +c;
  }
  return Math.floor(best / 1000);
}
// A slot earlier than AniList's time can put an episode out before the feed's fetch
// (aired episodes only) has it, so those come from the tracked schedule: entries newer
// than anything fetched. The fetched entry takes over later (same id, so never both).
function animeEarlyItems(slots) {
  if (!slots.size || !trackSched || !animeItems.length) return [];
  const a = settings.anime, newest = animeItems[0].at;
  // A season the feed hasn't seen yet (e.g. a premiere) needs to be on the user's list in "user" mode
  const onList = m => a.source !== 'user' ||
    !!(animeUserIds && animeUserIds.user === a.user.toLowerCase() && animeUserIds.ids.includes(m));
  const out = [];
  for (const s of trackSched.items) {
    if (!slots.has(s.m) || s.at <= newest) continue;
    const ref = animeItems.find(x => x.m === s.m);   // same season: its title, format, country, link
    if (ref) out.push({ ...ref, id: s.id, ep: s.ep, at: s.at });
    else if (onList(s.m)) out.push({ id: s.id, m: s.m, ep: s.ep, at: s.at, t: slots.get(s.m).title, f: '', c: '', u: `https://anilist.co/anime/${s.m}` });
  }
  return out;
}
function animeAge(at) {
  const ms = Date.now() - at * 1000;
  return ms < 60000 ? L().feedJustNow : L().animeAgo.replace('{t}', relShort(ms));
}

function showAnimeState(key) {
  animeShown = [];
  $.animeList.innerHTML = `<div class="rss-state">${esc(L()[key] || '')}</div>`;
  scheduleLayout();
}
function renderAnimeUpdated() {
  const on = settings.anime.enabled && animeUpdatedAt;
  $.animeUpdated.textContent = on ? relShort(Date.now() - animeUpdatedAt) : '';
  $.animeUpdated.title = on ? L().feedUpdatedTitle + ' ' + new Date(animeUpdatedAt).toLocaleString() : '';
}
function renderAnime() {
  const a = settings.anime;
  if (!a.enabled) return;
  renderAnimeUpdated();
  animeNextDue = Infinity;
  if (a.source === 'user' && !a.user) { showAnimeState('animeSetUser'); return; }
  // Custom slots move episodes to their own time; one whose slot is still ahead is held back
  const slots = customSlots(), nowS = Date.now() / 1000, out = [];
  for (const it of animeVisible(animeItems.concat(animeEarlyItems(slots)))) {
    const at = animeOutAt(it, slots);
    if (at > nowS) { animeNextDue = Math.min(animeNextDue, at); continue; }
    out.push(at === it.at ? it : { ...it, at });
  }
  const shown = out.sort((x, y) => y.at - x.at || y.id - x.id).slice(0, ANIME_SHOW);
  if (!shown.length) { showAnimeState(animeBusy ? 'feedLoading' : (animeErr || 'animeEmpty')); return; }
  const target  = settings.newTab ? ' target="_blank" rel="noopener"' : '';
  const phrases = highlightPhrases(a.highlight);
  const hlSeasons = new Set(a.shows.filter(s => s.hl).map(s => s.id));
  const alTitle = esc(L().animeOpenAniList);
  const scroll  = $.animeList.scrollTop;
  animeShown = shown;
  $.animeList.innerHTML = shown.map(it => {
    const title = `${it.t} - Episode ${it.ep}`;
    const hl = (hlSeasons.has(it.m) || titleIsHighlighted(title, phrases)) ? ' rss-item--hl' : '';
    return `<div class="rss-item anime-item${hl}" data-id="${it.id}">` +
      `<a class="anime-main" href="${esc(animeLinkFor(it))}"${target}>` +
        `<span>${esc(title)}</span><span class="anime-meta" data-at="${it.at}">${esc(animeAge(it.at))}</span></a>` +
      `<a class="anime-al" href="${esc(it.u)}"${target} title="${alTitle}">${TRACKER_LINK_SVG}</a>` +
    `</div>`;
  }).join('');
  $.animeList.scrollTop = scroll;
  scheduleLayout();
}
// Keep the "3h ago" figures current without rebuilding the list (rebuilt once a
// held-back episode reaches its custom slot)
setInterval(() => {
  if (!settings.anime.enabled) return;
  if (Date.now() / 1000 >= animeNextDue) { renderAnime(); return; }
  $.animeList.querySelectorAll('.anime-meta[data-at]').forEach(el => { el.textContent = animeAge(Number(el.dataset.at)); });
  renderAnimeUpdated();
}, 30000);

// ── Fetching ──
async function anilist(query, variables) {
  const res = await fetch(ANILIST_API, {
    method: 'POST', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.errors || !data.data) throw Object.assign(new Error('AniList request failed'), { status: res.status });
  return data.data;
}
function toAnimeItem(s) {
  const md = s && s.media;
  if (!md || !Number.isInteger(s.id) || !Number.isInteger(md.id)) return null;
  const t = ((md.title && (md.title.english || md.title.romaji)) || '').trim();   // English first, romaji fallback
  if (!t) return null;
  return {
    id: s.id, m: md.id, ep: Number(s.episode) || 0, at: Number(s.airingAt) || 0, t,
    f: md.format || '', c: md.countryOfOrigin || '',
    u: safeHttpLink(md.siteUrl) || `https://anilist.co/anime/${md.id}`,
  };
}
function mergeAnime(items) {
  const byId = new Map(animeItems.map(it => [it.id, it]));
  for (const it of items) byId.set(it.id, it);   // fresh data wins (e.g. a corrected air time)
  animeItems = [...byId.values()].sort((a, b) => b.at - a.at || b.id - a.id);
}
// Keep ≥ ANIME_CACHE_MIN entries and everything down to the oldest shown row
function trimAnime() {
  const vis = animeVisible(animeItems);
  const keep = Math.min(ANIME_CACHE_MAX, Math.max(ANIME_CACHE_MIN,
    vis.length >= ANIME_SHOW ? animeItems.indexOf(vis[ANIME_SHOW - 1]) + 1 : animeItems.length));
  if (animeItems.length > keep) { animeItems = animeItems.slice(0, keep); animeExhausted = false; }
}
async function fetchAnime() {
  const a = settings.anime;
  if (!a.enabled || (a.source === 'user' && !a.user)) return;
  if (animeBusy) { animeAgain = true; return; }
  animeBusy = true; animeAgain = false;
  const sig = animeSig();
  animeFetchedSig = sig;
  if (!animeVisible(animeItems).length) renderAnime();   // "Loading…" while nothing is on screen
  const stale = () => { if (animeSig() !== sig) throw Object.assign(new Error('stale'), { stale: true }); };
  try {
    let ids = null;
    if (a.source === 'user') {
      let d;
      try { d = await anilist(ANIME_LIST_Q, { u: a.user }); }
      catch (e) { e.userErr = e.status === 404 || e.status === 403; throw e; }
      stale();
      const lists = (d.MediaListCollection && d.MediaListCollection.lists) || [];
      ids = [...new Set(lists.flatMap(l => (l.entries || []).map(e => e.mediaId)).filter(Number.isInteger))];
      animeUserIds = { user: a.user.toLowerCase(), ids, at: Date.now() };   // reused by the tracker's "airing today"
      const key = hashIds(ids);
      if (key !== animeListKey) { animeItems = []; animeExhausted = false; animeListKey = key; }   // list changed → rebuild
    }
    if (ids && !ids.length) {
      animeItems = []; animeExhausted = true;
    } else {
      const q = ids ? ANIME_SCHED_USER : ANIME_SCHED_ALL;
      const getPage = async (p, to) => {
        const d = await anilist(q, ids ? { p, to, ids } : { p, to });
        stale();
        const pg = d.Page || {};
        return { items: (pg.airingSchedules || []).map(toAnimeItem).filter(Boolean), more: !!(pg.pageInfo && pg.pageInfo.hasNextPage) };
      };
      let pages = 0;
      // 1) Newest first, until we reach entries we already have. On a fresh start
      //    (empty cache) rows appear page by page until the cache holds ANIME_CACHE_MIN.
      const known = new Set(animeItems.map(it => it.id));
      const now = Math.floor(Date.now() / 1000) + 1;
      const fresh = [];
      let hit = false, more = true;
      for (let p = 1; pages < ANIME_MAX_PAGES; p++) {
        const r = await getPage(p, now); pages++;
        hit = r.items.some(it => known.has(it.id));
        more = r.more;
        if (known.size) fresh.push(...r.items);
        else { mergeAnime(r.items); renderAnime(); }
        if (hit || !more) break;
        if (!known.size && animeItems.length >= ANIME_CACHE_MIN && animeVisible(animeItems).length >= ANIME_SHOW) break;
      }
      if (known.size) {
        // Never reached the cached entries → there's a gap, so the old cache can't be stitched on
        if (!hit && more) { animeItems = []; animeExhausted = false; }
        mergeAnime(fresh);
      }
      if (!more) animeExhausted = true;
      // 2) Older entries until 100 rows pass the filters (or AniList runs out)
      while (animeItems.length && !animeExhausted && pages < ANIME_MAX_PAGES && animeItems.length < ANIME_CACHE_MAX &&
             animeVisible(animeItems).length < ANIME_SHOW) {
        const oldest = animeItems[animeItems.length - 1];
        const r = await getPage(1, oldest.at + 1); pages++;
        mergeAnime(r.items);
        if (!r.more) animeExhausted = true;
        if (animeItems[animeItems.length - 1] === oldest) break;   // no progress (shared timestamps) — stop
      }
    }
    trimAnime();
    animeUpdatedAt = Date.now();
    animeErr = '';
    saveAnimeCache();
    touchAnimeSeasons();
  } catch (e) {
    if (!e.stale && animeSig() === sig) {   // a failure for a source that's since been switched away from is moot
      animeErr = e.userErr ? 'animeUserError' : 'animeError';
      if (animeItems.length) saveAnimeCache();   // keep whatever was fetched before the failure
    }
  } finally {
    animeBusy = false;
    renderAnime();
    if (animeAgain) fetchAnime();
  }
}
// A filter/blacklist change: re-render from cache, and fetch older entries if fewer than 100 rows remain
function animeFiltersChanged() {
  renderAnime();
  exportAnimeWeek();   // the Weekly-Tracker site follows the blacklist too
  if (settings.tracker.enabled) renderTracker();
  clearTimeout(animeFillDebounce);
  if (animeVisible(animeItems).length < ANIME_SHOW && !animeExhausted) animeFillDebounce = setTimeout(fetchAnime, 600);
}
function applyAnime() {
  const a = settings.anime, el = $.animePanel;
  ALL_POSITIONS.forEach(p => el.classList.remove('pos-' + p));
  el.classList.add('pos-' + a.position);
  el.classList.toggle('show', a.enabled);
  if (animeTimer) { clearInterval(animeTimer); animeTimer = null; }
  if (a.enabled) {
    if (animeSigLoaded !== animeSig()) { animeSigLoaded = animeSig(); loadAnimeCache(); animeErr = ''; touchAnimeSeasons(); }
    if (animeFetchedSig !== animeSig()) fetchAnime();
    renderAnime();
    animeTimer = setInterval(fetchAnime, ANIME_REFRESH_MS);
  }
  renderAnimeUpdated();
  scheduleLayout();
}
$.animeRefresh.addEventListener('click', () => {
  $.animeRefresh.classList.remove('spin');
  void $.animeRefresh.offsetWidth;  // restart the transition
  $.animeRefresh.classList.add('spin');
  fetchAnime();
});

// ── Right-click menu + per-season link editor ──
$.animeList.addEventListener('contextmenu', e => {
  const row = e.target.closest('.anime-item'); if (!row) return;
  const it = animeShown.find(x => x.id === Number(row.dataset.id)); if (!it) return;
  openAnimeCtx(e, it);
});
// Tracked entries in the Weekly Tracker widget get the same menu (your own entries
// come from the standalone tracker and keep the browser's normal menu)
$.trackerBody.addEventListener('contextmenu', e => {
  const card = e.target.closest('.wt-auto, .wt-up'); if (!card) return;
  const m = Number(card.dataset.m), s = animeShow(m);
  if (!s && !card.dataset.t) return;
  openAnimeCtx(e, { m, t: s ? s.title : card.dataset.t });
});
// `it` only needs the season: { m: media id, t: title }
function openAnimeCtx(e, it) {
  e.preventDefault();
  closeCtx(); closeAnimeBlCtx();
  animeCtxItem = it;
  const s = animeShow(it.m), tracked = !!(s && s.track);
  $.animeCtxReset.style.display = s && s.url ? '' : 'none';
  $.animeCtxHl.textContent = s && s.hl ? L().animeUnhighlight : L().animeHighlightSeason;
  $.animeCtxTrack.textContent = tracked ? L().animeUntrack : L().animeTrack;
  $.animeCtxTime.style.display = tracked ? '' : 'none';
  placeMenu($.animeCtx, e);
}
function closeAnimeCtx() { $.animeCtx.classList.remove('open'); animeCtxItem = null; }
function animeCtxEdit() {
  const it = animeCtxItem; closeAnimeCtx();
  if (!it) return;
  animeEditItem = it;
  const s = animeShow(it.m);
  $.animeLinkTitle.textContent = it.t;
  $.animeLinkUrl.value = s ? s.url : '';
  $.animeLinkUrl.placeholder = animeSearchUrl(it.t);   // shows what "default" means
  $.animeLinkModal.classList.add('open');
  setTimeout(() => $.animeLinkUrl.focus(), 30);
}
function closeAnimeLinkModal() { $.animeLinkModal.classList.remove('open'); animeEditItem = null; }
// Set (or, with an empty url, clear) one season's custom link
function setAnimeLink(id, title, url) {
  url = url.trim();
  const s = url ? ensureShow(id, title) : animeShow(id);   // clearing never creates a show
  if (s) s.url = url;
  save(); renderAnime(); renderAnimeSettings();
  trackedChanged();   // tracked entries (widget + Weekly-Tracker site) open the same link
}
function saveAnimeLink() {
  if (!animeEditItem) return;
  setAnimeLink(animeEditItem.m, animeEditItem.t, $.animeLinkUrl.value);
  closeAnimeLinkModal();
}
function animeCtxReset() {
  const it = animeCtxItem; closeAnimeCtx();
  if (it) setAnimeLink(it.m, it.t, '');
}
function animeCtxBlacklist() {
  const it = animeCtxItem; closeAnimeCtx();
  if (!it) return;
  if (!settings.anime.blacklist.some(b => b.id === it.m)) settings.anime.blacklist.push({ id: it.m, title: it.t, last: animeSeasonLast(it.m) });
  save(); renderAnimeSettings(); animeFiltersChanged();
}
// Toggle the whole season's highlight (every episode, now and future)
function animeCtxHighlight() {
  const it = animeCtxItem; closeAnimeCtx();
  if (it) toggleShowFlag(ensureShow(it.m, it.t).id, 'hl');
}
// Toggle tracking: a tracked season's episodes show in the Weekly Tracker widget
function animeCtxTrack() {
  const it = animeCtxItem; closeAnimeCtx();
  if (it) toggleShowFlag(ensureShow(it.m, it.t).id, 'track');
}
// Flip a show's Tracked / Highlighted flag (right-click menu or the Anime Manager's toggles)
function toggleShowFlag(id, flag) {
  const s = animeShow(id); if (!s) return;
  s[flag] = !s[flag];
  save(); renderAnime(); renderAnimeSettings();
  if (flag === 'track') trackedChanged();
  else exportAnimeWeek();   // the Weekly-Tracker site shows highlights too
}
// Add a show by pasting an AniList link (anilist.co/anime/12345/…) or a bare ID.
// The entry is looked up first, for its title and to confirm it's an anime; it's
// added with nothing switched on, ready to be set up in the list.
const ANIME_MEDIA_Q = 'query($id:Int){Media(id:$id){id type status endDate{year month day} title{english romaji}}}';
function parseAniListId(s) {
  s = s.trim();
  if (/^\d+$/.test(s)) return { id: Number(s) };
  const m = /anilist\.co\/(anime|manga)\/(\d+)/i.exec(s);
  if (!m) return null;
  return { id: Number(m[2]), manga: m[1].toLowerCase() === 'manga' };
}
async function addShowFromInput() {
  const t = L(), msg = (text, err) => { $.animeShowAddMsg.textContent = text; $.animeShowAddMsg.classList.toggle('err', !!err); };
  const p = parseAniListId($.animeShowAdd.value);
  if (!p || !p.id) { msg(t.animeBadId, true); return; }
  if (p.manga) { msg(t.animeNotAnime, true); return; }
  const dup = animeShow(p.id);
  if (dup) { msg(t.animeShowDup.replace('{t}', dup.title), true); return; }
  // A blacklisted season is hidden from every list, so adding it would look like nothing happened
  if (settings.anime.blacklist.some(b => b.id === p.id)) { msg(t.animeShowBlacklisted, true); return; }
  msg(t.animeLooking);
  $.animeShowAddBtn.disabled = true;
  try {
    const md = (await anilist(ANIME_MEDIA_Q, { id: p.id })).Media;
    if (!md || md.type !== 'ANIME') { msg(t.animeNotAnime, true); return; }
    const title = ((md.title && (md.title.english || md.title.romaji)) || '').trim() || ('#' + md.id);
    const fresh = !animeShow(md.id), s = ensureShow(md.id, title);   // no-op if it was added meanwhile
    // A season that has finished airing starts out archived: date it by its end date
    // (unknown = long ago) instead of "now", which would list it as airing for ANIME_ACTIVE_DAYS
    const ended = md.status === 'FINISHED' || md.status === 'CANCELLED';
    if (fresh && ended) {
      const d = md.endDate || {};
      s.last = d.year ? Math.floor(new Date(d.year, (d.month || 12) - 1, d.day || 28).getTime() / 1000) : 1;   // 1, not 0: 0 means "unset" and loads as now
    }
    animeFilterSel = 'all';      // it has nothing switched on yet, so make sure it's listed
    save(); renderAnimeSeasonList('shows');
    $.animeShowAdd.value = '';
    msg((isShowActive(s) ? t.animeShowAdded : t.animeShowAddedArchived).replace('{t}', title));
  } catch (e) {
    msg(e.status === 404 ? t.animeNotFound : t.animeFail, true);
  } finally {
    $.animeShowAddBtn.disabled = false;
  }
}
$.animeShowAdd.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addShowFromInput(); } });
// Track every currently airing season on the user's AniList lists, skipping any
// whose list status is Dropped and any blacklisted season. Asks for confirmation
// with the count + titles.
const ANIME_MYLIST_Q = 'query($u:String){MediaListCollection(userName:$u,type:ANIME){lists{entries{status media{id status title{english romaji}}}}}}';
async function trackMyAniList() {
  const t = L(), user = settings.anime.user;
  const msg = (text, err) => { $.animeShowAddMsg.textContent = text; $.animeShowAddMsg.classList.toggle('err', !!err); };
  if (!user) { msg(t.animeTrackListNeedUser, true); return; }
  msg(t.animeLooking);
  $.animeTrackListBtn.disabled = true;
  try {
    const d = await anilist(ANIME_MYLIST_Q, { u: user });
    const lists = (d.MediaListCollection && d.MediaListCollection.lists) || [];
    const dropped = new Set(), airing = new Map();
    for (const e of lists.flatMap(l => l.entries || [])) {
      const md = e.media;
      if (!md || !Number.isInteger(md.id)) continue;
      if (e.status === 'DROPPED') { dropped.add(md.id); continue; }
      if (md.status !== 'RELEASING') continue;
      const title = ((md.title && (md.title.english || md.title.romaji)) || '').trim() || ('#' + md.id);
      airing.set(md.id, title);
    }
    const blocked = new Set(settings.anime.blacklist.map(b => b.id));
    const toTrack = [...airing].filter(([id]) => !dropped.has(id) && !blocked.has(id) && !(animeShow(id) && animeShow(id).track));
    if (!toTrack.length) { msg(t.animeTrackListNone); return; }
    const names = toTrack.map(([, title]) => '• ' + title);
    const list = names.slice(0, 15).join('\n') + (names.length > 15 ? `\n… +${names.length - 15}` : '');
    msg('');
    if (!confirm(t.animeTrackListConfirm.replace('{n}', toTrack.length).replace('{u}', user).replace('{list}', list))) return;
    for (const [id, title] of toTrack) ensureShow(id, title).track = true;
    save(); renderAnimeSettings(); trackedChanged();
    msg(t.animeTrackListDone.replace('{n}', toTrack.length));
  } catch (e) {
    msg(e.status === 404 || e.status === 403 ? t.animeUserError : t.animeFail, true);
  } finally {
    $.animeTrackListBtn.disabled = false;
  }
}
// Newest air time we've seen for a season (falls back to now for one not in the cache)
function animeSeasonLast(m) {
  const it = animeItems.find(x => x.m === m);   // items are newest-first
  return it ? it.at : Math.floor(Date.now() / 1000);
}
// Advance each listed season's `last` from the cached entries (drives the Airing/Archived split)
function touchAnimeSeasons() {
  const latest = new Map();
  for (const it of animeItems) if (!latest.has(it.m)) latest.set(it.m, it.at);
  const a = settings.anime;
  let changed = false;
  for (const list of [a.shows, a.blacklist]) {
    for (const e of list) {
      const at = latest.get(e.id);
      if (at && at > e.last) { e.last = at; changed = true; }
    }
  }
  if (changed) { save(); refreshAnimeManagerShows(); }
}
