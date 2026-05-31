/**
 * @file today.js
 * @description Renders and manages the Today page — greeting, todos, metrics, wins, and pillar blocks.
 * @module Today
 */

import { STATE, subscribe } from './state.js';
import { upsertDailyLog } from './supabase.js';
import { syncWrite } from './sync.js';
import { vibrate, HAPTIC_TICK, HAPTIC_COMPLETE, HAPTIC_ADD } from './haptics.js';
import { attachSwipeToComplete } from './gestures.js';
import { showPage } from './nav.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const SECS_PER_HOUR = 3600;
const MINS_PER_HOUR = 60;
const MAX_HOURS_INPUT = 24;
const HOURS_STEP = 0.5;
const ALL_DONE_LABEL_MS = 2200;
const TODAY_PAGE_ID = 'today';

// ─── Greeting helpers ─────────────────────────────────────────────────────────

/**
 * Returns a time-appropriate greeting prefix.
 * @returns {string} 'Good morning' | 'Good afternoon' | 'Good evening'
 */
function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Formats a date object as a readable string, e.g. "Monday, 28 April".
 * @param {Date} date
 * @returns {string}
 */
function formatDateLabel(date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

// ─── Streak calculation ───────────────────────────────────────────────────────

/**
 * Calculates the current streak: consecutive days (ending today or yesterday)
 * where at least one timer session was completed.
 * @param {Array} sessions - Array of timer_session objects from STATE.sessions
 * @returns {number} streak count
 */
function calcStreak(sessions) {
  if (!sessions || sessions.length === 0) return 0;

  const datesWithSessions = new Set(
    sessions.filter((s) => s.completed).map((s) => s.session_date)
  );

  let streak = 0;
  const today = new Date();
  const check = new Date(today);

  // Allow streak to count even if today has no sessions yet (don't break for today's gap)
  const todayStr = check.toISOString().slice(0, 10);
  if (!datesWithSessions.has(todayStr)) {
    // Try starting from yesterday
    check.setDate(check.getDate() - 1);
  }

  for (let i = 0; i < 365; i++) {
    const dateStr = check.toISOString().slice(0, 10);
    if (datesWithSessions.has(dateStr)) {
      streak++;
      check.setDate(check.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

// ─── Focus goal helpers ───────────────────────────────────────────────────────

/**
 * Sums duration_secs for today's timer sessions.
 * @param {Array} sessions - Full sessions array from STATE
 * @param {string} todayDate - ISO date string
 * @returns {number} Total seconds focused today
 */
function getTodayFocusSecs(sessions, todayDate) {
  if (!sessions) return 0;
  return sessions
    .filter((s) => s.session_date === todayDate && s.completed)
    .reduce((sum, s) => sum + (s.duration_secs || 0), 0);
}

/**
 * Formats seconds to "Xh Ym" string, e.g. "2h 15m".
 * @param {number} secs
 * @returns {string}
 */
function formatHoursMinutes(secs) {
  const totalMins = Math.floor(secs / 60);
  const h = Math.floor(totalMins / MINS_PER_HOUR);
  const m = totalMins % MINS_PER_HOUR;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// ─── Tag label helpers ────────────────────────────────────────────────────────

/**
 * Returns the display label for the career "study" metric.
 * Uses first tag with maps_to='study-hrs' or falls back to "Study".
 * @returns {string}
 */
function getStudyLabel() {
  const tag = (STATE.tags || []).find((t) => t.maps_to === 'study-hrs');
  return tag ? tag.name : 'Study';
}

/**
 * Returns the display label for the career "business" metric.
 * Uses first tag with maps_to='biz-hrs' or falls back to "Business".
 * @returns {string}
 */
function getBizLabel() {
  const tag = (STATE.tags || []).find((t) => t.maps_to === 'biz-hrs');
  return tag ? tag.name : 'Business';
}

// ─── Metric helpers ───────────────────────────────────────────────────────────

/**
 * Returns completion percentage of todos (0–100).
 * @param {Array} todos
 * @returns {number}
 */
function calcCompletionPct(todos) {
  if (!todos || todos.length === 0) return 0;
  const done = todos.filter((t) => t.completed).length;
  return Math.round((done / todos.length) * 100);
}

/**
 * Counts completed and total habits for today.
 * @param {Array} habits
 * @param {Object} checks - { [habitId]: boolean }
 * @returns {{ done: number, total: number }}
 */
function calcHabitCounts(habits, checks) {
  if (!habits || habits.length === 0) return { done: 0, total: 0 };
  const active = habits.filter((h) => h.is_active);
  const done = active.filter((h) => checks && checks[h.id]).length;
  return { done, total: active.length };
}

// ─── Auto-populate timer totals into career fields ────────────────────────────

/**
 * Sums today's session durations for sessions whose tag maps_to a given value.
 * @param {Array} sessions
 * @param {string} todayDate
 * @param {string} mapsTo - 'study-hrs' | 'biz-hrs'
 * @returns {number} total minutes
 */
function calcTagMins(sessions, todayDate, mapsTo) {
  if (!sessions) return 0;
  const relevantTags = new Set(
    (STATE.tags || []).filter((t) => t.maps_to === mapsTo).map((t) => t.name)
  );
  return sessions
    .filter(
      (s) =>
        s.session_date === todayDate &&
        s.completed &&
        relevantTags.has(s.tag_name)
    )
    .reduce((sum, s) => sum + Math.floor((s.duration_secs || 0) / 60), 0);
}

// ─── DOM helpers ─────────────────────────────────────────────────────────────

/**
 * Creates an icon SVG element by name (inline SVG paths).
 * @param {string} name
 * @returns {SVGElement}
 */
function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.classList.add('icon');

  const path = document.createElementNS(ns, 'path');

  const paths = {
    check: 'M20 6L9 17l-5-5',
    plus: 'M12 5v14M5 12h14',
    trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
    chevron: 'M6 9l6 6 6-6',
    circle: '',
    'check-circle': 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3',
    'arrow-right': 'M5 12h14M12 5l7 7-7 7',
    flame: 'M12 2c0 0-5 5-5 10a5 5 0 0 0 10 0c0-5-5-10-5-10z',
  };

  if (name === 'circle') {
    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('cx', '12');
    circle.setAttribute('cy', '12');
    circle.setAttribute('r', '10');
    svg.appendChild(circle);
  } else if (paths[name]) {
    path.setAttribute('d', paths[name]);
    svg.appendChild(path);
  }

  return svg;
}

// ─── Core update helper ───────────────────────────────────────────────────────

/**
 * Persists todayLog changes to Supabase and triggers a sync write.
 * @param {Object} patch - Partial daily_log fields to merge
 */
async function persistLog(patch) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    await upsertDailyLog({ log_date: today, ...patch });
    syncWrite();
  } catch (err) {
    console.error('[Today] persistLog failed:', err);
  }
}

// ─── Wins row ─────────────────────────────────────────────────────────────────

/**
 * Renders the wins row from STATE.wins and STATE.todayLog.wins_achieved.
 * @returns {HTMLElement}
 */
function buildWinsRow() {
  const wins = STATE.wins || [];
  const achieved = new Set(STATE.todayLog?.wins_achieved || []);

  const wrapper = document.createElement('div');
  wrapper.className = 'wins-row';

  if (wins.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'wins-row__empty';
    empty.textContent = 'Add wins in Settings →';
    wrapper.appendChild(empty);
    return wrapper;
  }

  wins.forEach((win) => {
    const chip = document.createElement('button');
    chip.className = 'win-chip' + (achieved.has(win.id) ? ' win-chip--achieved' : '');
    chip.textContent = win.name;
    chip.dataset.winId = win.id;

    chip.addEventListener('click', async () => {
      vibrate(HAPTIC_TICK);
      const nowAchieved = new Set(STATE.todayLog?.wins_achieved || []);
      if (nowAchieved.has(win.id)) {
        nowAchieved.delete(win.id);
      } else {
        nowAchieved.add(win.id);
      }
      const updated = Array.from(nowAchieved);
      if (!STATE.todayLog) STATE.todayLog = {};
      STATE.todayLog.wins_achieved = updated;
      chip.classList.toggle('win-chip--achieved');
      await persistLog({ wins_achieved: updated });
    });

    wrapper.appendChild(chip);
  });

  return wrapper;
}

// ─── To-Do list ───────────────────────────────────────────────────────────────

/**
 * Creates a single todo item element.
 * @param {Object} todo - { id, text, completed }
 * @param {Function} onToggle
 * @param {Function} onDelete
 * @returns {HTMLElement}
 */
function buildTodoItem(todo, onToggle, onDelete) {
  const item = document.createElement('div');
  item.className = 'todo-item' + (todo.completed ? ' todo-item--completed' : '');
  item.dataset.todoId = todo.id;

  // Swipe background
  const swipeBg = document.createElement('div');
  swipeBg.className = 'todo-item__swipe-bg';
  const swipeCheck = document.createElement('span');
  swipeCheck.className = 'todo-item__swipe-check';
  swipeCheck.innerHTML = '✓';
  swipeBg.appendChild(swipeCheck);
  item.appendChild(swipeBg);

  // Content row
  const row = document.createElement('div');
  row.className = 'todo-item__row';

  // Check circle
  const check = document.createElement('button');
  check.className = 'todo-item__check';
  check.setAttribute('aria-label', todo.completed ? 'Uncheck task' : 'Check task');
  if (todo.completed) {
    check.appendChild(icon('check-circle'));
  } else {
    check.appendChild(icon('circle'));
  }
  check.addEventListener('click', (e) => {
    e.stopPropagation();
    onToggle(todo.id);
  });

  // Text
  const text = document.createElement('span');
  text.className = 'todo-item__text';
  text.textContent = todo.text;

  // Delete
  const del = document.createElement('button');
  del.className = 'todo-item__delete';
  del.setAttribute('aria-label', 'Delete task');
  del.appendChild(icon('trash'));
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    onDelete(todo.id);
  });

  row.appendChild(check);
  row.appendChild(text);
  row.appendChild(del);
  item.appendChild(row);

  return item;
}

/**
 * Renders the full todo section including add-task input.
 * @returns {HTMLElement}
 */
function buildTodoSection() {
  const todos = STATE.todayLog?.todos || [];

  const section = document.createElement('div');
  section.className = 'today-section todo-section';

  const header = document.createElement('div');
  header.className = 'today-section__header';
  const title = document.createElement('h3');
  title.className = 'today-section__title';
  title.textContent = 'Today\'s Tasks';
  header.appendChild(title);
  section.appendChild(header);

  const list = document.createElement('div');
  list.className = 'todo-list';
  section.appendChild(list);

  const renderList = () => {
    list.innerHTML = '';
    const currentTodos = STATE.todayLog?.todos || [];
    currentTodos.forEach((todo) => {
      const item = buildTodoItem(
        todo,
        async (id) => {
          vibrate(HAPTIC_TICK);
          const updated = (STATE.todayLog.todos || []).map((t) =>
            t.id === id ? { ...t, completed: !t.completed } : t
          );
          STATE.todayLog.todos = updated;
          renderList();
          updateMetricCards();
          await persistLog({ todos: updated });
        },
        async (id) => {
          vibrate(HAPTIC_TICK);
          const updated = (STATE.todayLog.todos || []).filter((t) => t.id !== id);
          STATE.todayLog.todos = updated;
          renderList();
          updateMetricCards();
          await persistLog({ todos: updated });
        }
      );

      list.appendChild(item);

      if (!todo.completed) {
        attachSwipeToComplete(item, async () => {
          vibrate(HAPTIC_TICK);
          const updated = (STATE.todayLog.todos || []).map((t) =>
            t.id === todo.id ? { ...t, completed: true } : t
          );
          STATE.todayLog.todos = updated;
          renderList();
          updateMetricCards();
          await persistLog({ todos: updated });
        });
      }
    });
  };

  renderList();

  // Add task row
  const addRow = document.createElement('div');
  addRow.className = 'todo-add-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'todo-add-row__input';
  input.placeholder = 'Add a task…';
  input.setAttribute('aria-label', 'New task');

  const addBtn = document.createElement('button');
  addBtn.className = 'todo-add-row__btn';
  addBtn.setAttribute('aria-label', 'Add task');
  addBtn.appendChild(icon('plus'));

  const addTask = async () => {
    const text = input.value.trim();
    if (!text) return;
    vibrate(HAPTIC_ADD);
    const newTodo = {
      id: crypto.randomUUID(),
      text,
      completed: false,
      createdAt: Date.now(),
    };
    if (!STATE.todayLog) STATE.todayLog = {};
    const updated = [...(STATE.todayLog.todos || []), newTodo];
    STATE.todayLog.todos = updated;
    input.value = '';
    renderList();
    updateMetricCards();
    await persistLog({ todos: updated });
  };

  addBtn.addEventListener('click', addTask);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addTask();
  });

  addRow.appendChild(input);
  addRow.appendChild(addBtn);
  section.appendChild(addRow);

  return section;
}

