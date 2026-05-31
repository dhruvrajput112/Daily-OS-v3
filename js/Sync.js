/**
 * @file sync.js
 * @description Single Supabase Realtime sync engine — subscribes to all 7 tables,
 *              handles echo prevention, offline queue, and sync status indicator.
 * @module Sync
 */

import { supabase } from './supabase.js';
import { STATE, setState, notify } from './state.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const OFFLINE_QUEUE_KEY = 'daily_os_offline_queue';
const DEVICE_ID_KEY     = 'daily_os_device_id';
const SYNC_INDICATOR_ID = 'sync-indicator';
const SYNCED_FADE_DELAY = 2000; // ms before 'synced' indicator auto-hides
const CHANNEL_NAME      = 'daily-os-global';

/**
 * Maps each synced Supabase table name to its corresponding STATE key.
 * profiles uses PK `id` for filtering; all others use `user_id`.
 */
const TABLE_STATE_MAP = {
  daily_logs:   'dailyLog',
  weekly_goals: 'weeklyGoals',
  habits:       'habits',
  wins:         'wins',
  tags:         'tags',
  categories:   'categories',
  profiles:     'profile',
};

// ─── Device ID ────────────────────────────────────────────────────────────────

/**
 * Returns a stable per-device UUID. Generates and persists one on first call.
 * This is the echo-prevention key: writes stamped with this ID are ignored
 * when they bounce back through the Realtime channel.
 * @returns {string} UUID string
 */
function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

/** Stable device identifier, exported for use by supabase.js when stamping writes. */
export const DEVICE_ID = getDeviceId();

// ─── Sync Status Indicator ────────────────────────────────────────────────────

/** @type {number|null} setTimeout handle used to fade out the 'synced' state. */
let syncedFadeTimer = null;

/**
 * Updates the #sync-indicator DOM element class to reflect current sync status.
 * The CSS in nav.css drives all visual rendering — JS only sets the class.
 *
 * States:
 *   'syncing' → spinner animation
 *   'synced'  → checkmark, fades out after SYNCED_FADE_DELAY ms
 *   'error'   → red dot, persists until next successful sync
 *   'offline' → amber dot + "Offline" label
 *
 * @param {'syncing'|'synced'|'error'|'offline'} status
 */
function updateSyncIndicator(status) {
  const el = document.getElementById(SYNC_INDICATOR_ID);
  if (!el) return;

  // Cancel any pending fade-out before changing state
  if (syncedFadeTimer !== null) {
    clearTimeout(syncedFadeTimer);
    syncedFadeTimer = null;
  }

  el.classList.remove(
    'sync-indicator--syncing',
    'sync-indicator--synced',
    'sync-indicator--error',
    'sync-indicator--offline',
    'sync-indicator--hidden',
  );
  el.removeAttribute('aria-label');

  switch (status) {
    case 'syncing':
      el.classList.add('sync-indicator--syncing');
      el.setAttribute('aria-label', 'Syncing…');
      break;

    case 'synced':
      el.classList.add('sync-indicator--synced');
      el.setAttribute('aria-label', 'Synced');
      syncedFadeTimer = setTimeout(() => {
        el.classList.add('sync-indicator--hidden');
        syncedFadeTimer = null;
      }, SYNCED_FADE_DELAY);
      break;

    case 'error':
      el.classList.add('sync-indicator--error');
      el.setAttribute('aria-label', 'Sync error');
      break;

    case 'offline':
      el.classList.add('sync-indicator--offline');
      el.setAttribute('aria-label', 'Offline');
      break;

    default:
      el.classList.add('sync-indicator--hidden');
  }
}

// ─── Offline Queue ─────────────────────────────────────────────────────────────

/**
 * Reads the persisted offline queue from localStorage.
 * @returns {Array<{table: string, data: Object, operation: string, enqueuedAt: number}>}
 */
