// Startpage: Widget slots (no two in one corner) and same-side vertical layout.
// Classic script sharing globals with the others; load order is set in index.html.

// ── Widget position constraint ────────────────────────────────────────────────
// There are 6 fixed slots (3 per side) and up to 6 widgets. No two enabled
// widgets may share a slot. When one is moved/enabled (`touched`), it keeps its
// chosen slot and any colliding widgets are bumped to the first free slot.
// Corner-picker grid order: 2 columns (left, right) × 3 rows (top, middle, bottom)
const POS_GRID_ORDER = ['tl', 'tr', 'ml', 'mr', 'bl', 'br'];
function resolveWidgetPositions(touched) {
  const used = new Set();
  const order = touched ? [touched, ...WIDGET_KEYS.filter(k => k !== touched)] : WIDGET_KEYS;
  for (const k of order) {
    const w = settings[k];
    if (!w || !w.enabled) continue;
    let pos = ALL_POSITIONS.includes(w.position) ? w.position : ALL_POSITIONS[0];
    if (used.has(pos)) pos = ALL_POSITIONS.find(p => !used.has(p)) || pos;
    w.position = pos;
    used.add(pos);
  }
}
// Fill each widget's position grid with its six corner cells (built once at init)
function buildPosGrids() {
  document.querySelectorAll('.pos-grid').forEach(grid => {
    grid.innerHTML = POS_GRID_ORDER
      .map(p => `<button type="button" class="pos-cell" data-pos="${p}"></button>`).join('');
  });
}
// Reflect each widget's position (incl. any collision auto-move) in its grid + label
function syncWidgetPositions() {
  for (const key of WIDGET_KEYS) {
    const grid = document.querySelector(`.pos-grid[data-widget="${key}"]`);
    if (!grid) continue;
    const pos = settings[key].position;
    grid.querySelectorAll('.pos-cell').forEach(c => {
      c.classList.toggle('active', c.dataset.pos === pos);
      c.title = L()['pos' + c.dataset.pos.toUpperCase()] || '';
    });
    const nm = document.getElementById(key + '-pos-name');
    if (nm) nm.textContent = L()['pos' + pos.toUpperCase()] || '';
  }
}

