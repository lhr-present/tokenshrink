/**
 * @module adapters/claude
 * Hardened platform adapter for claude.ai.
 * 9 selector strategies + SVG heuristic fallback.
 * Exposes window.__ts_diagnose() for DevTools debugging.
 */

export default {
  name: 'Claude',

  hostMatch: (host) => host.includes('claude.ai'),

  getTextarea() {
    // Ordered by recency — most-likely-current first. Each must be visible.
    const candidates = [
      'div[contenteditable="true"][data-testid="chat-input"]',
      'div[contenteditable="true"].ProseMirror',
      'div[contenteditable="true"][data-placeholder]',
      'div[contenteditable="true"][aria-label]',
      'div[contenteditable="true"][role="textbox"]',
      'main div[contenteditable="true"]',
      '[role="main"] div[contenteditable="true"]',
      'form div[contenteditable="true"]',
      'div[contenteditable="true"]',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }
    return null;
  },

  getSendButton() {
    const candidates = [
      'button[aria-label="Send message"]',
      'button[data-testid="send-button"]',
      'button[aria-label="Send"]',
      'button[type="submit"]',
    ];
    for (const sel of candidates) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        if (el.offsetParent !== null && !el.disabled) return el;
      }
    }
    // SVG heuristic: find visible non-disabled button containing SVG near the input
    const textarea = this.getTextarea();
    if (textarea) {
      const container = textarea.closest('form, [role="main"], main, div[class]');
      if (container) {
        const btns = container.querySelectorAll('button');
        for (const btn of btns) {
          if (btn.offsetParent !== null && !btn.disabled && btn.querySelector('svg')) {
            return btn;
          }
        }
      }
    }
    return null;
  },

  getText(el) {
    return (el.innerText || el.textContent || '').trim();
  },

  setText(el, text) {
    el.focus();

    // Strategy 1: execCommand (standard contenteditable)
    try {
      document.execCommand('selectAll', false, null);
      const ok = document.execCommand('insertText', false, text);
      if (ok && (el.innerText || el.textContent || '').trim() === text.trim()) return true;
    } catch (_) {}

    // Strategy 2: React fiber / controlled element — native setter override
    try {
      const proto = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
      if (proto?.set) {
        proto.set.call(el, text);
      } else {
        el.innerText = text;
      }
      el.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: true, inputType: 'insertText', data: text,
      }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch (_) {}

    // Strategy 3: textContent + synthetic event (last resort)
    el.textContent = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    return true;
  },

  isReady() {
    return !!this.getTextarea();
  },
};

// ── Diagnostics ────────────────────────────────────────────────────────────────
// Run window.__ts_diagnose() in DevTools console to debug selector misses.

export function diagnose() {
  const report = {
    url: window.location.href,
    textarea: 'NOT FOUND',
    sendButton: 'NOT FOUND',
    allContenteditables: [],
    allVisibleButtons: [],
    verdict: '',
  };

  document.querySelectorAll('[contenteditable]').forEach((el) => {
    report.allContenteditables.push({
      tag: el.tagName,
      testid: el.dataset.testid || null,
      placeholder: el.getAttribute('data-placeholder')?.slice(0, 40) || null,
      ariaLabel: el.getAttribute('aria-label') || null,
      role: el.getAttribute('role') || null,
      classes: [...el.classList].slice(0, 5).join(' ') || null,
      visible: el.offsetParent !== null,
    });
  });

  document.querySelectorAll('button').forEach((el) => {
    if (el.offsetParent !== null) {
      report.allVisibleButtons.push({
        testid: el.dataset.testid || null,
        ariaLabel: el.getAttribute('aria-label') || null,
        type: el.type || null,
        disabled: el.disabled,
        hasSvg: !!el.querySelector('svg'),
        text: (el.innerText || '').slice(0, 20) || null,
      });
    }
  });

  // Check primary selectors
  const ta = document.querySelector(
    'div[contenteditable="true"][data-testid="chat-input"], ' +
    'div[contenteditable="true"].ProseMirror, ' +
    'div[contenteditable="true"]'
  );
  if (ta && ta.offsetParent) report.textarea = 'FOUND';

  const btn = document.querySelector(
    'button[aria-label="Send message"], button[data-testid="send-button"], button[type="submit"]'
  );
  if (btn && btn.offsetParent && !btn.disabled) report.sendButton = 'FOUND';

  report.verdict =
    report.textarea !== 'NOT FOUND' && report.sendButton !== 'NOT FOUND'
      ? '✓ Adapter should work'
      : report.textarea === 'NOT FOUND'
      ? '✗ Textarea not found — DOM changed. Check allContenteditables above.'
      : '✗ Send button not found — check allVisibleButtons above.';

  console.group('[TokenShrink] DOM Diagnosis');
  console.log('Verdict:', report.verdict);
  console.log('URL:', report.url);
  console.table(report.allContenteditables);
  console.table(report.allVisibleButtons);
  console.groupEnd();
  return report;
}

if (typeof window !== 'undefined') {
  window.__ts_diagnose = diagnose;
}
