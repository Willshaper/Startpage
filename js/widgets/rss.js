// Startpage: RSS feed widget: fetch, cache, highlight/blacklist, feed list in settings.
// Classic script sharing globals with the others; load order is set in index.html.

// ── RSS feed ──────────────────────────────────────────────────────────────────
const RSS_REFRESH_MS = 15 * 60 * 1000;  // 15 min
const RSS_MAX_ITEMS  = 50;
const FEED_CACHE_KEY = 'startpage_feedcache';   // last good items, shown until a fresh fetch lands
let rssTimer = null;
let rssLastSig = '';     // signature of the URL set last fetched (avoids needless refetch)
let rssUrlDebounce = null;
let rssHighlightDebounce = null;
let rssBlacklistDebounce = null;
let lastFeedItems = [];  // last rendered items, so a highlight-only change can re-style without refetching
let feedUpdatedAt = 0;   // timestamp of the last SUCCESSFUL fetch (persisted in the cache)

// Signature of the current feed set (url + keyword filter). Highlight is not part
// of it — highlighting is visual-only and never triggers a refetch.
function feedSig() { return settings.rss.urls.map(f => f.url + '|' + f.filter).join('||'); }
// Persist the last good items so the feed shows instantly on the next load and
// survives a failed fetch. Keyed by feed signature so a cache from a different
// feed set is ignored.
function loadFeedCache() {
  try {
    const c = JSON.parse(localStorage.getItem(FEED_CACHE_KEY) || 'null');
    if (c && c.sig === feedSig() && Array.isArray(c.items) && c.items.length) {
      feedUpdatedAt = typeof c.fetchedAt === 'number' ? c.fetchedAt : 0;  // so "last updated" survives reloads
      return c.items;
    }
  } catch {}
  return null;
}
function saveFeedCache(items) {
  feedUpdatedAt = Date.now();
  try {
    localStorage.setItem(FEED_CACHE_KEY, JSON.stringify({
      sig: feedSig(),
      fetchedAt: feedUpdatedAt,
      items: items.map(it => ({ title: it.title, link: it.link, ts: it.ts })),
    }));
  } catch {}
  renderFeedUpdated();
}
// Relative "time since last successful update" shown between the Feed label and refresh.
function renderFeedUpdated() {
  if (!$.rssUpdated) return;
  if (!feedUpdatedAt || !settings.rss.enabled || !settings.rss.urls.length) { $.rssUpdated.textContent = ''; $.rssUpdated.title = ''; return; }
  $.rssUpdated.textContent = relShort(Date.now() - feedUpdatedAt);
  $.rssUpdated.title = L().feedUpdatedTitle + ' ' + new Date(feedUpdatedAt).toLocaleString();
}
// Compact elapsed time: "now" / "5m" / "3h" / "2d"
function relShort(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? L().feedJustNow
       : s < 3600 ? Math.floor(s / 60) + 'm'
       : s < 86400 ? Math.floor(s / 3600) + 'h'
       : Math.floor(s / 86400) + 'd';
}

function applyRss() {
  const r = settings.rss;
  // strip any previous position class, then re-apply
  ALL_POSITIONS.forEach(p => $.rssPanel.classList.remove('pos-' + p));
  $.rssPanel.classList.add('pos-' + (ALL_POSITIONS.includes(r.position) ? r.position : 'mr'));
  if (rssTimer) { clearInterval(rssTimer); rssTimer = null; }
  if (r.enabled) {
    $.rssPanel.classList.add('show');
    if (r.urls.length) {
      // Show last-known items instantly (from cache) while the fresh fetch runs
      if (!$.rssList.querySelector('.rss-item')) {
        const cached = loadFeedCache();
        if (cached) renderFeed(cached);
        else feedUpdatedAt = 0;   // new/unknown feed set: no successful update yet
      }
      if (feedSig() !== rssLastSig) fetchFeed();
      rssTimer = setInterval(fetchFeed, RSS_REFRESH_MS);
    } else {
      showRssState('feedEmpty');
    }
  } else {
    $.rssPanel.classList.remove('show');
  }
  renderFeedUpdated();
  scheduleLayout();
}

function showRssState(key) {
  $.rssList.innerHTML = `<div class="rss-state">${esc(L()[key] || '')}</div>`;
  scheduleLayout();
}

