/**
 * Content-script Logger — classic script (NO ES module syntax).
 *
 * Content scripts are injected as classic scripts, so this file must not use
 * `export`/`import` (the previous injection of src/core/logger.js threw
 * "Unexpected token 'export'" on every page and window.Logger never existed).
 *
 * Keep the API in sync with src/core/logger.js (the ES-module twin used by
 * bundled/module code). Level defaults to 'warn' here because content scripts
 * run inside user pages — debug/info noise must not pollute site consoles.
 */

// Guard against re-injection — same pattern as selector.js/redactor.js.
if (typeof window !== 'undefined' && window.Logger) {
  // Already defined — keep the live instance.
} else {
  (function () {
    var LEVELS = { debug: 0, info: 1, warn: 2, error: 3, none: 4 };
    var PREFIX = '[TestSnapper]';
    var currentLevel = LEVELS.warn;

    var Logger = {
      setLevel: function (level) {
        currentLevel = LEVELS[level] !== undefined ? LEVELS[level] : LEVELS.info;
      },
      debug: function () {
        if (currentLevel <= LEVELS.debug) console.log.apply(console, [PREFIX].concat([].slice.call(arguments)));
      },
      info: function () {
        if (currentLevel <= LEVELS.info) console.log.apply(console, [PREFIX].concat([].slice.call(arguments)));
      },
      warn: function () {
        if (currentLevel <= LEVELS.warn) console.warn.apply(console, [PREFIX].concat([].slice.call(arguments)));
      },
      error: function () {
        if (currentLevel <= LEVELS.error) console.error.apply(console, [PREFIX].concat([].slice.call(arguments)));
      }
    };

    if (typeof window !== 'undefined') window.Logger = Logger;
  })();
}
