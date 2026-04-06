/**
 * @module adapters/gemini
 * Platform adapter for gemini.google.com
 * Gemini uses a Quill-based contenteditable editor.
 * Multi-strategy getText/setText matching claude.js hardening pattern.
 */

export default {
  name: 'Gemini',
  hostMatch: (host) => host.includes('gemini.google.com'),

  getTextarea() {
    const candidates = [
      'rich-textarea div[contenteditable="true"]',
      'div[contenteditable="true"].ql-editor',
      'div[contenteditable="true"][aria-label]',
      'div[contenteditable="true"]',
      'textarea[placeholder]',
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
      'button[aria-label="Submit"]',
      'button.send-button',
      'button[type="submit"]',
    ];
    for (const sel of candidates) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        if (el.offsetParent !== null && !el.disabled) return el;
      }
    }
    return null;
  },

  getText(el) {
    // Strategy 1: Quill paragraph lines
    try {
      const lines = el.querySelectorAll('p, div:not([contenteditable])');
      if (lines.length > 0) {
        const text = Array.from(lines).map(l => l.textContent || '').join('\n').trim();
        if (text) return text;
      }
    } catch (_) {}
    // Strategy 2: innerText / textContent
    return (el.innerText || el.textContent || '').trim();
  },

  setText(el, text) {
    el.focus();
    // Strategy 1: execCommand (works in Quill)
    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
      if ((el.innerText || el.textContent || '').trim() === text.trim()) return true;
    } catch (_) {}
    // Strategy 2: beforeinput event
    try {
      document.execCommand('selectAll', false, null);
      el.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true, cancelable: true,
        inputType: 'insertText', data: text,
      }));
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
      if ((el.innerText || el.textContent || '').trim() === text.trim()) return true;
    } catch (_) {}
    // Strategy 3: direct assignment
    el.innerText = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    return true;
  },

  isReady() {
    return !!this.getTextarea();
  },
};

export function diagnose() {
  console.group('[TokenShrink] Gemini DOM Diagnosis');
  document.querySelectorAll('[contenteditable]').forEach(el => {
    console.log({ tag: el.tagName, class: el.className.slice(0, 40), visible: el.offsetParent !== null });
  });
  console.groupEnd();
}
if (typeof window !== 'undefined') window.__ts_diagnose_gemini = diagnose;
