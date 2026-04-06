/**
 * @module adapters/perplexity
 * Platform adapter for perplexity.ai
 * Perplexity uses a plain <textarea> — React-controlled via native value setter.
 */

export default {
  name: 'Perplexity',
  hostMatch: (host) => host.includes('perplexity.ai'),

  getTextarea() {
    const candidates = [
      'textarea[placeholder*="Ask"]',
      'textarea[data-testid]',
      'div[contenteditable="true"]',
      'textarea',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }
    return null;
  },

  getSendButton() {
    const candidates = [
      'button[aria-label="Submit"]',
      'button[data-testid="submit-button"]',
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
    if (el.tagName === 'TEXTAREA') return el.value.trim();
    return (el.innerText || el.textContent || '').trim();
  },

  setText(el, text) {
    el.focus();
    if (el.tagName === 'TEXTAREA') {
      // React-compatible: use native value setter to bypass synthetic event system
      const nativeSet = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      )?.set;
      if (nativeSet) {
        nativeSet.call(el, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    // contenteditable fallback
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, text);
    return true;
  },

  isReady() {
    return !!this.getTextarea();
  },
};
