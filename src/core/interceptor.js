/**
 * @module core/interceptor
 * Hooks into a platform adapter's send mechanism to intercept prompts
 * before they are sent. Uses three strategies: click, keydown, MutationObserver.
 * Includes setText verification + retry, slow-network warning, and error guard.
 */

const INDICATOR_ID = 'tokenshrink-indicator';

export class Interceptor {
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

    if (btn) {
      this._clickHandler = (e) => this._onIntercept(e, 'click');
      btn.addEventListener('click', this._clickHandler, true);
    }
    if (ta) {
      this._keydownHandler = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) this._onIntercept(e, 'keydown');
      };
      ta.addEventListener('keydown', this._keydownHandler, true);
    }
  }

  _detachListeners() {
    const btn = this.adapter.getSendButton();
    const ta = this.adapter.getTextarea();
    if (btn && this._clickHandler) btn.removeEventListener('click', this._clickHandler, true);
    if (ta && this._keydownHandler) ta.removeEventListener('keydown', this._keydownHandler, true);
    this._clickHandler = null;
    this._keydownHandler = null;
  }

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
    // Unhandled promise rejection guard — never block the send on our error
    try {
      await this._handleIntercept(e, source);
    } catch (err) {
      console.error('[TokenShrink] Intercept error:', err);
      this._removeIndicator();
      this._busy = false;
      // Fall through — re-fire uncompressed
      const ta = this.adapter.getTextarea();
      await new Promise((r) => setTimeout(r, 80));
      if (source === 'click') {
        const btn = this.adapter.getSendButton();
        if (btn) btn.click();
      } else if (ta) {
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      }
    }
  }

  async _handleIntercept(e, source) {
    if (this._busy) return;
    const ta = this.adapter.getTextarea();
    if (!ta) return;
    const text = this.adapter.getText(ta).trim();
    if (!text || text.length < 20) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    this._busy = true;

    if (this.settings.showIndicator) this._showIndicator();

    // Slow-network warning — mutate indicator after 3s
    const slowWarning = setTimeout(() => {
      const ind = document.getElementById(INDICATOR_ID);
      if (ind) {
        const span = ind.querySelector('span');
        if (span) {
          span.innerHTML = span.innerHTML.replace(
            'compressing\u2026',
            'compressing\u2026 <span style="color:#ffb400;font-size:9px">(slow)</span>'
          );
        }
      }
    }, 3000);

    const timeout = new Promise((resolve) =>
      setTimeout(
        () => resolve({ success: false, error: 'timeout', original: text }),
        this.settings.timeoutMs + 500
      )
    );

    const compressionRequest = new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: 'COMPRESS', text, mode: this.settings.aggressiveness },
        (response) => resolve(response || { success: false, error: 'no response', original: text })
      );
    });

    const result = await Promise.race([compressionRequest, timeout]);

    clearTimeout(slowWarning);
    this._removeIndicator();
    this._busy = false;

    if (result.success && result.compressed && result.compressed !== text) {
      this.adapter.setText(ta, result.compressed);

      // Verify setText worked — React re-render needs ~60ms
      await new Promise((r) => setTimeout(r, 60));
      const actualText = this.adapter.getText(ta);
      if (actualText.trim() !== result.compressed.trim()) {
        console.warn('[TokenShrink] setText verification failed, retrying with innerText');
        try {
          ta.focus();
          ta.innerText = result.compressed;
          ta.dispatchEvent(new InputEvent('input', {
            bubbles: true, cancelable: true,
            inputType: 'insertText', data: result.compressed,
          }));
          await new Promise((r) => setTimeout(r, 60));
        } catch (_) {}
      }

      window.dispatchEvent(new CustomEvent('tokenshrink:compressed', {
        detail: { source: result.source, stats: result.stats, domain: result.domain },
      }));
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

  _showIndicator() {
    this._removeIndicator();
    const div = document.createElement('div');
    div.id = INDICATOR_ID;
    div.innerHTML = `
      <span style="
        display:inline-flex;align-items:center;gap:7px;
        background:#111;
        border:1px solid rgba(0,255,140,0.25);
        border-left:2px solid #00ff8c;
        border-radius:4px;
        padding:6px 12px;
        font-family:'JetBrains Mono','Courier New',monospace;
        font-size:11px;color:#00ff8c;
        box-shadow:0 3px 16px rgba(0,0,0,0.5);
        letter-spacing:0.05em;white-space:nowrap;
      ">
        <span style="
          display:inline-block;width:9px;height:9px;
          border:1.5px solid #00ff8c;border-top-color:transparent;
          border-radius:50%;animation:ts-spin 0.65s linear infinite;
        "></span>
        TokenShrink compressing\u2026
      </span>
      <style>@keyframes ts-spin{to{transform:rotate(360deg)}}</style>
    `;
    Object.assign(div.style, {
      position: 'fixed', bottom: '80px', right: '20px',
      zIndex: '2147483646', pointerEvents: 'none',
    });
    document.body.appendChild(div);
  }

  _removeIndicator() {
    document.getElementById(INDICATOR_ID)?.remove();
  }
}
