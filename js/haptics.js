/**
 * @file haptics.js
 * @description Haptic feedback module — named vibration patterns and a safe vibrate() wrapper.
 * @module Haptics
 */

// ─── Named Haptic Patterns ────────────────────────────────────────────────────
// All durations are in milliseconds: [vibrate, pause, vibrate, ...]

/** Checkbox check or uncheck — single quick tick */
export const HAPTIC_TICK = [8];

/** Pillar block fully completed — triple pulse */
export const HAPTIC_COMPLETE = [10, 50, 20];

/** Pomodoro cycle complete — celebratory pattern */
export const HAPTIC_POMO_DONE = [15, 80, 15, 80, 30];

/** Focus session starts — deliberate double tap */
export const HAPTIC_SESSION = [20, 60, 20];

/** Swipe-to-complete threshold crossed — single swipe feedback */
export const HAPTIC_SWIPE = [12];

/** Task added — gentle confirmation */
export const HAPTIC_ADD = [4];

/** Sync error — short urgent double */
export const HAPTIC_ERROR = [6, 40, 6];

/** Timer finished — strong completion signal */
export const HAPTIC_TIMER_END = [30, 100, 30, 100, 60];

// ─── Vibrate Function ─────────────────────────────────────────────────────────

/**
 * Safely trigger device vibration using a named pattern constant.
 * Silently no-ops on devices that do not support the Vibration API.
 *
 * @param {number[]} pattern - Array of vibrate/pause durations in ms.
 *   Use one of the exported HAPTIC_* constants.
 * @returns {void}
 */
export function vibrate(pattern) {
  if (!navigator.vibrate) return;
  try {
    navigator.vibrate(pattern);
  } catch (err) {
    // Some browsers throw if vibrate is called outside a user gesture.
    // Swallow silently — haptics are enhancement only, never critical.
    console.warn('[Haptics] vibrate failed silently:', err);
  }
}
