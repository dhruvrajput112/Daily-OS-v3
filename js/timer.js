/**
 * @file timer.js
 * @description Timer page UI and logic: Timer, Stopwatch, and Pomodoro modes.
 *              Single master tick interval, localStorage persistence via timer-state.js,
 *              completed sessions written to Supabase via insertTimerSession().
 *              HTML template lives in timer-html.js (split per 400-line rule).
 * @module Timer
 */

import { STATE } from './state.js';
import { insertTimerSession } from './supabase.js';
import { updateSessionBanner } from './nav.js';
import { vibrate, HAPTIC_TIMER_END, HAPTIC_POMO_DONE, HAPTIC_SESSION, HAPTIC_ERROR } from './haptics.js';
import { saveTimerState, loadTimerState, clearTimerState } from './timer-state.js';
import { buildTimerHTML } from './timer-html.js';

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_SESS = 10;
const CIRC     = 2 * Math.PI * 88; // must match timer-html.js

// ─── Private module state ─────────────────────────────────────────────────────
let _tick = null; // THE single setInterval — startTick() guards against duplicates
let _mode = 'timer', _running = false, _paused = false;
let _startTs = 0, _pausedAt = 0, _totalPausedMs = 0;
let _duration = 1500, _elapsed = 0; // seconds
let _phase = 'focus', _focusDone = 0, _cycle = 0; // pomodoro only
let _tag = '', _tagColor = '', _cat = '', _catType = 'subject', _catColor = '';

// ─── Micro-utilities ──────────────────────────────────────────────────────────
const pad    = n  => String(n).padStart(2, '0');
const hms    = s  => { const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),ss=s%60; return h?`${h}:${pad(m)}:${pad(ss)}`:`${pad(m)}:${pad(ss)}`; };
const lbl    = s  => { const h=Math.floor(s/3600),m=Math.floor((s%3600)/60); return h?`${h}h ${m}m`:`${m}m`; };
const $      = id => document.getElementById(id);
const mk     = (tag, cls, txt) => { const e=document.createElement(tag); if(cls) e.className=cls; if(txt!=null) e.textContent=txt; return e; };
const pomoS  = p  => ({ focus:(STATE.profile?.pomo_focus||25)*60, short:(STATE.profile?.pomo_short||5)*60, long:(STATE.profile?.pomo_long||15)*60 }[p]);
const cycles = () => STATE.profile?.pomo_cycles || 4;

// ─── SVG ring ─────────────────────────────────────────────────────────────────
function ring(rem, tot) {
  const r = $('timer-ring-progress');
  if (r && tot > 0) r.style.strokeDashoffset = CIRC * (1 - Math.max(0, Math.min(1, rem / tot)));
}

// ─── Display refresh ──────────────────────────────────────────────────────────
function draw() {
  const t = $('timer-time'); if (!t) return;
  if (_mode === 'timer') {
    const r = Math.max(0, _duration - _elapsed);
    t.textContent = hms(r); ring(r, _duration);
  } else if (_mode === 'stopwatch') {
    t.textContent = hms(_elapsed);
  } else {
    const tot = pomoS(_phase), r = Math.max(0, tot - _elapsed);
    t.textContent = hms(r); ring(r, tot); drawDots(); drawPhase();
  }
}

function drawDots() {
  document.querySelectorAll('.pomo-dot').forEach((d, i) => d.classList.toggle('pomo-dot--done', i < _focusDone));
}

function drawPhase() {
  const p = $('pomo-phase-label');
  if (p) p.textContent = { focus: 'Focus', short: 'Short Break', long: 'Long Break' }[_phase];
  const n = $('pomo-cycle-num');
  if (n) n.textContent = _cycle;
}

// ─── Master tick — only one ever runs ────────────────────────────────────────
function startTick() { if (_tick) return; _tick = setInterval(onTick, 1000); }
function stopTick()  { clearInterval(_tick); _tick = null; }

function onTick() {
  if (!_running || _paused) return;
  _elapsed++;
  draw();
  updateSessionBanner(banner());
  saveTimerState(snap());
  if      (_mode === 'timer'    && _elapsed >= _duration)     onDone();
  else if (_mode === 'pomodoro' && _elapsed >= pomoS(_phase)) onPomoPhase();
}

// ─── Completion ───────────────────────────────────────────────────────────────
function onDone() {
  _running = false; stopTick(); vibrate(HAPTIC_TIMER_END); updateSessionBanner(null);
  showSheet(_duration, _tag);
}

