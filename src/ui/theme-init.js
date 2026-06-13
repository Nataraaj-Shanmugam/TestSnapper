/**
 * theme-init.js — Inline-equivalent theme bootstrap
 * UX-006: Apply the saved theme BEFORE first paint to prevent flash of wrong theme.
 * Load this as the FIRST <script> in <head> (CSP allows 'self' scripts).
 * Reads localStorage (fast synchronous mirror) rather than chrome.storage.
 */
(function () {
  try {
    var t = localStorage.getItem('theme');
    if (!t) {
      t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark' : 'light';
    }
    document.documentElement.dataset.theme = t;
    document.documentElement.classList.add(t === 'dark' ? 'dark-mode' : 'light-mode');
  } catch (e) {
    // localStorage unavailable (e.g. sandboxed) — fall through to JS-based setup
  }
})();