// ─── Metric cards ─────────────────────────────────────────────────────────────

let _metricCardEls = null;

/**
 * Builds the 4 metric card grid.
 * @returns {HTMLElement}
 */
function buildMetricCards() {
  const grid = document.createElement('div');
  grid.className = 'metrics-grid';
  grid.id = 'today-metrics-grid';

  const cards = [
    { id: 'metric-completion', label: 'Completion', value: '—', sub: '' },
    { id: 'metric-habits', label: 'Habits', value: '—', sub: '' },
    { id: 'metric-study', label: getStudyLabel(), value: '—', sub: 'today' },
    { id: 'metric-biz', label: getBizLabel(), value: '—', sub: 'today' },
  ];

  cards.forEach((c) => {
    const card = document.createElement('div');
    card.className = 'metric-card';
    card.id = c.id;

    const lbl = document.createElement('span');
    lbl.className = 'metric-card__label';
    lbl.textContent = c.label;

    const val = document.createElement('span');
    val.className = 'metric-card__value';
    val.textContent = c.value;

    card.appendChild(lbl);
    card.appendChild(val);
    grid.appendChild(card);
  });

  _metricCardEls = grid;
  updateMetricCards(grid);
  return grid;
}

/**
 * Re-populates metric card values from current STATE.
 * @param {HTMLElement} [container] - optional grid element (uses cached if omitted)
 */
