// Startpage: Settings window: tabs, every settings control, export / import.
// Classic script sharing globals with the others; load order is set in index.html.

// ── Settings ──────────────────────────────────────────────────────────────────
function openSettings() {
  $.setName.value = settings.greetingName;
  $.setLang.value = settings.lang;
  buildEngineSelect($.setEngine, settings.engine);
  $.setNewtab.classList.toggle('on', settings.newTab);
  $.setSeconds.classList.toggle('on', settings.seconds);
  $.setShowAdd.classList.toggle('on', !settings.hideAdd);
  $.setBgUrls.value = (settings.bgUrls || []).join('\n');
  $.setBgInterval.value = String(settings.bgInterval || 0);
  applyBgModeUI();
  $.setRss.classList.toggle('on', settings.rss.enabled);
  $.setRssHighlight.value = settings.rss.highlight;
  $.setRssBlacklist.value = settings.rss.blacklist;
  $.setNote.classList.toggle('on', settings.note.enabled);
  $.setNoteChecklist.classList.toggle('on', settings.note.checklist);
  $.setWeather.classList.toggle('on', settings.weather.enabled);
  $.setWeatherUnits.classList.toggle('on', settings.weather.units === 'f');
  $.setWeatherLoc.value = settings.weather.location ? settings.weather.location.name : '';
  $.setCountdown.classList.toggle('on', settings.countdown.enabled);
  $.setCountdownLabel.value  = '';
  $.setCountdownTarget.value = '';
  $.setTracker.classList.toggle('on', settings.tracker.enabled);
  $.setAnime.classList.toggle('on', settings.anime.enabled);
  $.setTrackerAnime.classList.toggle('on', settings.tracker.anime);
  syncWidgetPositions();
  syncWidgetNav();
  $.setTileOp.value   = Math.round(clampOpacity(settings.tileOpacity)   * 100);
  $.setWidgetOp.value = Math.round(clampOpacity(settings.widgetOpacity) * 100);
  $.setSearchOp.value = Math.round(clampOpacity(settings.searchOpacity) * 100);
  $.setClockOp.value  = Math.round(clampOpacity(settings.clockOpacity)  * 100);
  $.setShowSearch.classList.toggle('on', settings.searchEnabled);
  $.setClock.classList.toggle('on', settings.clock.enabled);
  segSetActive($.setClockValignSeg, 'valign', settings.clock.valign);
  $.setAccent.value = settings.accent || '#4fc4a8';
  $.setTileCols.value = clampCols(settings.tileColumns);
  $.setTileCompact.classList.toggle('on', settings.tileCompact);
  segSetActive($.setThemeSeg, 'themeVal', settings.theme);
  applyOpacity();   // refresh the % labels next to the sliders
  applyTiles();     // refresh the tiles-per-line count label + vertical-position seg
  renderFeedList();
  renderGroupList();
  renderCountdownList();
  $.setModal.classList.add('open');
}
// Re-apply every widget at once (used after a position auto-move so the bumped
// widget actually relocates on screen)
function applyAllWidgets() { applyRss(); applyNote(); applyWeather(); applyCountdown(); applyTracker(); applyAnime(); }
function closeSettings() { $.setModal.classList.remove('open'); }
// Settings hub tabs: show one pane at a time
function setSettingsTab(pane) {
  document.querySelectorAll('#settings-nav .settings-tab').forEach(b => b.classList.toggle('active', b.dataset.pane === pane));
  document.querySelectorAll('#settings-modal .settings-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === pane));
}
document.getElementById('settings-nav').addEventListener('click', e => {
  const b = e.target.closest('.settings-tab'); if (!b) return;
  if (b.dataset.open === 'anime-manager') openAnimeManager();   // its own window, not a page
  else setSettingsTab(b.dataset.pane);
});
// Show a sidebar page button for each enabled widget only (the Anime Manager button
// is always there). If the page that's open belongs to a widget that was just
// turned off, fall back to the Widgets page.
function syncWidgetNav() {
  document.querySelectorAll('#settings-nav .settings-tab[data-widget]').forEach(b => {
    const w = settings[b.dataset.widget];
    const on = !!(w && w.enabled);
    b.style.display = on ? '' : 'none';
    if (!on && b.classList.contains('active')) setSettingsTab('widgets');
  });
}

$.setLang.addEventListener('change', () => {
  settings.lang = $.setLang.value;
  save();
  applyLanguage();
  updateGreeting();
  tick();
  renderTiles();   // re-render so the Add tile picks up the new language
});

document.getElementById('set-newtab-row').addEventListener('click', () => {
  settings.newTab = !settings.newTab;
  $.setNewtab.classList.toggle('on', settings.newTab);
  save(); renderTiles();
});
document.getElementById('set-seconds-row').addEventListener('click', () => {
  settings.seconds = !settings.seconds;
  $.setSeconds.classList.toggle('on', settings.seconds);
  save(); tick();
});
document.getElementById('set-showadd-row').addEventListener('click', () => {
  settings.hideAdd = !settings.hideAdd;
  $.setShowAdd.classList.toggle('on', !settings.hideAdd);
  save(); renderTiles(); applyHint();
});
$.setName.addEventListener('input', () => {
  settings.greetingName = $.setName.value.trim();
  save(); updateGreeting();
});
$.setEngine.addEventListener('change', () => {
  settings.engine = $.setEngine.value;
  $.searchEng.value = settings.engine;
  save();
});
$.setAccent.addEventListener('input', () => {
  settings.accent = $.setAccent.value;
  applyAccent(); save();
});
function resetAccent() {
  settings.accent = '';
  $.setAccent.value = '#4fc4a8';
  applyAccent(); save();
}

// Generic helper: toggle a widget's enabled flag (or change its position),
// resolve any slot collisions, sync the dropdowns, then re-apply all widgets.
function onWidgetEnabledToggle(key, toggleEl) {
  settings[key].enabled = !settings[key].enabled;
  toggleEl.classList.toggle('on', settings[key].enabled);
  resolveWidgetPositions(key);
  syncWidgetPositions();
  syncWidgetNav();
  save();
}
function onWidgetPosChange(key, value) {
  settings[key].position = value;
  resolveWidgetPositions(key);
  syncWidgetPositions();
  save();
}

document.getElementById('set-rss-row').addEventListener('click', () => {
  onWidgetEnabledToggle('rss', $.setRss);
  rssLastSig = '';
  applyAllWidgets();
});
$.setRssUrl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addFeed(); } });
$.setRssHighlight.addEventListener('input', () => {
  settings.rss.highlight = $.setRssHighlight.value;   // store as-typed; trim/lowercase at match time
  save();
  // Highlighting is purely visual, so just re-style the items already shown — no refetch
  clearTimeout(rssHighlightDebounce);
  rssHighlightDebounce = setTimeout(() => { if (lastFeedItems.length) renderFeed(lastFeedItems); }, 150);
});
$.setRssBlacklist.addEventListener('input', () => {
  settings.rss.blacklist = $.setRssBlacklist.value;   // store as-typed; trim/lowercase at match time
  save();
  // Blacklist filters at render time, so re-run it on the fetched items — no refetch needed
  clearTimeout(rssBlacklistDebounce);
  rssBlacklistDebounce = setTimeout(() => { if (lastFeedItems.length) renderFeed(lastFeedItems); }, 150);
});

