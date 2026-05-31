/**
 * @file nav.js
 * @description Navigation — bottom tab bar routing, page fade transitions,
 *   floating session banner (app-wide timer status), and toast notifications.
 * @module Nav
 */

import { STATE } from './state.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_FADE_MS  = 150;
const TOAST_HOLD_MS = 2500;
const TOAST_FADE_MS = 300;

/**
 * Tab definitions — name must match the page section IDs in index.html.
 */
const TABS = [
  {
    name: 'today',
    label: 'Today',
    svg: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>',
  },
  {
    name: 'timer',
    label: 'Timer',
    svg: '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>',
  },
  {
    name: 'weekly',
    label: 'Weekly',
    svg: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>',
  },
  {
    name: 'analytics',
    label: 'Analytics',
    svg: '<line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line>',
  },
  {
    // FIX: was 'me' — page element in index.html is id="page-settings"
    name: 'settings',
    label: 'Me',
    svg: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>',
  },
];

// ─── Banner internal state ─────────────────────────────────────────────────────

let _bannerInterval = null;

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Zero-pad a number to at least 2 digits.
 * @param {number} n
 * @returns {string}
 */
function pad(n) {
  return String(Math.max(0, Math.floor(n))).padStart(2, '0');
}

/**
 * Format elapsed seconds into HH:MM:SS or MM:SS.
 * @param {number} totalSeconds
 * @returns {string}
 */
