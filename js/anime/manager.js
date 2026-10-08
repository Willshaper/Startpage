// Startpage: Anime Manager window: Airing / Archived / Blacklist / Feed settings.
// Classic script sharing globals with the others; load order is set in index.html.

// ── Anime Manager: its own big window with Airing / Archived / Blacklist / Feed settings ──
// Shows that aired within the last ANIME_ACTIVE_DAYS are under Airing; the rest move
// to Archived on their own, so years of seasons never become one long list.
const ANIME_ACTIVE_DAYS = 8;   // just over a week with no new episode
// "Airing" vs "Archived": an episode seen in the last ANIME_ACTIVE_DAYS, or (for a
// tracked show, whose schedule we know) its next episode due within a week — so a
// show returning from a long break counts as airing again before it airs.
function isShowActive(s) {
  const nowS = Math.floor(Date.now() / 1000);
  if (s.last >= nowS - ANIME_ACTIVE_DAYS * 86400) return true;
  const md = trackSched && trackSched.media && trackSched.media[s.id];
  return !!(md && md.na && md.na - nowS <= 7 * 86400);
}
let animeSub = 'airing';          // the manager's open tab: airing | archived | blacklist | feed
let animeShowsView = 'airing';    // which shows the shared Airing/Archived table lists
const animeSearch = { shows: '', blacklist: '' };
// Shows-table filter chips: which shows each one keeps
let animeFilterSel = 'all';
const ANIME_SHOW_FILTERS = {
  all:   () => true,
  track: s => s.track,
  hl:    s => s.hl,
  link:  s => !!s.url,
  time:  s => s.track && s.day !== null,   // a kept slot on an untracked show isn't in use
};
// Opened from the Settings sidebar; always starts on Airing
function openAnimeManager() {
  closeSettings();
  $.setAnimeUser.value = settings.anime.user;
  $.setAnimeHighlight.value = settings.anime.highlight;
  $.animeShowAddMsg.textContent = '';
  animeSub = 'airing';
  renderAnimeSettings();
  syncWidgetPositions();
  $.animeManager.classList.add('open');
}
function isAnimeManagerOpen() { return $.animeManager.classList.contains('open'); }
// Closing goes back to Settings. A field still being edited is committed first
// (blurring it fires its change event).
function closeAnimeManager() {
  if (!isAnimeManagerOpen()) return;
  const f = document.activeElement;
  if (f && $.animeManager.contains(f)) f.blur();
  closeAnimeCtx(); closeAnimeBlCtx();
  $.animeManager.classList.remove('open');
  openSettings();
}
// Airing and Archived share one panel (same table, toolbar and filters); adding
// shows only makes sense under Airing
function setAnimeSub(sub) {
  animeSub = sub;
  segSetActive($.animeSubnav, 'sub', sub);
  $.animeManager.querySelectorAll('.anime-sub').forEach(p => p.classList.toggle('active', p.dataset.sub.split(' ').includes(sub)));
  if ((sub === 'airing' || sub === 'archived') && sub !== animeShowsView) {
    animeShowsView = sub;
    $.animeAddBar.style.display = sub === 'airing' ? '' : 'none';
    $.animeShowAddMsg.textContent = '';
    renderAnimeSeasonList('shows');
  }
}
$.animeSubnav.addEventListener('click', e => {
  const b = e.target.closest('button[data-sub]');
  if (b) setAnimeSub(b.dataset.sub);
});
$.animeManager.querySelectorAll('.anime-search').forEach(inp => {
  inp.addEventListener('input', () => { animeSearch[inp.dataset.list] = inp.value; renderAnimeSeasonList(inp.dataset.list); });
});
$.animeShowFilter.addEventListener('click', e => {
  const b = e.target.closest('.chip[data-f]'); if (!b) return;
  animeFilterSel = b.dataset.f;
  renderAnimeSeasonList('shows');
});
// A link being typed into a table row shouldn't be wiped by a background re-render
const animeTyping = el => { const f = document.activeElement; return !!(f && f.tagName === 'INPUT' && el.contains(f)); };
function renderAnimeSettings() {
  const a = settings.anime, t = L();
  setAnimeSub(animeSub);
  segSetActive($.setAnimeSource, 'src', a.source);
  $.animeUserRow.style.display = a.source === 'user' ? '' : 'none';
  $.animeWidgetOff.textContent = a.enabled ? '' : t.animeWidgetOff;
  $.setAnimeFormats.innerHTML = ANIME_FORMATS.map(f =>
    `<button type="button" class="chip${a.formats.includes(f) ? ' on' : ''}" data-fmt="${f}">${esc(t.animeFmt[f])}</button>`).join('');
  $.setAnimeCountries.innerHTML = ANIME_COUNTRIES.map(c =>
    `<button type="button" class="chip${a.countries.includes(c) ? ' on' : ''}" data-cc="${c}">${esc(t.animeCountry[c])}</button>`).join('');
  ['shows', 'blacklist'].forEach(k => { if (!animeTyping(ANIME_LISTS[k].el())) renderAnimeSeasonList(k); });
}
// Refresh the shows table if the manager is open (e.g. a schedule arrived, so air
// times are known and shows may have moved between Airing and Archived)
function refreshAnimeManagerShows() {
  if (isAnimeManagerOpen() && !animeTyping($.animeShowList)) renderAnimeSeasonList('shows');
}
const ANIME_LISTS = {
  shows:     { key: 'shows',     el: () => $.animeShowList },
  blacklist: { key: 'blacklist', el: () => $.animeBlList },
};
// Filter chips with counts for the shows in the current view (Airing or Archived)
function renderAnimeShowFilter(pool) {
  const t = L();
  const names = { all: t.amFilterAll, track: t.animeChipTracked, hl: t.animeChipHl, link: t.amFilterLink, time: t.amFilterTime };
  $.animeShowFilter.innerHTML = Object.keys(ANIME_SHOW_FILTERS).map(f =>
    `<button type="button" class="chip${animeFilterSel === f ? ' on' : ''}" data-f="${f}">${esc(names[f])}<span class="chip-count">${pool.filter(ANIME_SHOW_FILTERS[f]).length}</span></button>`).join('');
}
// The shows under the current view: not blacklisted, and airing or archived ("Archived" =
// no episode in the last ANIME_ACTIVE_DAYS and none due within a week — see isShowActive)
function animeShowsPool() {
  const blocked = new Set(settings.anime.blacklist.map(b => b.id));
  const archived = animeShowsView === 'archived';
  return settings.anime.shows.filter(s => !blocked.has(s.id) && isShowActive(s) !== archived);
}
// Air-time button (tracked shows only): a custom slot in the accent colour, else
// AniList's slot tagged "AniList". Opens the day + time dialog.
function animeTimeCell(e) {
  const t = L();
  if (!e.track) return `<span class="am-dim">—</span>`;
  const custom = e.day !== null && !!e.time;
  const slot = custom ? { day: e.day, time: e.time } : aniListSlot(e.id);
  const label = slot ? `${esc(t.days[slot.day].slice(0, 3))} ${esc(slot.time)}` : esc(t.animeDayAuto);
  return `<button type="button" class="am-time${custom ? ' custom' : ''}" title="${esc(t.animeEditTime)}" onclick="openTrackTime(${e.id})">` +
    label + (custom || !slot ? '' : '<small>AniList</small>') + `</button>`;
}
function renderAnimeSeasonList(kind) {
  const a = settings.anime, t = L(), isShows = kind === 'shows';
  const el = ANIME_LISTS[kind].el();
  const q = animeSearch[kind].trim().toLowerCase();
  const pool = isShows ? animeShowsPool() : a.blacklist;
  if (isShows) renderAnimeShowFilter(pool);
  const keep = isShows ? ANIME_SHOW_FILTERS[animeFilterSel] : () => true;
  const match = pool.filter(e => keep(e) && (!q || e.title.toLowerCase().includes(q)))
    .sort((x, y) => x.title.localeCompare(y.title, undefined, { sensitivity: 'base' }));
  // Title: opens the show's link (custom, else the Reddit search), like a feed row;
  // the small button next to it opens the AniList page
  const title = e => `<div class="am-title">` +
    `<a class="am-name" href="${esc(animeLinkFor({ m: e.id, t: e.title }))}" target="_blank" rel="noopener noreferrer" title="${esc(e.title)}">${esc(e.title || '#' + e.id)}</a>` +
    `<a class="anime-al" href="https://anilist.co/anime/${e.id}" target="_blank" rel="noopener noreferrer" title="${esc(t.animeOpenAniList)}">${TRACKER_LINK_SVG}</a></div>`;
  const toggle = (e, flag, label) => `<div class="am-cell" data-label="${esc(label)}">` +
    `<button type="button" class="toggle${e[flag] ? ' on' : ''}" title="${esc(label)}" aria-pressed="${!!e[flag]}" onclick="toggleShowFlag(${e.id}, '${flag}')"></button></div>`;
  // Shows: title · Track · Highlight · Air time · Link · ✕ — Blacklist: title · Restore
  const row = e => isShows
    ? `<div class="am-row" data-id="${e.id}">` + title(e) +
        toggle(e, 'track', t.amColTrack) + toggle(e, 'hl', t.amColHl) +
        `<div class="am-cell">${animeTimeCell(e)}</div>` +
        `<div class="am-cell"><input class="feed-filter-input" type="text" value="${esc(e.url)}" placeholder="${esc(t.animeLinkPh)}" spellcheck="false" onchange="updateAnimeLinkUrl(${e.id}, this.value)"></div>` +
        `<button type="button" class="am-x" title="${esc(t.animeRemoveShow)}" onclick="removeAnimeSeason('shows', ${e.id})">✕</button>` +
      `</div>`
    : `<div class="am-row" data-id="${e.id}">` + title(e) +
        `<button type="button" class="btn btn-ghost" onclick="removeAnimeSeason('blacklist', ${e.id})">${esc(t.animeRestore)}</button>` +
      `</div>`;
  const head = isShows
    ? `<div class="am-row am-hd"><span>${esc(t.amColShow)}</span><span>${esc(t.amColTrack)}</span><span>${esc(t.amColHl)}</span>` +
      `<span>${esc(t.amColTime)}</span><span>${esc(t.amColLink)}</span><span></span></div>`
    : '';
  const emptyMsg = pool.length ? t.animeNoMatch
    : !isShows ? t.animeNoneYet : animeShowsView === 'archived' ? t.animeArchivedEmpty : t.animeShowsEmpty;
  el.innerHTML = match.length ? head + match.map(row).join('') : `<div class="am-empty">${esc(emptyMsg)}</div>`;
}
// Right-click a show under Airing / Archived: the feed's menu (link, highlight, track,
// time, blacklist). The link field keeps the browser's own menu, for pasting.
$.animeShowList.addEventListener('contextmenu', e => {
  const row = e.target.closest('.am-row[data-id]');
  if (!row || e.target.closest('input')) return;
  const s = animeShow(Number(row.dataset.id)); if (!s) return;
  openAnimeCtx(e, { m: s.id, t: s.title });
});
// Right-click a blacklisted season: open it on AniList, or restore it
let animeBlCtxId = null;
$.animeBlList.addEventListener('contextmenu', e => {
  const row = e.target.closest('.am-row[data-id]'); if (!row) return;
  e.preventDefault();
  closeCtx(); closeAnimeCtx();
  animeBlCtxId = Number(row.dataset.id);
  placeMenu($.animeBlCtx, e);
});
function closeAnimeBlCtx() { $.animeBlCtx.classList.remove('open'); animeBlCtxId = null; }
function animeBlCtxOpen() {
  const id = animeBlCtxId; closeAnimeBlCtx();
  if (id !== null) window.open(`https://anilist.co/anime/${id}`, '_blank', 'noopener');
}
function animeBlCtxRestore() {
  const id = animeBlCtxId; closeAnimeBlCtx();
  if (id !== null) removeAnimeSeason('blacklist', id);
}
// A show's custom link, edited in the Shows table (empty = back to the Reddit search)
function updateAnimeLinkUrl(id, value) {
  const s = animeShow(id); if (!s) return;
  s.url = value.trim();
  save(); renderAnime();
  // Only the counts and this row's name link change: re-rendering the table would
  // steal focus from whatever field was clicked next
  renderAnimeShowFilter(animeShowsPool());
  const name = $.animeShowList.querySelector(`.am-row[data-id="${id}"] .am-name`);
  if (name) name.href = animeLinkFor({ m: id, t: s.title });
  trackedChanged();
}
// Remove a show (all its settings, after asking) or restore a blacklisted season
function removeAnimeSeason(kind, id) {
  const a = settings.anime, key = ANIME_LISTS[kind].key;
  const e = a[key].find(x => x.id === id); if (!e) return;
  if (kind === 'shows' && !confirm(L().animeRemoveConfirm.replace('{t}', e.title || '#' + id))) return;
  a[key] = a[key].filter(x => x.id !== id);
  save(); renderAnimeSettings(); renderAnime();   // both tables: a restored season reappears under Airing/Archived
  if (kind === 'shows') trackedChanged();
  else animeFiltersChanged();   // restoring a blacklisted season shows it again everywhere
}