function updateMetricCards(container) {
  const grid = container || document.getElementById('today-metrics-grid');
  if (!grid) return;

  const todos = STATE.todayLog?.todos || [];
  const habits = STATE.habits || [];
  const allChecks = {
    ...(STATE.todayLog?.career_checks || {}),
    ...(STATE.todayLog?.physical_checks || {}),
    ...(STATE.todayLog?.spiritual_checks || {}),
  };
  const todayDate = new Date().toISOString().slice(0, 10);

  // Completion %
  const pct = calcCompletionPct(todos);
  const compEl = grid.querySelector('#metric-completion .metric-card__value');
  if (compEl) compEl.textContent = todos.length ? `${pct}%` : '—';

  // Habits done/total
  const habitCounts = calcHabitCounts(habits, allChecks);
  const habEl = grid.querySelector('#metric-habits .metric-card__value');
  if (habEl)
    habEl.textContent =
      habitCounts.total ? `${habitCounts.done}/${habitCounts.total}` : '—';

  // Study mins (higher of manual or timer)
  const studyTimerMins = calcTagMins(STATE.sessions, todayDate, 'study-hrs');
  const studyManualMins = STATE.todayLog?.career_study_mins || 0;
  const studyMins = Math.max(studyTimerMins, studyManualMins);
  const studyEl = grid.querySelector('#metric-study .metric-card__value');
  if (studyEl)
    studyEl.textContent = studyMins ? formatHoursMinutes(studyMins * 60) : '0m';

  // Biz mins (higher of manual or timer)
  const bizTimerMins = calcTagMins(STATE.sessions, todayDate, 'biz-hrs');
  const bizManualMins = STATE.todayLog?.career_biz_mins || 0;
  const bizMins = Math.max(bizTimerMins, bizManualMins);
  const bizEl = grid.querySelector('#metric-biz .metric-card__value');
  if (bizEl) bizEl.textContent = bizMins ? formatHoursMinutes(bizMins * 60) : '0m';
}

