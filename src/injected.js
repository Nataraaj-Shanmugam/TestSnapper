/**
 * Injected Script - Runs in page context for DOM manipulation
 */

(function() {
  'use strict';

  // Helper function to get element bounds
  window.testSnapperGetBounds = function(selector) {
    try {
      const element = document.querySelector(selector);
      if (!element) return null;

      const rect = element.getBoundingClientRect();
      return {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        bottom: rect.bottom,
        right: rect.right
      };
    } catch (error) {
      console.error('Error getting bounds:', error);
      return null;
    }
  };

  // Helper function to test if selector is valid
  window.testSnapperTestSelector = function(selector) {
    try {
      const element = document.querySelector(selector);
      return element !== null;
    } catch (error) {
      return false;
    }
  };

  // Helper function to get element count for selector
  window.testSnapperCountElements = function(selector) {
    try {
      return document.querySelectorAll(selector).length;
    } catch (error) {
      return 0;
    }
  };

  console.log('TestSnapper injected script loaded');
})();