function readOfflineQueue() {
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

/**
 * Persists the offline queue to localStorage.
 * @param {Array<Object>} queue
 */
function writeOfflineQueue(queue) {
  try {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  } catch (err) {
    console.error('[Sync] writeOfflineQueue failed:', err);
  }
}

/**
 * Appends a failed write operation to the offline queue for later retry.
 * @param {string} table
 * @param {Object} data
 * @param {'upsert'|'insert'|'delete'} operation
 */
function enqueueOperation(table, data, operation) {
  const queue = readOfflineQueue();
  queue.push({ table, data, operation, enqueuedAt: Date.now() });
  writeOfflineQueue(queue);
}

/**
 * Drains the offline queue, retrying each operation in order.
 * Successfully replayed operations are removed from the queue.
 * Failed operations remain for the next retry cycle.
 * Called automatically on 'online' event and after channel SUBSCRIBED.
 *
 * @returns {Promise<void>}
 */
export async function processOfflineQueue() {
  const queue = readOfflineQueue();
  if (queue.length === 0) return;

  const remaining = [];

  for (const op of queue) {
    try {
      await executeSupabaseOperation(op.table, op.data, op.operation);
    } catch (err) {
      console.error('[Sync] processOfflineQueue — retry failed:', err);
      remaining.push(op);
    }
  }

  writeOfflineQueue(remaining);

  if (remaining.length === 0) {
    setState('syncStatus', 'synced');
    notify('syncStatus');
    updateSyncIndicator('synced');
  } else {
    setState('syncStatus', 'error');
    notify('syncStatus');
    updateSyncIndicator('error');
  }
}

// ─── Core Supabase Operation ───────────────────────────────────────────────────

/**
 * Executes a Supabase write without touching STATE or the sync indicator.
 * This is the shared primitive used by both syncWrite and processOfflineQueue.
 *
 * @param {string} table
 * @param {Object} data
 * @param {'upsert'|'insert'|'delete'} operation
 * @returns {Promise<Object|null>} The returned Supabase data (or null for deletes)
 * @throws On Supabase error or unknown operation
 */
async function executeSupabaseOperation(table, data, operation) {
  let result;

  switch (operation) {
    case 'upsert':
      result = await supabase.from(table).upsert(data).select();
      break;

    case 'insert':
      result = await supabase.from(table).insert(data).select();
      break;

    case 'delete':
      if (!data.id) throw new Error('[Sync] delete operation requires data.id');
      result = await supabase.from(table).delete().eq('id', data.id);
      break;

    default:
      throw new Error(`[Sync] Unknown operation: ${operation}`);
  }

  if (result.error) throw result.error;
  return result.data ?? null;
}

// ─── Public Write API ──────────────────────────────────────────────────────────

/**
 * Writes data to Supabase with full sync status management.
 *
 * Automatically stamps `device_id` on tables that support echo prevention
 * (daily_logs, weekly_goals). On network failure or Supabase error, the
 * operation is queued in localStorage for retry when connectivity returns.
 *
 * @param {string} table - Supabase table name
 * @param {Object} data  - Record payload. Must include `user_id` where the schema requires it.
 * @param {'upsert'|'insert'|'delete'} [operation='upsert']
 * @returns {Promise<boolean>} true on success, false on failure (queued)
 */
export async function syncWrite(table, data, operation = 'upsert') {
  // Stamp device_id for echo prevention on supported tables
  const deviceAwareTables = new Set(['daily_logs', 'weekly_goals']);
  const payload = deviceAwareTables.has(table)
    ? { ...data, device_id: DEVICE_ID }
    : { ...data };

  setState('syncStatus', 'syncing');
  notify('syncStatus');
  updateSyncIndicator('syncing');

  try {
    await executeSupabaseOperation(table, payload, operation);

    setState('syncStatus', 'synced');
    notify('syncStatus');
    updateSyncIndicator('synced');
    return true;

  } catch (err) {
    console.error(`[Sync] syncWrite failed (${table}/${operation}):`, err);

    setState('syncStatus', 'error');
    notify('syncStatus');
    updateSyncIndicator('error');

    enqueueOperation(table, payload, operation);
    return false;
  }
}

// ─── Realtime Event Handler ────────────────────────────────────────────────────

/**
 * Processes a single incoming postgres_changes Realtime event.
 *
 * Echo prevention: if the record carries our DEVICE_ID we originated this
 * write ourselves — skip it to avoid double-rendering our own changes.
 *
 * For singleton records (daily_logs, profiles) the whole STATE key is replaced.
 * For array records (habits, wins, tags, categories, weekly_goals) the array is
 * patched by id: INSERT appends, UPDATE replaces the matching row, DELETE removes it.
 *
 * @param {string} table     - Supabase table name
 * @param {string} eventType - 'INSERT' | 'UPDATE' | 'DELETE'
 * @param {Object} record    - The new record (or old record for DELETE events)
 */
function handleRealtimeEvent(table, eventType, record) {
  // Echo prevention: skip writes that originated from this device
  if (record && record.device_id && record.device_id === DEVICE_ID) return;

  const stateKey = TABLE_STATE_MAP[table];
  if (!stateKey) return;

  const current = STATE[stateKey];

  switch (table) {
    // Singleton records — replace the entire object in STATE
    case 'daily_logs':
    case 'profiles':
      if (eventType !== 'DELETE') {
        setState(stateKey, record);
        notify(stateKey);
      }
      break;

    // Array records — patch by record id
    case 'weekly_goals':
    case 'habits':
    case 'wins':
    case 'tags':
    case 'categories': {
      if (!Array.isArray(current)) {
        setState(stateKey, eventType === 'DELETE' ? [] : [record]);
        notify(stateKey);
        break;
      }

      if (eventType === 'INSERT') {
        // Guard against duplicate inserts (e.g. race between local write and Realtime)
        const exists = current.some((r) => r.id === record.id);
        if (!exists) setState(stateKey, [...current, record]);
      } else if (eventType === 'UPDATE') {
        setState(stateKey, current.map((r) => (r.id === record.id ? record : r)));
      } else if (eventType === 'DELETE') {
        setState(stateKey, current.filter((r) => r.id !== record.id));
      }

      notify(stateKey);
      break;
    }

    default:
      break;
  }
}

// ─── Realtime Channel Bootstrap ────────────────────────────────────────────────

/** @type {import('@supabase/supabase-js').RealtimeChannel|null} */
let activeChannel = null;

/**
 * Initialises the single Supabase Realtime channel for the authenticated user.
 *
 * Subscribes to postgres_changes on all 7 synced tables.
 * Safe to call multiple times (e.g. after re-login) — tears down any
 * existing channel before creating a new one.
 *
 * Design note: `profiles` filters by `id=eq.userId` (its primary key) rather
 * than `user_id=eq.userId` like the other tables. It therefore has its own
 * subscription block rather than being included in the loop over userIdTables.
 *
 * @param {string} userId - The authenticated Supabase user UUID
 * @returns {void}
 */
export function initSync(userId) {
  if (!userId) {
    console.error('[Sync] initSync called without userId');
    return;
  }

  // Tear down stale channel (e.g. user signed out then back in)
  if (activeChannel) {
    supabase.removeChannel(activeChannel);
    activeChannel = null;
  }

  // Tables whose rows are scoped by a user_id FK column
  const userIdTables = [
    'daily_logs',
    'weekly_goals',
    'habits',
    'wins',
    'tags',
    'categories',
  ];

  const channel = supabase.channel(CHANNEL_NAME);

  userIdTables.forEach((table) => {
    channel.on(
      'postgres_changes',
      {
        event:  '*',
        schema: 'public',
        table,
        filter: `user_id=eq.${userId}`,
      },
      ({ eventType, new: newRecord, old: oldRecord }) => {
        const record = eventType === 'DELETE' ? oldRecord : newRecord;
        handleRealtimeEvent(table, eventType, record);
      },
    );
  });

  // profiles: filter on primary key `id`, not `user_id`
  channel.on(
    'postgres_changes',
    {
      event:  '*',
      schema: 'public',
      table:  'profiles',
      filter: `id=eq.${userId}`,
    },
    ({ eventType, new: newRecord, old: oldRecord }) => {
      const record = eventType === 'DELETE' ? oldRecord : newRecord;
      handleRealtimeEvent('profiles', eventType, record);
    },
  );

  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      // Channel is live — flush any writes that queued while we were offline
      processOfflineQueue();
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      console.error('[Sync] Realtime channel error:', status);
      setState('syncStatus', 'error');
      notify('syncStatus');
      updateSyncIndicator('error');
    }
  });

  activeChannel = channel;
}

// ─── Network Event Listeners ───────────────────────────────────────────────────

window.addEventListener('online', () => {
  setState('syncStatus', 'syncing');
  notify('syncStatus');
  updateSyncIndicator('syncing');
  processOfflineQueue();
});

window.addEventListener('offline', () => {
  setState('syncStatus', 'offline');
  notify('syncStatus');
  updateSyncIndicator('offline');
});
