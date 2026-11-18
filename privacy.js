/*
 * The privacy page follows the theme the panel uses.
 *
 * This used to be an inline <script> in privacy.html, which the extension CSP
 * blocks: the page always fell back to its default theme. It lives in its own
 * file so it actually runs, in Chrome and in Firefox.
 */
(function () {
  'use strict';

  var allowed = ['auto', 'midnight', 'graphite', 'ember', 'forest', 'daylight', 'sand'];

  function apply(theme) {
    if (allowed.indexOf(theme) === -1) theme = 'midnight';
    var resolved = theme;
    if (theme === 'auto') {
      resolved = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'daylight'
        : 'midnight';
    }
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themeMode = theme;
  }

  function fromStorage(data) {
    apply((data && data.ptcSettings || {}).theme);
  }

  apply('auto');

  try {
    if (!window.chrome || !chrome.storage || !chrome.storage.local) return;
    /* Chrome resolves a promise and ignores a callback; Firefox's chrome.*
       namespace answers the callback. Both paths end in the same place. */
    var reading = chrome.storage.local.get({ ptcSettings: {} }, fromStorage);
    if (reading && typeof reading.then === 'function') reading.then(fromStorage).catch(function () {});
  } catch (error) {
    /* keep the default theme */
  }
})();
