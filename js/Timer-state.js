/**
 * @file timer-state.js
 * @description Handles localStorage persistence for timer, stopwatch, and pomodoro states,
 *              including 24-hour expiry and mathematical elapsed-time reconstruction.
 * @module TimerState
 */

// ─── Constants ────────────────────────────────────────────────────────────────
const STORAGE_KEY = 'daily_os_timer_v2';
const MAX_AGE_MS  = 86_400_000; // 24 hours

/**
 * @typedef {Object} TimerStateShape
 * @property {'timer'|'stopwatch'|'pomodoro'} mode
 * @property {boolean} running
 * @property {boolean} paused
 * @property {number}  startTs           - unix ms when the current run segment began
 * @property {number}  pausedAt          - unix ms when last paused (0 if not paused)
 * @property {number}  totalPausedMs     - cumulative ms spent paused in this session
 * @property {number}  duration          - timer mode: total seconds selected
 * @property {string}  tag               - selected tag name
 * @property {string}  tagColor          - selected tag color hex
 * @property {string}  category          - selected category name
 * @property {string}  categoryType      - 'subject' | 'project'
 * @property {string}  categoryColor     - selected category color hex
 * @property {'focus'|'short'|'long'} pomoPhase
 * @property {number}  pomoFocusDone     - completed focus intervals in current cycle
 * @property {number}  pomoCycle         - total completed pomodoro cycles
 * @property {number}  savedAt           - unix ms timestamp of last save
 */

/**
 * Persists the current timer state to localStorage.
 * Called every second (tick), on pause, on resume, and on mode switch.
 *
 * @param {TimerStateShape} state
 * @returns {void}
 */
export function saveTimerState(state) {
  try {
    const payload = { ...state, savedAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.error('[TimerState] saveTimerState failed:', err);
  }
}

/**
 * Loads and validates persisted timer state from localStorage.
 * Returns null if missing, corrupt, or older than 24 hours.
 * Reconstructs elapsed time mathematically if timer was running when saved.
 *
 * @returns {{ state: TimerStateShape, reconstructedElapsedSecs: number }|null}
 */
export function loadTimerState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    /** @type {TimerStateShape} */
    const state = JSON.parse(raw);

    // 24-hour expiry check
    if (!state.savedAt || Date.now() - state.savedAt > MAX_AGE_MS) {
      clearTimerState();
      return null;
    }

    // Mathematical elapsed reconstruction
    // elapsed = (now - startTs) - totalPausedMs
    // This gives the correct position WITHOUT trying to "catch up" the UI
    let reconstructedElapsedSecs = 0;

    if (state.running && !state.paused && state.startTs) {
      const elapsedMs = (Date.now() - state.startTs) - (state.totalPausedMs || 0);
      reconstructedElapsedSecs = Math.max(0, Math.floor(elapsedMs / 1000));
    } else if (state.running && state.paused && state.startTs) {
      // Paused: elapsed up to the moment of pause
      const elapsedMs = (state.pausedAt - state.startTs) - (state.totalPausedMs || 0);
      reconstructedElapsedSecs = Math.max(0, Math.floor(elapsedMs / 1000));
    }

    return { state, reconstructedElapsedSecs };
  } catch (err) {
    console.error('[TimerState] loadTimerState failed:', err);
    clearTimerState();
    return null;
  }
}

/**
 * Removes all persisted timer state from localStorage.
 * Call when a session is saved, abandoned, or expired.
 *
 * @returns {void}
 */
export function clearTimerState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.error('[TimerState] clearTimerState failed:', err);
  }
}

/**
 * Returns true if there is a valid active persisted timer state.
 *
 * @returns {boolean}
 */
export function hasPersistedTimer() {
  const result = loadTimerState();
  return result !== null && (result.state.running || result.state.paused);
}
