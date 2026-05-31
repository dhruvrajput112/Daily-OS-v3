/**
 * @file state.js
 * @description Global reactive app state object with dot-notation get/set and a simple pub/sub system.
 * @module State
 */

// ─── Initial State Shape ──────────────────────────────────────────────────────
// All keys are defined upfront so every module can rely on their existence.
// Values are null/empty until populated by supabase.js after auth.

/**
 * The single source of truth for all app data.
 * Modules read from STATE directly; they write via setState().
 * @type {Object}
 */
export const STATE = {
  /** @type {Object|null} Supabase auth user object */
  user: null,

  /** @type {Object|null} Row from the profiles table */
  profile: null,

  /** @type {Array} Rows from the habits table */
  habits: [],

  /** @type {Array} Rows from the wins table */
  wins: [],

  /** @type {Array} Rows from the tags table */
  tags: [],

  /** @type {Array} Rows from the categories table */
  categories: [],

  /**
   * Today's daily_log row (or a local stub if not yet saved).
   * Keyed by today's date. Re-fetched when the date changes.
   * @type {Object|null}
   */
  todayLog: null,

  /**
   * Weekly goals for the currently viewed week.
   * @type {Array}
   */
  weeklyGoals: [],

  /**
   * Timer sessions for the currently viewed period (analytics / weekly page).
   * @type {Array}
   */
  sessions: [],

  /**
   * The currently visible page id.
   * One of: 'today' | 'timer' | 'weekly' | 'analytics' | 'spiritual' | 'settings'
   * @type {string}
   */
  currentPage: 'today',

  /**
   * Whether a timer or stopwatch session is actively running.
   * Controls visibility of the floating session banner.
   * @type {boolean}
   */
  timerActive: false,

  /**
   * Current sync status.
   * One of: 'idle' | 'syncing' | 'synced' | 'offline'
   * @type {string}
   */
  syncStatus: 'idle',
};

// ─── Pub/Sub Registry ─────────────────────────────────────────────────────────
// Maps a top-level STATE key (or '*' for all changes) to an array of callbacks.
// Modules subscribe in their init() calls and react to data changes without
// needing to import each other directly (prevents circular dependency).

/** @type {Map<string, Function[]>} */
const _subscribers = new Map();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolves a dot-notation path array from a string.
 * e.g. 'profile.display_name' → ['profile', 'display_name']
 *
 * @param {string} path - Dot-separated key path
 * @returns {string[]}
 */
function _parsePath(path) {
  return path.split('.');
}

/**
 * Reads a value from an object by a dot-notation path string.
 * Returns undefined if any segment along the path doesn't exist.
 *
 * @param {Object} obj - The root object to read from
 * @param {string[]} keys - Path segments
 * @returns {*}
 */
function _getByPath(obj, keys) {
  return keys.reduce((acc, key) => (acc != null ? acc[key] : undefined), obj);
}

/**
 * Sets a value inside an object at a dot-notation path.
 * Mutates the object in place. Creates intermediate objects if missing.
 *
 * @param {Object} obj - The root object to mutate
 * @param {string[]} keys - Path segments
 * @param {*} value - The value to set
 */
function _setByPath(obj, keys, value) {
  const last = keys[keys.length - 1];
  const parent = keys.slice(0, -1).reduce((acc, key) => {
    if (acc[key] == null || typeof acc[key] !== 'object') {
      acc[key] = {};
    }
    return acc[key];
  }, obj);
  parent[last] = value;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Reads a value from STATE using dot notation.
 * e.g. getState('profile.display_name')
 *
 * @param {string} path - Dot-separated key path into STATE
 * @returns {*} The current value at that path, or undefined
 */
export function getState(path) {
  return _getByPath(STATE, _parsePath(path));
}

/**
 * Sets a value in STATE using dot notation, then notifies subscribers
 * of the top-level key that changed.
 * e.g. setState('profile.display_name', 'Dhruv')
 *
 * @param {string} path - Dot-separated key path into STATE
 * @param {*} value - The value to set
 */
export function setState(path, value) {
  const keys = _parsePath(path);
  _setByPath(STATE, keys, value);
  // Notify subscribers for the top-level key and for '*' (catch-all)
  const topKey = keys[0];
  notify(topKey);
  if (topKey !== '*') notify('*');
}

/**
 * Subscribes a callback to changes on a specific top-level STATE key.
 * Use '*' to listen to all changes.
 * The callback receives the new top-level value as its first argument.
 *
 * @param {string} key - Top-level STATE key, or '*' for all
 * @param {Function} callback - Called whenever the key changes
 * @returns {Function} Unsubscribe function — call it to remove the listener
 *
 * @example
 * const unsub = subscribe('profile', (profile) => renderProfile(profile));
 * // Later: unsub();
 */
export function subscribe(key, callback) {
  if (!_subscribers.has(key)) {
    _subscribers.set(key, []);
  }
  _subscribers.get(key).push(callback);

  // Return an unsubscribe function for cleanup
  return function unsubscribe() {
    const list = _subscribers.get(key);
    if (list) {
      const idx = list.indexOf(callback);
      if (idx !== -1) list.splice(idx, 1);
    }
  };
}

/**
 * Manually triggers all subscribers for a given key.
 * Called internally by setState(); can also be called by sync.js
 * after a Realtime event updates STATE directly.
 *
 * @param {string} key - Top-level STATE key to notify, or '*'
 */
export function notify(key) {
  const value = key === '*' ? STATE : STATE[key];
  const list = _subscribers.get(key);
  if (list && list.length > 0) {
    // Iterate over a copy so unsubscribes during callback don't break the loop
    [...list].forEach((cb) => {
      try {
        cb(value);
      } catch (err) {
        console.error(`[State] Subscriber for "${key}" threw:`, err);
      }
    });
  }
}
