/**
 * @file supabase.js
 * @description Supabase client initialisation and all database read/write operations.
 * @module Supabase
 */

import { SUPABASE_URL, SUPABASE_ANON_KEY, DEVICE_ID, TODAY_KEY, WEEK_START_KEY } from './config.js';

// ─── Client Init ──────────────────────────────────────────────────────────────
// supabase-js is loaded via CDN script tag in index.html.
// The global `supabase` object is available as window.supabase.createClient.

/** @type {import('@supabase/supabase-js').SupabaseClient} */
export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

/**
 * Returns the currently authenticated Supabase user, or null if signed out.
 * @returns {Promise<import('@supabase/supabase-js').User|null>}
 */
export async function getUser() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    return user ?? null;
  } catch (err) {
    console.error('[Supabase] getUser failed:', err);
    return null;
  }
}

/**
 * Signs in with email and password.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{user: Object|null, error: Object|null}>}
 */
export async function signIn(email, password) {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    return { user: data?.user ?? null, error: error ?? null };
  } catch (err) {
    console.error('[Supabase] signIn failed:', err);
    return { user: null, error: err };
  }
}

/**
 * Signs up a new user with email, password, and display name.
 * The database trigger handle_new_user() auto-creates the profile row.
 * @param {string} email
 * @param {string} password
 * @param {string} name - Display name stored in user_metadata
 * @returns {Promise<{user: Object|null, error: Object|null}>}
 */
export async function signUp(email, password, name) {
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } },
    });
    return { user: data?.user ?? null, error: error ?? null };
  } catch (err) {
    console.error('[Supabase] signUp failed:', err);
    return { user: null, error: err };
  }
}

/**
 * Signs the current user out.
 * @returns {Promise<void>}
 */
export async function signOut() {
  try {
    await supabase.auth.signOut();
  } catch (err) {
    console.error('[Supabase] signOut failed:', err);
  }
}

// ─── Bulk Fetch ───────────────────────────────────────────────────────────────

/**
 * Fetches all user data needed on app load in parallel.
 * Returns a single object containing every dataset.
 *
 * @param {string} userId - The authenticated user's UUID
 * @returns {Promise<{
 *   profile: Object|null,
 *   habits: Array,
 *   wins: Array,
 *   tags: Array,
 *   categories: Array,
 *   todayLog: Object|null,
 *   weeklyGoals: Array
 * }>}
 */
export async function fetchAllUserData(userId) {
  try {
    const today = TODAY_KEY();
    const weekStart = WEEK_START_KEY();

    const [
      profileRes,
      habitsRes,
      winsRes,
      tagsRes,
      categoriesRes,
      todayLogRes,
      weeklyGoalsRes,
    ] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).single(),
      supabase.from('habits').select('*').eq('user_id', userId).eq('is_active', true).order('sort_order'),
      supabase.from('wins').select('*').eq('user_id', userId).order('sort_order'),
      supabase.from('tags').select('*').eq('user_id', userId).order('sort_order'),
      supabase.from('categories').select('*').eq('user_id', userId).order('sort_order'),
      supabase.from('daily_logs').select('*').eq('user_id', userId).eq('log_date', today).single(),
      supabase.from('weekly_goals').select('*').eq('user_id', userId).eq('week_start', weekStart).order('sort_order'),
    ]);

    // Log individual errors but don't throw — partial data is better than nothing
    if (profileRes.error && profileRes.error.code !== 'PGRST116') {
      console.error('[Supabase] fetchAllUserData profile error:', profileRes.error);
    }
    if (todayLogRes.error && todayLogRes.error.code !== 'PGRST116') {
      // PGRST116 = row not found, which is fine (first visit today)
      console.error('[Supabase] fetchAllUserData todayLog error:', todayLogRes.error);
    }

    return {
      profile:      profileRes.data      ?? null,
      habits:       habitsRes.data       ?? [],
      wins:         winsRes.data         ?? [],
      tags:         tagsRes.data         ?? [],
      categories:   categoriesRes.data   ?? [],
      todayLog:     todayLogRes.data     ?? null,
      weeklyGoals:  weeklyGoalsRes.data  ?? [],
    };
  } catch (err) {
    console.error('[Supabase] fetchAllUserData failed:', err);
    return {
      profile: null,
      habits: [],
      wins: [],
      tags: [],
      categories: [],
      todayLog: null,
      weeklyGoals: [],
    };
  }
}