function onPomoPhase() {
  if (_phase === 'focus') {
    _focusDone++;
    vibrate(HAPTIC_TIMER_END);
    if (_focusDone >= cycles()) {
      _cycle++; _focusDone = 0; vibrate(HAPTIC_POMO_DONE); startPhase('long');
    } else {
      startPhase('short');
    }
  } else {
    startPhase('focus');
  }
}

/**
 * Transitions to a new pomodoro phase, resets elapsed, restarts tick.
 * @param {'focus'|'short'|'long'} p
 */
function startPhase(p) {
  _phase = p; _elapsed = 0; _startTs = Date.now(); _totalPausedMs = 0;
  _running = true; _paused = false;
  startTick(); draw(); ctrl(); saveTimerState(snap());
}

// ─── Completion sheet (slides up from bottom) ─────────────────────────────────
/**
 * @param {number} secs    - session duration in seconds
 * @param {string} tagName - selected tag name (may be empty)
 */
function showSheet(secs, tagName) {
  $('timer-completion-sheet')?.remove();
  const s = mk('div', 'completion-sheet'); s.id = 'timer-completion-sheet';
  s.innerHTML = `
    <div class="completion-sheet__handle"></div>
    <div class="completion-sheet__icon">✓</div>
    <h2 class="completion-sheet__title">Session complete</h2>
    <p class="completion-sheet__sub">${lbl(secs)}${tagName ? ' of ' + tagName : ''}</p>
    <button class="completion-sheet__btn btn-primary" id="timer-save-btn">Save &amp; Close</button>
    <button class="completion-sheet__btn completion-sheet__btn--ghost" id="timer-discard-btn">Discard</button>`;
  document.body.appendChild(s);
  requestAnimationFrame(() => s.classList.add('completion-sheet--open'));
  $('timer-save-btn').addEventListener('click',    async () => { await saveSession(secs); closeSheet(); reset(); });
  $('timer-discard-btn').addEventListener('click', ()        => { clearTimerState(); closeSheet(); reset(); });
}

function closeSheet() {
  const s = $('timer-completion-sheet'); if (!s) return;
  s.classList.remove('completion-sheet--open');
  setTimeout(() => s.remove(), 300);
}

/**
 * Writes completed session to Supabase timer_sessions table.
 * @param {number} secs
 * @returns {Promise<void>}
 */
async function saveSession(secs) {
  try {
    await insertTimerSession({
      session_date:   new Date().toISOString().slice(0, 10),
      tag_name:       _tag      || null,
      tag_color:      _tagColor || null,
      category_name:  _cat      || null,
      category_type:  _catType  || null,
      category_color: _catColor || null,
      duration_secs:  secs,
      mode:           _mode,
      completed:      true,
    });
    clearTimerState();
    renderSessions();
  } catch (err) {
    console.error('[Timer] saveSession failed:', err);
    vibrate(HAPTIC_ERROR);
  }
}

// ─── Abandon modal ────────────────────────────────────────────────────────────
const showAbandon = () => $('timer-abandon-modal')?.classList.add('modal--open');
const hideAbandon = () => $('timer-abandon-modal')?.classList.remove('modal--open');

// ─── Controls visibility ──────────────────────────────────────────────────────
function ctrl() {
  const h = (id, hidden) => $(id)?.classList.toggle('hidden', hidden);
  h('timer-btn-start',   _running);              h('timer-btn-pause',   !_running || _paused);
  h('timer-btn-resume',  !_paused);              h('timer-btn-abandon', !_running && !_paused);
  h('sw-btn-start',      _running);              h('sw-btn-pause',      !_running || _paused);
  h('sw-btn-resume',     !_paused);              h('sw-btn-stop',       !_running && !_paused);
  h('sw-btn-cancel',     !_running && !_paused);
  h('pomo-btn-start',    _running);              h('pomo-btn-pause',    !_running || _paused);
  h('pomo-btn-resume',   !_paused);              h('pomo-btn-skip',     !_running && !_paused);
  h('pomo-btn-abandon',  !_running && !_paused);
}

// ─── Mode switcher ────────────────────────────────────────────────────────────
function switchMode(m) {
  if (_running || _paused) return;
  _mode = m; _elapsed = 0; draw();
  document.querySelectorAll('.mode-pill').forEach(p => p.classList.toggle('mode-pill--active', p.dataset.mode === m));
  ['timer', 'stopwatch', 'pomodoro'].forEach(x => $(`panel-${x}`)?.classList.toggle('hidden', x !== m));
  $('timer-ring-wrap')?.classList.toggle('hidden', m === 'stopwatch');
  saveTimerState(snap());
}