// ─── Focus bar ────────────────────────────────────────────────────────────────

/**
 * Builds the focus goal progress bar.
 * @param {number} todayFocusSecs
 * @param {number} goalHours
 * @returns {HTMLElement}
 */
function buildFocusBar(todayFocusSecs, goalHours) {
  const goalSecs = goalHours * SECS_PER_HOUR;
  const pct = goalSecs > 0 ? Math.min(100, (todayFocusSecs / goalSecs) * 100) : 0;

  const wrapper = document.createElement('div');
  wrapper.className = 'focus-bar';
  wrapper.id = 'today-focus-bar';

  const row = document.createElement('div');
  row.className = 'focus-bar__row';

  const label = document.createElement('span');
  label.className = 'focus-bar__label';
  label.textContent = 'Daily Focus';

  const time = document.createElement('span');
  time.className = 'focus-bar__time';
  time.textContent =
    goalHours > 0
      ? `${formatHoursMinutes(todayFocusSecs)} / ${goalHours}h`
      : formatHoursMinutes(todayFocusSecs);

  row.appendChild(label);
  row.appendChild(time);

  const track = document.createElement('div');
  track.className = 'focus-bar__track';

  const fill = document.createElement('div');
  fill.className = 'focus-bar__fill';
  fill.style.width = `${pct}%`;

  track.appendChild(fill);
  wrapper.appendChild(row);
  wrapper.appendChild(track);

  return wrapper;
}

