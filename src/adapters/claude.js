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
    // Strategy 1: ProseMirror EditorView internal state — reads true content
    // regardless of DOM update timing (bypasses async transaction lag)
    try {
      let node = el;
      for (let i = 0; i < 5; i++) {
        const keys = Object.keys(node);
        for (const key of keys) {
          try {
            const val = node[key];
            // ProseMirror EditorView: .state.doc.textContent
            if (val?.state?.doc?.textContent !== undefined) {
              const text = val.state.doc.textContent;
              if (text && text.trim().length > 0) return text.trim();
            }
            // React fiber path: memoizedProps.editorState.doc.textContent
            if (val?.memoizedProps?.editorState?.doc?.textContent !== undefined) {
              return val.memoizedProps.editorState.doc.textContent.trim();
            }
          } catch (_) {}
        }
        node = node.parentElement;
        if (!node) break;
      }
    } catch (_) {}

    // Strategy 2: Read all <p> nodes — handles paste wrapping in paragraph nodes
    try {
      const paragraphs = el.querySelectorAll('p, div:not([contenteditable])');
      if (paragraphs.length > 0) {
        const text = Array.from(paragraphs)
          .map((p) => p.textContent || '')
          .join('\n')
          .trim();
        if (text.length > 0) return text;
      }
    } catch (_) {}

    // Strategy 3: innerText (handles formatted content with newlines)
    try {
      const text = el.innerText;
      if (text && text.trim().length > 0) return text.trim();
    } catch (_) {}

    // Strategy 4: textContent fallback
    return (el.textContent || '').trim();
  },

  setText(el, text) {
    el.focus();

    // Strategy 1: deleteContentBackward then insertText via beforeinput
    // ProseMirror processes both events through its transaction system
    try {
      document.execCommand('selectAll', false, null);
      el.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true, cancelable: true, inputType: 'deleteContentBackward',
      }));
      el.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true, cancelable: true, inputType: 'insertText', data: text,
      }));
      if (this.getText(el) === text.trim()) return true;
    } catch (_) {}

    // Strategy 2: insertFromPaste via beforeinput + DataTransfer
    try {
      document.execCommand('selectAll', false, null);
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      el.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true, cancelable: true,
        inputType: 'insertFromPaste', dataTransfer: dt,
      }));
      if (this.getText(el) === text.trim()) return true;
    } catch (_) {}

    // Strategy 3: ClipboardEvent paste with text/plain + text/html
    try {
      document.execCommand('selectAll', false, null);
      const dt2 = new DataTransfer();
      dt2.setData('text/plain', text);
      dt2.setData('text/html', `<p>${text.replace(/\n/g, '</p><p>')}</p>`);
      el.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true, cancelable: true, clipboardData: dt2,
      }));
      if (this.getText(el) === text.trim()) return true;
    } catch (_) {}

    // Strategy 4: execCommand selectAll + insertText
    try {
      document.execCommand('selectAll', false, null);
      const ok = document.execCommand('insertText', false, text);
      if (ok && this.getText(el) === text.trim()) return true;
    } catch (_) {}

    // Strategy 5: Direct DOM clear + innerText + input event (last resort)
    try {
      while (el.firstChild) el.removeChild(el.firstChild);
      el.innerText = text;
      el.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: true, inputType: 'insertText', data: text,
      }));
    } catch (_) {}
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
