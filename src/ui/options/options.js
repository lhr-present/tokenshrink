/**
 * @module ui/options/options.js
 * Options page controller — loads/saves settings, API key + Groq key, backend selector, stats.
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
  if (!text) return 0;
  const codeBlocks = (text.match(/```[\s\S]*?```|`[^`\n]+`/g) || []);
  let remaining = text;
  let tokens = 0;
  codeBlocks.forEach(b => { tokens += Math.ceil(b.length / 3); remaining = remaining.replace(b, ''); });
  tokens += Math.ceil(remaining.length / 4);
  return Math.max(1, tokens);
}

function updateGroqKeyVisibility(backend) {
  const group = document.getElementById('groqKeyGroup');
  if (group) group.style.display = (backend === 'local' || backend === 'anthropic') ? 'none' : 'block';
}

async function init() {
  const [settings, stats] = await Promise.all([msg('GET_SETTINGS'), msg('GET_STATS')]);

  // API Key
  document.getElementById('apiKey').value = settings.apiKey || '';

  // Groq Key
  document.getElementById('groqApiKey').value = settings.groqApiKey || '';

  // Backend radio
  const backend = settings.backend || 'auto';
  const backendRadio = document.querySelector(`input[name="backend"][value="${backend}"]`);
  if (backendRadio) backendRadio.checked = true;
  updateGroqKeyVisibility(backend);

  // Toggles
  document.getElementById('masterEnabled').checked = settings.enabled !== false;
  document.getElementById('showIndicator').checked = settings.showIndicator !== false;
  document.getElementById('showToast').checked = settings.showToast !== false;
  document.getElementById('cacheEnabled').checked = settings.cacheEnabled !== false;

  // Mode pills
  document.querySelectorAll('.mode-pills .pill').forEach((p) => {
    p.classList.toggle('active', p.dataset.mode === settings.aggressiveness);
  });

  // Local threshold
  const threshold = settings.localThreshold ?? 20;
  document.getElementById('localThreshold').value = threshold;
  document.getElementById('thresholdVal').textContent = threshold;

  // Advanced
  document.getElementById('customPrompt').value = settings.customSystemPrompt || '';
  document.getElementById('modelSelect').value = settings.model || 'claude-haiku-4-5-20251001';
  const timeout = settings.timeoutMs || 8000;
  document.getElementById('timeoutSlider').value = timeout;
  document.getElementById('timeoutVal').textContent = `${timeout / 1000}s`;

  renderStats(stats);
}

function renderStats(stats) {
  document.getElementById('statTotal').textContent = formatNum(stats.totalSaved || 0);
  document.getElementById('statCount').textContent = stats.compressionCount || 0;
  const avg = stats.totalOriginalTokens > 0
    ? Math.round((stats.totalSaved / stats.totalOriginalTokens) * 100)
    : 0;
  document.getElementById('statAvg').textContent = `${avg}%`;
  const cacheEl = document.getElementById('cacheEntries');
  if (cacheEl) cacheEl.textContent = stats.cacheEntries ?? '—';
}

function collectSettings() {
  const mode = document.querySelector('.mode-pills .pill.active')?.dataset.mode || 'balanced';
  const backend = document.querySelector('input[name="backend"]:checked')?.value || 'auto';
  return {
    apiKey: document.getElementById('apiKey').value.trim(),
    groqApiKey: document.getElementById('groqApiKey').value.trim(),
    enabled: document.getElementById('masterEnabled').checked,
    showIndicator: document.getElementById('showIndicator').checked,
    showToast: document.getElementById('showToast').checked,
    cacheEnabled: document.getElementById('cacheEnabled').checked,
    aggressiveness: mode,
    backend,
    localThreshold: parseInt(document.getElementById('localThreshold').value, 10),
    customSystemPrompt: document.getElementById('customPrompt').value.trim(),
    model: document.getElementById('modelSelect').value,
    timeoutMs: parseInt(document.getElementById('timeoutSlider').value, 10),
    platforms: [
      document.getElementById('platform-claude')?.checked     && 'claude.ai',
      document.getElementById('platform-chatgpt')?.checked    && 'chatgpt.com',
      document.getElementById('platform-gemini')?.checked     && 'gemini.google.com',
      document.getElementById('platform-perplexity')?.checked && 'perplexity.ai',
    ].filter(Boolean),
  };
}

// Show/hide Anthropic key
document.getElementById('showHideKey').addEventListener('click', () => {
  const inp = document.getElementById('apiKey');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});

// Show/hide Groq key
document.getElementById('showHideGroqKey').addEventListener('click', () => {
  const inp = document.getElementById('groqApiKey');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});

// Test Anthropic connection
document.getElementById('testConnection').addEventListener('click', async () => {
  const res = document.getElementById('testResult');
  await msg('SAVE_SETTINGS', { settings: { apiKey: document.getElementById('apiKey').value.trim() } });
  res.textContent = 'Testing...';
  res.className = 'test-result';
  const result = await msg('TEST_CONNECTION', { backend: 'anthropic' });
  if (result?.ok) {
    res.textContent = `✓ Connected via ${result.source || 'anthropic'} — ${result.latencyMs}ms`;
    res.className = 'test-result ok';
  } else {
    res.textContent = `✗ ${result?.error || 'Connection failed'}`;
    res.className = 'test-result err';
  }
});

// Test Groq connection
document.getElementById('testGroqConnection').addEventListener('click', async () => {
  const res = document.getElementById('groqTestResult');
  await msg('SAVE_SETTINGS', { settings: { groqApiKey: document.getElementById('groqApiKey').value.trim() } });
  res.textContent = 'Testing...';
  res.className = 'test-result';
  const result = await msg('TEST_CONNECTION', { backend: 'groq' });
  if (result?.ok) {
    res.textContent = `✓ Groq connected — ${result.latencyMs}ms`;
    res.className = 'test-result ok';
  } else {
    res.textContent = `✗ ${result?.error || 'Groq connection failed'}`;
    res.className = 'test-result err';
  }
});

// Backend radio change — show/hide Groq key field
document.querySelectorAll('input[name="backend"]').forEach((radio) => {
  radio.addEventListener('change', () => updateGroqKeyVisibility(radio.value));
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

// Local threshold slider
document.getElementById('localThreshold').addEventListener('input', (e) => {
  document.getElementById('thresholdVal').textContent = e.target.value;
});

// Live preview token count
document.getElementById('previewInput').addEventListener('input', (e) => {
  const t = e.target.value;
  const tokens = estimateTokens(t);
  document.getElementById('previewStats').textContent = t ? `~${tokens} tokens (est.)` : '';
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
  await new Promise((r) => chrome.storage.local.set({
    stats: { totalOriginalTokens: 0, totalCompressedTokens: 0, totalSaved: 0, compressionCount: 0 }
  }, r));
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
