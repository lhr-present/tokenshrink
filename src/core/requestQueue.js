/**
 * @module core/requestQueue
 * Async queue with concurrency=1 and per-key debounce.
 * Prevents duplicate API calls when user sends rapidly.
 * Works in both service worker (background.js) and browser contexts.
 */

export class RequestQueue {
  /**
   * @param {{ concurrency?: number, debounceMs?: number }} [options]
   */
  constructor({ concurrency = 1, debounceMs = 80 } = {}) {
    this._concurrency = concurrency;
    this._debounceMs = debounceMs;
    this._running = 0;
    this._queue = [];
    this._timers = new Map();
    this._pendingByKey = new Map();
  }

  /**
   * Enqueue a task with debounce. Multiple rapid calls with the same key
   * will cancel earlier pending tasks, keeping only the latest.
   * @param {string} key - Dedup key (e.g. first N chars of the prompt)
   * @param {() => Promise<any>} task - Async factory
   * @returns {Promise<any>}
   */
  enqueue(key, task) {
    return new Promise((resolve, reject) => {
      // Cancel any pending debounce for this key
      if (this._timers.has(key)) {
        clearTimeout(this._timers.get(key));
        this._timers.delete(key);
      }
      // Reject any queued (not yet running) task for this key
      if (this._pendingByKey.has(key)) {
        const prev = this._pendingByKey.get(key);
        this._queue = this._queue.filter((q) => q !== prev);
        prev.reject(new Error('debounced'));
        this._pendingByKey.delete(key);
      }

      const timer = setTimeout(() => {
        this._timers.delete(key);
        const entry = { key, task, resolve, reject };
        this._pendingByKey.set(key, entry);
        this._queue.push(entry);
        this._tick();
      }, this._debounceMs);

      this._timers.set(key, timer);
    });
  }

  _tick() {
    if (this._running >= this._concurrency || this._queue.length === 0) return;
    const entry = this._queue.shift();
    this._pendingByKey.delete(entry.key);
    this._running++;
    Promise.resolve()
      .then(() => entry.task())
      .then(entry.resolve)
      .catch(entry.reject)
      .finally(() => {
        this._running--;
        this._tick();
      });
  }

  /** Number of queued (waiting) tasks */
  get pendingCount() { return this._queue.length; }

  /** Whether a task is currently executing */
  get isRunning() { return this._running > 0; }

  /** Drain all pending tasks with a 'cleared' rejection */
  clear() {
    this._queue.forEach((e) => e.reject(new Error('cleared')));
    this._queue = [];
    this._pendingByKey.clear();
    this._timers.forEach(clearTimeout);
    this._timers.clear();
  }
}