// ── Widget vertical layout ─────────────────────────────────────────────────────
// resolveWidgetPositions keeps widgets in distinct slots, but two on the same
// SIDE (e.g. top-right + bottom-right) can still overlap when their content is
// tall. This stacks same-side widgets top-down and caps each one's height so the
// column fits the viewport — tall content (like a 50-item feed) then scrolls
// internally instead of covering its neighbour.
const WIDGET_PANEL_REF = { rss: 'rssPanel', note: 'notePanel', weather: 'weatherPanel', countdown: 'countdownPanel', tracker: 'trackerPanel', anime: 'animePanel' };
const WIDGET_SLOT_ORDER = { tl: 0, ml: 1, bl: 2, tr: 0, mr: 1, br: 2 };
let layoutRaf = null;
function scheduleLayout() {           // coalesce bursts of calls into one reflow
  if (layoutRaf) return;
  layoutRaf = requestAnimationFrame(() => { layoutRaf = null; layoutWidgets(); });
}
// The scrollable region inside each widget (so measurement can let it expand)
function widgetScrollChild(key) {
  if (key === 'rss')       return $.rssList;
  if (key === 'anime')     return $.animeList;
  if (key === 'note')      return settings.note.checklist ? $.noteList : $.noteText;
  if (key === 'countdown') return $.countdownBody;
  if (key === 'tracker')   return $.trackerBody;
  return null;             // weather is fixed-height, no scroll region
}
// Uncapped content height of a widget. Its scroll child is flex:1 and would
// collapse to 0 while the panel is unbounded, so expand it during the measure.
// Save/restore the child's scrollTop — expanding it removes the overflow, which
// would otherwise reset a scrolled list (e.g. the feed) back to the top.
function measureNatural(el, child) {
  // Read scrollTop BEFORE unbounding the panel — once max-height is 'none' the
  // child stops overflowing and its scrollTop is already 0.
  let cf, cm, st;
  if (child) { cf = child.style.flex; cm = child.style.maxHeight; st = child.scrollTop; }
  const pm = el.style.maxHeight; el.style.maxHeight = 'none';
  if (child) { child.style.flex = '0 0 auto'; child.style.maxHeight = 'none'; }
  const h = el.offsetHeight;
  el.style.maxHeight = pm;
  if (child) { child.style.flex = cf; child.style.maxHeight = cm; child.scrollTop = st; }
  return h;
}
const WIDGET_EDGE = 16;          // inset from the viewport edges (matches the pos-* CSS)
const TRACKER_OTHERS_MIN = 180;  // min height each non-tracker widget keeps when the tracker has priority
// Water-fill: short widgets keep their natural height, the rest share what's left
// (floored at 80). Caps the total so the anchored placement can't overlap.
function waterFill(items, avail) {
  items.forEach(it => it.h = 0);
  let remaining = avail, flexible = items.length, changed = true;
  while (changed && flexible > 0) {
    changed = false;
    const share = remaining / flexible;
    for (const it of items) {
      if (!it.h && it.nat <= share) { it.h = it.nat; remaining -= it.nat; flexible--; changed = true; }
    }
  }
  if (flexible > 0) {
    const share = Math.max(80, Math.floor(remaining / flexible));
    for (const it of items) if (!it.h) it.h = share;
  }
}
function layoutWidgets() {
  const allPanels = WIDGET_KEYS.map(k => $[WIDGET_PANEL_REF[k]]).filter(Boolean);
  const clear = el => { el.style.top = ''; el.style.bottom = ''; el.style.transform = ''; el.style.maxHeight = ''; };
  // Below the responsive breakpoint the widgets are hidden — drop any overrides.
  if (window.innerWidth <= 1280) { allPanels.forEach(clear); if ($.topControls) $.topControls.style.right = ''; return; }

  const groups = { l: [], r: [] };
  for (const k of WIDGET_KEYS) {
    const w = settings[k], el = $[WIDGET_PANEL_REF[k]];
    if (!w || !w.enabled || !el || !el.classList.contains('show')) continue;
    const side = ['tl', 'ml', 'bl'].includes(w.position) ? 'l' : 'r';
    groups[side].push({ el, key: k, order: WIDGET_SLOT_ORDER[w.position] ?? 1 });
  }
  // Shift the settings gear left of a top-right widget so that widget can hug the corner.
  const hasTR = groups.r.some(w => settings[w.key].position === 'tr');
  if ($.topControls) $.topControls.style.right = hasTR ? (WIDGET_EDGE + 290 + 12) + 'px' : '';

  const topPad = WIDGET_EDGE, botPad = WIDGET_EDGE, gap = 14;
  for (const side of ['l', 'r']) {
    const list = groups[side].sort((a, b) => a.order - b.order);
    list.forEach(({ el }) => clear(el));       // reset before measuring / re-placing
    if (list.length < 2) continue;             // a lone widget keeps its CSS anchor + 70vh cap

    const avail = window.innerHeight - topPad - botPad - gap * (list.length - 1);
    // Natural (uncapped) height of each widget
    const items = list.map(({ el, key, order }) => ({ el, key, order, nat: measureNatural(el, widgetScrollChild(key)), h: 0 }));
    // The Weekly Tracker has priority: it expands to its full natural height first,
    // and the others share the rest, each floored at TRACKER_OTHERS_MIN so they still
    // show a few entries and scroll. Otherwise everyone water-fills equally.
    const tracker = items.find(it => it.key === 'tracker');
    if (tracker) {
      const others = items.filter(it => it !== tracker);
      const othersReserve = others.reduce((s, it) => s + Math.min(it.nat, TRACKER_OTHERS_MIN), 0);
      tracker.h = Math.min(tracker.nat, Math.max(Math.min(tracker.nat, TRACKER_OTHERS_MIN), avail - othersReserve));
      waterFill(others, avail - tracker.h);
    } else {
      waterFill(items, avail);
    }
    // Place each at its own anchor — top→top edge, bottom→bottom edge,
    // middle→centred — so a "bottom" widget stays at the bottom instead of
    // clustering at the top. Heights are already capped, so they never overlap.
    const T = topPad, B = window.innerHeight - botPad, C = window.innerHeight / 2;
    const place = (it, y) => {
      it.el.style.top = Math.round(y) + 'px';
      it.el.style.bottom = 'auto';
      it.el.style.transform = 'none';
      it.el.style.maxHeight = Math.round(it.h) + 'px';
    };
    const top = items.find(it => it.order === 0);   // distinct slots per side, so ≤1 each
    const mid = items.find(it => it.order === 1);
    const bot = items.find(it => it.order === 2);
    if (top) place(top, T);
    if (bot) place(bot, B - bot.h);
    if (mid) {
      const lo = top ? T + top.h + gap : T;
      const hi = bot ? B - bot.h - gap : B;
      place(mid, Math.max(lo, Math.min(C - mid.h / 2, hi - mid.h)));
    }
  }
}
window.addEventListener('resize', scheduleLayout);
