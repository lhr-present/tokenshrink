/**
 * @module adapters/chatgpt
 * Platform adapter for chatgpt.com and chat.openai.com.
 * React fiber workaround for controlled input state.
 */

export default {
  name: 'ChatGPT',

  /** @param {string} host */
  hostMatch: (host) => host.includes('chatgpt.com') || host.includes('chat.openai.com'),

  getTextarea: () =>
    document.querySelector('div#prompt-textarea') ||
    document.querySelector('textarea[data-id="root"]') ||
    document.querySelector('div[contenteditable="true"][data-testid]') ||
    document.querySelector('textarea[placeholder]'),

  getSendButton: () =>
    document.querySelector('button[data-testid="send-button"]') ||
    document.querySelector('button[aria-label="Send prompt"]') ||
    document.querySelector('button[aria-label="Send message"]'),

  getText: (el) => el.value || el.innerText || el.textContent || '',

  setText: (el, text) => {
    el.focus();
    // React controlled input workaround
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLElement.prototype,
      el.tagName === 'TEXTAREA' ? 'value' : 'innerText'
    );
    if (nativeInputValueSetter?.set) {
      nativeInputValueSetter.set.call(el, text);
    } else {
      // contenteditable fallback
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('insertText', false, text);
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  },

  isReady: () =>
    !!(
      (document.querySelector('div#prompt-textarea') || document.querySelector('textarea[data-id="root"]')) &&
      document.querySelector('button[data-testid="send-button"]')
    ),
};
