/**
 * @file config.js
 * @description App-wide constants, Supabase credentials, device identity, and date helpers.
 * @module Config
 */

// ─── Supabase Credentials ────────────────────────────────────────────────────
// Replace these placeholder strings with your actual project values if needed.
// They are already set to the project values from the brief.

export const SUPABASE_URL = 'https://jtvsqqbtmpemhguqhmny.supabase.co';

export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0dnNxcWJ0bXBlbWhndXFobW55Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczNzQwNjYsImV4cCI6MjA5Mjk1MDA2Nn0.FgfFEndDJP15f5nMULl3FUlbJO4L7hgXOOdwPHsr1OY';

// ─── App Metadata ─────────────────────────────────────────────────────────────

export const APP_VERSION = 'v2.0';

// ─── localStorage Keys ────────────────────────────────────────────────────────

export const TIMER_STORAGE_KEY = 'daily_os_timer_v2';
export const OFFLINE_QUEUE_KEY = 'daily_os_offline_queue';

/** Key under which the device UUID is persisted. */
const DEVICE_ID_STORAGE_KEY = 'daily_os_device_id';

// ─── Device Identity ──────────────────────────────────────────────────────────
// Generated once per install and stored in localStorage forever.
// Used by sync.js to filter out echo events from Supabase Realtime.

/**
 * Generates a RFC4122-compliant UUID v4.
 * Uses crypto.randomUUID() when available; falls back to Math.random().
 * @returns {string} A UUID string, e.g. "550e8400-e29b-41d4-a716-446655440000"
 */
function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for older Safari / WebKit
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * The unique identifier for this browser/device installation.
 * Persisted across sessions via localStorage.
 * @type {string}
 */
export const DEVICE_ID = (() => {
  try {
    let id = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (!id) {
      id = generateUUID();
      localStorage.setItem(DEVICE_ID_STORAGE_KEY, id);
    }
    return id;
  } catch (err) {
    // localStorage may be blocked (private browsing / iframe sandboxing).
    // Fall back to a session-only UUID so the app still functions.
    console.warn('[Config] localStorage unavailable, using session-only DEVICE_ID:', err);
    return generateUUID();
  }
})();

// ─── Date Helpers ─────────────────────────────────────────────────────────────

/**
 * Returns today's date as an ISO 8601 date string (YYYY-MM-DD) in the
 * user's LOCAL timezone (not UTC). This is the canonical date key used
 * for all daily_log lookups and writes.
 *
 * @returns {string} e.g. "2025-07-14"
 */
export function TODAY_KEY() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns the ISO date string (YYYY-MM-DD) for the Monday of the week
 * that contains the given date. Used for weekly_goals lookups.
 *
 * @param {Date} [date=new Date()] - The reference date (defaults to today)
 * @returns {string} e.g. "2025-07-14"
 */
export function WEEK_START_KEY(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon … 6=Sat
  // Adjust to Monday: subtract (day + 6) % 7 days
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const dayStr = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${dayStr}`;
}