// ─── Tag chips ────────────────────────────────────────────────────────────────
function renderTags() {
  const c = $('timer-tags'); if (!c) return; c.innerHTML = '';
  (STATE.tags || []).forEach(t => {
    const b = mk('button', 'tag-chip' + (t.name === _tag ? ' tag-chip--active' : ''), t.name);
    b.style.setProperty('--chip-color', t.color || 'var(--accent)');
    b.addEventListener('click', () => {
      _tag = t.name === _tag ? '' : t.name;
      _tagColor = _tag ? (t.color || '') : '';
      renderTags();
    });
    c.appendChild(b);
  });
}

// ─── Category chips ───────────────────────────────────────────────────────────
function renderCats() {
  const c = $('timer-categories'); if (!c) return; c.innerHTML = '';
  _catType = STATE.profile?.cat_type || 'subject';
  (STATE.categories || []).filter(x => x.type === _catType).forEach(t => {
    const b = mk('button', 'tag-chip category-chip' + (t.name === _cat ? ' tag-chip--active' : ''), t.name);
    b.style.setProperty('--chip-color', t.color || 'var(--accent)');
    b.addEventListener('click', () => {
      _cat = t.name === _cat ? '' : t.name;
      _catColor = _cat ? (t.color || '') : '';
      renderCats();
    });
    c.appendChild(b);
  });
}