// ─── Pillar blocks ────────────────────────────────────────────────────────────

/**
 * Returns all active habits for a given pillar.
 * @param {string} pillar - 'career' | 'physical' | 'spiritual'
 * @returns {Array}
 */
function habitsForPillar(pillar) {
  return (STATE.habits || []).filter(
    (h) => h.pillar === pillar && h.is_active !== false
  );
}

/**
 * Counts completed habits for a pillar.
 * @param {string} pillar
 * @param {Object} checks
 * @returns {{ done: number, total: number }}
 */
function pillarHabitCounts(pillar, checks) {
  const habits = habitsForPillar(pillar);
  const done = habits.filter((h) => checks && checks[h.id]).length;
  return { done, total: habits.length };
}

/**
 * Checks if all habits in a pillar are complete.
 * @param {string} pillar
 * @param {Object} checks
 * @returns {boolean}
 */
function isPillarComplete(pillar, checks) {
  const habits = habitsForPillar(pillar);
  if (habits.length === 0) return false;
  return habits.every((h) => checks && checks[h.id]);
}

/**
 * Auto-marks the win for a given pillar when all habits are done.
 * Finds a win with a name matching the pillar and adds it to wins_achieved.
 * @param {string} pillar
 */
async function autoMarkPillarWin(pillar) {
  const pillarWin = (STATE.wins || []).find(
    (w) => w.pillar === pillar || w.name.toLowerCase().includes(pillar)
  );
  if (!pillarWin) return;

  const achieved = new Set(STATE.todayLog?.wins_achieved || []);
  if (achieved.has(pillarWin.id)) return; // already done

  achieved.add(pillarWin.id);
  const updated = Array.from(achieved);
  if (!STATE.todayLog) STATE.todayLog = {};
  STATE.todayLog.wins_achieved = updated;

  // Update win chip UI
  const chip = document.querySelector(`.win-chip[data-win-id="${pillarWin.id}"]`);
  if (chip) chip.classList.add('win-chip--achieved');

  await persistLog({ wins_achieved: updated });
}

/**
 * Shows an "All done!" flash label in the block header.
 * @param {HTMLElement} headerEl
 */
function showAllDoneLabel(headerEl) {
  const existing = headerEl.querySelector('.pillar-block__all-done');
  if (existing) return;

  const label = document.createElement('span');
  label.className = 'pillar-block__all-done';
  label.textContent = 'All done ✓';
  headerEl.appendChild(label);

  setTimeout(() => label.remove(), ALL_DONE_LABEL_MS);
}

/**
 * Builds a habit checkbox row.
 * @param {Object} habit
 * @param {boolean} checked
 * @param {string} pillar
 * @param {HTMLElement} headerEl - pillar block header, for "all done" flash
 * @param {HTMLElement} countEl - element showing "X/Y done"
 * @returns {HTMLElement}
 */
function buildHabitRow(habit, checked, pillar, headerEl, countEl) {
  const row = document.createElement('label');
  row.className = 'check-row';

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'check-row__input';
  cb.checked = !!checked;
  cb.setAttribute('aria-label', habit.name);

  const box = document.createElement('span');
  box.className = 'check-row__box' + (checked ? ' check-row__box--checked' : '');

  const txt = document.createElement('span');
  txt.className = 'check-row__label';
  txt.textContent = habit.name;

  row.appendChild(cb);
  row.appendChild(box);
  row.appendChild(txt);

  cb.addEventListener('change', async () => {
    vibrate(HAPTIC_TICK);
    const checksKey = `${pillar}_checks`;
    const current = { ...(STATE.todayLog?.[checksKey] || {}) };
    current[habit.id] = cb.checked;

    if (!STATE.todayLog) STATE.todayLog = {};
    STATE.todayLog[checksKey] = current;

    box.classList.toggle('check-row__box--checked', cb.checked);
    updateMetricCards();

    // Update count label
    const { done, total } = pillarHabitCounts(pillar, current);
    if (countEl) countEl.textContent = `${done}/${total} done`;

    // Check if pillar complete
    if (isPillarComplete(pillar, current)) {
      vibrate(HAPTIC_COMPLETE);
      showAllDoneLabel(headerEl);
      await autoMarkPillarWin(pillar);
    }

    await persistLog({ [checksKey]: current });
  });

  return row;
}

