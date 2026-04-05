/**
 * @module ui/options/options.js
 * Options page controller — loads/saves settings, API key management, stats.
 */

function msg(action, extra = {}) {
  return new Promise((r) => chrome.runtime.sendMessage({ action, ...extra }, r));
}

function formatNum(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function estimateTokens(text) {
  // Quick offline estimate (same as tokenCounter.js but inline for options page)
  if (!text) return 0;
  const codeBlocks = (text.match(/```[\s\S]*?```|`[^`\n]+`/g) || []);
  let remaining = text;
  let tokens = 0;
  codeBlocks.forEach(b => { tokens += Math.ceil(b.length / 3); remaining = remaining.replace(b, ''); });
  tokens += Math.ceil(remaining.length / 4);
  return Math.max(1, tokens);
}

async function init() {
  const [settings, stats] = await Promise.all([msg('GET_SETTINGS'), msg('GET_STATS')]);

  // API Key
  document.getElementById('apiKey').value = settings.apiKey || '';

  // Toggles
  document.getElementById('masterEnabled').checked = settings.enabled !== false;
  document.getElementById('showIndicator').checked = settings.showIndicator !== false;
  document.getElementById('showToast').checked = settings.showToast !== false;

  // Mode
  document.querySelectorAll('.mode-pills .pill').forEach((p) => {
    p.classList.toggle('active', p.dataset.mode === settings.aggressiveness);
  });

  // Advanced
  document.getElementById('customPrompt').value = settings.customSystemPrompt || '';
  document.getElementById('modelSelect').value = settings.model || 'claude-haiku-4-5-20251001';
  const timeout = settings.timeoutMs || 8000;
  document.getElementById('timeoutSlider').value = timeout;
  document.getElementById('timeoutVal').textContent = `${timeout / 1000}s`;

  // Stats
  renderStats(stats);
}

function renderStats(stats) {
  document.getElementById('statTotal').textContent = formatNum(stats.totalSaved || 0);
  document.getElementById('statCount').textContent = stats.compressionCount || 0;
  const avg = stats.totalOriginalTokens > 0
    ? Math.round((stats.totalSaved / stats.totalOriginalTokens) * 100)
    : 0;
  document.getElementById('statAvg').textContent = `${avg}%`;
}

function collectSettings() {
  const mode = document.querySelector('.mode-pills .pill.active')?.dataset.mode || 'balanced';
  return {
    apiKey: document.getElementById('apiKey').value.trim(),
    enabled: document.getElementById('masterEnabled').checked,
    showIndicator: document.getElementById('showIndicator').checked,
    showToast: document.getElementById('showToast').checked,
    aggressiveness: mode,
    customSystemPrompt: document.getElementById('customPrompt').value.trim(),
    model: document.getElementById('modelSelect').value,
    timeoutMs: parseInt(document.getElementById('timeoutSlider').value, 10),
    platforms: document.getElementById('platform-claude').checked ? ['claude.ai'] : [],
  };
}

// Show/hide key
document.getElementById('showHideKey').addEventListener('click', () => {
  const inp = document.getElementById('apiKey');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});

// Test connection
document.getElementById('testConnection').addEventListener('click', async () => {
  const res = document.getElementById('testResult');
  // Save key first so background can use it
  await msg('SAVE_SETTINGS', { settings: { apiKey: document.getElementById('apiKey').value.trim() } });
  res.textContent = 'Testing...';
  res.className = 'test-result';
  const result = await msg('TEST_CONNECTION');
  if (result?.ok) {
    res.textContent = `✓ Connected — ${result.latencyMs}ms`;
    res.className = 'test-result ok';
  } else {
    res.textContent = `✗ ${result?.error || 'Connection failed'}`;
    res.className = 'test-result err';
  }
});

// Mode pills
document.querySelectorAll('.mode-pills .pill').forEach((pill) => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.mode-pills .pill').forEach((p) => p.classList.remove('active'));
    pill.classList.add('active');
  });
});

// Timeout slider
document.getElementById('timeoutSlider').addEventListener('input', (e) => {
  document.getElementById('timeoutVal').textContent = `${parseInt(e.target.value) / 1000}s`;
});

// Live preview token count
document.getElementById('previewInput').addEventListener('input', (e) => {
  const t = e.target.value;
  const tokens = estimateTokens(t);
  document.getElementById('previewStats').textContent =
    t ? `~${tokens} tokens (est.)` : '';
});

// Save
document.getElementById('saveBtn').addEventListener('click', async () => {
  const settings = collectSettings();
  await msg('SAVE_SETTINGS', { settings });
  const status = document.getElementById('saveStatus');
  status.textContent = '✓ Saved';
  setTimeout(() => { status.textContent = ''; }, 2000);
});

// Reset stats
document.getElementById('resetStats').addEventListener('click', async () => {
  if (!confirm('Reset all-time statistics? This cannot be undone.')) return;
  await new Promise((r) => chrome.storage.local.set({ stats: { totalOriginalTokens: 0, totalCompressedTokens: 0, totalSaved: 0, compressionCount: 0 } }, r));
  renderStats({ totalSaved: 0, compressionCount: 0, totalOriginalTokens: 0 });
});

// Export stats
document.getElementById('exportStats').addEventListener('click', async () => {
  const stats = await msg('GET_STATS');
  const blob = new Blob([JSON.stringify(stats, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tokenshrink-stats-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

init();
