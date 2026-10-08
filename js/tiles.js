// Startpage: Tiles: drag to reorder, context menus (+ the shared placeMenu), link dialog, tile groups.
// Classic script sharing globals with the others; load order is set in index.html.

// ── Drag to reorder ───────────────────────────────────────────────────────────
let dragId = null;
function attachDrag() {
  $.tiles.querySelectorAll('.tile[draggable]').forEach(el => {
    el.addEventListener('dragstart', e => {
      dragId = Number(el.dataset.id);
      el.style.opacity = '0.4';
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => { el.style.opacity = ''; dragId = null; });
    el.addEventListener('dragover', e => e.preventDefault());
    el.addEventListener('drop', e => {
      e.preventDefault();
      const targetId = Number(el.dataset.id);
      if (dragId === null || dragId === targetId) return;
      const from = links.findIndex(l => l.id === dragId);
      const to   = links.findIndex(l => l.id === targetId);
      if (from < 0 || to < 0) return;
      const targetGroup = links[to].group;     // capture before the array shifts
      const [moved] = links.splice(from, 1);
      moved.group = targetGroup;                // adopt target's group (no-op for same-group reorders)
      // Removing `from` shifts later indices left by one; compensate so the tile
      // lands just before the drop target regardless of drag direction.
      links.splice(from < to ? to - 1 : to, 0, moved);
      save(); renderTiles();
    });
  });
}

// ── Context menu ──────────────────────────────────────────────────────────────
function openCtx(evt, id) {
  evt.preventDefault();
  closeAnimeCtx(); closeAnimeBlCtx();
  ctxId = id;
  placeMenu($.ctxMenu, evt);
}
// Measure a context menu off-screen, then open it at the cursor, kept inside the viewport
function placeMenu(m, evt) {
  m.style.visibility = 'hidden';
  m.classList.add('open');
  const mw = m.offsetWidth, mh = m.offsetHeight;
  m.classList.remove('open');
  m.style.visibility = '';
  m.style.left = Math.min(evt.clientX, innerWidth  - mw - 6) + 'px';
  m.style.top  = Math.min(evt.clientY, innerHeight - mh - 6) + 'px';
  m.classList.add('open');
}
function closeCtx() { $.ctxMenu.classList.remove('open'); ctxId = null; }
function ctxEdit() {
  if (ctxId === null) return;
  const l = links.find(x => x.id === ctxId);
  if (l) openLinkModal(l);
  closeCtx();
}
function ctxRemove() {
  if (ctxId === null) return;
  const l = links.find(x => x.id === ctxId);
  closeCtx();
  if (!l) return;
  if (!confirm(L().confirmRemove.replace('{name}', l.name || ''))) return;
  links = links.filter(x => x.id !== l.id);
  save(); renderTiles();
}
document.addEventListener('click', e => {
  if (!$.ctxMenu.contains(e.target)) closeCtx();
  if (!$.animeCtx.contains(e.target)) closeAnimeCtx();
  if (!$.animeBlCtx.contains(e.target)) closeAnimeBlCtx();
});
document.addEventListener('contextmenu', e => {
  if (!$.ctxMenu.contains(e.target) && !e.target.closest('.tile')) closeCtx();
  const showRow = e.target.closest('#anime-show-list .am-row') && !e.target.closest('input');
  if (!$.animeCtx.contains(e.target) && !e.target.closest('.anime-item, .wt-auto, .wt-up') && !showRow) closeAnimeCtx();
  if (!$.animeBlCtx.contains(e.target) && !e.target.closest('#anime-bl-list .am-row')) closeAnimeBlCtx();
});

// ── Link modal (add / edit) ───────────────────────────────────────────────────
function openLinkModal(link) {
  editingId = link ? link.id : null;
  modalIcon = link ? link.icon : '';
  $.linkTitle.textContent = link ? L().editLink : L().addLink;
  $.linkSave.textContent  = link ? L().save     : L().add;
  $.linkName.value = link ? link.name : '';
  $.linkUrl.value  = link ? link.url  : '';
  populateGroupSelect($.linkGroup, link ? link.group : '');
  // show a pasted icon URL in the field; hide data: URLs and the letter sentinel
  $.iconUrl.value  = (modalIcon && modalIcon !== FORCE_LETTER && !modalIcon.startsWith('data:')) ? modalIcon : '';
  updateIconPreview();
  $.linkModal.classList.add('open');
  setTimeout(() => $.linkName.focus(), 30);
}
function closeLinkModal() { $.linkModal.classList.remove('open'); editingId = null; modalIcon = ''; }
function updateIconPreview() {
  const nameVal = $.linkName.value.trim();
  $.iconPrevLetter.textContent = (nameVal[0] || '?').toUpperCase();
  $.iconPrev.style.background = colorFor(nameVal || '?');
  const sources = modalIcon === FORCE_LETTER ? []
    : modalIcon ? [modalIcon, ...faviconSources($.linkUrl.value.trim())]
    : faviconSources($.linkUrl.value.trim());
  if (sources.length) {
    $.iconPrevImg.dataset.fb = sources.slice(1).join('|');
    $.iconPrevImg.onerror = () => nextIcon($.iconPrevImg);
    $.iconPrevImg.style.display = 'block';
    $.iconPrevImg.src = sources[0];
  } else {
    $.iconPrevImg.style.display = 'none';
  }
}
function resetModalIcon() { modalIcon = ''; $.iconUrl.value = ''; updateIconPreview(); }
function useModalLetter() { modalIcon = FORCE_LETTER; $.iconUrl.value = ''; updateIconPreview(); }
function saveLink() {
  const name  = $.linkName.value.trim();
  const url   = $.linkUrl.value.trim();
  const group = $.linkGroup.value;
  if (!name || !url) { (!name ? $.linkName : $.linkUrl).focus(); return; }
  const prevLinks = links.map(l => ({ ...l })), prevNextId = nextId;
  if (editingId !== null) {
    const l = links.find(x => x.id === editingId);
    if (l) { l.name = name; l.url = url; l.icon = modalIcon; l.group = group; }
  } else {
    links.push({ id: nextId++, name, url, icon: modalIcon, group });
  }
  if (!save()) {
    links = prevLinks; nextId = prevNextId;   // undo, so a retry can't add the tile twice
    alert(L().alertSaveFailed); return;
  }
  renderTiles(); closeLinkModal();
}
$.iconUrl.addEventListener('input', () => { modalIcon = $.iconUrl.value.trim(); updateIconPreview(); });
$.linkUrl.addEventListener('input',  () => { if (!modalIcon || !modalIcon.startsWith('data:')) updateIconPreview(); });
$.linkName.addEventListener('input', updateIconPreview);
document.getElementById('icon-file').addEventListener('change', function () {
  const f = this.files[0]; this.value = '';
  if (!f) return;
  processImageFile(f, 128, 'image/png', undefined, dataUrl => {
    if (!dataUrl) { alert(L().alertReadFailed); return; }
    modalIcon = dataUrl; $.iconUrl.value = ''; updateIconPreview();
  });
});

// ── Tile groups manager ─────────────────────────────────────────────────────
let groupDragIdx = null;
function attachGroupDrag() {
  $.groupList.querySelectorAll('.feed-row[draggable]').forEach(el => {
    el.addEventListener('dragstart', e => {
      groupDragIdx = Number(el.dataset.idx);
      el.style.opacity = '0.4';
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend',  () => { el.style.opacity = ''; groupDragIdx = null; });
    el.addEventListener('dragover', e => e.preventDefault());
    el.addEventListener('drop', e => {
      e.preventDefault();
      const to = Number(el.dataset.idx);
      if (groupDragIdx === null || groupDragIdx === to) return;
      const [moved] = settings.groups.splice(groupDragIdx, 1);
      settings.groups.splice(to, 0, moved);
      save(); renderGroupList(); renderTiles();
    });
  });
}
function renderGroupList() {
  const gs = settings.groups;
  $.groupCount.textContent = ` ${gs.length}/${MAX_GROUPS}`;
  if (!gs.length) {
    $.groupList.innerHTML = `<div class="feed-empty" data-i18n="noGroups">${esc(L().noGroups)}</div>`;
  } else {
    $.groupList.innerHTML = gs.map((g, i) =>
      `<div class="feed-row" draggable="true" data-idx="${i}"><span title="${esc(g)}">${esc(g)}</span>` +
      `<button type="button" title="${esc(L().remove)}" onclick="removeGroup(${i})">✕</button></div>`
    ).join('');
    attachGroupDrag();
  }
  const atLimit = gs.length >= MAX_GROUPS;
  $.groupInput.disabled  = atLimit;
  $.groupAddBtn.disabled = atLimit;
}
function addGroup() {
  const name = $.groupInput.value.trim();
  if (!name || settings.groups.length >= MAX_GROUPS) return;
  if (settings.groups.includes(name)) { $.groupInput.value = ''; return; }  // already exists
  settings.groups.push(name);
  $.groupInput.value = '';
  save(); renderGroupList(); renderTiles();
}
function removeGroup(i) {
  const name = settings.groups[i];
  if (!name) return;
  if (!confirm(L().confirmRemoveGroup.replace('{name}', name))) return;
  settings.groups.splice(i, 1);
  // Tiles that were in this group become ungrouped
  links.forEach(l => { if (l.group === name) l.group = ''; });
  save(); renderGroupList(); renderTiles();
}
function populateGroupSelect(sel, current) {
  let html = `<option value="">${esc(L().none)}</option>`;
  for (const g of settings.groups) {
    html += `<option value="${esc(g)}">${esc(g)}</option>`;
  }
  sel.innerHTML = html;
  sel.value = settings.groups.includes(current) ? current : '';
}
