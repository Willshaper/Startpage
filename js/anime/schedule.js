// Startpage: Tracked seasons: schedule, Weekly-Tracker site sync, airing today, custom day/time.
// Classic script sharing globals with the others; load order is set in index.html.

// ── Tracked seasons → Weekly Tracker widget ──
// Fetches the airing schedule (±8 days) of every tracked season and shows the
// episodes airing today as auto entries in the tracker. A season with a custom
// day + time shows on that day at that time, using the AniList episode nearest
// to that slot (none within ±3.5 days = no episode that week).
const TRACK_CACHE_KEY  = 'startpage_trackcache';
const TRACK_REFRESH_MS = 30 * 60 * 1000;
const ANIME_TRACK_Q = 'query($p:Int,$ids:[Int],$from:Int,$to:Int){Page(page:$p,perPage:50){pageInfo{hasNextPage} airingSchedules(mediaId_in:$ids,airingAt_greater:$from,airingAt_lesser:$to,sort:TIME){id episode airingAt mediaId}}}';
// Status + next episode per tracked season, to tell a break week from a finished season
const ANIME_TRACK_MEDIA_Q = 'query($p:Int,$ids:[Int]){Page(page:$p,perPage:50){pageInfo{hasNextPage} media(id_in:$ids){id status nextAiringEpisode{airingAt episode}}}}';
let trackSched = null;   // { key, fetchedAt, items: [{ id, m, ep, at }], media: { [id]: { st, na, ne } } }
let trackBusy = false, trackAgain = false;
function trackKey() { return trackedShows().map(x => x.id).sort((a, b) => a - b).join(','); }
function loadTrackCache() {
  try {
    const c = JSON.parse(localStorage.getItem(TRACK_CACHE_KEY) || 'null');
    if (c && typeof c.key === 'string' && Array.isArray(c.items) && c.media && typeof c.media === 'object') trackSched = c;
  } catch {}
}
// Runs whenever there are tracked shows (even with the tracker widget off): the
// schedule also feeds the Weekly-Tracker site through exportAnimeWeek().
async function fetchTracked(force) {
  if (trackBusy) { if (force) trackAgain = true; return; }   // a timer tick during a fetch needs no re-run
  const key = trackKey();
  if (!key) { trackSched = { key: '', fetchedAt: Date.now(), items: [], media: {} }; exportAnimeWeek(); return; }
  if (!force && trackSched && trackSched.key === key && Date.now() - trackSched.fetchedAt < TRACK_REFRESH_MS) return;
  trackBusy = true; trackAgain = false;
  try {
    const ids = key.split(',').map(Number), now = Math.floor(Date.now() / 1000), items = [];
    for (let p = 1; p <= 5; p++) {
      // +11 days: enough to find the episode nearest a weekly slot up to 7 days out (± 3.5)
      const d = await anilist(ANIME_TRACK_Q, { p, ids, from: now - 8 * 86400, to: now + 11 * 86400 });
      const pg = d.Page || {};
      for (const s of pg.airingSchedules || []) {
        if (Number.isInteger(s.id) && Number.isInteger(s.mediaId)) items.push({ id: s.id, m: s.mediaId, ep: Number(s.episode) || 0, at: Number(s.airingAt) || 0 });
      }
      if (!(pg.pageInfo && pg.pageInfo.hasNextPage)) break;
    }
    const media = {};
    for (let p = 1; p <= 5; p++) {
      const d = await anilist(ANIME_TRACK_MEDIA_Q, { p, ids });
      const pg = d.Page || {};
      for (const md of pg.media || []) {
        if (!Number.isInteger(md.id)) continue;
        const n = md.nextAiringEpisode;
        media[md.id] = { st: md.status || '', na: n ? Number(n.airingAt) || 0 : 0, ne: n ? Number(n.episode) || 0 : 0 };
      }
      if (!(pg.pageInfo && pg.pageInfo.hasNextPage)) break;
    }
    if (trackKey() !== key) { trackAgain = true; return; }   // list changed mid-flight
    trackSched = { key, fetchedAt: Date.now(), items, media };
    try { localStorage.setItem(TRACK_CACHE_KEY, JSON.stringify(trackSched)); } catch {}
    // Aired episodes also keep a tracked season in the "airing" part of its list
    let changed = false;
    for (const tr of trackedShows()) {
      for (const s of items) if (s.m === tr.id && s.at <= now && s.at > tr.last) { tr.last = s.at; changed = true; }
    }
    if (changed) save();
    exportAnimeWeek();
  } catch {}   // offline / rate-limited: keep the cached schedule
  finally {
    trackBusy = false;
    if (settings.tracker.enabled) renderTracker();
    refreshAnimeManagerShows();   // air times / airing-vs-finished may have changed
    if (trackAgain) fetchTracked(true);
  }
}
// The tracked list, a custom time or a link changed: update the Weekly-Tracker site's
// copy, refresh the widget, and refetch if the set of tracked seasons changed
function trackedChanged() {
  exportAnimeWeek();
  if (!trackSched || trackSched.key !== trackKey()) fetchTracked(true);
  if (settings.tracker.enabled) renderTracker();
}

