/**
 * @file auth.js
 * @description Auth screen UI — renders login/signup forms, handles submission,
 *   shows errors, and bootstraps the app after successful authentication.
 * @module Auth
 */

import { signIn, signUp, signOut, getUser, fetchAllUserData } from './supabase.js';
import { STATE } from './state.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const AUTH_SCREEN_ID      = 'auth-screen';
const APP_SHELL_ID        = 'app-shell';
const APP_LOADING_ID      = 'app-loading';

const TAB_SIGNIN          = 'signin';
const TAB_SIGNUP          = 'signup';

const ERROR_DISPLAY_MS    = 4000;   // How long inline errors remain visible
const SUCCESS_DISPLAY_MS  = 6000;   // How long the "check your email" message stays

// ─── Module-level DOM refs (populated in initAuth) ────────────────────────────

let $authScreen   = null;
let $appShell     = null;
let $appLoading   = null;

// ─── HTML Template ────────────────────────────────────────────────────────────

/**
 * Build and return the complete auth screen HTML string.
 * No user-generated content is interpolated here — safe to use innerHTML.
 *
 * @returns {string} Static HTML for the auth screen.
 */
function buildAuthHTML() {
  return `
    <div class="auth__inner">

      <div class="auth__brand">
        <h1 class="auth__logo">Daily OS</h1>
        <p class="auth__tagline">Your personal operating system.</p>
      </div>

      <div class="auth__tabs" role="tablist">
        <button
          class="auth__tab auth__tab--active"
          data-tab="${TAB_SIGNIN}"
          role="tab"
          aria-selected="true"
          aria-controls="auth-panel-signin"
        >Sign In</button>
        <button
          class="auth__tab"
          data-tab="${TAB_SIGNUP}"
          role="tab"
          aria-selected="false"
          aria-controls="auth-panel-signup"
        >Sign Up</button>
      </div>

      <!-- Sign In Panel -->
      <div class="auth__panel auth__panel--active" id="auth-panel-signin" role="tabpanel">
        <div class="auth__field">
          <label class="auth__label" for="signin-email">Email</label>
          <input
            class="auth__input"
            id="signin-email"
            type="email"
            autocomplete="email"
            placeholder="you@example.com"
            inputmode="email"
          />
        </div>
        <div class="auth__field">
          <label class="auth__label" for="signin-password">Password</label>
          <input
            class="auth__input"
            id="signin-password"
            type="password"
            autocomplete="current-password"
            placeholder="••••••••"
          />
        </div>
        <div class="auth__feedback" id="signin-feedback" aria-live="polite"></div>
        <button class="auth__submit" id="signin-submit">Sign In</button>
      </div>

      <!-- Sign Up Panel -->
      <div class="auth__panel" id="auth-panel-signup" role="tabpanel">
        <div class="auth__field">
          <label class="auth__label" for="signup-name">Display Name</label>
          <input
            class="auth__input"
            id="signup-name"
            type="text"
            autocomplete="name"
            placeholder="Your name"
          />
        </div>
        <div class="auth__field">
          <label class="auth__label" for="signup-email">Email</label>
          <input
            class="auth__input"
            id="signup-email"
            type="email"
            autocomplete="email"
            placeholder="you@example.com"
            inputmode="email"
          />
        </div>
        <div class="auth__field">
          <label class="auth__label" for="signup-password">Password</label>
          <input
            class="auth__input"
            id="signup-password"
            type="password"
            autocomplete="new-password"
            placeholder="Min. 8 characters"
          />
        </div>
        <div class="auth__feedback" id="signup-feedback" aria-live="polite"></div>
        <button class="auth__submit" id="signup-submit">Create Account</button>
      </div>

    </div>
  `;
}

// ─── Tab Switching ────────────────────────────────────────────────────────────

/**
 * Switch the visible auth tab and its associated panel.
 *
 * @param {string} tabName - Either 'signin' or 'signup'.
 * @returns {void}
 */
