/**
 * @module ui/toast
 * Injected toast notification — shows token savings after each compression.
 * Supports optional compressedText param: shows a Copy button so user can
 * always retrieve the compressed version even if setText failed.
 */

const SOURCE_COLORS = {
  local:     '#00c864',
  groq:      '#50a0ff',
  anthropic: '#ffb400',
  cache:     '#888888',
  clipboard: '#cc88ff',
};

const SOURCE_ICONS = {
  local:     '⚡',
  groq:      '☁',
  anthropic: '✦',
  cache:     '◈',
  clipboard: '📋',
};

/**
 * Show a toast notification for a compression result.
 *
 * @param {{
 *   source: string,
 *   savedPct: number,
 *   savedTokens: number,
 *   compressedText?: string   // if set, shows a Copy button (clipboard fallback mode)
 * }} options
 */
export function showToast({ source, savedPct, savedTokens, compressedText }) {
  document.getElementById('ts-toast')?.remove();

  const color = SOURCE_COLORS[source] || '#00ff8c';
  const icon  = SOURCE_ICONS[source]  || '✓';
  const label = (source || 'local').toUpperCase();
  const hasCopy = !!compressedText;

  const toast = document.createElement('div');
  toast.id = 'ts-toast';

  if (hasCopy) {
    // Clipboard fallback mode — setText couldn't write, show Copy button instead
    toast.innerHTML = `
      <span style="color:${color};font-weight:700;letter-spacing:0.06em">${icon} ${label}</span>
      <span style="color:#333;margin:0 8px;font-size:14px">·</span>
      <span style="color:#e0e0e0">-${savedPct || 0}%</span>
      <span style="color:#444;font-size:10px;margin-left:5px">setText failed —</span>
      <button id="ts-copy-btn" style="
        margin-left:8px;padding:2px 8px;font-size:10px;
        background:#1a1a1a;color:${color};border:1px solid ${color}55;
        border-radius:3px;cursor:pointer;font-family:monospace;
        transition:background 0.15s;
      ">Copy compressed</button>
    `;
  } else {
    toast.innerHTML = `
      <span style="color:${color};font-weight:700;letter-spacing:0.06em">${icon} ${label}</span>
      <span style="color:#333;margin:0 8px;font-size:14px">·</span>
      <span style="color:#e0e0e0">-${savedPct || 0}%</span>
      <span style="color:#444;font-size:10px;margin-left:5px">(-${savedTokens || 0} tokens)</span>
    `;
  }

  Object.assign(toast.style, {
    position:   'fixed',
    bottom:     '20px',
    right:      '20px',
    background: '#111111',
    border:     `1px solid ${color}33`,
    borderLeft: `3px solid ${color}`,
    borderRadius: '4px',
    padding:    '8px 14px',
    fontFamily: "'JetBrains Mono', 'Courier New', monospace",
    fontSize:   '11px',
    zIndex:     '2147483647',
    display:    'flex',
    alignItems: 'center',
    gap:        '2px',
    boxShadow:  '0 4px 24px rgba(0,0,0,0.6)',
    opacity:    '0',
    transform:  'translateY(10px)',
    transition: 'opacity 0.2s ease, transform 0.2s ease',
    pointerEvents: hasCopy ? 'auto' : 'none',
    userSelect: 'none',
    lineHeight: '1.4',
  });

  document.body.appendChild(toast);

  if (hasCopy) {
    const copyBtn = document.getElementById('ts-copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(compressedText);
          copyBtn.textContent = '✓ Copied!';
          copyBtn.style.color = '#00ff8c';
          setTimeout(() => toast?.remove(), 1500);
        } catch (_) {
          copyBtn.textContent = 'Failed';
        }
      });
    }
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });
  });

  const timeout = hasCopy ? 8000 : 3000; // longer timeout when copy button shown
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(4px)';
    setTimeout(() => toast?.remove(), 300);
  }, timeout);
}