document.getElementById('set-note-row').addEventListener('click', () => {
  onWidgetEnabledToggle('note', $.setNote);
  applyAllWidgets();
});
document.getElementById('set-note-checklist-row').addEventListener('click', () => {
  settings.note.checklist = !settings.note.checklist;
  $.setNoteChecklist.classList.toggle('on', settings.note.checklist);
  save(); applyNote();
});

document.getElementById('set-weather-row').addEventListener('click', () => {
  onWidgetEnabledToggle('weather', $.setWeather);
  applyAllWidgets();
});
document.getElementById('set-weather-units-row').addEventListener('click', () => {
  settings.weather.units = settings.weather.units === 'f' ? 'c' : 'f';
  $.setWeatherUnits.classList.toggle('on', settings.weather.units === 'f');
  save();
  weatherLastSig = '';
  if (settings.weather.enabled && settings.weather.location) fetchWeather();
});
$.setWeatherLoc.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); setWeatherLocationFromInput(); } });

document.getElementById('set-countdown-row').addEventListener('click', () => {
  onWidgetEnabledToggle('countdown', $.setCountdown);
  applyAllWidgets();
});
$.setCountdownLabel.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addCountdown(); } });
$.setCountdownTarget.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addCountdown(); } });

document.getElementById('set-tracker-row').addEventListener('click', () => {
  onWidgetEnabledToggle('tracker', $.setTracker);
  applyAllWidgets();
});
document.getElementById('set-tracker-anime-row').addEventListener('click', () => {
  settings.tracker.anime = !settings.tracker.anime;
  $.setTrackerAnime.classList.toggle('on', settings.tracker.anime);
  save(); applyTracker();
});

