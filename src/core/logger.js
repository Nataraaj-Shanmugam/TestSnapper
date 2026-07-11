/**
 * Logger — centralised logging with configurable levels.
 *
 * Usage:
 *   import { Logger } from './logger.js';
 *   Logger.info('Recording started');
 *   Logger.warn('Quota high');
 *   Logger.error('Export failed', err);
 *
 * Set level at boot:
 *   Logger.setLevel('warn');  // silences info/debug
 *
 * In production builds the level is automatically set to 'warn'
 * so debug/info noise is suppressed.
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3, none: 4 };
const PREFIX = '[TestSnapper]';

let currentLevel = LEVELS.info;

export const Logger = {
  setLevel(level) {
    currentLevel = LEVELS[level] ?? LEVELS.info;
  },

  debug(...args) {
    if (currentLevel <= LEVELS.debug) console.log(PREFIX, ...args);
  },

  info(...args) {
    if (currentLevel <= LEVELS.info) console.log(PREFIX, ...args);
  },

  warn(...args) {
    if (currentLevel <= LEVELS.warn) console.warn(PREFIX, ...args);
  },

  error(...args) {
    if (currentLevel <= LEVELS.error) console.error(PREFIX, ...args);
  }
};

// Suppress info/debug in production builds
if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') {
  Logger.setLevel('warn');
}

// Expose Logger to content scripts (window context)
if (typeof window !== 'undefined') window.Logger = Logger;