// ─── Recent sessions ──────────────────────────────────────────────────────────
function renderSessions() {
  const c = $('recent-sessions'); if (!c) return;
  const sess = (STATE.sessions || []).slice(0, MAX_SESS);
  if (!sess.length) { c.innerHTML = '<p class="empty-hint">No sessions yet</p>'; return; }

  const groups = {};
  sess.forEach(s => {
    const d = s.session_date || s.created_at?.slice(0, 10) || '—';
    (groups[d] = groups[d] || []).push(s);
  });
  c.innerHTML = '';

  const today = new Date().toISOString().slice(0, 10);
  const yday  = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  Object.entries(groups).forEach(([d, items]) => {
    const label = d === today ? 'Today' : d === yday ? 'Yesterday'
      : new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    c.appendChild(mk('p', 'session-date-header', label));
    items.forEach(s => {
      const row = mk('div', 'session-item');
      const dot = mk('span', 'session-item__tag-dot');
      dot.style.background = s.tag_color || 'var(--accent)';
      row.append(
        dot,
        mk('span', 'session-item__label',    s.tag_name || s.category_name || 'Untitled'),
        mk('span', 'session-item__duration', lbl(s.duration_secs || 0))
      );
      c.appendChild(row);
    });
  });
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function toast(msg) {
  const e = mk('div', 'timer-toast', msg);
  document.body.appendChild(e);
  setTimeout(() => e.classList.add('timer-toast--show'), 10);
  setTimeout(() => { e.classList.remove('timer-toast--show'); setTimeout(() => e.remove(), 300); }, 2200);
}

// ─── State snapshot + banner ─────────────────────────────────────────────────
function snap() {
  return {
    mode: _mode, running: _running, paused: _paused,
    startTs: _startTs, pausedAt: _pausedAt, totalPausedMs: _totalPausedMs,
    duration: _duration, tag: _tag, tagColor: _tagColor,
    category: _cat, categoryType: _catType, categoryColor: _catColor,
    pomoPhase: _phase, pomoFocusDone: _focusDone, pomoCycle: _cycle,
  };
}

function banner() {
  if (!_running || _paused) return null;
  const display = _mode === 'stopwatch' ? hms(_elapsed) : hms(Math.max(0, _duration - _elapsed));
  return { mode: _mode, display, tag: _tag, tagColor: _tagColor };
}

function reset() {
  _running = false; _paused = false; _elapsed = 0;
  _startTs = 0; _pausedAt = 0; _totalPausedMs = 0;
  _phase = 'focus'; _focusDone = 0; _cycle = 0;
  stopTick(); draw(); ctrl(); updateSessionBanner(null);
}

// ─── Restore persisted state on page load ─────────────────────────────────────
function restore() {
  const res = loadTimerState(); if (!res) return;
  const { state: s, reconstructedElapsedSecs: e } = res;
  _mode     = s.mode          || 'timer';
  _running  = s.running       || false;
  _paused   = s.paused        || false;
  _startTs  = s.startTs       || 0;
  _pausedAt = s.pausedAt      || 0;
  _totalPausedMs = s.totalPausedMs || 0;
  _duration = s.duration      || 1500;
  _elapsed  = e;
  _tag      = s.tag           || '';
  _tagColor = s.tagColor      || '';
  _cat      = s.category      || '';
  _catType  = s.categoryType  || 'subject';
  _catColor = s.categoryColor || '';
  _phase    = s.pomoPhase     || 'focus';
  _focusDone = s.pomoFocusDone || 0;
  _cycle    = s.pomoCycle     || 0;
  if (_running && !_paused) { startTick(); toast('Resumed'); updateSessionBanner(banner()); }
}

// ─── Event wiring ─────────────────────────────────────────────────────────────
function wire() {
  // Mode pills
  document.querySelectorAll('.mode-pill').forEach(p =>
    p.addEventListener('click', () => switchMode(p.dataset.mode))
  );

  // Duration chips
  document.querySelectorAll('.duration-chip').forEach(chip =>
    chip.addEventListener('click', () => {
      if (_running || _paused) return;
      _duration = parseInt(chip.dataset.secs, 10); _elapsed = 0;
      document.querySelectorAll('.duration-chip').forEach(c => c.classList.remove('duration-chip--active'));
      chip.classList.add('duration-chip--active');
      draw();
    })
  );

  // Custom duration input
  $('timer-custom-min')?.addEventListener('blur', () => {
    const m = parseInt($('timer-custom-min').value, 10);
    if (!isNaN(m) && m > 0) {
      _duration = m * 60; _elapsed = 0;
      document.querySelectorAll('.duration-chip').forEach(c => c.classList.remove('duration-chip--active'));
      draw();
    }
  });

  // Shared start / pause / resume (used by both Timer and Stopwatch)
  const startRun = () => {
    _running = true; _paused = false; _elapsed = 0;
    _startTs = Date.now(); _totalPausedMs = 0;
    vibrate(HAPTIC_SESSION); startTick(); ctrl();
    saveTimerState(snap()); updateSessionBanner(banner());
  };
  const pauseRun = () => {
    _paused = true; _pausedAt = Date.now();
    ctrl(); saveTimerState(snap()); updateSessionBanner(null);
  };
  const resumeRun = () => {
    _totalPausedMs += Date.now() - _pausedAt; _paused = false; _pausedAt = 0;
    ctrl(); saveTimerState(snap()); updateSessionBanner(banner());
  };

  // Timer controls
  $('timer-btn-start')?.addEventListener('click',   startRun);
  $('timer-btn-pause')?.addEventListener('click',   pauseRun);
  $('timer-btn-resume')?.addEventListener('click',  resumeRun);
  $('timer-btn-abandon')?.addEventListener('click', showAbandon);

  // Stopwatch controls
  $('sw-btn-start')?.addEventListener('click',   startRun);
  $('sw-btn-pause')?.addEventListener('click',   pauseRun);
  $('sw-btn-resume')?.addEventListener('click',  resumeRun);
  $('sw-btn-stop')?.addEventListener('click',    () => { _running = false; stopTick(); updateSessionBanner(null); showSheet(_elapsed, _tag); });
  $('sw-btn-cancel')?.addEventListener('click',  () => { clearTimerState(); reset(); });

  // Pomodoro controls
  $('pomo-btn-start')?.addEventListener('click',   () => { startPhase('focus'); vibrate(HAPTIC_SESSION); });
  $('pomo-btn-pause')?.addEventListener('click',   pauseRun);
  $('pomo-btn-resume')?.addEventListener('click',  resumeRun);
  $('pomo-btn-skip')?.addEventListener('click',    onPomoPhase);
  $('pomo-btn-reset')?.addEventListener('click',   () => { _focusDone = 0; _cycle = 0; reset(); });
  $('pomo-btn-abandon')?.addEventListener('click', showAbandon);

  // Abandon modal
  $('abandon-confirm')?.addEventListener('click', () => { clearTimerState(); hideAbandon(); reset(); });
  $('abandon-cancel')?.addEventListener('click',  hideAbandon);
}

// ─── Public entry point ───────────────────────────────────────────────────────
/**
 * Initialises the timer page. Called by nav.js when the Timer tab is activated.
 * Renders HTML, chips, sessions, restores any persisted timer state, wires all events.
 *
 * @returns {void}
 */
export function initTimer() {
  const page = $('page-timer'); if (!page) return;
  page.innerHTML = buildTimerHTML(cycles());
  renderTags();
  renderCats();
  renderSessions();
  restore();
  switchMode(_mode); // sets correct panel visibility + pill highlight
  draw();
  ctrl();
  wire();
}
