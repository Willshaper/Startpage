// Startpage: Weekly Tracker widget (reads the Weekly-Tracker site data).
// Classic script sharing globals with the others; load order is set in index.html.

// ── Weekly-Tracker widget ──────────────────────────────────────────────────────
// Reads the Weekly-Tracker's data straight from this origin's localStorage. Both
// sites are served from willshaper.github.io, so they share one store. Read-only:
// the widget never writes TRACKER_KEY, so it can't corrupt the tracker.
let trackerTimer = null, trackFetchTimer = null;
function readTrackerEntries() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(TRACKER_KEY) || 'null'); } catch { return null; }
  if (!data || !Array.isArray(data.entries)) return null;
  return data.entries.map(e => {
    if (!e || typeof e.id !== 'number' || typeof e.day !== 'number') return null;
    return {
      id:    e.id,
      day:   e.day,
      time:  typeof e.time  === 'string' ? e.time  : '00:00',
      name:  typeof e.name  === 'string' ? e.name  : '',
      notes: typeof e.notes === 'string' ? e.notes : '',
      link:  typeof e.link  === 'string' ? e.link  : '',
      color: (e.color && TRACKER_COLORS[e.color]) ? e.color : null,
    };
  }).filter(Boolean);
}
// ms until the next weekly occurrence of (day 0=Sun..6=Sat, "HH:MM") in local time
function trackerMsUntilNext(day, timeStr, now) {
  const [h, m] = timeStr.split(':').map(Number);
  let ahead = (day - now.getDay() + 7) % 7;
  if (ahead === 0 && (now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m))) ahead = 7;
  const t = new Date(now);
  t.setDate(t.getDate() + ahead);
  t.setHours(h || 0, m || 0, 0, 0);
  return t - now;
}
function trackerCountdown(ms) {
  const mins = Math.floor(ms / 60000), hrs = Math.floor(mins / 60), days = Math.floor(hrs / 24);
  if (days === 0 && hrs === 0) return (mins % 60) + 'm';
  if (days === 0) return hrs + 'h ' + (mins % 60) + 'm';
  return days + 'd ' + (hrs % 24) + 'h';
}
function trackerCdClass(ms) {
  const h = ms / 3600000;
  return h < 6 ? 'wt-cd-near' : h < 48 ? 'wt-cd-mid' : 'wt-cd-far';
}
const TRACKER_LINK_SVG = '<svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M4.5 2H2a1 1 0 00-1 1v6a1 1 0 001 1h6a1 1 0 001-1V6.5M6.5 1H10m0 0v3.5M10 1L5 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const TRACKER_TODAY_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 3l4 4 4-4"/></svg>';
// Header button: toggle listing today's not-yet-aired anime
$.trackerHeader.addEventListener('click', e => {
  if (!e.target.closest('.tracker-today-btn')) return;
  settings.tracker.upcoming = !settings.tracker.upcoming;
  save();
  if (settings.tracker.upcoming) fetchUpcoming();
  renderTracker();
});
// "+" on an airing-today card: track that show
$.trackerBody.addEventListener('click', e => {
  const b = e.target.closest('.wt-add'); if (!b) return;
  const card = b.closest('.wt-up');
  const s = ensureShow(Number(b.dataset.add), card ? card.dataset.t : '');
  if (!s.track) toggleShowFlag(s.id, 'track');
});
function trackerState(key) {
  $.trackerBody.innerHTML = `<div class="tracker-state">${esc(L()[key] || '')}</div>`;
  scheduleLayout();
}
function renderTracker() {
  if (!settings.tracker.enabled) return;
  const t = L();
  const now   = new Date();
  const today = now.getDay();
  // Header doubles as a link to the standalone tracker; the button on the right
  // toggles listing today's not-yet-aired anime
  const upOn = settings.tracker.upcoming;
  $.trackerHeader.innerHTML =
    `<a class="tracker-head-link" href="${TRACKER_URL}" target="_blank" rel="noopener noreferrer">${esc(t.weeklyTracker + ' - ' + t.days[today])}</a>` +
    `<button type="button" class="tracker-today-btn${upOn ? ' on' : ''}" title="${esc(t.trackerUpcomingBtn)}" aria-pressed="${upOn}">${TRACKER_TODAY_SVG}</button>`;
  const entries  = readTrackerEntries() || [];
  const auto     = trackedAnimeToday(now);    // tracked Anime Feed seasons airing today
  const upcoming = upcomingAnimeToday(now);   // other shows still to air today (header toggle)
  if (!entries.length && !auto.length && !upcoming.length) { trackerState('trackerEmpty'); return; }
  // Only today's entries, ordered by time of day (like the tracker's day column)
  const rows = entries.filter(e => e.day === today).concat(auto, upcoming)
    .map(e => ({ e, ms: trackerMsUntilNext(e.day, e.time, now) }))
    .sort((a, b) => a.e.time.localeCompare(b.e.time));
  if (!rows.length) { trackerState('trackerNoneToday'); return; }
  const target = settings.newTab ? ' target="_blank" rel="noopener"' : '';
  // Next-up = the earliest of your entries today that hasn't started yet (the
  // untracked "airing today" shows never take the badge). If every event today has
  // already passed, badge nothing (msUntilNext would point a week ahead, which
  // isn't the actual next thing).
  let nextId = null;
  for (const r of rows) {
    if (r.e.upcoming || r.e.brk) continue;
    const [h, m] = r.e.time.split(':').map(Number);
    const passed = now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);
    if (!passed) { nextId = r.e.id; break; }
  }
  // Preserve the scroll position across the 60s (and refocus/storage) re-renders,
  // which rebuild the list to refresh the "5h 33m" figures and would otherwise
  // snap the body back to the top.
  const savedScroll = $.trackerBody.scrollTop;
  $.trackerBody.innerHTML = rows.map(r => {
    const e = r.e;
    const isNext = e.id === nextId ? ' wt-next' : '';
    if (e.upcoming) {
      // Not aired yet, so no discussion thread: the card opens the AniList entry
      return `<div class="wt-entry wt-up" data-m="${e.m}" data-t="${esc(e.title)}">` +
        `<a class="wt-cover" href="${esc(e.al)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(e.name)}"></a>` +
        `<div class="wt-name">${esc(e.name)}</div>` +
        `<div class="wt-meta">` +
          `<span class="wt-time">${esc(e.time)}</span>` +
          `<div class="wt-meta-right">` +
            `<span class="wt-cd ${trackerCdClass(r.ms)}">${esc(trackerCountdown(r.ms))}</span>` +
            `<button type="button" class="wt-add" title="${esc(t.trackerTrackShow)}" data-add="${e.m}">+</button>` +
          `</div>` +
        `</div>` +
      `</div>`;
    }
    if (e.brk) {
      // A tracked season on a break this week: dimmed note, no countdown
      return `<div class="wt-entry wt-auto wt-break" data-m="${e.m}">` +
        `<a class="wt-cover" href="${esc(e.al)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(e.name)}"></a>` +
        `<div class="wt-name">${esc(e.name)}</div>` +
        `<div class="wt-notes">${esc(e.note)}</div>` +
        `<div class="wt-meta">` +
          `<span class="wt-meta-left"><span class="wt-time">${esc(e.time)}</span><span class="wt-al-tag">AniList</span></span>` +
          `<div class="wt-meta-right">` +
            `<a class="wt-link" href="${esc(e.al)}" target="_blank" rel="noopener noreferrer" title="${esc(t.animeOpenAniList)}">${TRACKER_LINK_SVG}</a>` +
          `</div>` +
        `</div>` +
      `</div>`;
    }
    if (e.auto) {
      return `<div class="wt-entry wt-auto${isNext}" data-m="${e.m}">` +
        `<a class="wt-cover" href="${esc(e.link)}"${target} aria-label="${esc(e.name)}"></a>` +
        `<div class="wt-name">${esc(e.name)}</div>` +
        `<div class="wt-meta">` +
          `<span class="wt-meta-left"><span class="wt-time">${esc(e.time)}</span><span class="wt-al-tag">AniList</span></span>` +
          `<div class="wt-meta-right">` +
            `<span class="wt-cd ${trackerCdClass(r.ms)}">${esc(trackerCountdown(r.ms))}</span>` +
            `<a class="wt-link" href="${esc(e.al)}" target="_blank" rel="noopener noreferrer" title="${esc(t.animeOpenAniList)}">${TRACKER_LINK_SVG}</a>` +
          `</div>` +
        `</div>` +
      `</div>`;
    }
    const colorHex   = e.color ? TRACKER_COLORS[e.color] : null;
    const colorAttrs = colorHex ? ` data-ec="${e.color}" style="--ec:${colorHex}"` : '';
    const link   = safeHttpLink(e.link);
    const linkBtn = link
      ? `<a class="wt-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer" title="${esc(link)}">${TRACKER_LINK_SVG}</a>`
      : '';
    return `<div class="wt-entry${isNext}"${colorAttrs}>` +
      `<div class="wt-name">${esc(e.name)}</div>` +
      (e.notes ? `<div class="wt-notes">${esc(e.notes)}</div>` : '') +
      `<div class="wt-meta">` +
        `<span class="wt-time">${esc(e.time)}</span>` +
        `<div class="wt-meta-right">` +
          `<span class="wt-cd ${trackerCdClass(r.ms)}">${esc(trackerCountdown(r.ms))}</span>` +
          linkBtn +
        `</div>` +
      `</div>` +
    `</div>`;
  }).join('');
  $.trackerBody.scrollTop = savedScroll;
  scheduleLayout();
}
function applyTracker() {
  const tk = settings.tracker;
  ALL_POSITIONS.forEach(p => $.trackerPanel.classList.remove('pos-' + p));
  $.trackerPanel.classList.add('pos-' + (ALL_POSITIONS.includes(tk.position) ? tk.position : 'tl'));
  $.trackerPanel.classList.toggle('show', tk.enabled);
  if (trackerTimer) { clearInterval(trackerTimer); trackerTimer = null; }
  if (trackFetchTimer) { clearInterval(trackFetchTimer); trackFetchTimer = null; }
  if (tk.enabled) {
    if (!trackSched) loadTrackCache();
    renderTracker();
    trackerTimer = setInterval(renderTracker, 60000);  // keep the "in Xd Yh" figures current
    if (tk.upcoming) fetchUpcoming();
    // Refetches only once its 30-min cache goes stale (or the source/day changed).
    // Tracked shows have their own always-on refresh (initAnimeSync), since they
    // also feed the Weekly-Tracker site even with this widget off.
    trackFetchTimer = setInterval(fetchUpcoming, 10 * 60 * 1000);
  }
  scheduleLayout();
}
// The Weekly-Tracker tab writes localStorage; that fires a 'storage' event in this
// tab, so the widget refreshes live. Also re-read when this tab regains focus.
window.addEventListener('storage', e => {
  if (e.key === TRACKER_KEY && settings.tracker.enabled) renderTracker();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && settings.tracker.enabled) renderTracker();
});
