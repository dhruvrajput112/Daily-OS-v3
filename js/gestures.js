/**
 * @file gestures.js
 * @description Touch gesture handlers — swipe-to-complete for To-Do items.
 * @module Gestures
 */

import { vibrate, HAPTIC_SWIPE } from './haptics.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Horizontal distance (px) at which a swipe is committed and triggers completion. */
const SWIPE_THRESHOLD = 80;

/**
 * Minimum horizontal-to-vertical ratio to recognise a horizontal swipe
 * and prevent accidental triggers during vertical scroll.
 */
const SWIPE_AXIS_LOCK_PX = 10;

/** CSS class added to the item when it crosses the commit threshold. */
const CLASS_COMMITTED = 'swipe-committed';

/** CSS class applied during the spring-back animation. */
const CLASS_SPRINGING = 'swipe-springing';

/** CSS class applied during the slide-out animation. */
const CLASS_SLIDING_OUT = 'swipe-sliding-out';

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Read or lazily create the reveal overlay inside a todo element.
 * The overlay sits behind the item content and shows the green background + checkmark.
 *
 * @param {HTMLElement} el - The todo item root element.
 * @returns {HTMLElement} The reveal overlay element.
 */
function getOrCreateReveal(el) {
  let reveal = el.querySelector('.swipe-reveal');
  if (!reveal) {
    reveal = document.createElement('div');
    reveal.className = 'swipe-reveal';

    const icon = document.createElement('span');
    icon.className = 'swipe-reveal__icon';
    icon.textContent = '✓';
    reveal.appendChild(icon);

    // Insert as first child so it sits behind the item's own content
    el.insertBefore(reveal, el.firstChild);
  }
  return reveal;
}

/**
 * Reset a todo element back to its resting state — no transform, no extra classes.
 *
 * @param {HTMLElement} el - The todo item root element.
 * @param {HTMLElement} reveal - The reveal overlay element.
 */
function resetItem(el, reveal) {
  el.classList.add(CLASS_SPRINGING);
  el.style.transform = 'translateX(0)';
  reveal.style.opacity = '0';
  el.classList.remove(CLASS_COMMITTED);

  // Remove the springing class after the transition completes
  el.addEventListener('transitionend', () => {
    el.classList.remove(CLASS_SPRINGING);
  }, { once: true });
}

/**
 * Animate a todo element sliding off-screen to the right, then remove it from the DOM.
 *
 * @param {HTMLElement} el - The todo item root element.
 * @param {Function} onDone - Called after the element is removed.
 */
function slideOut(el, onDone) {
  el.classList.add(CLASS_SLIDING_OUT);
  el.style.transform = 'translateX(110%)';
  el.style.opacity = '0';

  el.addEventListener('transitionend', () => {
    el.remove();
    if (typeof onDone === 'function') onDone();
  }, { once: true });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Attach swipe-to-complete touch listeners to a single To-Do item element.
 * The element must have a `data-id` attribute containing the todo item's ID.
 *
 * Swipe is disabled if the item already carries the class `todo-item--completed`.
 *
 * @param {HTMLElement} element - The todo item root element.
 * @param {Function} onComplete - Callback invoked with the todo ID when the
 *   swipe gesture is committed. Signature: (id: string) => void | Promise<void>
 * @returns {void}
 */
export function attachSwipeToComplete(element, onComplete) {
  /** @type {number} X coordinate where the touch started. */
  let startX = 0;
  /** @type {number} Y coordinate where the touch started. */
  let startY = 0;
  /** @type {boolean} Whether the gesture has been recognised as horizontal. */
  let isHorizontal = false;
  /** @type {boolean} Whether the swipe threshold has been crossed this gesture. */
  let hapticFired = false;
  /** @type {boolean} Lock to prevent re-entrant completion calls. */
  let completing = false;

  const reveal = getOrCreateReveal(element);

  // ── touchstart ──────────────────────────────────────────────────────────────
  element.addEventListener('touchstart', (e) => {
    // Do not attach behaviour to already-completed items
    if (element.classList.contains('todo-item--completed')) return;

    const touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    isHorizontal = false;
    hapticFired = false;
    completing = false;

    // Remove any residual animation classes
    element.classList.remove(CLASS_SPRINGING, CLASS_COMMITTED, CLASS_SLIDING_OUT);
  }, { passive: true });

  // ── touchmove ───────────────────────────────────────────────────────────────
  element.addEventListener('touchmove', (e) => {
    if (element.classList.contains('todo-item--completed')) return;
    if (completing) return;

    const touch = e.touches[0];
    const deltaX = touch.clientX - startX;
    const deltaY = Math.abs(touch.clientY - startY);

    // Only allow rightward swipes
    if (deltaX <= 0) return;

    // Determine gesture axis on first meaningful movement
    if (!isHorizontal) {
      if (deltaX < SWIPE_AXIS_LOCK_PX && deltaY < SWIPE_AXIS_LOCK_PX) return;
      isHorizontal = deltaX > deltaY;
      if (!isHorizontal) return; // Vertical scroll — ignore
    }

    // Prevent the page from scrolling while we are handling a horizontal swipe
    e.preventDefault();

    // Translate the element
    element.style.transform = `translateX(${deltaX}px)`;

    // Reveal background + checkmark opacity scales with distance up to threshold
    const progress = Math.min(deltaX / SWIPE_THRESHOLD, 1);
    reveal.style.opacity = String(progress);

    // Committed state: past threshold
    if (deltaX >= SWIPE_THRESHOLD) {
      if (!hapticFired) {
        vibrate(HAPTIC_SWIPE);
        hapticFired = true;
        element.classList.add(CLASS_COMMITTED);
      }
    } else {
      element.classList.remove(CLASS_COMMITTED);
      hapticFired = false;
    }
  }, { passive: false });

  // ── touchend ────────────────────────────────────────────────────────────────
  element.addEventListener('touchend', (e) => {
    if (element.classList.contains('todo-item--completed')) return;
    if (!isHorizontal) return;
    if (completing) return;

    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - startX;

    if (deltaX >= SWIPE_THRESHOLD) {
      // ── Commit: slide out and invoke callback ────────────────────────────
      completing = true;
      const id = element.dataset.id;
      slideOut(element, () => {
        if (typeof onComplete === 'function') onComplete(id);
      });
    } else {
      // ── Bail: spring back to resting position ────────────────────────────
      resetItem(element, reveal);
    }
  }, { passive: true });

  // ── touchcancel ─────────────────────────────────────────────────────────────
  element.addEventListener('touchcancel', () => {
    if (!isHorizontal) return;
    resetItem(element, reveal);
  }, { passive: true });
}