// ─── Daily Logs ───────────────────────────────────────────────────────────────

/**
 * Upserts (insert or update) a daily_log row.
 * Always stamps device_id and updated_at automatically.
 *
 * @param {Object} logData - Partial or full daily_log fields to save.
 *   Must include user_id and log_date.
 * @returns {Promise<{data: Object|null, error: Object|null}>}
 */
export async function upsertDailyLog(logData) {
  try {
    const payload = {
      ...logData,
      device_id: DEVICE_ID,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from('daily_logs')
      .upsert(payload, { onConflict: 'user_id,log_date' })
      .select()
      .single();
    if (error) throw error;
    return { data, error: null };
  } catch (err) {
    console.error('[Supabase] upsertDailyLog failed:', err);
    return { data: null, error: err };
  }
}

/**
 * Fetches a daily_log row for a specific date.
 * Returns null if no row exists for that date yet.
 *
 * @param {string} userId
 * @param {string} date - ISO date string (YYYY-MM-DD)
 * @returns {Promise<Object|null>}
 */
export async function fetchDailyLog(userId, date) {
  try {
    const { data, error } = await supabase
      .from('daily_logs')
      .select('*')
      .eq('user_id', userId)
      .eq('log_date', date)
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    return data ?? null;
  } catch (err) {
    console.error('[Supabase] fetchDailyLog failed:', err);
    return null;
  }
}

/**
 * Fetches daily_log rows for a date range (inclusive).
 * Used by Weekly and Analytics pages.
 *
 * @param {string} userId
 * @param {string} startDate - ISO date string
 * @param {string} endDate - ISO date string
 * @returns {Promise<Array>}
 */
export async function fetchDailyLogsRange(userId, startDate, endDate) {
  try {
    const { data, error } = await supabase
      .from('daily_logs')
      .select('*')
      .eq('user_id', userId)
      .gte('log_date', startDate)
      .lte('log_date', endDate)
      .order('log_date');
    if (error) throw error;
    return data ?? [];
  } catch (err) {
    console.error('[Supabase] fetchDailyLogsRange failed:', err);
    return [];
  }
}

// ─── Profiles ─────────────────────────────────────────────────────────────────

/**
 * Upserts the user's profile row.
 *
 * @param {Object} profileData - Partial or full profile fields. Must include id.
 * @returns {Promise<{data: Object|null, error: Object|null}>}
 */
export async function upsertProfile(profileData) {
  try {
    const payload = {
      ...profileData,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from('profiles')
      .upsert(payload, { onConflict: 'id' })
      .select()
      .single();
    if (error) throw error;
    return { data, error: null };
  } catch (err) {
    console.error('[Supabase] upsertProfile failed:', err);
    return { data: null, error: err };
  }
}

// ─── Timer Sessions ───────────────────────────────────────────────────────────

/**
 * Inserts a completed timer session.
 * Timer sessions are insert-only — never updated or synced in real time.
 *
 * @param {Object} sessionData - Must include user_id, session_date, duration_secs, mode.
 * @returns {Promise<{data: Object|null, error: Object|null}>}
 */
export async function insertTimerSession(sessionData) {
  try {
    const { data, error } = await supabase
      .from('timer_sessions')
      .insert(sessionData)
      .select()
      .single();
    if (error) throw error;
    return { data, error: null };
  } catch (err) {
    console.error('[Supabase] insertTimerSession failed:', err);
    return { data: null, error: err };
  }
}

/**
 * Fetches timer sessions for a date range, ordered newest first.
 *
 * @param {string} userId
 * @param {string} startDate - ISO date string
 * @param {string} endDate - ISO date string
 * @returns {Promise<Array>}
 */
export async function fetchTimerSessions(userId, startDate, endDate) {
  try {
    const { data, error } = await supabase
      .from('timer_sessions')
      .select('*')
      .eq('user_id', userId)
      .gte('session_date', startDate)
      .lte('session_date', endDate)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  } catch (err) {
    console.error('[Supabase] fetchTimerSessions failed:', err);
    return [];
  }
}

// ─── Habits ───────────────────────────────────────────────────────────────────

/**
 * Creates a new habit.
 * @param {Object} habitData - Must include user_id, name, pillar.
 * @returns {Promise<{data: Object|null, error: Object|null}>}
 */
export async function createHabit(habitData) {
  try {
    const { data, error } = await supabase
      .from('habits')
      .insert(habitData)
      .select()
      .single();
    if (error) throw error;
    return { data, error: null };
  } catch (err) {
    console.error('[Supabase] createHabit failed:', err);
    return { data: null, error: err };
  }
}

/**
 * Updates an existing habit.
 * @param {string} habitId - UUID of the habit to update
 * @param {Object} updates - Fields to update
 * @returns {Promise<{data: Object|null, error: Object|null}>}
 */
export async function updateHabit(habitId, updates) {
  try {
    const { data, error } = await supabase
      .from('habits')
      .update(updates)
      .eq('id', habitId)
      .select()
      .single();
    if (error) throw error;
    return { data, error: null };
  } catch (err) {
    console.error('[Supabase] updateHabit failed:', err);
    return { data: null, error: err };
  }
}

/**
 * Soft-deletes a habit by setting is_active = false.
 * Hard delete is avoided to preserve historical analytics.
 * @param {string} habitId - UUID of the habit
 * @returns {Promise<{error: Object|null}>}
 */
export async function deleteHabit(habitId) {
  try {
    const { error } = await supabase
      .from('habits')
      .update({ is_active: false })
      .eq('id', habitId);
    if (error) throw error;
    return { error: null };
  } catch (err) {
    console.error('[Supabase] deleteHabit failed:', err);
    return { error: err };
  }
}

// ─── Wins ─────────────────────────────────────────────────────────────────────

/**
 * Creates a new win.
 * @param {Object} winData - Must include user_id, name.
 * @returns {Promise<{data: Object|null, error: Object|null}>}
 */
export async function createWin(winData) {
  try {
    const { data, error } = await supabase
      .from('wins')
      .insert(winData)
      .select()
      .single();
    if (error) throw error;
    return { data, error: null };
  } catch (err) {
    console.error('[Supabase] createWin failed:', err);
    return { data: null, error: err };
  }
}

/**
 * Updates a win.
 * @param {string} winId
 * @param {Object} updates
 * @returns {Promise<{data: Object|null, error: Object|null}>}
 */
export async function updateWin(winId, updates) {
  try {
    const { data, error } = await supabase
      .from('wins')
      .update(updates)
      .eq('id', winId)
      .select()
      .single();
    if (error) throw error;
    return { data, error: null };
  } catch (err) {
    console.error('[Supabase] updateWin failed:', err);
    return { data: null, error: err };
  }
}

/**
 * Deletes a win permanently.
 * @param {string} winId
 * @returns {Promise<{error: Object|null}>}
 */
export async function deleteWin(winId) {
  try {
    const { error } = await supabase.from('wins').delete().eq('id', winId);
    if (error) throw error;
    return { error: null };
  } catch (err) {
    console.error('[Supabase] deleteWin failed:', err);
    return { error: err };
  }
}

// ─── Tags ─────────────────────────────────────────────────────────────────────

/**
 * Creates a new timer tag.
 * @param {Object} tagData - Must include user_id, name.
 * @returns {Promise<{data: Object|null, error: Object|null}>}
 */
export async function createTag(tagData) {
  try {
    const { data, error } = await supabase
      .from('tags')
      .insert(tagData)
      .select()
      .single();
    if (error) throw error;
    return { data, error: null };
  } catch (err) {
    console.error('[Supabase] createTag failed:', err);
    return { data: null, error: err };
  }
}

/**
 * Updates a tag.
 * @param {string} tagId
 * @param {Object} updates
 * @returns {Promise<{data: Object|null, error: Object|null}>}
 */
export async function updateTag(tagId, updates) {
  try {
    const { data, error } = await supabase
      .from('tags')
      .update(updates)
      .eq('id', tagId)
      .select()
      .single();
    if (error) throw error;
    return { data, error: null };
  } catch (err) {
    console.error('[Supabase] updateTag failed:', err);
    return { data: null, error: err };
  }
}

/**
 * Deletes a tag.
 * @param {string} tagId
 * @returns {Promise<{error: Object|null}>}
 */
export async function deleteTag(tagId) {
  try {
    const { error } = await supabase.from('tags').delete().eq('id', tagId);
    if (error) throw error;
    return { error: null };
  } catch (err) {
    console.error('[Supabase] deleteTag failed:', err);
    return { error: err };
  }
}

// ─── Categories ───────────────────────────────────────────────────────────────

/**
 * Creates a new category (subject or project).
 * @param {Object} categoryData - Must include user_id, name, type.
 * @returns {Promise<{data: Object|null, error: Object|null}>}
 */
export async function createCategory(categoryData) {
  try {
    const { data, error } = await supabase
      .from('categories')
      .insert(categoryData)
      .select()
      .single();
    if (error) throw error;
    return { data, error: null };
  } catch (err) {
    console.error('[Supabase] createCategory failed:', err);
    return { data: null, error: err };
  }
}

/**
 * Updates a category.
 * @param {string} categoryId
 * @param {Object} updates
 * @returns {Promise<{data: Object|null, error: Object|null}>}
 */
export async function updateCategory(categoryId, updates) {
  try {
    const { data, error } = await supabase
      .from('categories')
      .update(updates)
      .eq('id', categoryId)
      .select()
      .single();
    if (error) throw error;
    return { data, error: null };
  } catch (err) {
    console.error('[Supabase] updateCategory failed:', err);
    return { data: null, error: err };
  }
}

/**
 * Deletes a category.
 * @param {string} categoryId
 * @returns {Promise<{error: Object|null}>}
 */
export async function deleteCategory(categoryId) {
  try {
    const { error } = await supabase.from('categories').delete().eq('id', categoryId);
    if (error) throw error;
    return { error: null };
  } catch (err) {
    console.error('[Supabase] deleteCategory failed:', err);
    return { error: err };
  }
}

// ─── Weekly Goals ─────────────────────────────────────────────────────────────

/**
 * Fetches all weekly goals for a given week.
 * @param {string} userId
 * @param {string} weekStart - ISO date of the Monday of that week
 * @returns {Promise<Array>}
 */
export async function fetchWeeklyGoals(userId, weekStart) {
  try {
    const { data, error } = await supabase
      .from('weekly_goals')
      .select('*')
      .eq('user_id', userId)
      .eq('week_start', weekStart)
      .order('sort_order');
    if (error) throw error;
    return data ?? [];
  } catch (err) {
    console.error('[Supabase] fetchWeeklyGoals failed:', err);
    return [];
  }
}

/**
 * Creates a new weekly goal.
 * @param {Object} goalData - Must include user_id, week_start, text.
 * @returns {Promise<{data: Object|null, error: Object|null}>}
 */
export async function createWeeklyGoal(goalData) {
  try {
    const payload = {
      ...goalData,
      device_id: DEVICE_ID,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from('weekly_goals')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return { data, error: null };
  } catch (err) {
    console.error('[Supabase] createWeeklyGoal failed:', err);
    return { data: null, error: err };
  }
}

/**
 * Updates a weekly goal (e.g. toggle completed, edit text).
 * @param {string} goalId
 * @param {Object} updates
 * @returns {Promise<{data: Object|null, error: Object|null}>}
 */
export async function updateWeeklyGoal(goalId, updates) {
  try {
    const payload = {
      ...updates,
      device_id: DEVICE_ID,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from('weekly_goals')
      .update(payload)
      .eq('id', goalId)
      .select()
      .single();
    if (error) throw error;
    return { data, error: null };
  } catch (err) {
    console.error('[Supabase] updateWeeklyGoal failed:', err);
    return { data: null, error: err };
  }
}

/**
 * Deletes a weekly goal.
 * @param {string} goalId
 * @returns {Promise<{error: Object|null}>}
 */
export async function deleteWeeklyGoal(goalId) {
  try {
    const { error } = await supabase.from('weekly_goals').delete().eq('id', goalId);
    if (error) throw error;
    return { error: null };
  } catch (err) {
    console.error('[Supabase] deleteWeeklyGoal failed:', err);
    return { error: err };
  }
}