/**
 * Builds an inline number/text field for the pillar body.
 * @param {Object} opts
 * @returns {HTMLElement}
 */
function buildInlineField({ label, value, type = 'number', min, max, step, placeholder, onChange }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'inline-field';

  const lbl = document.createElement('span');
  lbl.className = 'inline-label';
  lbl.textContent = label;

  const input = document.createElement('input');
  input.type = type;
  input.className = 'inline-input';
  if (min !== undefined) input.min = min;
  if (max !== undefined) input.max = max;
  if (step !== undefined) input.step = step;
  if (placeholder !== undefined) input.placeholder = placeholder;
  input.value = value !== undefined && value !== null ? value : '';
  input.setAttribute('aria-label', label);

  input.addEventListener('change', () => onChange(input.value));

  wrapper.appendChild(lbl);
  wrapper.appendChild(input);
  return wrapper;
}

/**
 * Builds a pillar block (career, physical, or spiritual).
 * @param {string} pillar
 * @param {Object} opts
 * @returns {HTMLElement}
 */
function buildPillarBlock(pillar, { onlyOne }) {
  const log = STATE.todayLog || {};
  const checksKey = `${pillar}_checks`;
  const checks = log[checksKey] || {};
  const habits = habitsForPillar(pillar);
  const { done, total } = pillarHabitCounts(pillar, checks);

  const block = document.createElement('div');
  block.className = `pillar-block pillar-block--${pillar}`;
  block.dataset.pillar = pillar;

  // ── Header
  const header = document.createElement('div');
  header.className = 'pillar-block__header';
  header.setAttribute('role', 'button');
  header.setAttribute('tabindex', '0');
  header.setAttribute('aria-expanded', 'false');

  const dot = document.createElement('span');
  dot.className = `pillar-block__dot pillar-block__dot--${pillar}`;

  const titleEl = document.createElement('span');
  titleEl.className = 'pillar-block__title';
  titleEl.textContent =
    pillar.charAt(0).toUpperCase() + pillar.slice(1);

  const countEl = document.createElement('span');
  countEl.className = 'pillar-block__count';
  countEl.textContent = total ? `${done}/${total} done` : 'No habits';

  const chevron = document.createElement('span');
  chevron.className = 'pillar-block__chevron';
  chevron.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><path d="M6 9l6 6 6-6"/></svg>';

  header.appendChild(dot);
  header.appendChild(titleEl);
  header.appendChild(countEl);
  header.appendChild(chevron);
  block.appendChild(header);

  // ── Body
  const body = document.createElement('div');
  body.className = 'pillar-block__body';
  block.appendChild(body);

  // Habit checkboxes
  habits.forEach((habit) => {
    const row = buildHabitRow(habit, !!checks[habit.id], pillar, header, countEl);
    body.appendChild(row);
  });

  // Pillar-specific fields
  if (pillar === 'career') {
    const todayDate = new Date().toISOString().slice(0, 10);
    const studyTimerMins = calcTagMins(STATE.sessions, todayDate, 'study-hrs');
    const studyManualMins = log.career_study_mins || 0;
    const studyDisplayMins = Math.max(studyTimerMins, studyManualMins);

    body.appendChild(
      buildInlineField({
        label: `${getStudyLabel()} Hours`,
        value: studyDisplayMins ? (studyDisplayMins / MINS_PER_HOUR).toFixed(1) : '',
        type: 'number',
        min: 0,
        max: MAX_HOURS_INPUT,
        step: HOURS_STEP,
        placeholder: '0',
        onChange: async (val) => {
          const mins = Math.round(parseFloat(val || 0) * MINS_PER_HOUR);
          if (!STATE.todayLog) STATE.todayLog = {};
          STATE.todayLog.career_study_mins = mins;
          updateMetricCards();
          await persistLog({ career_study_mins: mins });
        },
      })
    );

    const bizTimerMins = calcTagMins(STATE.sessions, todayDate, 'biz-hrs');
    const bizManualMins = log.career_biz_mins || 0;
    const bizDisplayMins = Math.max(bizTimerMins, bizManualMins);

    body.appendChild(
      buildInlineField({
        label: `${getBizLabel()} Hours`,
        value: bizDisplayMins ? (bizDisplayMins / MINS_PER_HOUR).toFixed(1) : '',
        type: 'number',
        min: 0,
        max: MAX_HOURS_INPUT,
        step: HOURS_STEP,
        placeholder: '0',
        onChange: async (val) => {
          const mins = Math.round(parseFloat(val || 0) * MINS_PER_HOUR);
          if (!STATE.todayLog) STATE.todayLog = {};
          STATE.todayLog.career_biz_mins = mins;
          updateMetricCards();
          await persistLog({ career_biz_mins: mins });
        },
      })
    );

    // Custom career fields
    const careerCustom = log.career_custom || {};
    renderCustomFields(body, careerCustom, 'career_custom');
  }

  if (pillar === 'physical') {
    body.appendChild(
      buildInlineField({
        label: 'Calories',
        value: log.physical_calories || '',
        type: 'number',
        min: 0,
        placeholder: '0',
        onChange: async (val) => {
          const n = parseInt(val || 0, 10);
          if (!STATE.todayLog) STATE.todayLog = {};
          STATE.todayLog.physical_calories = n;
          await persistLog({ physical_calories: n });
        },
      })
    );

    body.appendChild(
      buildInlineField({
        label: 'Protein (g)',
        value: log.physical_protein || '',
        type: 'number',
        min: 0,
        placeholder: '0',
        onChange: async (val) => {
          const n = parseInt(val || 0, 10);
          if (!STATE.todayLog) STATE.todayLog = {};
          STATE.todayLog.physical_protein = n;
          await persistLog({ physical_protein: n });
        },
      })
    );

    const physCustom = log.physical_custom || {};
    renderCustomFields(body, physCustom, 'physical_custom');
  }

  if (pillar === 'spiritual') {
    const spirCustom = log.spiritual_custom || {};
    renderCustomFields(body, spirCustom, 'spiritual_custom');

    // Link to spiritual page
    const link = document.createElement('button');
    link.className = 'pillar-block__nav-link';
    link.textContent = 'Open practice →';
    link.addEventListener('click', () => showPage('spiritual'));
    body.appendChild(link);
  }

  // ── Accordion toggle
  const toggle = () => {
    const isExpanded = block.classList.contains('pillar-block--expanded');

    if (!isExpanded) {
      // Collapse all other blocks (accordion pattern)
      if (onlyOne) {
        document.querySelectorAll('.pillar-block--expanded').forEach((b) => {
          b.classList.remove('pillar-block--expanded');
          b.querySelector('.pillar-block__header')?.setAttribute('aria-expanded', 'false');
        });
      }
      block.classList.add('pillar-block--expanded');
      header.setAttribute('aria-expanded', 'true');
    } else {
      block.classList.remove('pillar-block--expanded');
      header.setAttribute('aria-expanded', 'false');
    }
  };

  header.addEventListener('click', toggle);
  header.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  });

  return block;
}

