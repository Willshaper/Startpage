// Startpage: Page: background, tile/clock/search layout controls, search, accent, theme, clock + greeting.
// Classic script sharing globals with the others; load order is set in index.html.

// ── Background ────────────────────────────────────────────────────────────────
// settings.bgMode picks the active source: 'upload' (settings.background, a single
// uploaded data URI), 'urls' (settings.bgUrls, direct links that rotate), or 'none'.
// Both sources are kept independently, so switching modes never wipes the other.
// bgIndex is the currently-shown image; it's randomised once at start.
let bgTimer = null, bgIndex = 0;
function bgList() {
  if (settings.bgMode === 'urls')   return Array.isArray(settings.bgUrls) ? settings.bgUrls : [];
  if (settings.bgMode === 'upload') return settings.background ? [settings.background] : [];
  return [];
}
function paintBg(url) {
  if (url) {
    document.body.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`;
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundPosition = 'center';
    document.body.style.backgroundAttachment = 'fixed';
  } else {
    document.body.style.backgroundImage = '';
  }
}
function applyBackground() {
  if (bgTimer) { clearTimeout(bgTimer); bgTimer = null; }
  const list = bgList();
  if (!list.length) { paintBg(''); return; }
  bgIndex = bgCurrentIndex();
  paintBg(list[bgIndex]);
  scheduleBgRotation();
}
// With a rotate interval set, which image shows is a function of the wall clock, so
// every tab open in the same window shows the same one and it advances on real
// N-minute boundaries (not from when a given tab happened to open). Interval 0
// ("On each load") keeps the random per-load pick in bgIndex.
function bgCurrentIndex() {
  const list = bgList();
  const mins = Number(settings.bgInterval) || 0;
  if (mins > 0 && list.length > 1) return Math.floor(Date.now() / (mins * 60000)) % list.length;
  return (bgIndex >= 0 && bgIndex < list.length) ? bgIndex : 0;
}
// Fire at the next wall-clock boundary (aligned across tabs), then reschedule.
function scheduleBgRotation() {
  const list = bgList();
  const mins = Number(settings.bgInterval) || 0;
  if (mins <= 0 || list.length < 2) return;
  const period = mins * 60000;
  bgTimer = setTimeout(() => {
    const cur = bgList();
    if (cur.length > 1) {
      const idx = Math.floor(Date.now() / period) % cur.length;
      const url = cur[idx];
      const img = new Image();
      img.onload = img.onerror = () => { bgIndex = idx; paintBg(url); };  // preload so the swap doesn't flash
      img.src = url;
    }
    scheduleBgRotation();
  }, period - (Date.now() % period) + 100);
}
// Quota-safe setter for the uploaded image; leaves the URL list and mode untouched.
function setBackground(value) {
  const prev = settings.background;
  settings.background = value;
  if (!save()) {
    settings.background = prev; save();
    alert(L().alertImageTooLarge);
    return false;
  }
  return true;
}
function removeUploadedBg() {
  setBackground('');
  applyBackground();
  applyBgModeUI();
}
// Show the controls + help text for the active source, and highlight the selector.
function applyBgModeUI() {
  const mode = settings.bgMode || 'none';
  segSetActive($.setBgMode, 'bgmode', mode);
  const up = document.getElementById('bg-upload-controls');
  const ur = document.getElementById('bg-urls-controls');
  if (up) up.style.display = mode === 'upload' ? '' : 'none';
  if (ur) ur.style.display = mode === 'urls'   ? '' : 'none';
  const help = document.getElementById('bg-mode-help');
  if (help) help.textContent =
    mode === 'upload' ? L().bgHelpUpload + (settings.background ? '' : ' ' + L().bgNoImage)
  : mode === 'urls'   ? L().bgHelpUrls
  :                     L().bgHelpNone;
}

// ── Render tiles ──────────────────────────────────────────────────────────────
function buildTileHtml(l, i) {
  const letter  = (l.name.trim()[0] || '?').toUpperCase();
  const sources = l.icon === FORCE_LETTER ? []
                : l.icon ? [l.icon, ...faviconSources(l.url)]
                : faviconSources(l.url);
  const target  = settings.newTab ? ' target="_blank" rel="noopener"' : '';
  const imgTag  = sources.length
    ? `<img src="${esc(sources[0])}" data-fb="${esc(sources.slice(1).join('|'))}" alt="" onerror="nextIcon(this)">`
    : '';
  return `<a class="tile" href="${esc(withProtocol(l.url))}"${target}
      style="animation-delay:${Math.min(i, 30) * 20}ms"
      draggable="true" data-id="${l.id}"
      oncontextmenu="openCtx(event, ${l.id})">
    <div class="tile-icon" style="background:${colorFor(l.name)}">
      <span>${esc(letter)}</span>
      ${imgTag}
    </div>
    <span class="tile-name">${esc(l.name)}</span>
  </a>`;
}

function renderTiles() {
  // Group links by their .group field (links pointing at a deleted group fall to ungrouped)
  const byGroup = new Map();
  byGroup.set('', []);                          // ungrouped bucket always exists
  for (const g of settings.groups) byGroup.set(g, []);
  for (const l of links) {
    const g = settings.groups.includes(l.group) ? l.group : '';
    byGroup.get(g).push(l);
  }

  let html = '';
  let idx = 0;  // global tile index so the staggered entry animation is monotonic
  let widest = 0;  // most tiles in any one section -> sizes the centered block
  const order = [...settings.groups, ''];  // user-defined groups first, ungrouped last
  for (const groupName of order) {
    const groupLinks = byGroup.get(groupName) || [];
    const isUngrouped = groupName === '';
    const showAddHere = isUngrouped && !settings.hideAdd;
    if (!groupLinks.length && !showAddHere) continue;  // hide empty sections
    widest = Math.max(widest, groupLinks.length + (showAddHere ? 1 : 0));
    html += '<div class="tile-section">';
    if (groupName) html += `<div class="tile-section-title">${esc(groupName)}</div>`;
    html += '<div class="tile-grid">';
    for (const l of groupLinks) html += buildTileHtml(l, idx++);
    if (showAddHere) {
      html += `<button class="tile tile-add" style="animation-delay:${Math.min(idx++, 30) * 20}ms" onclick="openLinkModal()">
        <div class="plus">+</div>
        <span class="tile-name">${esc(L().add)}</span>
      </button>`;
    }
    html += '</div></div>';
  }
  $.tiles.innerHTML = html;
  maxRowTiles = widest;
  applyTiles();   // resize the centered block to the widest section
  attachDrag();
}
// Hint text is tied to the Add tile — hide both together
function applyHint() {
  $.hint.style.display = settings.hideAdd ? 'none' : '';
}

// ── Tile/widget background opacity ────────────────────────────────────────────
// Drives the --tile-bg-opacity / --widget-bg-opacity CSS custom properties on
// :root. The CSS uses color-mix() against transparent so only the background,
// border, and shadow fade — icons, text, and tile-icon colours stay 100%.
function clampOpacity(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
}
function applyOpacity() {
  const t = clampOpacity(settings.tileOpacity);
  const w = clampOpacity(settings.widgetOpacity);
  const s = clampOpacity(settings.searchOpacity);
  const c = clampOpacity(settings.clockOpacity);
  const root = document.documentElement.style;
  root.setProperty('--tile-bg-opacity',   t);
  root.setProperty('--widget-bg-opacity', w);
  root.setProperty('--search-bg-opacity', s);
  root.setProperty('--clock-bg-opacity',  c);
  if ($.tileOpVal)   $.tileOpVal.textContent   = Math.round(t * 100) + '%';
  if ($.widgetOpVal) $.widgetOpVal.textContent = Math.round(w * 100) + '%';
  if ($.searchOpVal) $.searchOpVal.textContent = Math.round(s * 100) + '%';
  if ($.clockOpVal)  $.clockOpVal.textContent  = Math.round(c * 100) + '%';
}
function applySearch() {
  $.searchForm.style.display = settings.searchEnabled ? '' : 'none';
}
// The clock is a widget now: show/hide the whole block and place it in its slot.
function applyClock() {
  $.clockBlock.style.display = settings.clock.enabled ? '' : 'none';
  segSetActive($.setClockValignSeg, 'valign', settings.clock.valign || 'middle');
  placeBlocks();
}
// Put the clock block and the content block (tiles) into their vertical slots.
// When both land in the same slot the clock is appended first, so it sits above.
// The search bar rides with the clock when the clock is on (always directly below
// it), otherwise it sits above the tiles in the content block.
function placeBlocks() {
  if (settings.clock.enabled) $.clockBlock.appendChild($.searchForm);
  else $.contentBlock.insertBefore($.searchForm, $.contentBlock.firstChild);
  const slot = v => document.getElementById('slot-' + (['top','middle','bottom'].includes(v) ? v : 'middle'));
  slot(settings.clock.valign).appendChild($.clockBlock);
  slot(settings.tileVAlign).appendChild($.contentBlock);
}
// Tiles-per-line + compact size. --tile-cols is the setting (max per row); --tile-fit
// is the effective width = the widest group's tile count capped at the setting, so the
// centered block hugs the widest group. renderTiles updates maxRowTiles then calls this.
let maxRowTiles = 0;   // largest section's tile count (set by renderTiles)
function applyTiles() {
  const n = clampCols(settings.tileColumns);
  const fit = Math.min(n, maxRowTiles || n);
  const root = document.documentElement.style;
  root.setProperty('--tile-cols', n);
  root.setProperty('--tile-fit', fit);
  $.tiles.classList.toggle('compact', !!settings.tileCompact);
  if ($.setTileColsVal) $.setTileColsVal.textContent = n;
  // Vertical placement of the content block (search + tiles)
  segSetActive($.setValignSeg, 'valign', settings.tileVAlign || 'middle');
  placeBlocks();
}
// Highlight the button in a .seg whose data-<attr> equals val
function segSetActive(seg, attr, val) {
  if (!seg) return;
  seg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset[attr] === val));
}
// Bind one opacity slider. Guards against persisting an uninitialised slider:
// only react while the Settings panel is open (so openSettings has set the value
// from settings first), and block the mouse wheel from nudging the slider when
// the user is just scrolling the panel.
function bindOpacitySlider(el, key) {
  el.addEventListener('input', () => {
    if (!$.setModal.classList.contains('open')) return;
    settings[key] = clampOpacity(el.value / 100);
    applyOpacity(); save();
  });
  el.addEventListener('wheel', e => { e.preventDefault(); }, { passive: false });
}
bindOpacitySlider($.setTileOp,   'tileOpacity');
bindOpacitySlider($.setWidgetOp, 'widgetOpacity');
bindOpacitySlider($.setSearchOp, 'searchOpacity');
bindOpacitySlider($.setClockOp,  'clockOpacity');
document.getElementById('set-showsearch-row').addEventListener('click', () => {
  settings.searchEnabled = !settings.searchEnabled;
  $.setShowSearch.classList.toggle('on', settings.searchEnabled);
  save(); applySearch();
});
// Tiles-per-line slider (same open-panel guard + wheel block as the opacity sliders).
$.setTileCols.addEventListener('input', () => {
  if (!$.setModal.classList.contains('open')) return;
  settings.tileColumns = clampCols($.setTileCols.value);
  applyTiles(); save();
});
$.setTileCols.addEventListener('wheel', e => { e.preventDefault(); }, { passive: false });
document.getElementById('set-tile-compact-row').addEventListener('click', () => {
  settings.tileCompact = !settings.tileCompact;
  $.setTileCompact.classList.toggle('on', settings.tileCompact);
  applyTiles(); save();
});
// Clock widget: enable toggle + its own vertical-position segmented control
document.getElementById('set-clock-row').addEventListener('click', () => {
  settings.clock.enabled = !settings.clock.enabled;
  $.setClock.classList.toggle('on', settings.clock.enabled);
  applyClock(); save(); syncWidgetNav();
});
$.setClockValignSeg.addEventListener('click', e => {
  const b = e.target.closest('button[data-valign]'); if (!b) return;
  settings.clock.valign = b.dataset.valign;
  applyClock(); save();
});
// Theme + tile-vertical segmented controls (delegated clicks)
$.setThemeSeg.addEventListener('click', e => {
  const b = e.target.closest('button[data-theme-val]'); if (!b) return;
  settings.theme = b.dataset.themeVal;
  applyTheme(settings.theme); save();
});
$.setValignSeg.addEventListener('click', e => {
  const b = e.target.closest('button[data-valign]'); if (!b) return;
  settings.tileVAlign = b.dataset.valign;
  applyTiles(); save();
});

// ── Search ────────────────────────────────────────────────────────────────────
function buildEngineSelect(sel, current) {
  sel.innerHTML = Object.entries(ENGINES)
    .map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
  sel.value = current;
}
$.searchForm.addEventListener('submit', e => {
  e.preventDefault();
  const q = $.searchIn.value.trim();
  if (!q) return;
  if (looksLikeUrl(q)) {
    location.href = withProtocol(q);
  } else {
    const eng = ENGINES[settings.engine] || ENGINES.google;   // never crash on a stale engine
    location.href = eng.url + encodeURIComponent(q);
  }
});
$.searchEng.addEventListener('change', () => {
  settings.engine = $.searchEng.value;
  save();
});

// ── Accent color ──────────────────────────────────────────────────────────────
// A custom accent overrides --teal (drives buttons, focus rings, toggles, etc.);
// empty falls back to the per-theme default.
function applyAccent() {
  const root = document.documentElement.style;
  if (settings.accent) root.setProperty('--teal', settings.accent);
  else root.removeProperty('--teal');
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  segSetActive($.setThemeSeg, 'themeVal', theme);
}

// ── Clock & greeting ──────────────────────────────────────────────────────────
function greetingText() {
  const h = new Date().getHours();
  const g = L().greetings;
  if (h < 5)  return g.night;
  if (h < 12) return g.morning;
  if (h < 18) return g.afternoon;
  if (h < 22) return g.evening;
  return g.night;
}
function updateGreeting() {
  const n = settings.greetingName;
  $.greeting.innerHTML = greetingText() + (n ? `, <b>${esc(n)}</b>` : '');
}
let lastClockHtml = '', lastDateText = '';
function tick() {
  const t = L();
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  const clockHtml = settings.seconds ? `${hm}<span class="sec">${p(d.getSeconds())}</span>` : hm;
  if (clockHtml !== lastClockHtml) { $.clock.innerHTML = clockHtml; lastClockHtml = clockHtml; }
  const day = t.days[d.getDay()];
  const date = d.getDate();
  const month = t.months[d.getMonth()];
  // Danish convention: "Fredag, 23. maj"; English: "Friday, May 23"
  const dateText = settings.lang === 'da' ? `${day}, ${date}. ${month}` : `${day}, ${month} ${date}`;
  if (dateText !== lastDateText) { $.date.textContent = dateText; lastDateText = dateText; }
  updateCountdown();
}
