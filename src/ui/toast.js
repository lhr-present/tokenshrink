/**
 * @module ui/toast
 * Injected toast notification — shows token savings after each compression.
 * Self-contained: injects its own styles, removes itself after timeout.
 * No external dependencies, no class names that clash with host page.
 */

const SOURCE_COLORS = {
  local: '#00c864',
  groq: '#50a0ff',
  anthropic: '#ffb400',
  cache: '#888888',
};

const SOURCE_ICONS = {
  local: '⚡',
  groq: '☁',
  anthropic: '✦',
  cache: '◈',
};

/**
 * Show a toast notification for a compression result.
 * @param {{ source: string, savedPct: number, savedTokens: number }} options
 */
export function showToast({ source, savedPct, savedTokens }) {
  // Remove any existing toast
  document.getElementById('ts-toast')?.remove();

  const color = SOURCE_COLORS[source] || '#00ff8c';
  const icon = SOURCE_ICONS[source] || '✓';
  const label = (source || 'local').toUpperCase();

  const toast = document.createElement('div');
  toast.id = 'ts-toast';
  toast.innerHTML = `
    <span style="color:${color};font-weight:700;letter-spacing:0.06em">${icon} ${label}</span>
    <span style="color:#333;margin:0 8px;font-size:14px">·</span>
    <span style="color:#e0e0e0">-${savedPct || 0}%</span>
    <span style="color:#444;font-size:10px;margin-left:5px">(-${savedTokens || 0} tokens)</span>
  `;

  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    background: '#111111',
    border: `1px solid ${color}33`,
    borderLeft: `3px solid ${color}`,
    borderRadius: '4px',
    padding: '8px 14px',
    fontFamily: "'JetBrains Mono', 'Courier New', monospace",
    fontSize: '11px',
    zIndex: '2147483647',
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
    opacity: '0',
    transform: 'translateY(10px)',
    transition: 'opacity 0.2s ease, transform 0.2s ease',
    pointerEvents: 'none',
    userSelect: 'none',
    lineHeight: '1.4',
  });

  document.body.appendChild(toast);

  // Double rAF ensures the initial opacity:0 is painted before transitioning
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });
  });

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(4px)';
    setTimeout(() => toast?.remove(), 300);
  }, 3000);
}