function formatElapsed(totalSeconds) {
  const s   = Math.max(0, Math.floor(totalSeconds));
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/**
 * Format remaining countdown seconds into MM:SS.
 * @param {number} remainingSeconds
 * @returns {string}
 */
function formatCountdown(remainingSeconds) {
  const s = Math.max(0, Math.floor(remainingSeconds));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

/**
 * Compute the banner clock string from timer state.
 * @param {Object} timerState
 * @returns {string}
 */
function computeBannerTime(timerState) {
  const now = Date.now();

  if (timerState.mode === 'stopwatch') {
    const elapsed = timerState.paused
      ? (timerState.pausedAt - timerState.startTs - timerState.totalPausedMs) / 1000
      : (now - timerState.startTs - timerState.totalPausedMs) / 1000;
    return formatElapsed(elapsed);
  }

  // Timer or Pomodoro — countdown
  const totalMs   = (timerState.duration || 0) * 1000;
  const elapsedMs = timerState.paused
    ? timerState.pausedAt - timerState.startTs - timerState.totalPausedMs
    : now - timerState.startTs - timerState.totalPausedMs;
  return formatCountdown((totalMs - elapsedMs) / 1000);
}

// ─── Session Banner ───────────────────────────────────────────────────────────

/**
 * Get or create the session banner element.
 * @returns {HTMLElement}
 */
function getBanner() {
  let banner = document.getElementById('session-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id        = 'session-banner';
    banner.className = 'session-banner session-banner--hidden';
    banner.innerHTML = `
      <span class="session-banner__dot"></span>
      <span class="session-banner__mode" id="banner-mode"></span>
      <span class="session-banner__time" id="banner-time"></span>
      <span class="session-banner__tag"  id="banner-tag"></span>
    `;
    banner.addEventListener('click', () => showPage('timer'));
    document.body.prepend(banner);
  }
  return banner;
}

/**
 * Stop the banner's live clock interval.
 * @returns {void}
 */
function stopBannerClock() {
  if (_bannerInterval) {
    clearInterval(_bannerInterval);
    _bannerInterval = null;
  }
}

/**
 * Update the banner time display from current timer state.
 * @param {Object} timerState
 * @returns {void}
 */
function tickBanner(timerState) {
  const timeEl = document.getElementById('banner-time');
  if (timeEl) timeEl.textContent = computeBannerTime(timerState);
}

/**
 * Show, hide, or update the floating session banner.
 * Called by timer.js whenever timer state changes.
 *
 * @param {Object|null} timerState
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

  const modeEl = document.getElementById('banner-mode');
  const tagEl  = document.getElementById('banner-tag');

  if (modeEl) {
    const labels = { timer: 'Focus', stopwatch: 'Stopwatch', pomodoro: 'Pomodoro' };
    modeEl.textContent = labels[timerState.mode] || timerState.mode;
  }
  if (tagEl) {
    tagEl.textContent  = timerState.tag || '';
    tagEl.style.color  = timerState.tagColor || 'var(--accent)';
  }

  banner.classList.toggle('session-banner--paused', !!timerState.paused);
  banner.classList.remove('session-banner--hidden');

  tickBanner(timerState);
  if (!timerState.paused) {
    _bannerInterval = setInterval(() => tickBanner(timerState), 1000);
  }
}

// ─── Toast Notifications ──────────────────────────────────────────────────────

let _toastTimeout = null;

/**
 * Get or create the toast element.
 * @returns {HTMLElement}
 */
function getToast() {
  let toast = document.getElementById('app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id        = 'app-toast';
    toast.className = 'app-toast';
    document.body.appendChild(toast);
  }
  return toast;
}

/**
 * Show a transient toast notification.
 * @param {string} message
 * @param {'success'|'error'|'info'} [type='info']
 * @returns {void}
 */
export function showToast(message, type = 'info') {
  const toast = getToast();

  if (_toastTimeout) {
    clearTimeout(_toastTimeout);
    _toastTimeout = null;
  }

  toast.className  = `app-toast app-toast--${type} app-toast--visible`;
  toast.textContent = message;

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
 * Navigate to a page with a fade transition.
 * Updates STATE.currentPage and bottom nav tab indicators.
 *
 * @param {string} pageName - 'today' | 'timer' | 'weekly' | 'analytics' | 'settings'
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

  // Fade out and hide current page
  if (currentPageEl) {
    currentPageEl.classList.add('page--exiting');
    setTimeout(() => {
      currentPageEl.classList.remove('page--active', 'page--exiting');
      currentPageEl.classList.add('hidden');   // FIX: was missing — pages stayed visible
    }, PAGE_FADE_MS);
  }

  // Unhide and fade in target page
  setTimeout(() => {
    targetPageEl.classList.remove('hidden');   // FIX: was missing — pages never appeared
    targetPageEl.classList.add('page--active');
  }, PAGE_FADE_MS);

  STATE.currentPage = pageName;
  updateNavTabs(pageName);

  window.dispatchEvent(
    new CustomEvent('daily-os:page-shown', { detail: { page: pageName } })
  );
}

/**
 * Update the active indicator on all bottom nav tab buttons.
 * @param {string} activePage
 * @returns {void}
 */
function updateNavTabs(activePage) {
  // FIX: was '.nav__tab' — must match class rendered by renderNav()
  document.querySelectorAll('.bottom-nav__tab').forEach((btn) => {
    const isActive = btn.dataset.page === activePage;
    // FIX: was 'nav__tab--active'
    btn.classList.toggle('bottom-nav__tab--active', isActive);
    btn.setAttribute('aria-current', isActive ? 'page' : 'false');
  });
}

// ─── Bottom Nav Rendering ─────────────────────────────────────────────────────

/**
 * Clear and re-render the bottom tab bar into #bottom-nav.
 * @returns {void}
 */
function renderNav() {
  // FIX: was 'nav-bar' — element in index.html has id="bottom-nav"
  const navBar = document.getElementById('bottom-nav');
  if (!navBar) {
    console.error('[Nav] renderNav — #bottom-nav element not found.');
    return;
  }

  navBar.innerHTML = '';

  TABS.forEach(({ name, label, svg }) => {
    const btn = document.createElement('button');
    // FIX: was 'nav__tab'
    btn.className = 'bottom-nav__tab';
    btn.dataset.page = name;
    btn.setAttribute('role',         'tab');
    btn.setAttribute('aria-selected', 'false');
    btn.setAttribute('aria-label',    label);

    // SVG icon
    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgEl.setAttribute('viewBox',       '0 0 24 24');
    svgEl.setAttribute('fill',          'none');
    svgEl.setAttribute('stroke',        'currentColor');
    svgEl.setAttribute('stroke-width',  '2');
    svgEl.setAttribute('stroke-linecap', 'round');
    svgEl.setAttribute('stroke-linejoin', 'round');
    svgEl.setAttribute('aria-hidden',   'true');
    // FIX: was 'nav__tab-icon'
    svgEl.classList.add('bottom-nav__icon');
    svgEl.innerHTML = svg;

    // Label
    const labelEl = document.createElement('span');
    // FIX: was 'nav__tab-label'
    labelEl.className   = 'bottom-nav__label';
    labelEl.textContent = label;

    // Active dot indicator
    const dotEl = document.createElement('span');
    // FIX: was 'nav__tab-dot'
    dotEl.className = 'bottom-nav__dot';
    dotEl.setAttribute('aria-hidden', 'true');

    btn.appendChild(svgEl);
    btn.appendChild(labelEl);
    btn.appendChild(dotEl);

    btn.addEventListener('click', () => showPage(name));
    navBar.appendChild(btn);
  });
}

// ─── Sidebar Nav (tablet ≥768px) ──────────────────────────────────────────────

/**
 * Render the left sidebar nav into #sidebar-nav (tablet layout).
 * Optional — returns silently if element not found.
 * @returns {void}
 */
function renderSidebar() {
  const sidebar = document.getElementById('sidebar-nav');
  if (!sidebar) return;

  sidebar.innerHTML = '';

  const brand = document.createElement('div');
  brand.className   = 'sidebar__brand';
  brand.textContent = 'Daily OS';
  sidebar.appendChild(brand);

  TABS.forEach(({ name, label, svg }) => {
    const btn = document.createElement('button');
    btn.className = 'bottom-nav__tab sidebar__tab';
    btn.dataset.page = name;
    btn.setAttribute('role',          'tab');
    btn.setAttribute('aria-selected', 'false');
    btn.setAttribute('aria-label',    label);

    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgEl.setAttribute('viewBox',        '0 0 24 24');
    svgEl.setAttribute('fill',           'none');
    svgEl.setAttribute('stroke',         'currentColor');
    svgEl.setAttribute('stroke-width',   '2');
    svgEl.setAttribute('stroke-linecap', 'round');
    svgEl.setAttribute('stroke-linejoin', 'round');
    svgEl.setAttribute('aria-hidden',    'true');
    svgEl.classList.add('bottom-nav__icon');
    svgEl.innerHTML = svg;

    const labelEl = document.createElement('span');
    labelEl.className   = 'bottom-nav__label';
    labelEl.textContent = label;

    btn.appendChild(svgEl);
    btn.appendChild(labelEl);
    btn.addEventListener('click', () => showPage(name));
    sidebar.appendChild(btn);
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialise navigation. Renders tab bar and sidebar, ensures banner exists,
 * and navigates to the default page. Call once after app shell is visible.
 * @returns {void}
 */
export function initNav() {
  renderNav();
  renderSidebar();
  getBanner();

  // Force a fresh navigation to 'today'
  STATE.currentPage = null;
  showPage('today');
}

// ─── Auto-init ────────────────────────────────────────────────────────────────
// FIX: initNav() was never called. Now wired to 'daily-os:ready' which auth.js
// dispatches from bootstrapApp() after the user is authenticated and data loaded.
window.addEventListener('daily-os:ready', () => initNav());
