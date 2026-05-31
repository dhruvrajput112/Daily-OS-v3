/**
 * @file timer-html.js
 * @description Builds the static HTML skeleton for the timer page.
 *              Split from timer.js to respect the 400-line module limit.
 * @module TimerHTML
 */

const PRESETS    = [300, 600, 1500, 1800, 3600];
const PRESET_LBL = ['5m', '10m', '25m', '30m', '60m'];
const CIRC       = (2 * Math.PI * 88).toFixed(2); // SVG ring circumference, r=88

/**
 * Returns the full inner HTML string for the timer page.
 *
 * @param {number} cycleCount - number of pomodoro cycle dots to render
 * @returns {string}
 */
export function buildTimerHTML(cycleCount) {
  const chips = PRESETS.map((s, i) =>
    `<button class="duration-chip${i === 2 ? ' duration-chip--active' : ''}" data-secs="${s}">${PRESET_LBL[i]}</button>`
  ).join('');

  const dots = Array.from({ length: cycleCount }, () => `<span class="pomo-dot"></span>`).join('');

  return `
<div class="timer-mode-switcher">
  <button class="mode-pill mode-pill--active" data-mode="timer">Timer</button>
  <button class="mode-pill" data-mode="stopwatch">Stopwatch</button>
  <button class="mode-pill" data-mode="pomodoro">Pomodoro</button>
</div>

<div class="timer-chip-row"><div id="timer-tags" class="chip-scroll"></div></div>
<div class="timer-chip-row"><div id="timer-categories" class="chip-scroll"></div></div>

<div id="timer-ring-wrap" class="timer-ring-wrap">
  <svg class="timer-ring" viewBox="0 0 200 200">
    <circle class="timer-ring__track" cx="100" cy="100" r="88"/>
    <circle id="timer-ring-progress" class="timer-ring__progress" cx="100" cy="100" r="88"
      stroke-dasharray="${CIRC}" stroke-dashoffset="0" transform="rotate(-90 100 100)"/>
  </svg>
  <div id="timer-time" class="timer-time">25:00</div>
</div>

<div id="panel-timer" class="timer-panel">
  <div class="duration-chips">
    ${chips}
    <input id="timer-custom-min" class="duration-custom-input" type="number" min="1" max="480" placeholder="min">
  </div>
  <div class="timer-controls">
    <button id="timer-btn-start"   class="btn-primary timer-btn">Start</button>
    <button id="timer-btn-pause"   class="btn-secondary timer-btn hidden">Pause</button>
    <button id="timer-btn-resume"  class="btn-primary timer-btn hidden">Resume</button>
    <button id="timer-btn-abandon" class="btn-ghost timer-btn hidden">Abandon</button>
  </div>
</div>

<div id="panel-stopwatch" class="timer-panel hidden">
  <div class="timer-controls">
    <button id="sw-btn-start"  class="btn-primary timer-btn">Start</button>
    <button id="sw-btn-pause"  class="btn-secondary timer-btn hidden">Pause</button>
    <button id="sw-btn-resume" class="btn-primary timer-btn hidden">Resume</button>
    <button id="sw-btn-stop"   class="btn-primary timer-btn hidden">Stop &amp; Save</button>
    <button id="sw-btn-cancel" class="btn-ghost timer-btn hidden">Cancel</button>
  </div>
</div>

<div id="panel-pomodoro" class="timer-panel hidden">
  <div class="pomo-phase-row">
    <span id="pomo-phase-label" class="pomo-phase-label">Focus</span>
    <span class="pomo-cycle-count">Cycle <span id="pomo-cycle-num">0</span></span>
  </div>
  <div class="pomo-dots" id="pomo-dots">${dots}</div>
  <div class="timer-controls">
    <button id="pomo-btn-start"   class="btn-primary timer-btn">Start</button>
    <button id="pomo-btn-pause"   class="btn-secondary timer-btn hidden">Pause</button>
    <button id="pomo-btn-resume"  class="btn-primary timer-btn hidden">Resume</button>
    <button id="pomo-btn-skip"    class="btn-ghost timer-btn hidden">Skip Phase</button>
    <button id="pomo-btn-reset"   class="btn-ghost timer-btn">Reset Cycle</button>
    <button id="pomo-btn-abandon" class="btn-ghost timer-btn hidden">Abandon</button>
  </div>
</div>

<div id="timer-abandon-modal" class="modal-backdrop">
  <div class="modal-sheet">
    <p class="modal-title">Abandon session?</p>
    <p class="modal-sub">Your time will not be saved.</p>
    <button id="abandon-confirm" class="btn-danger">Abandon</button>
    <button id="abandon-cancel"  class="btn-ghost">Keep going</button>
  </div>
</div>

<div class="recent-sessions-section">
  <h3 class="section-title">Recent Sessions</h3>
  <div id="recent-sessions"></div>
</div>`;
}
