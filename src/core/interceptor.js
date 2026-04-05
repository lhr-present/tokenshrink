/**
 * @module core/interceptor
 * Hooks into a platform adapter's send mechanism to intercept prompts
 * before they are sent. Uses three strategies: click, keydown, MutationObserver.
 */

const INDICATOR_ID = 'tokenshrink-indicator';

/**
 * Interceptor class. Attach to an adapter and call install() to begin.
 */
export class Interceptor {
  /**
   * @param {object} adapter - Platform adapter (claude.js etc.)
   * @param {object} settings - Extension settings
   */
  constructor(adapter, settings) {
    this.adapter = adapter;
    this.settings = settings;
    this._clickHandler = null;
    this._keydownHandler = null;
    this._observer = null;
    this._installed = false;
    this._busy = false;
  }

  install() {
    if (this._installed) return;
    this._installed = true;
    this._attachListeners();
    this._watchForDomRebuild();
  }

  uninstall() {
    this._installed = false;
    this._detachListeners();
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
    this._removeIndicator();
  }

  _attachListeners() {
    const btn = this.adapter.getSendButton();
    const ta = this.adapter.getTextarea();
    if (!btn && !ta) return;

    // Strategy A: click on send button
    if (btn) {
      this._clickHandler = (e) => this._onIntercept(e, 'click');
      btn.addEventListener('click', this._clickHandler, true);
    }

    // Strategy B: Enter keydown on textarea
    if (ta) {
      this._keydownHandler = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          this._onIntercept(e, 'keydown');
        }
      };
      ta.addEventListener('keydown', this._keydownHandler, true);
    }
  }

  _detachListeners() {
    const btn = this.adapter.getSendButton();
    const ta = this.adapter.getTextarea();
    if (btn && this._clickHandler) {
      btn.removeEventListener('click', this._clickHandler, true);
    }
    if (ta && this._keydownHandler) {
      ta.removeEventListener('keydown', this._keydownHandler, true);
    }
    this._clickHandler = null;
    this._keydownHandler = null;
  }

  // Strategy C: MutationObserver re-attaches after SPA navigation rebuilds the DOM
  _watchForDomRebuild() {
    this._observer = new MutationObserver(() => {
      if (!this._installed) return;
      const btn = this.adapter.getSendButton();
      const ta = this.adapter.getTextarea();
      if (btn && !btn.__tsAttached) {
        btn.__tsAttached = true;
        this._detachListeners();
        this._attachListeners();
      }
      if (ta && !ta.__tsAttached) {
        ta.__tsAttached = true;
        this._detachListeners();
        this._attachListeners();
      }
    });
    this._observer.observe(document.body, { childList: true, subtree: true });
  }

  async _onIntercept(e, source) {
    if (this._busy) return;
    const ta = this.adapter.getTextarea();
    if (!ta) return;
    const text = this.adapter.getText(ta).trim();
    if (!text || text.length < 20) return; // Don't compress very short messages

    e.preventDefault();
    e.stopImmediatePropagation();
    this._busy = true;

    if (this.settings.showIndicator) this._showIndicator(ta);

    // Request compression from background service worker
    const timeout = new Promise((resolve) =>
      setTimeout(() => resolve({ success: false, error: 'timeout', original: text }), this.settings.timeoutMs + 500)
    );

    const compressionRequest = new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: 'COMPRESS', text, mode: this.settings.aggressiveness },
        (response) => resolve(response || { success: false, error: 'no response', original: text })
      );
    });

    const result = await Promise.race([compressionRequest, timeout]);

    this._removeIndicator();
    this._busy = false;

    if (result.success && result.compressed && result.compressed !== text) {
      this.adapter.setText(ta, result.compressed);
      if (this.settings.showToast && result.stats) {
        this._showToast(result.stats);
      }
      // Save stats
      chrome.runtime.sendMessage({ action: 'SAVE_STATS', stats: result.stats });
    }

    // Re-fire the original action
    await new Promise((r) => setTimeout(r, 80));
    if (source === 'click') {
      const btn = this.adapter.getSendButton();
      if (btn) btn.click();
    } else {
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    }
  }

  _showIndicator(nearEl) {
    this._removeIndicator();
    const div = document.createElement('div');
    div.id = INDICATOR_ID;
    div.textContent = '⚡ compressing...';
    div.style.cssText = `
      position: fixed;
      bottom: 80px;
      right: 24px;
      background: #0a0a0a;
      color: #00ff8c;
      border: 1px solid #00ff8c;
      font-family: 'JetBrains Mono', monospace, monospace;
      font-size: 12px;
      padding: 6px 12px;
      border-radius: 4px;
      z-index: 99999;
      letter-spacing: 0.05em;
      pointer-events: none;
      opacity: 0.92;
    `;
    document.body.appendChild(div);
  }

  _removeIndicator() {
    document.getElementById(INDICATOR_ID)?.remove();
  }

  _showToast(stats) {
    const div = document.createElement('div');
    div.textContent = `TokenShrink: ${stats.saved} tokens saved (${stats.pct}%)`;
    div.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #0a0a0a;
      color: #00ff8c;
      border: 1px solid #1a2a1a;
      font-family: 'JetBrains Mono', monospace, monospace;
      font-size: 12px;
      padding: 8px 16px;
      border-radius: 4px;
      z-index: 99999;
      letter-spacing: 0.05em;
      opacity: 0;
      transition: opacity 0.2s ease;
      pointer-events: none;
    `;
    document.body.appendChild(div);
    requestAnimationFrame(() => { div.style.opacity = '0.95'; });
    setTimeout(() => {
      div.style.opacity = '0';
      setTimeout(() => div.remove(), 300);
    }, 3000);
  }
}