// Feed sources: an RSS-to-JSON service and two CORS proxies. Free proxies are flaky
// (especially against rate-limited sites like Reddit), so every feed is fetched
// through all of them and the results are merged (see fetchOneFeed).
const FEED_FETCHERS = [
  // 1) RSS2JSON: dedicated RSS-to-JSON service, the most reliable for RSS (10k req/day free)
  {
    name: 'rss2json',
    url:  u => `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(u)}`,
    parse: async res => {
      const data = await res.json();
      if (!data || data.status !== 'ok' || !Array.isArray(data.items)) throw new Error('bad rss2json');
      return data.items
        .map(i => ({ title: (i.title || '').trim(), link: safeHttpLink(i.link), ts: Date.parse(i.pubDate || '') || 0 }))
        .filter(it => it.title && it.link);
    },
  },
  // 2) AllOrigins: generic CORS proxy returning JSON-wrapped raw content
  {
    name: 'allorigins',
    url:  u => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
    parse: async res => {
      const data = await res.json();
      if (!data || !data.contents) throw new Error('empty allorigins');
      return parseFeedXml(data.contents);
    },
  },
  // 3) corsproxy.io: streams raw response directly (no JSON wrapping)
  {
    name: 'corsproxy',
    url:  u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    parse: async res => {
      const text = await res.text();
      if (!text) throw new Error('empty corsproxy');
      return parseFeedXml(text);
    },
  },
];

// Query every source in parallel and merge their items, deduped by link. A single
// stale source can no longer hide fresher items — e.g. rss2json serves a cached copy
// of rate-limited feeds like Reddit (hours old), while corsproxy returns the current
// feed; merging surfaces the fresh items from whichever source has them. `no-store`
// also bypasses the browser HTTP cache. Returns [] only if every source fails.
async function fetchOneFeed(url) {
  const perSource = await Promise.all(FEED_FETCHERS.map(async f => {
    try {
      const res = await fetch(f.url(url), { cache: 'no-store' });
      if (!res.ok) return [];
      return await f.parse(res);
    } catch { return []; }
  }));
  const seen = new Set(), out = [];
  for (const items of perSource) for (const it of items) {
    if (!seen.has(it.link)) { seen.add(it.link); out.push(it); }
  }
  return out;
}

// Fetch every configured feed, combine, sort newest-first, show the last RSS_MAX_ITEMS overall
async function fetchFeed() {
  const feeds = settings.rss.urls;
  if (!feeds.length) { showRssState('feedEmpty'); return; }
  const sig = feedSig();
  rssLastSig = sig;
  // Only show "Loading…" when nothing is on screen yet; otherwise keep the current
  // (cached or previous) items visible until the fresh set arrives.
  if (!$.rssList.querySelector('.rss-item')) showRssState('feedLoading');
  let rawTotal = 0;  // track items before filtering to distinguish "no results" from "fetch failed"
  const results = await Promise.all(feeds.map(f => fetchOneFeed(f.url).then(items => {
    rawTotal += items.length;
    const keywords = f.filter.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    if (!keywords.length) return items;
    return items.filter(it => {
      const title = it.title.toLowerCase();
      return keywords.some(k => title.includes(k));
    });
  })));
  if (feedSig() !== sig) return;  // feed set changed mid-flight, abandon
  // Merge all items, deduping by link (handles cross-posts + accidental duplicate URLs)
  const seen = new Set();
  const all  = [];
  results.forEach(items => items.forEach(it => {
    if (!seen.has(it.link)) { seen.add(it.link); all.push(it); }
  }));
  if (!all.length) {
    // Fresh data that all got filtered out → say so. But a plain fetch failure
    // leaves any cached/previous items on screen rather than replacing them.
    if (rawTotal > 0) showRssState('feedFiltered');
    else if (!$.rssList.querySelector('.rss-item')) showRssState('feedError');
    return;
  }
  all.sort((a, b) => (b.ts || 0) - (a.ts || 0));   // newest first; undated items fall to the end
  const top = all.slice(0, RSS_MAX_ITEMS);
  renderFeed(top);
  saveFeedCache(top);   // remember this good set for the next load / a failed fetch
}

function parseFeedXml(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) return [];
  const out = [];
  // RSS 2.0 / 1.0
  doc.querySelectorAll('item').forEach(node => {
    const title = (node.querySelector('title')?.textContent || '').trim();
    const link  = safeHttpLink(node.querySelector('link')?.textContent);
    const date  = node.querySelector('pubDate')?.textContent || '';
    if (title && link) out.push({ title, link, ts: Date.parse(date) || 0 });
  });
  // Atom — only fall back to entries if no RSS items were found
  if (!out.length) {
    doc.querySelectorAll('entry').forEach(node => {
      const title  = (node.querySelector('title')?.textContent || '').trim();
      const links  = Array.from(node.querySelectorAll('link'));
      const altLnk = links.find(l => (l.getAttribute('rel') || 'alternate') === 'alternate') || links[0];
      const link   = safeHttpLink(altLnk ? altLnk.getAttribute('href') : '');
      const date   = node.querySelector('updated')?.textContent || node.querySelector('published')?.textContent || '';
      if (title && link) out.push({ title, link, ts: Date.parse(date) || 0 });
    });
  }
  return out;
}

