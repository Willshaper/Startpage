// Startpage: Countdown widget + its list in settings.
// Classic script sharing globals with the others; load order is set in index.html.

// ── Countdown widget (holds a list of independent countdowns) ──────────────────
function applyCountdown() {
  const c = settings.countdown;
  ALL_POSITIONS.forEach(p => $.countdownPanel.classList.remove('pos-' + p));
  $.countdownPanel.classList.add('pos-' + (ALL_POSITIONS.includes(c.position) ? c.position : 'br'));
  $.countdownPanel.classList.toggle('show', c.enabled);
  updateCountdown();
  scheduleLayout();
}
// Colour the readout by nearness, matching the tracker's countdown colours
function countdownCdClass(ms) {
  const h = ms / 3600000;
  return h < 6 ? 'cd-near' : h < 48 ? 'cd-mid' : 'cd-far';
}
// Render one countdown's body: a prominent D/H/M/S line, "time's up",
// or a "set a target" hint
function countdownItemHtml(item, now, t) {
  const p2 = n => String(n).padStart(2, '0');
  const target = item.target ? new Date(item.target).getTime() : NaN;
  let inner;
  if (!Number.isFinite(target)) {
    inner = `<div class="countdown-state">${esc(t.countdownSet)}</div>`;
  } else {
    const ms = target - now;
    if (ms <= 0) {
      inner = `<div class="countdown-done">${esc(t.countdownReached)}</div>`;
    } else {
      let diff = Math.floor(ms / 1000);
      const days = Math.floor(diff / 86400); diff -= days * 86400;
      const hrs  = Math.floor(diff / 3600);  diff -= hrs * 3600;
      const mins = Math.floor(diff / 60);
      const secs = diff - mins * 60;
      const seg = (n, u) => `<span class="cd-seg">${n}<span class="u">${u}</span></span>`;
      const time = (days > 0 ? seg(days, 'd') : '') +
        seg(p2(hrs), 'h') + seg(p2(mins), 'm') + seg(p2(secs), 's');
      inner = `<div class="countdown-time ${countdownCdClass(ms)}">${time}</div>`;
    }
  }
  return `<div class="countdown-item">` +
    `<div class="countdown-item-label">${esc(item.label || t.countdown)}</div>${inner}</div>`;
}
// Called every second by tick(). Without seconds the readout only changes each
// minute, so only touch the DOM when the HTML actually changes (avoids resetting
// the scroll position and needless layout work).
let lastCountdownHtml = '';
function updateCountdown() {
  const c = settings.countdown;
  if (!c.enabled) return;
  const t = L();
  const html = c.items.length
    ? c.items.map(item => countdownItemHtml(item, Date.now(), t)).join('')
    : `<div class="countdown-state">${esc(t.countdownSet)}</div>`;
  if (html === lastCountdownHtml) return;
  lastCountdownHtml = html;
  const st = $.countdownBody.scrollTop;      // the per-second rebuild would reset scroll otherwise
  $.countdownBody.innerHTML = html;
  $.countdownBody.scrollTop = st;
  scheduleLayout();
}

// ── Countdown list manager (settings) ──────────────────────────────────────────
function formatCountdownWhen(target) {
  return typeof target === 'string' ? target.replace('T', ' ') : '';
}
function renderCountdownList() {
  const items = settings.countdown.items;
  $.countdownCount.textContent = ` ${items.length}/${MAX_COUNTDOWNS}`;
  if (!items.length) {
    $.countdownList.innerHTML = `<div class="feed-empty">${esc(L().noCountdowns)}</div>`;
  } else {
    $.countdownList.innerHTML = items.map((it, i) => {
      const label = it.label || L().countdown;
      const when  = formatCountdownWhen(it.target);
      return `<div class="feed-row"><span title="${esc(label + ' · ' + when)}">${esc(label)} · ${esc(when)}</span>` +
             `<button type="button" title="${esc(L().remove)}" onclick="removeCountdown(${i})">✕</button></div>`;
    }).join('');
  }
  const atLimit = items.length >= MAX_COUNTDOWNS;
  $.setCountdownLabel.disabled  = atLimit;
  $.setCountdownTarget.disabled = atLimit;
  $.countdownAddBtn.disabled    = atLimit;
}
function addCountdown() {
  if (settings.countdown.items.length >= MAX_COUNTDOWNS) return;
  const target = $.setCountdownTarget.value;
  if (!target) { $.setCountdownTarget.focus(); return; }   // a target is required; label is optional
  settings.countdown.items.push({ label: $.setCountdownLabel.value.trim().slice(0, 60), target });
  $.setCountdownLabel.value = '';
  $.setCountdownTarget.value = '';
  save(); renderCountdownList(); applyCountdown();
}
function removeCountdown(i) {
  settings.countdown.items.splice(i, 1);
  save(); renderCountdownList(); applyCountdown();
}