/**
 * Renders custom fields (from settings extra fields) into a container.
 * @param {HTMLElement} container
 * @param {Object} customData - { [fieldId]: value }
 * @param {string} logKey - e.g. 'career_custom'
 */
function renderCustomFields(container, customData, logKey) {
  // Custom fields are stored in STATE.profile or settings — currently
  // rendered if extra fields data is present. This is a forward-compatible
  // stub: we iterate any keys present in customData and render them.
  const profile = STATE.profile || {};
  const extraFields = profile[`${logKey}_fields`] || [];

  extraFields.forEach((field) => {
    if (field.type === 'checkbox') {
      const row = document.createElement('label');
      row.className = 'check-row';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'check-row__input';
      cb.checked = !!customData[field.id];

      const box = document.createElement('span');
      box.className = 'check-row__box' + (cb.checked ? ' check-row__box--checked' : '');

      const txt = document.createElement('span');
      txt.className = 'check-row__label';
      txt.textContent = field.label;

      row.appendChild(cb);
      row.appendChild(box);
      row.appendChild(txt);

      cb.addEventListener('change', async () => {
        vibrate(HAPTIC_TICK);
        box.classList.toggle('check-row__box--checked', cb.checked);
        const updated = { ...(STATE.todayLog?.[logKey] || {}), [field.id]: cb.checked };
        if (!STATE.todayLog) STATE.todayLog = {};
        STATE.todayLog[logKey] = updated;
        await persistLog({ [logKey]: updated });
      });

      container.appendChild(row);
    } else {
      // textarea
      const wrapper = document.createElement('div');
      wrapper.className = 'inline-field inline-field--text';

      const lbl = document.createElement('span');
      lbl.className = 'inline-label';
      lbl.textContent = field.label;

      const ta = document.createElement('textarea');
      ta.className = 'inline-textarea';
      ta.value = customData[field.id] || '';
      ta.rows = 2;
      ta.placeholder = field.placeholder || '';

      ta.addEventListener('blur', async () => {
        const updated = { ...(STATE.todayLog?.[logKey] || {}), [field.id]: ta.value };
        if (!STATE.todayLog) STATE.todayLog = {};
        STATE.todayLog[logKey] = updated;
        await persistLog({ [logKey]: updated });
      });

      wrapper.appendChild(lbl);
      wrapper.appendChild(ta);
      container.appendChild(wrapper);
    }
  });
}

