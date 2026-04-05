/**
 * @module adapters/claude
 * Platform adapter for claude.ai.
 * Handles DOM interaction with Claude's chat interface.
 * Uses multiple fallback selectors since claude.ai DOM changes frequently.
 */

export default {
  name: 'Claude',

  /** @param {string} host */
  hostMatch: (host) => host.includes('claude.ai'),

  /**
   * Find the active chat input textarea.
   * @returns {Element|null}
   */
  getTextarea: () =>
    document.querySelector('div[contenteditable="true"][data-testid="chat-input"]') ||
    document.querySelector('div[contenteditable="true"][class*="ProseMirror"]') ||
    document.querySelector('div[contenteditable="true"][class*="editor"]') ||
    document.querySelector('fieldset div[contenteditable="true"]') ||
    document.querySelector('div[contenteditable="true"]'),

  /**
   * Find the send button.
   * @returns {Element|null}
   */
  getSendButton: () =>
    document.querySelector('button[aria-label="Send message"]') ||
    document.querySelector('button[data-testid="send-button"]') ||
    document.querySelector('button[aria-label="Send Message"]') ||
    document.querySelector('button[type="submit"][aria-label]') ||
    (() => {
      // Last resort: find enabled button near the textarea
      const buttons = [...document.querySelectorAll('button[type="submit"], button[aria-label*="send" i]')];
      return buttons.find((b) => !b.disabled) || null;
    })(),

  /**
   * Get text from a contenteditable element.
   * @param {Element} el
   * @returns {string}
   */
  getText: (el) => el.innerText || el.textContent || '',

  /**
   * Set text in a contenteditable element.
   * Uses execCommand for React compatibility.
   * @param {Element} el
   * @param {string} text
   */
  setText: (el, text) => {
    el.focus();
    // Select all existing content
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
    // Insert replacement text
    document.execCommand('insertText', false, text);
    // Dispatch input event to trigger React state update
    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
  },

  /**
   * Check if the Claude interface is ready for interaction.
   * @returns {boolean}
   */
  isReady: () =>
    !!(
      document.querySelector('div[contenteditable="true"]') &&
      (document.querySelector('button[aria-label="Send message"]') ||
        document.querySelector('button[aria-label="Send Message"]') ||
        document.querySelector('button[type="submit"]'))
    ),
};
