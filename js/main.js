// Startpage: Global listeners and start-up. Loaded last.
// Classic script sharing globals with the others; load order is set in index.html.

// ── Global listeners ──────────────────────────────────────────────────────────
document.getElementById('btn-settings').addEventListener('click', openSettings);
// A click on the dark backdrop closes a dialog — only when the press also started on
// it, so drag-selecting text in a field and letting go outside never closes it (and
// loses what was typed). While a right-click menu is open, that click just closes the menu.
let backdropPress = null;
document.addEventListener('mousedown', e => {
  const menuOpen = [$.ctxMenu, $.animeCtx, $.animeBlCtx].some(m => m.classList.contains('open'));
  backdropPress = !menuOpen && e.target.classList.contains('modal-overlay') ? e.target : null;
});
[[$.linkModal, closeLinkModal], [$.setModal, closeSettings], [$.animeLinkModal, closeAnimeLinkModal],
 [$.trackTimeModal, closeTrackTimeModal], [$.animeManager, closeAnimeManager]].forEach(([m, close]) => {
  m.addEventListener('click', e => { if (e.target === m && backdropPress === m) close(); });
});
$.linkName.addEventListener('keydown', e => { if (e.key === 'Enter') saveLink(); });
$.linkUrl .addEventListener('keydown', e => { if (e.key === 'Enter') saveLink(); });
$.animeLinkUrl.addEventListener('keydown', e => { if (e.key === 'Enter') saveAnimeLink(); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  // A dialog or menu over the Anime Manager closes alone; otherwise Escape leaves the manager for Settings
  const dialog = [$.animeLinkModal, $.trackTimeModal, $.animeCtx, $.animeBlCtx].some(x => x.classList.contains('open'));
  closeCtx(); closeAnimeCtx(); closeAnimeBlCtx(); closeLinkModal(); closeAnimeLinkModal(); closeTrackTimeModal();
  if (!dialog && isAnimeManagerOpen()) closeAnimeManager();
  else closeSettings();
});

// ── Init ──────────────────────────────────────────────────────────────────────
load();
applyTheme(settings.theme);
applyAccent();
bgIndex = Math.floor(Math.random() * (bgList().length || 1));   // random wallpaper per page load
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
initAnimeSync();
buildPosGrids();
buildEngineSelect($.searchEng, settings.engine);
renderTiles();
applyHint();
updateGreeting();
tick();
setInterval(tick, 1000);
setInterval(updateGreeting, 60000);
setInterval(renderFeedUpdated, 30000);   // keep the feed's "last updated" figure current
window.addEventListener('load', () => { if (settings.searchEnabled) $.searchIn.focus(); });