document.getElementById('set-anime-row').addEventListener('click', () => {
  onWidgetEnabledToggle('anime', $.setAnime);
  applyAllWidgets();
});
$.setAnimeSource.addEventListener('click', e => {
  const b = e.target.closest('button[data-src]'); if (!b) return;
  settings.anime.source = b.dataset.src;
  save(); renderAnimeSettings(); applyAnime();
});
function setAnimeUser() {
  const u = $.setAnimeUser.value.trim().slice(0, 40);
  $.setAnimeUser.value = u;
  if (u === settings.anime.user) return;
  settings.anime.user = u;
  save(); applyAnime();
}
$.setAnimeUser.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); setAnimeUser(); } });
$.setAnimeUser.addEventListener('change', setAnimeUser);   // also commit on blur, so closing settings doesn't drop a typed name
// Format / country chips: toggle membership, re-filter the cached entries
[[$.setAnimeFormats, 'formats', 'fmt', ANIME_FORMATS], [$.setAnimeCountries, 'countries', 'cc', ANIME_COUNTRIES]].forEach(([el, key, attr, order]) => {
  el.addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    const v = b.dataset[attr], cur = settings.anime[key];
    settings.anime[key] = order.filter(x => x === v ? !cur.includes(x) : cur.includes(x));
    b.classList.toggle('on', settings.anime[key].includes(v));
    save(); animeFiltersChanged();
  });
});
let animeHighlightDebounce = null;
$.setAnimeHighlight.addEventListener('input', () => {
  settings.anime.highlight = $.setAnimeHighlight.value;   // store as-typed; trim/lowercase at match time
  save();
  clearTimeout(animeHighlightDebounce);
  animeHighlightDebounce = setTimeout(renderAnime, 150);
});
// Position grids (all widgets, plus the Anime Manager's): click a corner cell to place that widget on screen
[$.setModal, $.animeManager].forEach(m => m.addEventListener('click', e => {
  const cell = e.target.closest('.pos-cell');
  if (!cell) return;
  onWidgetPosChange(cell.closest('.pos-grid').dataset.widget, cell.dataset.pos);
  applyAllWidgets();
}));

$.groupInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addGroup(); } });
// Background source selector — switching never wipes the other source's data.
$.setBgMode.addEventListener('click', e => {
  const b = e.target.closest('button[data-bgmode]'); if (!b) return;
  settings.bgMode = b.dataset.bgmode;
  bgIndex = Math.floor(Math.random() * (bgList().length || 1));
  applyBackground(); applyBgModeUI(); save();
});
document.getElementById('bg-file').addEventListener('change', function () {
  const f = this.files[0]; this.value = '';
  if (!f) return;
  processImageFile(f, 1600, 'image/jpeg', 0.85, dataUrl => {
    if (!dataUrl) { alert(L().alertReadFailed); return; }
    if (setBackground(dataUrl)) { settings.bgMode = 'upload'; save(); applyBackground(); applyBgModeUI(); }
  });
});
// Rotating background URL list — one per line. Independent of the uploaded image.
$.setBgUrls.addEventListener('input', () => {
  settings.bgUrls = [...new Set($.setBgUrls.value.split('\n').map(s => s.trim()).filter(Boolean))];
  bgIndex = Math.floor(Math.random() * (settings.bgUrls.length || 1));
  applyBackground(); save();
});
$.setBgInterval.addEventListener('change', () => {
  settings.bgInterval = Number($.setBgInterval.value) || 0;
  applyBackground(); save();
});

// ── Export / Import ───────────────────────────────────────────────────────────
function exportData() {
  const blob = new Blob([JSON.stringify({ links, nextId, settings }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = 'startpage-backup.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);   // revoke after the download starts, not before
}
function importData(input) {
  const file = input.files[0];
  if (!file) return;
  if (!confirm(L().confirmImport)) { input.value = ''; return; }   // import overwrites everything
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const d = JSON.parse(ev.target.result);
      if (!Array.isArray(d.links)) throw 0;
      links    = d.links.map(normalizeLink).filter(Boolean);
      nextId   = safeNextId(d.nextId);
      settings = { ...DEFAULT_SETTINGS, ...migrateStored(d.settings) };
      normalizeSettings(settings);
      normalizeAllSubfields();
      if (!save()) { alert(L().alertImportTooLarge); }
      applyTheme(settings.theme);
      applyAccent();
      bgIndex = Math.floor(Math.random() * (bgList().length || 1));
      applyBackground();
      applyOpacity();
      applySearch();
      applyClock();
      applyTiles();
      applyLanguage();
      applyRss();
      applyNote();
      applyWeather();
      applyCountdown();
      applyTracker();
      applyAnime();
      trackedChanged();   // the imported tracked list → widget + Weekly-Tracker site
      buildEngineSelect($.searchEng, settings.engine);
      renderTiles(); applyHint(); tick(); updateGreeting();
      closeSettings();
    } catch { alert(L().alertImportInvalid); }
    input.value = '';
  };
  reader.readAsText(file);
}
document.getElementById('import-file').addEventListener('change', function () { importData(this); });
