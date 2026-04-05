/**
 * @module adapters/gemini
 * Platform adapter for gemini.google.com — STUB.
 * Not yet implemented. Exported to satisfy adapter registry.
 */

export default {
  name: 'Gemini',

  /** @param {string} host */
  hostMatch: (host) => host.includes('gemini.google.com'),

  getTextarea: () => null,
  getSendButton: () => null,
  getText: () => '',
  setText: () => {},
  isReady: () => false,
};