// Global "highlight" filter: a title is flagged when one of the comma-separated
// phrases occurs as a whole token (not flanked by letters/digits) — so "Episode 1"
// matches "…Episode 1" but not "…Episode 10" or "…Episode 19". Case-insensitive.
function highlightPhrases(src = settings.rss.highlight) {
  return src.split(',').map(p => p.trim().toLowerCase()).filter(Boolean);
}
function titleIsHighlighted(title, phrases) {
  if (!phrases.length) return false;
  const lt = title.toLowerCase();
  const word = c => (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
  return phrases.some(p => {
    let idx = lt.indexOf(p);
    while (idx !== -1) {
      const before = idx > 0 ? lt[idx - 1] : '';
      const after  = lt[idx + p.length] || '';
      if (!word(before) && !word(after)) return true;   // token boundary on both sides
      idx = lt.indexOf(p, idx + 1);
    }
    return false;
  });
}
// Global blacklist: comma-separated words; a title is hidden when it contains any
// of them as a substring (case-insensitive), matching the per-feed whitelist.
function blacklistWords() {
  return settings.rss.blacklist.split(',').map(w => w.trim().toLowerCase()).filter(Boolean);
}
function renderFeed(items) {
  lastFeedItems = items;   // full set (pre-blacklist) so a highlight/blacklist change can re-run without refetching
  const bl = blacklistWords();
  const shown = bl.length ? items.filter(it => { const t = it.title.toLowerCase(); return !bl.some(w => t.includes(w)); }) : items;
  if (!shown.length) { showRssState('feedFiltered'); renderFeedUpdated(); return; }
  const target  = settings.newTab ? ' target="_blank" rel="noopener"' : '';
  const phrases = highlightPhrases();
  $.rssList.innerHTML = shown.map(it => {
    const hl = titleIsHighlighted(it.title, phrases) ? ' rss-item--hl' : '';
    return `<a class="rss-item${hl}" href="${esc(it.link)}"${target}>${esc(it.title)}</a>`;
  }).join('');
  renderFeedUpdated();
  scheduleLayout();   // feed height changed — re-fit the column
}

// ── Feed list manager (settings) ──────────────────────────────────────────────
function renderFeedList() {
  const feeds = settings.rss.urls;
  $.feedCount.textContent = ` ${feeds.length}/${MAX_FEEDS}`;
  if (!feeds.length) {
    $.feedList.innerHTML = `<div class="feed-empty" data-i18n="noFeeds">${esc(L().noFeeds)}</div>`;
  } else {
    $.feedList.innerHTML = feeds.map((f, i) =>
      `<div class="feed-row feed-row--stacked">` +
      `<div class="feed-row-top"><span title="${esc(f.url)}">${esc(f.url)}</span>` +
      `<button type="button" title="${esc(L().remove)}" onclick="removeFeed(${i})">✕</button></div>` +
      `<input class="feed-filter-input" type="text" placeholder="${esc(L().filterPlaceholder)}" value="${esc(f.filter)}" oninput="updateFeedFilter(${i}, this.value)">` +
      `</div>`
    ).join('');
  }
  const atLimit = feeds.length >= MAX_FEEDS;
  $.setRssUrl.disabled = atLimit;
  $.feedAddBtn.disabled = atLimit;
}
function addFeed() {
  const url = $.setRssUrl.value.trim();
  if (!url || settings.rss.urls.length >= MAX_FEEDS) return;
  if (settings.rss.urls.some(f => f.url === url)) { $.setRssUrl.value = ''; return; }  // already added
  settings.rss.urls.push({ url, filter: '' });
  $.setRssUrl.value = '';
  save(); renderFeedList(); applyRss();
}
function removeFeed(i) {
  settings.rss.urls.splice(i, 1);
  save(); renderFeedList(); applyRss();
}
function updateFeedFilter(i, value) {
  if (!settings.rss.urls[i]) return;
  settings.rss.urls[i].filter = value;  // store as-typed; trimming happens at match time
  save();
  rssLastSig = '';  // force refetch with new filter (after save)
  clearTimeout(rssUrlDebounce);
  rssUrlDebounce = setTimeout(() => { fetchFeed(); }, 600);
}

// Refresh button (manual reload, with a 360° spin for feedback)
$.rssRefresh.addEventListener('click', () => {
  if (!settings.rss.urls.length) return;
  $.rssRefresh.classList.remove('spin');
  void $.rssRefresh.offsetWidth;  // restart the transition
  $.rssRefresh.classList.add('spin');
  rssLastSig = '';  // force fetch even if the URL set is unchanged
  fetchFeed();
});