function switchTab(tabName) {
  const tabs   = $authScreen.querySelectorAll('.auth__tab');
  const panels = $authScreen.querySelectorAll('.auth__panel');

  tabs.forEach((btn) => {
    const isActive = btn.dataset.tab === tabName;
    btn.classList.toggle('auth__tab--active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });

  panels.forEach((panel) => {
    const isActive = panel.id === `auth-panel-${tabName}`;
    panel.classList.toggle('auth__panel--active', isActive);
  });

  // Clear all feedback messages when switching tabs
  clearFeedback(TAB_SIGNIN);
  clearFeedback(TAB_SIGNUP);
}

// ─── Feedback Helpers ─────────────────────────────────────────────────────────

/**
 * Display an inline feedback message inside the specified tab's panel.
 *
 * @param {string} tabName  - 'signin' or 'signup'.
 * @param {string} message  - The human-readable message to display.
 * @param {'error'|'success'} type - Controls styling class applied.
 * @returns {void}
 */
function showFeedback(tabName, message, type) {
  const el = $authScreen.querySelector(`#${tabName}-feedback`);
  if (!el) return;

  el.textContent = message;
  el.className = `auth__feedback auth__feedback--${type} auth__feedback--visible`;
}

/**
 * Clear the feedback element for a given tab.
 *
 * @param {string} tabName - 'signin' or 'signup'.
 * @returns {void}
 */
function clearFeedback(tabName) {
  const el = $authScreen.querySelector(`#${tabName}-feedback`);
  if (!el) return;
  el.textContent = '';
  el.className = 'auth__feedback';
}

// ─── Loading State ────────────────────────────────────────────────────────────

/**
 * Put a submit button into a loading (disabled + spinner label) state.
 *
 * @param {HTMLButtonElement} btn  - The button element to update.
 * @param {boolean}           loading - True to show loading, false to restore.
 * @param {string}            defaultLabel - The button's original label.
 * @returns {void}
 */
function setButtonLoading(btn, loading, defaultLabel) {
  btn.disabled = loading;
  btn.textContent = loading ? 'Please wait…' : defaultLabel;
  btn.classList.toggle('auth__submit--loading', loading);
}

// ─── Map Supabase error messages to friendly strings ─────────────────────────

/**
 * Translate a raw Supabase/GoTrue error message into user-friendly copy.
 *
 * @param {string} raw - The raw error message string from Supabase.
 * @returns {string} A friendly message suitable for display.
 */
function friendlyError(raw) {
  if (!raw) return 'Something went wrong. Please try again.';
  const lower = raw.toLowerCase();

  if (lower.includes('invalid login') || lower.includes('invalid credentials')) {
    return 'Incorrect email or password.';
  }
  if (lower.includes('email not confirmed')) {
    return 'Please confirm your email before signing in.';
  }
  if (lower.includes('user already registered') || lower.includes('already been registered')) {
    return 'An account with this email already exists. Try signing in.';
  }
  if (lower.includes('password should be')) {
    return 'Password must be at least 8 characters.';
  }
  if (lower.includes('unable to validate email')) {
    return 'Please enter a valid email address.';
  }
  if (lower.includes('rate limit') || lower.includes('too many')) {
    return 'Too many attempts. Please wait a moment and try again.';
  }
  return raw;
}

// ─── Post-Login Bootstrap ─────────────────────────────────────────────────────

/**
 * Called after a successful sign-in. Hides the auth screen, shows the loading
 * overlay, fetches all user data, populates STATE, then reveals the app shell.
 *
 * @returns {Promise<void>}
 */
async function bootstrapApp() {
  // Hide auth, show loading overlay
  $authScreen.classList.add('auth--hidden');
  if ($appLoading) $appLoading.classList.remove('app-loading--hidden');

  try {
    await fetchAllUserData();
  } catch (err) {
    console.error('[Auth] bootstrapApp — fetchAllUserData failed:', err);
    // Non-fatal: app will still load, just with empty state
  }

  // Hide loading, reveal the app shell
  if ($appLoading) $appLoading.classList.add('app-loading--hidden');
  if ($appShell)  $appShell.classList.remove('app-shell--hidden');

  // Signal the rest of the app that the user is ready
  window.dispatchEvent(new CustomEvent('daily-os:ready'));
}

// ─── Form Handlers ────────────────────────────────────────────────────────────

/**
 * Handle the Sign In form submission.
 *
 * @returns {Promise<void>}
 */
async function handleSignIn() {
  const emailEl    = $authScreen.querySelector('#signin-email');
  const passwordEl = $authScreen.querySelector('#signin-password');
  const submitBtn  = $authScreen.querySelector('#signin-submit');

  const email    = emailEl.value.trim();
  const password = passwordEl.value;

  clearFeedback(TAB_SIGNIN);

  // Basic client-side validation
  if (!email || !password) {
    showFeedback(TAB_SIGNIN, 'Please fill in all fields.', 'error');
    return;
  }

  setButtonLoading(submitBtn, true, 'Sign In');

  try {
    const { error } = await signIn(email, password);

    if (error) {
      showFeedback(TAB_SIGNIN, friendlyError(error.message), 'error');
      setButtonLoading(submitBtn, false, 'Sign In');
      return;
    }

    // Success — bootstrap the app (button stays disabled during load)
    await bootstrapApp();

  } catch (err) {
    console.error('[Auth] handleSignIn failed:', err);
    showFeedback(TAB_SIGNIN, 'Something went wrong. Please try again.', 'error');
    setButtonLoading(submitBtn, false, 'Sign In');
  }
}

/**
 * Handle the Sign Up form submission.
 *
 * @returns {Promise<void>}
 */
async function handleSignUp() {
  const nameEl     = $authScreen.querySelector('#signup-name');
  const emailEl    = $authScreen.querySelector('#signup-email');
  const passwordEl = $authScreen.querySelector('#signup-password');
  const submitBtn  = $authScreen.querySelector('#signup-submit');

  const name     = nameEl.value.trim();
  const email    = emailEl.value.trim();
  const password = passwordEl.value;

  clearFeedback(TAB_SIGNUP);

  // Client-side validation
  if (!name || !email || !password) {
    showFeedback(TAB_SIGNUP, 'Please fill in all fields.', 'error');
    return;
  }
  if (password.length < 8) {
    showFeedback(TAB_SIGNUP, 'Password must be at least 8 characters.', 'error');
    return;
  }

  setButtonLoading(submitBtn, true, 'Create Account');

  try {
    const { error } = await signUp(email, password, name);

    if (error) {
      showFeedback(TAB_SIGNUP, friendlyError(error.message), 'error');
      setButtonLoading(submitBtn, false, 'Create Account');
      return;
    }

    // Success — Supabase sends a confirmation email before the session is active
    showFeedback(
      TAB_SIGNUP,
      '✓ Check your email to confirm your account, then sign in.',
      'success'
    );
    setButtonLoading(submitBtn, false, 'Create Account');

    // Auto-switch to sign-in tab after a short delay so the user sees the message
    setTimeout(() => {
      switchTab(TAB_SIGNIN);
      // Pre-fill the email they just used
      const siEmail = $authScreen.querySelector('#signin-email');
      if (siEmail) siEmail.value = email;
    }, SUCCESS_DISPLAY_MS);

  } catch (err) {
    console.error('[Auth] handleSignUp failed:', err);
    showFeedback(TAB_SIGNUP, 'Something went wrong. Please try again.', 'error');
    setButtonLoading(submitBtn, false, 'Create Account');
  }
}

// ─── Event Wiring ─────────────────────────────────────────────────────────────

/**
 * Attach all click and keyboard listeners to the rendered auth screen.
 *
 * @returns {void}
 */
function wireEvents() {
  // Tab buttons
  $authScreen.querySelectorAll('.auth__tab').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Submit buttons
  $authScreen.querySelector('#signin-submit')
    .addEventListener('click', handleSignIn);

  $authScreen.querySelector('#signup-submit')
    .addEventListener('click', handleSignUp);

  // Allow Enter key to submit from any input inside a panel
  $authScreen.querySelectorAll('.auth__panel').forEach((panel) => {
    panel.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const isSignin = panel.id === 'auth-panel-signin';
      if (isSignin) handleSignIn();
      else          handleSignUp();
    });
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialise the auth module. Call this once on app startup (before any other
 * page module is initialised). Checks for an existing session: if one is found,
 * immediately bootstraps the app; otherwise renders the auth screen.
 *
 * @returns {Promise<void>}
 */
export async function initAuth() {
  $authScreen = document.getElementById(AUTH_SCREEN_ID);
  $appShell   = document.getElementById(APP_SHELL_ID);
  $appLoading = document.getElementById(APP_LOADING_ID);

  if (!$authScreen) {
    console.error('[Auth] initAuth — #auth-screen element not found in DOM.');
    return;
  }

  // Render the auth UI into the container
  $authScreen.innerHTML = buildAuthHTML();
  wireEvents();

  // Check for an existing Supabase session (e.g. after a page refresh)
  try {
    const user = await getUser();
    if (user) {
      // Already logged in — skip the auth screen entirely
      await bootstrapApp();
      return;
    }
  } catch (err) {
    console.error('[Auth] initAuth — session check failed:', err);
  }

  // No active session — show the auth screen
  $authScreen.classList.remove('auth--hidden');
}

/**
 * Sign the current user out, clear STATE, and show the auth screen again.
 *
 * @returns {Promise<void>}
 */
export async function handleLogout() {
  try {
    await signOut();
  } catch (err) {
    console.error('[Auth] handleLogout — signOut failed:', err);
  }

  // Reset global state
  if (STATE && typeof STATE === 'object') {
    Object.keys(STATE).forEach((key) => {
      // Preserve primitive defaults where possible
      STATE[key] = Array.isArray(STATE[key]) ? [] : null;
    });
  }

  // Hide the app shell, show auth screen
  if ($appShell)  $appShell.classList.add('app-shell--hidden');
  if ($appLoading) $appLoading.classList.add('app-loading--hidden');

  $authScreen.classList.remove('auth--hidden');

  // Reset to sign-in tab and clear all inputs
  switchTab(TAB_SIGNIN);
  $authScreen.querySelectorAll('.auth__input').forEach((input) => {
    input.value = '';
  });
}
