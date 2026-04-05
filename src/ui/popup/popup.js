/**
 * @module ui/popup/popup.js
 * Popup controller — loads stats/settings, handles mode selection and toggle.
 */

let sessionSaved = 0;
let sessionCount = 0;
let sessionOrigTotal = 0;

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

// Live update when storage changes (e.g. a compression just happened)
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
      // Update bar
      const pct = sessionOrigTotal > 0 ? Math.round((sessionSaved / sessionOrigTotal) * 100) : 0;
      document.getElementById('barWrap').style.display = 'block';
      document.getElementById('barFill').style.width = `${pct}%`;
      document.getElementById('barOrig').textContent = formatNum(sessionOrigTotal);
      document.getElementById('barComp').textContent = formatNum(sessionOrigTotal - sessionSaved);
    }
    render();
  }
});

render();
