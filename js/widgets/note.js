// Startpage: Sticky note widget (text or checklist).
// Classic script sharing globals with the others; load order is set in index.html.

// ── Sticky note widget ───────────────────────────────────────────────────────
// The note's `text` is the single source of truth in both modes. Checklist mode
// just renders/edits it as `- [ ] item` / `- [x] item` lines, so toggling modes
// (and export/import) keeps everything intact.
let noteSaveTimer = null;
const CHECK_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h8M2 8h8M2 12h5"/><path d="M11.5 11.5l1.5 1.5 2.5-3"/></svg>';
const TEXT_ICON  = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 4h12M2 8h12M2 12h8"/></svg>';
function parseChecklist(text) {
  return text.split('\n').filter(l => l.trim() !== '').map(line => {
    const m = /^\s*-\s*\[([ xX])\]\s?(.*)$/.exec(line);
    if (m) return { done: m[1].toLowerCase() === 'x', label: m[2] };
    return { done: false, label: line.replace(/^\s*[-*]\s+/, '') };
  });
}
function serializeChecklist(items) {
  return items.map(it => `- [${it.done ? 'x' : ' '}] ${it.label}`).join('\n');
}
function applyNote() {
  const n = settings.note;
  ALL_POSITIONS.forEach(p => $.notePanel.classList.remove('pos-' + p));
  $.notePanel.classList.add('pos-' + (ALL_POSITIONS.includes(n.position) ? n.position : 'ml'));
  $.notePanel.classList.toggle('show', n.enabled);
  const list = n.checklist;
  $.noteText.style.display   = list ? 'none' : '';
  $.noteList.style.display   = list ? '' : 'none';
  $.noteAddRow.style.display = list ? '' : 'none';
  $.noteModeBtn.innerHTML = list ? TEXT_ICON : CHECK_ICON;
  if ($.noteText.value !== n.text) $.noteText.value = n.text;
  if (list) renderNoteList();
  scheduleLayout();
}
function renderNoteList() {
  if (!settings.note.checklist) return;
  const items = parseChecklist(settings.note.text);
  if (!items.length) {
    $.noteList.innerHTML = `<div class="note-empty">${esc(L().noteEmpty)}</div>`;
  } else {
    $.noteList.innerHTML = items.map((it, i) =>
      `<label class="note-item${it.done ? ' done' : ''}">` +
      `<input type="checkbox" ${it.done ? 'checked' : ''} onchange="toggleNoteItem(${i})">` +
      `<span>${esc(it.label)}</span>` +
      `<button type="button" title="${esc(L().remove)}" onclick="removeNoteItem(${i})">✕</button>` +
      `</label>`
    ).join('');
  }
  scheduleLayout();
}
function commitChecklist(items) {
  settings.note.text = serializeChecklist(items);
  if ($.noteText.value !== settings.note.text) $.noteText.value = settings.note.text;
  save(); renderNoteList();
}
function toggleNoteItem(i) {
  const items = parseChecklist(settings.note.text);
  if (!items[i]) return;
  items[i].done = !items[i].done;
  commitChecklist(items);
}
function removeNoteItem(i) {
  const items = parseChecklist(settings.note.text);
  if (!items[i]) return;
  items.splice(i, 1);
  commitChecklist(items);
}
function addNoteItem() {
  const label = $.noteAddInput.value.trim();
  if (!label) return;
  const items = parseChecklist(settings.note.text);
  items.push({ done: false, label });
  $.noteAddInput.value = '';
  commitChecklist(items);
}
$.noteText.addEventListener('input', () => {
  settings.note.text = $.noteText.value;
  // Debounce so we don't hit localStorage on every keystroke
  clearTimeout(noteSaveTimer);
  noteSaveTimer = setTimeout(() => { noteSaveTimer = null; save(); }, 300);
});
// Save a pending edit right away when the tab is hidden or closed, so the last
// keystrokes before closing aren't lost to the debounce
function flushNote() {
  if (!noteSaveTimer) return;
  clearTimeout(noteSaveTimer); noteSaveTimer = null;
  save();
}
window.addEventListener('pagehide', flushNote);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushNote(); });
$.noteAddInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addNoteItem(); } });
$.noteModeBtn.addEventListener('click', () => {
  settings.note.checklist = !settings.note.checklist;
  if ($.setNoteChecklist) $.setNoteChecklist.classList.toggle('on', settings.note.checklist);
  save(); applyNote();
});