// ─── Hero / greeting area ─────────────────────────────────────────────────────

/**
 * Builds the hero greeting + date + streak badge.
 * @returns {HTMLElement}
 */
function buildHero() {
  const hero = document.createElement('div');
  hero.className = 'today-hero';

  const greeting = document.createElement('h1');
  greeting.className = 'today-hero__greeting';
  const name = STATE.profile?.display_name;
  greeting.textContent = `${getGreeting()}${name ? `, ${name}` : ''}`;

  const dateEl = document.createElement('p');
  dateEl.className = 'today-hero__date';
  dateEl.textContent = formatDateLabel(new Date());

  hero.appendChild(greeting);
  hero.appendChild(dateEl);

  // Streak badge
  const streak = calcStreak(STATE.sessions);
  if (streak >= 2) {
    const badge = document.createElement('div');
    badge.className = 'streak-badge';

    const flameSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    flameSvg.setAttribute('viewBox', '0 0 24 24');
    flameSvg.setAttribute('fill', 'currentColor');
    flameSvg.classList.add('icon', 'streak-badge__icon');
    const flamePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    flamePath.setAttribute(
      'd',
      'M12 2c0 0-4 4-4 9a4 4 0 0 0 8 0c0-2-1-4-2-5 0 2-1 3-2 3s-2-1-2-3c0-2 2-4 2-4z'
    );
    flameSvg.appendChild(flamePath);

    const badgeText = document.createElement('span');
    badgeText.textContent = `${streak} day streak`;

    badge.appendChild(flameSvg);
    badge.appendChild(badgeText);
    hero.appendChild(badge);
  }

  return hero;
}

// ─── Full page render ─────────────────────────────────────────────────────────

/**
 * Initializes the Today page by rendering all components into #page-today.
 * @returns {void}
 */
export function initToday() {
  const page = document.getElementById('page-today');
  if (!page) return;

  page.innerHTML = '';

  const scroll = document.createElement('div');
  scroll.className = 'page-scroll';

  // Hero
  scroll.appendChild(buildHero());

  // Focus bar
  const todayDate = new Date().toISOString().slice(0, 10);
  const todayFocusSecs = getTodayFocusSecs(STATE.sessions, todayDate);
  const goalHours = STATE.profile?.focus_goal_hours || 4;
  scroll.appendChild(buildFocusBar(todayFocusSecs, goalHours));

  // Metric cards
  scroll.appendChild(buildMetricCards());

  // Wins row
  const winsSection = document.createElement('div');
  winsSection.className = 'today-section wins-section';
  winsSection.id = 'today-wins-section';
  winsSection.appendChild(buildWinsRow());
  scroll.appendChild(winsSection);

  // Todos
  scroll.appendChild(buildTodoSection());

  // Pillar blocks
  const pillarsSection = document.createElement('div');
  pillarsSection.className = 'pillars-section';

  ['career', 'physical', 'spiritual'].forEach((pillar) => {
    pillarsSection.appendChild(buildPillarBlock(pillar, { onlyOne: true }));
  });

  scroll.appendChild(pillarsSection);
  page.appendChild(scroll);

  // Subscribe to todayLog changes for refresh
  subscribe('todayLog', refreshToday);
}

/**
 * Re-renders the Today page when STATE.todayLog changes.
 * Called by sync.js via the state subscriber.
 * @returns {void}
 */
export function refreshToday() {
  const page = document.getElementById('page-today');
  if (!page || !page.classList.contains('page--active')) return;
  // Full re-render keeps it simple and bug-free.
  initToday();
}
// Auto-init when authenticated app is ready, refresh on page revisit
window.addEventListener('daily-os:ready', () => initToday());
window.addEventListener('daily-os:page-shown', (e) => {
  if (e.detail?.page === TODAY_PAGE_ID) refreshToday();
});
