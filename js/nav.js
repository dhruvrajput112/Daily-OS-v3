/**
 * @file nav.js
 * @description Navigation — bottom tab bar routing, page fade transitions,
 *   floating session banner (app-wide timer status), and toast notifications.
 * @module Nav
 */

import { STATE } from './state.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Milliseconds for a page fade-out before swapping content. */
const PAGE_FADE_MS = 150;

/** Milliseconds to hold a toast before it begins fading out. */
const TOAST_HOLD_MS = 2500;

/** Milliseconds for the toast fade-out transition. */
const TOAST_FADE_MS = 300;

/** Tab definitions — order matches the bottom nav bar left-to-right. */
const TABS = [
  { name: 'today',     label: 'Today',     icon: '◎' },
  { name: 'timer',     label: 'Timer',     icon: '⏱' },
  { name: 'weekly',    label: 'Weekly',    icon: '📅' },
  { name: 'analytics', label: 'Analytics', icon: '◈' },
  { name: 'me',        label: 'Me',        icon: '⊙' },
];

/** setInterval handle for the running banner clock update. */
let _bannerInterval = null;

/** setInterval start timestamp used to drive the banner display clock. */
let _bannerStartTs  = null;

/** Total paused milliseconds carried over from timer-state (for accurate display). */
let _bannerPausedMs = 0;

/** Whether the currently-displayed timer is paused (freeze display). */
let _bannerPaused   = false;

/** Timestamp at which the running timer was paused. */
let _bannerPausedAt = null;

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Zero-pad a number to at least 2 digits.
 *
 * @param {number} n - The number to pad.
 * @returns {string}
 */
function pad(n) {
  return String(Math.max(0, Math.floor(n))).padStart(2, '0');
}

/**
 * Format elapsed seconds into HH:MM:SS or MM:SS depending on length.
 *
 * @param {number} totalSeconds - Total elapsed seconds (may be negative — clamped to 0).
 * @returns {string} Formatted time string.
 */