// ── Weekly-Tracker site sync ──
// The standalone Weekly Tracker (same origin, so the same localStorage) shows
// tracked anime in its week view. It only reads ANIME_WEEK_KEY, a small summary
// written here — one entry per tracked, still-airing, non-archived season with its
// weekly slot, the episode at that slot's next occurrence (or break-week info) and
// links. It never touches the Startpage's settings: changes made there (time, link,
// highlight, track, blacklist) are left as a note in ANIME_TIME_EDITS_KEY (named from
// when only the time could be edited), which applyTrackerTimeEdits() applies and clears.
const ANIME_WEEK_KEY       = 'startpage_anime_week';
const ANIME_TIME_EDITS_KEY = 'startpage_anime_time_edits';
let animeWeekLast = null;   // last exported shows JSON (skip identical rewrites)
function exportAnimeWeek() {
  if (!trackSched) return;   // schedule not known yet
  const pad = n => String(n).padStart(2, '0');
  const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const nowMs = Date.now(), nowS = Math.floor(nowMs / 1000);
  const shows = [];
  const blocked = new Set(settings.anime.blacklist.map(b => b.id));
  for (const tr of trackedShows()) {
    if (blocked.has(tr.id)) continue;   // blacklisted shows stay off the tracker even if tracked
    const md = (trackSched.media || {})[tr.id];
    // Only airing, non-archived shows — "airing" includes an upcoming premiere
    // (AniList calls it NOT_YET_RELEASED until episode 1 airs, but it has a date)
    const airing = md && (md.st === 'RELEASING' || (md.st === 'NOT_YET_RELEASED' && md.na));
    if (!airing || !isShowActive(tr)) continue;
    const eps = trackSched.items.filter(s => s.m === tr.id).sort((a, b) => a.at - b.at);
    const known = md.na ? eps.concat({ at: md.na, ep: md.ne }) : eps;
    // AniList's weekly slot: from the next upcoming episode, else the latest aired one
    const ref = known.find(s => s.at > nowS) || eps[eps.length - 1];
    if (!ref) continue;
    const rd = new Date(ref.at * 1000);
    const custom = tr.day !== null && !!tr.time;
    const day  = custom ? tr.day  : rd.getDay();
    const time = custom ? tr.time : hhmm(rd);
    // The episode nearest the slot's next occurrence (± 3.5 days); none = a break week
    const slotMs = nowMs + trackerMsUntilNext(day, time, new Date(nowMs));
    let best = null, bestDiff = Infinity;
    for (const s of known) {
      const diff = Math.abs(s.at * 1000 - slotMs);
      if (diff <= 3.5 * 86400000 && diff < bestDiff) { best = s; bestDiff = diff; }
    }
    shows.push({
      id: tr.id, title: tr.title, day, time, custom,
      aniDay: rd.getDay(), aniTime: hhmm(rd),
      ep: best ? best.ep : null,
      brk: best ? null : { ep: md.na ? md.ne : null, at: md.na || 0 },
      hl: !!tr.hl,
      url: tr.url,                          // the custom link ('' = default search)
      defLink: animeSearchUrl(tr.title),    // what an empty custom link falls back to
      link: animeLinkFor({ m: tr.id, t: tr.title }),
      al: `https://anilist.co/anime/${tr.id}`,
    });
  }
  // Also share, for the tracker's "All airing" view: highlight/link of shows that
  // aren't tracked, and the blacklist (hidden there too)
  const others = settings.anime.shows.filter(s => !s.track && (s.hl || s.url)).map(s => ({ id: s.id, title: s.title, hl: !!s.hl, url: s.url }));
  const blacklist = [...blocked];
  const body = JSON.stringify([shows, others, blacklist]);
  if (animeWeekLast === null) {   // first run: compare with what's already stored
    try { const c = JSON.parse(localStorage.getItem(ANIME_WEEK_KEY) || 'null'); animeWeekLast = c ? JSON.stringify([c.shows, c.others, c.blacklist]) : ''; } catch { animeWeekLast = ''; }
  }
  if (body === animeWeekLast) return;
  animeWeekLast = body;
  try { localStorage.setItem(ANIME_WEEK_KEY, JSON.stringify({ v: 1, updatedAt: nowMs, shows, others, blacklist })); } catch {}
}
// Apply changes made on the Weekly-Tracker site. The note is { [id]: fields } where
// each field is optional: day + time (day null = AniList time), hl, track, url,
// blacklist (true = hide the season, false = restore), plus the show's title so a
// show first touched on the tracker ("All airing") can be added here.
function applyTrackerTimeEdits() {
  let raw = null, edits = null;
  try { raw = localStorage.getItem(ANIME_TIME_EDITS_KEY); edits = JSON.parse(raw || 'null'); } catch {}
  if (!edits || typeof edits !== 'object') return;
  let changed = false;
  for (const [k, ed] of Object.entries(edits)) {
    const id = Number(k);
    if (!Number.isInteger(id) || id <= 0 || !ed || typeof ed !== 'object') continue;
    const title = typeof ed.title === 'string' ? ed.title.trim().slice(0, 200) : '';
    if (typeof ed.blacklist === 'boolean') {
      const a = settings.anime, on = a.blacklist.some(b => b.id === id);
      if (ed.blacklist && !on) a.blacklist.push({ id, title: title || (animeShow(id) || {}).title || '#' + id, last: animeSeasonLast(id) });
      if (!ed.blacklist && on) a.blacklist = a.blacklist.filter(b => b.id !== id);
      changed = true;
    }
    let s = animeShow(id);
    const touchesShow = 'day' in ed || typeof ed.hl === 'boolean' || typeof ed.track === 'boolean' || typeof ed.url === 'string';
    if (!s && touchesShow && (ed.track === true || ed.hl === true || (typeof ed.url === 'string' && ed.url.trim())))
      s = ensureShow(id, title || '#' + id);   // new show added from the tracker's "All airing" view
    if (!s) continue;
    if ('day' in ed) {
      const day  = Number.isInteger(ed.day) && ed.day >= 0 && ed.day <= 6 ? ed.day : null;
      const time = typeof ed.time === 'string' && TIME_RE.test(ed.time) ? ed.time : '';
      s.day  = day !== null && time ? day : null;
      s.time = s.day === null ? '' : time;
    }
    if (typeof ed.hl === 'boolean')    s.hl = ed.hl;
    if (typeof ed.track === 'boolean') s.track = ed.track;
    if (typeof ed.url === 'string')    s.url = ed.url.trim();
    changed = true;
  }
  // Clear the note — unless the tracker wrote a newer one meanwhile (that one fires
  // its own storage event; re-applying is harmless since every field is absolute)
  try { if (localStorage.getItem(ANIME_TIME_EDITS_KEY) === raw) localStorage.removeItem(ANIME_TIME_EDITS_KEY); } catch {}
  if (changed) { save(); renderAnimeSettings(); animeFiltersChanged(); trackedChanged(); }
}
window.addEventListener('storage', e => { if (e.key === ANIME_TIME_EDITS_KEY && e.newValue) applyTrackerTimeEdits(); });
// Startup: cached schedule → apply pending edits → export → fetch; then refresh every 10 min
function initAnimeSync() {
  if (!trackSched) loadTrackCache();
  applyTrackerTimeEdits();
  exportAnimeWeek();
  fetchTracked();
  setInterval(() => fetchTracked(), 10 * 60 * 1000);   // refetches once the 30-min cache is stale
}
function trackedAnimeToday(now) {
  if (!settings.tracker.anime || !trackSched) return [];
  const pad = n => String(n).padStart(2, '0');
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const out = [];
  const sameDay = (ms, day) => ms >= day && ms < day + 86400000;
  const hhmm = ms => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const blocked = new Set(settings.anime.blacklist.map(b => b.id));
  for (const tr of trackedShows()) {
    if (!isShowActive(tr) || blocked.has(tr.id)) continue;   // archived or blacklisted shows stay out
    const eps = trackSched.items.filter(s => s.m === tr.id);
    const md  = (trackSched.media || {})[tr.id];
    let pick = [], time = '', breakAt = '';
    if (tr.day !== null && tr.time) {
      if (tr.day !== now.getDay()) continue;
      const [h, m] = tr.time.split(':').map(Number);
      const slot = new Date(dayStart); slot.setHours(h, m, 0, 0);
      const best = eps.length ? eps.reduce((b, s) => Math.abs(s.at * 1000 - slot) < Math.abs(b.at * 1000 - slot) ? s : b) : null;
      if (best && Math.abs(best.at * 1000 - slot) <= 3.5 * 86400000) { pick = [best]; time = tr.time; }
      else breakAt = tr.time;   // its day, but no episode near it this week
    } else {
      pick = eps.filter(s => sameDay(s.at * 1000, +dayStart));
      if (!pick.length) {
        // On AniList time the usual slot is inferred: an episode exactly a week ago
        // (or a week ahead) means it normally airs on this weekday
        const wk = 7 * 86400000;
        const prev = eps.find(s => sameDay(s.at * 1000 + wk, +dayStart));
        const next = eps.find(s => sameDay(s.at * 1000 - wk, +dayStart));
        const ref = prev || next;
        if (ref) breakAt = hhmm(ref.at * 1000);
      }
    }
    // Break week: only for a season that's still airing (a finished one just stops)
    if (breakAt && md && md.st === 'RELEASING') {
      const nextTxt = md.na
        ? ' · ' + L().trackerBreakNext.replace('{ep}', md.ne)
            .replace('{date}', new Date(md.na * 1000).toLocaleDateString(settings.lang === 'da' ? 'da-DK' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' }))
        : '';
      out.push({
        id: 'brk' + tr.id, auto: true, brk: true, m: tr.id, day: now.getDay(), time: breakAt,
        name: tr.title, note: L().trackerBreak + nextTxt,
        link: `https://anilist.co/anime/${tr.id}`, al: `https://anilist.co/anime/${tr.id}`,
      });
      continue;
    }
    for (const s of pick) {
      const d = new Date(s.at * 1000);
      out.push({
        id: 'al' + s.id, auto: true, m: tr.id, day: now.getDay(),
        time: time || `${pad(d.getHours())}:${pad(d.getMinutes())}`,
        name: `${tr.title} - Episode ${s.ep}`,
        link: animeLinkFor({ m: tr.id, t: tr.title }),
        al: `https://anilist.co/anime/${tr.id}`,
      });
    }
  }
  return out;
}
// ── "Airing today" in the Weekly Tracker (header toggle) ──
// Every episode still to air today from the Anime Feed's source (All airing or the
// AniList user's list), through its format/country filters and blacklist, minus
// shows already tracked. Shown dimmed, mixed in by time, with a + to track.
const ANIME_UPCOMING_FIELDS = 'pageInfo{hasNextPage} airingSchedules(airingAt_greater:$from,airingAt_lesser:$to,%IDS%sort:TIME){id episode airingAt media{id format countryOfOrigin title{english romaji}}}';
const ANIME_UPCOMING_ALL  = 'query($p:Int,$from:Int,$to:Int){Page(page:$p,perPage:50){' + ANIME_UPCOMING_FIELDS.replace('%IDS%', '') + '}}';
const ANIME_UPCOMING_USER = 'query($p:Int,$from:Int,$to:Int,$ids:[Int]){Page(page:$p,perPage:50){' + ANIME_UPCOMING_FIELDS.replace('%IDS%', 'mediaId_in:$ids,') + '}}';
let animeUserIds = null;   // { user, ids, at } — the AniList user's list ids, shared with the feed fetch
let upSched = null;        // { key, fetchedAt, items } — the same item shape as the feed's
let upBusy = false, upTriedAt = 0;
function upcomingKey() {
  const d = new Date();
  return animeSig() + '|' + d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();   // source + local day
}
async function fetchUpcoming() {
  const tk = settings.tracker, a = settings.anime;
  if (!tk.enabled || !tk.upcoming || upBusy) return;
  if (a.source === 'user' && !a.user) { upSched = { key: upcomingKey(), fetchedAt: Date.now(), items: [] }; return; }
  const key = upcomingKey();
  if (upSched && upSched.key === key && Date.now() - upSched.fetchedAt < TRACK_REFRESH_MS) return;
  if (Date.now() - upTriedAt < 60000) return;   // don't hammer AniList after a failure
  upBusy = true; upTriedAt = Date.now();
  try {
    let ids = null;
    if (a.source === 'user') {
      const u = a.user.toLowerCase();
      if (animeUserIds && animeUserIds.user === u && Date.now() - animeUserIds.at < 60 * 60 * 1000) ids = animeUserIds.ids;
      else {
        const d = await anilist(ANIME_LIST_Q, { u: a.user });
        const lists = (d.MediaListCollection && d.MediaListCollection.lists) || [];
        ids = [...new Set(lists.flatMap(l => (l.entries || []).map(e => e.mediaId)).filter(Number.isInteger))];
        animeUserIds = { user: u, ids, at: Date.now() };
      }
    }
    const end = new Date(); end.setHours(24, 0, 0, 0);
    const from = Math.floor(Date.now() / 1000), to = Math.floor(end / 1000);
    const items = [];
    if (!ids || ids.length) {
      for (let p = 1; p <= 6; p++) {
        const d = await anilist(ids ? ANIME_UPCOMING_USER : ANIME_UPCOMING_ALL, ids ? { p, from, to, ids } : { p, from, to });
        const pg = d.Page || {};
        items.push(...(pg.airingSchedules || []).map(toAnimeItem).filter(Boolean));
        if (!(pg.pageInfo && pg.pageInfo.hasNextPage)) break;
      }
    }
    if (upcomingKey() !== key) return;   // source or day changed mid-flight; the next tick refetches
    upSched = { key, fetchedAt: Date.now(), items };
  } catch {}   // offline / rate-limited: keep what we had
  finally {
    upBusy = false;
    if (settings.tracker.enabled) renderTracker();
  }
}
function upcomingAnimeToday(now) {
  if (!settings.tracker.upcoming) return [];
  if (!upSched || upSched.key !== upcomingKey()) { fetchUpcoming(); return []; }   // stale source/day
  const pad = n => String(n).padStart(2, '0');
  // Tracked shows appear as tracked entries instead — but only once their schedule
  // has loaded, so a show just tracked with "+" doesn't blink out in between
  const trackedReady = !settings.tracker.anime || (trackSched && trackSched.key === trackKey());
  const tracked = new Set(trackedReady ? trackedShows().map(s => s.id) : []);
  return animeVisible(upSched.items)
    .filter(it => it.at * 1000 > now && !tracked.has(it.m))
    .map(it => {
      const d = new Date(it.at * 1000);
      return {
        id: 'up' + it.id, upcoming: true, m: it.m, title: it.t, day: now.getDay(),
        time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
        name: `${it.t} - Episode ${it.ep}`,
        al: it.u,
      };
    });
}
// ── Custom day/time for a tracked season (both needed; day null = AniList time) ──
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
// AniList's weekly slot for a tracked season: the local weekday + time of its next
// upcoming episode, else of the latest aired one (null = schedule not known yet)
function aniListSlot(id) {
  if (!trackSched) return null;
  const nowS = Math.floor(Date.now() / 1000), md = (trackSched.media || {})[id];
  const eps = trackSched.items.filter(s => s.m === id).sort((a, b) => a.at - b.at);
  const known = md && md.na ? eps.concat({ at: md.na, ep: md.ne }) : eps;
  const ref = known.find(s => s.at > nowS) || eps[eps.length - 1];
  if (!ref) return null;
  const d = new Date(ref.at * 1000);
  return { day: d.getDay(), time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` };
}
// AniList's local time of day for a season, used to prefill when a day is picked
function trackAniListTime(id) {
  const s = aniListSlot(id);
  return s ? s.time : '12:00';
}
function setTrackSlot(id, day, time) {
  const tr = animeShow(id); if (!tr) return;
  tr.day  = day;
  tr.time = day === null ? '' : (TIME_RE.test(time) ? time : (tr.time || trackAniListTime(id)));
  save(); renderAnimeSeasonList('shows'); trackedChanged();
}
// "Edit time…" dialog (right-click on a tracked season in either widget, or the
// Air time button in the Anime Manager)
let trackTimeId = null;
function animeCtxTime() {
  const it = animeCtxItem; closeAnimeCtx();
  if (it) openTrackTime(it.m);
}
function openTrackTime(id) {
  const tr = animeShow(id); if (!tr) return;
  const t = L();
  trackTimeId = tr.id;
  $.trackTimeTitle.textContent = tr.title;
  $.trackTimeDay.innerHTML = [`<option value="">${esc(t.animeDayAuto)}</option>`]
    .concat([1, 2, 3, 4, 5, 6, 0].map(d => `<option value="${d}">${esc(t.days[d])}</option>`)).join('');
  $.trackTimeDay.value = tr.day === null ? '' : String(tr.day);
  $.trackTimeTime.value = tr.time;
  syncTrackTimeInput();
  $.trackTimeModal.classList.add('open');
  setTimeout(() => $.trackTimeDay.focus(), 30);
}
// Time is only editable with a day picked; picking one prefills AniList's time
function syncTrackTimeInput() {
  const auto = $.trackTimeDay.value === '';
  $.trackTimeTime.disabled = auto;
  if (auto) $.trackTimeTime.value = '';
  else if (!$.trackTimeTime.value) $.trackTimeTime.value = trackAniListTime(trackTimeId);
}
function closeTrackTimeModal() { $.trackTimeModal.classList.remove('open'); trackTimeId = null; }
function saveTrackTime() {
  if (trackTimeId === null) return;
  const v = $.trackTimeDay.value;
  setTrackSlot(trackTimeId, v === '' ? null : Number(v), $.trackTimeTime.value);
  closeTrackTimeModal();
}
$.trackTimeDay.addEventListener('change', syncTrackTimeInput);
$.trackTimeTime.addEventListener('keydown', e => { if (e.key === 'Enter') saveTrackTime(); });
