/**
 * @module ui/popup/popup.js
 * Popup controller — loads stats/settings, handles mode selection and toggle.
 */

let sessionSaved = 0;
let sessionCount = 0;
let sessionOrigTotal = 0;
let sessionBreakdown = { local: 0, groq: 0, anthropic: 0, cache: 0 };

function formatNum(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

async function getMsg(action, extra = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action, ...extra }, resolve);
  });
}

async function render() {
  const [settings, stats] = await Promise.all([
    getMsg('GET_SETTINGS'),
    getMsg('GET_STATS'),
  ]);

  // Master toggle
  const toggle = document.getElementById('masterToggle');
  toggle.checked = settings.enabled !== false;

  // Mode pills
  document.querySelectorAll('.pill').forEach((p) => {
    p.classList.toggle('active', p.dataset.mode === settings.aggressiveness);
  });

  // All-time stats
  document.getElementById('allTimeSaved').textContent = formatNum(stats.totalSaved || 0);

  // Session stats (from local vars)
  document.getElementById('sessionSaved').textContent = formatNum(sessionSaved);
  document.getElementById('compressionCount').textContent = sessionCount;
  const avgPct = sessionOrigTotal > 0 ? Math.round((sessionSaved / sessionOrigTotal) * 100) : 0;
  document.getElementById('avgPct').textContent = `${avgPct}%`;

  // Platform status
  const tabs = await new Promise((r) => chrome.tabs.query({ active: true, currentWindow: true }, r));
  const tab = tabs?.[0];
  const host = tab?.url ? new URL(tab.url).hostname : '';
  const claudeEl = document.getElementById('platform-claude');
  const dot = claudeEl.querySelector('.dot');
  const status = claudeEl.querySelector('.platform-status');

  if (host.includes('claude.ai')) {
    dot.className = 'dot dot-green';
    status.textContent = settings.enabled ? '✓ interceptor active' : '✗ disabled';
    status.className = 'platform-status';
  } else {
    dot.className = 'dot dot-yellow';
    status.textContent = 'not current tab';
    status.className = 'platform-status';
    status.style.color = '#888';
  }
}

function updateBreakdown(lc) {
  const src = lc?.source || 'local';
  if (Object.prototype.hasOwnProperty.call(sessionBreakdown, src)) {
    sessionBreakdown[src]++;
  }
  const total = Object.values(sessionBreakdown).reduce((a, b) => a + b, 0);
  if (total === 0) return;

  const section = document.getElementById('breakdownSection');
  if (section) section.style.display = 'block';

  ['local', 'groq', 'anthropic', 'cache'].forEach((s) => {
    const pct = total > 0 ? (sessionBreakdown[s] / total) * 100 : 0;
    const bar = document.getElementById(`bar-${s}`);
    const cnt = document.getElementById(`count-${s}`);
    if (bar) bar.style.width = `${pct}%`;
    if (cnt) cnt.textContent = sessionBreakdown[s];
  });

  if (sessionBreakdown.cache > 0) {
    const hitRate = Math.round((sessionBreakdown.cache / total) * 100);
    const row = document.getElementById('cacheHitRow');
    const pctEl = document.getElementById('cacheHitPct');
    if (row) row.style.display = 'flex';
    if (pctEl) pctEl.textContent = `${hitRate}%`;
  }

  if (lc?.domain) {
    const row = document.getElementById('domainRow');
    const badge = document.getElementById('lastDomain');
    if (row) row.style.display = 'flex';
    if (badge) badge.textContent = lc.domain;
  }
}

// Breakdown toggle
document.getElementById('breakdownToggle')?.addEventListener('click', () => {
  const body = document.getElementById('breakdownBody');
  const arrow = document.getElementById('breakdownArrow');
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  if (arrow) arrow.textContent = isOpen ? '▸' : '▾';
});

// Event: toggle
document.getElementById('masterToggle').addEventListener('change', async (e) => {
  await getMsg('SAVE_SETTINGS', { settings: { enabled: e.target.checked } });
});

// Event: mode pills
document.querySelectorAll('.pill').forEach((pill) => {
  pill.addEventListener('click', async () => {
    document.querySelectorAll('.pill').forEach((p) => p.classList.remove('active'));
    pill.classList.add('active');
    await getMsg('SAVE_SETTINGS', { settings: { aggressiveness: pill.dataset.mode } });
  });
});

// Event: options link
document.getElementById('optionsLink').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// Live update when storage changes (stats or lastCompression)
chrome.storage.onChanged.addListener((changes) => {
  if (changes.stats) {
    const newStats = changes.stats.newValue || {};
    const oldStats = changes.stats.oldValue || {};
    const delta = (newStats.totalSaved || 0) - (oldStats.totalSaved || 0);
    const deltaOrig = (newStats.totalOriginalTokens || 0) - (oldStats.totalOriginalTokens || 0);
    if (delta > 0) {
      sessionSaved += delta;
      sessionOrigTotal += deltaOrig;
      sessionCount += 1;
      // Update compression ratio bar
      const pct = sessionOrigTotal > 0 ? Math.round((sessionSaved / sessionOrigTotal) * 100) : 0;
      document.getElementById('barWrap').style.display = 'block';
      document.getElementById('barFill').style.width = `${pct}%`;
      document.getElementById('barOrig').textContent = formatNum(sessionOrigTotal);
      document.getElementById('barComp').textContent = formatNum(sessionOrigTotal - sessionSaved);
      // Live update counts without full re-render
      document.getElementById('sessionSaved').textContent = formatNum(sessionSaved);
      document.getElementById('compressionCount').textContent = sessionCount;
      document.getElementById('avgPct').textContent = `${pct}%`;
    }
    render();
  }

  if (changes.lastCompression) {
    const lc = changes.lastCompression.newValue;
    if (!lc) return;
    const badge = document.getElementById('sourceBadge');
    const row = document.getElementById('sourceRow');
    const time = document.getElementById('sourceTime');
    if (badge && row) {
      const src = lc.source || 'local';
      badge.textContent = src;
      badge.className = 'source-badge ' + src;
      if (time) {
        const t = lc.ts ? new Date(lc.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
        time.textContent = lc.savedPct ? `-${lc.savedPct}% · ${t}` : t;
      }
      row.style.display = 'flex';
    }
    updateBreakdown(lc);
  }
});

// Restore source badge from storage on popup open
chrome.storage.local.get('lastCompression', (r) => {
  const lc = r.lastCompression;
  if (!lc) return;
  const badge = document.getElementById('sourceBadge');
  const row = document.getElementById('sourceRow');
  const time = document.getElementById('sourceTime');
  if (badge && row) {
    const src = lc.source || 'local';
    badge.textContent = src;
    badge.className = 'source-badge ' + src;
    if (time) {
      const t = lc.ts ? new Date(lc.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
      time.textContent = lc.savedPct ? `-${lc.savedPct}% · ${t}` : t;
    }
    row.style.display = 'flex';
  }
});

render();