function formatElapsed(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/**
 * Format a countdown duration in seconds into MM:SS.
 *
 * @param {number} remainingSeconds - Seconds remaining (clamped to 0).
 * @returns {string}
 */
function formatCountdown(remainingSeconds) {
  const s = Math.max(0, Math.floor(remainingSeconds));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

/**
 * Compute the current display value for the banner clock based on timer state.
 *
 * @param {Object} timerState - The timer state object from timer-state.js
 * @returns {string} Formatted time string for the banner.
 */
function computeBannerTime(timerState) {
  const now = Date.now();

  if (timerState.mode === 'stopwatch') {
    let elapsed;
    if (timerState.paused) {
      // Frozen at the moment it was paused
      elapsed = (timerState.pausedAt - timerState.startTs - timerState.totalPausedMs) / 1000;
    } else {
      elapsed = (now - timerState.startTs - timerState.totalPausedMs) / 1000;
    }
    return formatElapsed(elapsed);
  }

  // Timer or Pomodoro — show countdown
  const totalMs = (timerState.duration || 0) * 1000;
  let elapsedMs;
  if (timerState.paused) {
    elapsedMs = timerState.pausedAt - timerState.startTs - timerState.totalPausedMs;
  } else {
    elapsedMs = now - timerState.startTs - timerState.totalPausedMs;
  }
  const remainingSeconds = (totalMs - elapsedMs) / 1000;
  return formatCountdown(remainingSeconds);
}

// ─── Session Banner ───────────────────────────────────────────────────────────

/**
 * Get the session banner element, creating it if it does not yet exist.
 *
 * @returns {HTMLElement}
 */
function getBanner() {
  let banner = document.getElementById('session-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'session-banner';
    banner.className = 'session-banner session-banner--hidden';
    banner.innerHTML = `
      <span class="session-banner__dot"></span>
      <span class="session-banner__mode" id="banner-mode"></span>
      <span class="session-banner__time" id="banner-time"></span>
      <span class="session-banner__tag"  id="banner-tag"></span>
    `;
    // Tapping the banner navigates to the Timer page
    banner.addEventListener('click', () => showPage('timer'));
    document.body.prepend(banner);
  }
  return banner;
}

/**
 * Stop the banner's per-second clock interval.
 *
 * @returns {void}
 */
function stopBannerClock() {
  if (_bannerInterval) {
    clearInterval(_bannerInterval);
    _bannerInterval = null;
  }
}

/**
 * Update the banner's live time display. Called once immediately and then
 * every second via setInterval.
 *
 * @param {Object} timerState - Current timer state snapshot.
 * @returns {void}
 */
function tickBanner(timerState) {
  const timeEl = document.getElementById('banner-time');
  if (!timeEl) return;
  timeEl.textContent = computeBannerTime(timerState);
}

/**
 * Show, hide, or update the floating session banner.
 * Called by timer.js whenever timer state changes.
 *
 * @param {Object|null} timerState - Current timer state from timer-state.js,
 *   or null / { running: false } to hide the banner.
 * @returns {void}
 */
export function updateSessionBanner(timerState) {
  const banner = getBanner();
  stopBannerClock();

  const isActive = timerState && timerState.running;

  if (!isActive) {
    banner.classList.add('session-banner--hidden');
    banner.classList.remove('session-banner--paused');
    return;
  }

  // Populate banner fields
  const modeEl = document.getElementById('banner-mode');
  const tagEl  = document.getElementById('banner-tag');

  if (modeEl) {
    const labels = { timer: 'Focus', stopwatch: 'Stopwatch', pomodoro: 'Pomodoro' };
    modeEl.textContent = labels[timerState.mode] || timerState.mode;
  }
  if (tagEl) {
    tagEl.textContent = timerState.tag || '';
    tagEl.style.color = timerState.tagColor || 'var(--accent)';
  }

  // Show/hide paused indicator
  banner.classList.toggle('session-banner--paused', !!timerState.paused);
  banner.classList.remove('session-banner--hidden');

  // Immediate tick then start clock (only tick if not paused — frozen display)
  tickBanner(timerState);
  if (!timerState.paused) {
    _bannerInterval = setInterval(() => tickBanner(timerState), 1000);
  }
}

// ─── Toast Notifications ──────────────────────────────────────────────────────

/** Reference to any pending toast hide timeout so we can cancel it on rapid calls. */
let _toastTimeout = null;

/**
 * Get the toast element, creating it if needed.
 *
 * @returns {HTMLElement}
 */
function getToast() {
  let toast = document.getElementById('app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.className = 'app-toast';
    document.body.appendChild(toast);
  }
  return toast;
}

/**
 * Show a transient toast notification.
 *
 * @param {string} message  - The text to display.
 * @param {'success'|'error'|'info'} [type='info'] - Controls the toast's colour class.
 * @returns {void}
 */
export function showToast(message, type = 'info') {
  const toast = getToast();

  // Cancel any in-flight hide
  if (_toastTimeout) {
    clearTimeout(_toastTimeout);
    _toastTimeout = null;
  }

  // Reset classes and set new content
  toast.className = `app-toast app-toast--${type} app-toast--visible`;
  toast.textContent = message;

  // Hold, then fade out
  _toastTimeout = setTimeout(() => {
    toast.classList.remove('app-toast--visible');
    toast.classList.add('app-toast--hiding');

    setTimeout(() => {
      toast.classList.remove('app-toast--hiding', `app-toast--${type}`);
    }, TOAST_FADE_MS);
  }, TOAST_HOLD_MS);
}

// ─── Page Routing ─────────────────────────────────────────────────────────────

/**
 * Fade out the currently active page, swap active states, then fade in the target page.
 * Updates STATE.currentPage and the bottom nav tab active indicators.
 *
 * @param {string} pageName - One of: 'today' | 'timer' | 'weekly' | 'analytics' | 'me'
 * @returns {void}
 */
export function showPage(pageName) {
  if (STATE.currentPage === pageName) return;

  const currentPageEl = document.getElementById(`page-${STATE.currentPage}`);
  const targetPageEl  = document.getElementById(`page-${pageName}`);

  if (!targetPageEl) {
    console.error(`[Nav] showPage — no element found for page: ${pageName}`);
    return;
  }

  // ── Fade out current page ─────────────────────────────────────────────────
  if (currentPageEl) {
    currentPageEl.classList.add('page--exiting');
    setTimeout(() => {
      currentPageEl.classList.remove('page--active', 'page--exiting');
    }, PAGE_FADE_MS);
  }

  // ── Fade in target page ───────────────────────────────────────────────────
  // Small delay so both elements aren't simultaneously visible mid-transition
  setTimeout(() => {
    targetPageEl.classList.add('page--active');
  }, PAGE_FADE_MS);

  // ── Update state and nav tabs ──────────────────────────────────────────────
  STATE.currentPage = pageName;
  updateNavTabs(pageName);

  // ── Notify the page module that it has been shown ─────────────────────────
  // Each page module can listen for this event to lazy-render or refresh data.
  window.dispatchEvent(new CustomEvent('daily-os:page-shown', { detail: { page: pageName } }));
}

/**
 * Update the active state of all bottom nav tab buttons.
 *
 * @param {string} activePage - The page name that is now active.
 * @returns {void}
 */
function updateNavTabs(activePage) {
  document.querySelectorAll('.nav__tab').forEach((btn) => {
    const isActive = btn.dataset.page === activePage;
    btn.classList.toggle('nav__tab--active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });
}

// ─── Bottom Nav Rendering ─────────────────────────────────────────────────────

/**
 * Build and insert the bottom tab bar into #nav-bar.
 * On tablet (≥768px) the sidebar nav is shown instead; this function always
 * renders both — CSS controls which is visible via media queries.
 *
 * @returns {void}
 */
function renderNav() {
  const navBar = document.getElementById('nav-bar');
  if (!navBar) {
    console.error('[Nav] renderNav — #nav-bar element not found.');
    return;
  }

  navBar.innerHTML = '';

  TABS.forEach(({ name, label, icon }) => {
    const btn = document.createElement('button');
    btn.className = 'nav__tab';
    btn.dataset.page = name;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', 'false');
    btn.setAttribute('aria-label', label);

    // Icon
    const iconEl = document.createElement('span');
    iconEl.className = 'nav__tab-icon';
    iconEl.textContent = icon;

    // Label
    const labelEl = document.createElement('span');
    labelEl.className = 'nav__tab-label';
    labelEl.textContent = label;

    // Active dot indicator
    const dotEl = document.createElement('span');
    dotEl.className = 'nav__tab-dot';

    btn.appendChild(iconEl);
    btn.appendChild(labelEl);
    btn.appendChild(dotEl);

    btn.addEventListener('click', () => showPage(name));

    navBar.appendChild(btn);
  });
}

// ─── Sidebar Nav (tablet) ─────────────────────────────────────────────────────

/**
 * Build and insert the left sidebar nav into #sidebar-nav (tablet layout).
 * Mirrors the same tab data as the bottom bar.
 *
 * @returns {void}
 */
function renderSidebar() {
  const sidebar = document.getElementById('sidebar-nav');
  if (!sidebar) return; // Sidebar is optional — not all shells include it

  sidebar.innerHTML = '';

  // Brand mark at top
  const brand = document.createElement('div');
  brand.className = 'sidebar__brand';
  brand.textContent = 'Daily OS';
  sidebar.appendChild(brand);

  TABS.forEach(({ name, label, icon }) => {
    const btn = document.createElement('button');
    btn.className = 'nav__tab sidebar__tab';
    btn.dataset.page = name;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', 'false');
    btn.setAttribute('aria-label', label);

    const iconEl = document.createElement('span');
    iconEl.className = 'nav__tab-icon';
    iconEl.textContent = icon;

    const labelEl = document.createElement('span');
    labelEl.className = 'nav__tab-label';
    labelEl.textContent = label;

    btn.appendChild(iconEl);
    btn.appendChild(labelEl);

    btn.addEventListener('click', () => showPage(name));

    sidebar.appendChild(btn);
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialise the navigation module. Renders the bottom tab bar and sidebar,
 * wires up click handlers, and shows the default 'today' page.
 * Call this once after the app shell is visible.
 *
 * @returns {void}
 */
export function initNav() {
  renderNav();
  renderSidebar();

  // Ensure the session banner DOM node exists from app start
  getBanner();

  // Show the default landing page
  const defaultPage = 'today';
  STATE.currentPage = null; // Force showPage to treat this as a fresh navigation
  showPage(defaultPage);
}
