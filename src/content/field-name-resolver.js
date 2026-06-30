/**
 * Field Name Resolver - Smart, prioritized field name extraction
 * with Shadow DOM penetration, form group awareness, proximity scoring,
 * and cross-frame label resolution.
 *
 * Strategies (in priority order):
 *   1. Explicit Label (label[for], parent label, sibling, adjacent)
 *   2. ARIA Attributes (aria-label, aria-labelledby, aria-describedby)
 *   3. Placeholder text
 *   4. Form Group (fieldset/legend, role="group", framework form groups)
 *   5. Meaningful Attributes (name, id — skip auto-generated)
 *   6. Button Context (text, aria-label, SVG title, img alt, icon class)
 *   7. Proximity Text (spatial distance scoring via getBoundingClientRect)
 *   8. Shadow DOM Labels (walk shadow boundaries for labels)
 *   9. Frame Context (cross-frame label via cached message passing)
 */

/* global CSS */

// Use var for top-level to avoid SyntaxError on content-script re-injection
var FieldNameResolver = (function () {
  'use strict';

  // ── Generic name blocklist ─────────────────────────────────────────
  var GENERIC_NAMES = new Set([
    'text', 'password', 'email', 'number', 'tel', 'url', 'search',
    'button', 'submit', 'reset', 'input', 'field', 'div', 'span',
    'form', 'select', 'textarea', 'checkbox', 'radio',
    'hidden', 'file', 'image', 'range', 'color', 'date', 'time',
    'click here', 'enter', 'type here', 'unknown field',
    'click', 'type', 'option', 'label', 'a', 'li', 'td', 'th',
    'section', 'article', 'main', 'header', 'footer', 'nav'
  ]);

  // ── Auto-generated ID patterns (from selector.js) ─────────────────
  var GENERATED_ID_PATTERNS = [
    /^ember\d+/i,
    /^react-/i,
    /^__next/i,
    /^mui-\d+/i,
    /^:[a-z0-9]+:$/i,           // React 18+ useId
    /^[a-f0-9]{8,}$/i,          // hex hashes
    /^\d+$/,                     // pure numbers
    /^ng-/i,                     // Angular
    /^v-/i,                      // Vue
    /^svelte-/i,
    /^radix-/i,
    /^headlessui-/i,
    /^downshift-/i,
    /^rc_/i,                     // Ant Design
    /^ext-comp-\d+/i             // ExtJS
  ];

  // ── Meaningful prefix allowlist (overrides generated detection) ────
  var MEANINGFUL_PREFIXES = [
    'header', 'nav', 'form', 'login', 'signup', 'register', 'search',
    'user', 'email', 'password', 'name', 'phone', 'address', 'btn',
    'submit', 'cancel', 'save', 'delete', 'edit', 'menu', 'sidebar',
    'modal', 'dialog', 'tab', 'panel', 'card', 'list', 'table',
    'filter', 'sort', 'page', 'content', 'main', 'footer', 'title',
    'description', 'comment', 'message', 'chat', 'notification'
  ];

  /**
   * Initialize the field name resolver
   * @constructor
   * @param {Object} [selectorEngine] - Optional reference to the SelectorEngine instance
   */
  function FieldNameResolver(selectorEngine) {
    this._selectorEngine = selectorEngine || null;
    this._cache = new WeakMap();
    this._cachedFrameLabel = null;
  }

  /**
   * Main entry point. Returns a cleaned, meaningful field name or null.
   * Tries multiple strategies in priority order until one succeeds
   * @param {Element} element - Form element to resolve name for
   * @returns {string|null} Cleaned field name or null if not found
   */
  FieldNameResolver.prototype.resolve = function (element) {
    if (!element) return null;

    if (this._cache.has(element)) return this._cache.get(element);

    var strategies = [
      this._fromExplicitLabel,
      this._fromAriaAttributes,
      this._fromPlaceholder,
      this._fromFormGroup,
      this._fromMeaningfulAttributes,
      this._fromButtonContext,
      this._fromElementText,
      this._fromProximityText,
      this._fromShadowDOMLabels,
      this._fromFrameContext
    ];

    for (var i = 0; i < strategies.length; i++) {
      try {
        var name = strategies[i].call(this, element);
        if (name && this._isQualityName(name)) {
          var cleaned = this._cleanFieldName(name);
          if (cleaned && this._isQualityName(cleaned)) {
            this._cache.set(element, cleaned);
            return cleaned;
          }
        }
      } catch (e) {
        // Continue to next strategy
      }
    }

    this._cache.set(element, null);
    return null;
  };

  /**
   * Clear the resolution cache (call on navigation or DOM mutation)
   */
  FieldNameResolver.prototype.clearCache = function () {
    this._cache = new WeakMap();
  };

  /**
   * Pre-fetch iframe label context (async, call at recording start)
   * @async
   */
  FieldNameResolver.prototype.initFrameContext = async function () {
    if (window === window.top) return;

    try {
      var response = await chrome.runtime.sendMessage({
        action: 'getFrameLabel',
        frameUrl: window.location.href
      });
      if (response && response.label) {
        this._cachedFrameLabel = response.label;
      }
    } catch (e) {
      window.Logger?.debug('Frame context initialization note:', e);
    }
  };

  /**
   * Try to get label from explicit <label> element
   * Checks: label[for=id], label[for=name], parent label, sibling label, adjacent label
   * @private
   * @param {Element} element - Form element
   * @returns {string|null} Label text or null
   */
  FieldNameResolver.prototype._fromExplicitLabel = function (element) {
    // 1a. label[for=id]
    if (element.id) {
      var label = this._safeQuery('label[for="' + CSS.escape(element.id) + '"]');
      if (label) return this._extractLabelText(label);
    }

    // 1b. label[for=name] — some sites use name instead of id
    if (element.name) {
      var labelByName = this._safeQuery('label[for="' + CSS.escape(element.name) + '"]');
      if (labelByName) return this._extractLabelText(labelByName);
    }

    // 1c. Wrapping <label>
    var parentLabel = element.closest('label');
    if (parentLabel) return this._extractLabelText(parentLabel);

    // 1d. Previous sibling label
    var prev = element.previousElementSibling;
    while (prev) {
      if (prev.tagName === 'LABEL') return this._extractLabelText(prev);
      prev = prev.previousElementSibling;
    }

    // 1e. Adjacent label in parent/sibling structure (Bootstrap, Tailwind)
    var parent = element.parentElement;
    if (parent) {
      var siblingLabel = parent.querySelector('label');
      if (siblingLabel && !siblingLabel.contains(element)) {
        return this._extractLabelText(siblingLabel);
      }

      // Check parent's previous sibling for label
      var parentPrev = parent.previousElementSibling;
      if (parentPrev) {
        if (parentPrev.tagName === 'LABEL') return this._extractLabelText(parentPrev);
        var labelInPrev = parentPrev.querySelector('label');
        if (labelInPrev) return this._extractLabelText(labelInPrev);
      }
    }

    return null;
  };

  /**
   * Try to get label from ARIA attributes
   * Checks: aria-label, aria-labelledby, aria-describedby
   * @private
   * @param {Element} element - Form element
   * @returns {string|null} Label text or null
   */
  FieldNameResolver.prototype._fromAriaAttributes = function (element) {
    var ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

    var ariaLabelledBy = element.getAttribute('aria-labelledby');
    if (ariaLabelledBy) {
      var labelElement = document.getElementById(ariaLabelledBy);
      if (labelElement) {
        return labelElement.innerText || labelElement.textContent;
      }
    }

    var ariaDescribedBy = element.getAttribute('aria-describedby');
    if (ariaDescribedBy) {
      var descElement = document.getElementById(ariaDescribedBy);
      if (descElement) {
        return descElement.innerText || descElement.textContent;
      }
    }

    return null;
  };

  /**
   * Try to get label from placeholder attribute
   * @private
   * @param {Element} element - Form element
   * @returns {string|null} Placeholder text or null
   */
  FieldNameResolver.prototype._fromPlaceholder = function (element) {
    var ph = element.placeholder || element.getAttribute('placeholder');
    return ph && ph.trim() ? ph.trim() : null;
  };

  /**
   * Try to get label from form group context
   * Checks: fieldset/legend, role="group", framework form groups
   * @private
   * @param {Element} element - Form element
   * @returns {string|null} Form group label or null
   */
  FieldNameResolver.prototype._fromFormGroup = function (element) {
    // Fieldset + legend
    var fieldset = element.closest('fieldset');
    if (fieldset) {
      var legend = fieldset.querySelector('legend');
      if (legend) {
        return legend.innerText || legend.textContent;
      }
    }

    // role="group" with aria-label
    var groupRole = element.closest('[role="group"]');
    if (groupRole) {
      var groupLabel = groupRole.getAttribute('aria-label');
      if (groupLabel) return groupLabel;
    }

    return null;
  };

  /**
   * Try to get label from name or id attributes (skip auto-generated)
   * @private
   * @param {Element} element - Form element
   * @returns {string|null} Name or ID or null
   */
  FieldNameResolver.prototype._fromMeaningfulAttributes = function (element) {
    if (element.name && !this._isGenerated(element.name)) {
      return element.name;
    }

    if (element.id && !this._isGenerated(element.id)) {
      return element.id;
    }

    return null;
  };

  /**
   * Try to get label from button context (for buttons, links, etc)
   * @private
   * @param {Element} element - Form element
   * @returns {string|null} Button text or null
   */
  FieldNameResolver.prototype._fromButtonContext = function (element) {
    var tag = element.tagName.toLowerCase();

    if (tag === 'button' || tag === 'a') {
      return element.innerText || element.textContent;
    }

    // SVG icon label from title
    if (tag === 'svg') {
      var title = element.querySelector('title');
      if (title) return title.textContent;
    }

    // img alt text
    if (tag === 'img') {
      return element.getAttribute('alt');
    }

    return null;
  };

  /**
   * Try to get label from element text content (fallback for any element)
   * @private
   * @param {Element} element - Form element
   * @returns {string|null} Text content or null
   */
  FieldNameResolver.prototype._fromElementText = function (element) {
    var title = element.getAttribute('title');
    if (title && title.trim()) return title.trim();

    var text = element.innerText || element.textContent;
    if (text && text.trim()) {
      var trimmed = text.trim();
      if (trimmed.length < 100) return trimmed;
    }

    return null;
  };

  /**
   * Try to get label from nearby text (proximity scoring)
   * Looks for nearby text nodes based on spatial distance
   * @private
   * @param {Element} element - Form element
   * @returns {string|null} Nearby text or null
   */
  FieldNameResolver.prototype._fromProximityText = function (element) {
    var rect = element.getBoundingClientRect();
    var candidates = [];

    // Walk through all text nodes in parent container
    var walker = document.createTreeWalker(
      element.parentElement || document.body,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    var node;
    while (node = walker.nextNode()) {
      var text = node.textContent.trim();
      if (text && text.length > 2 && text.length < 100 && !GENERIC_NAMES.has(text.toLowerCase())) {
        // Calculate distance to element
        var nodeRect = node.parentElement.getBoundingClientRect();
        var distance = Math.hypot(
          nodeRect.left - rect.left,
          nodeRect.top - rect.top
        );
        candidates.push({ text: text, distance: distance });
      }
    }

    if (candidates.length > 0) {
      // Sort by distance and return closest
      candidates.sort((a, b) => a.distance - b.distance);
      return candidates[0].text;
    }

    return null;
  };

  /**
   * Try to get label from Shadow DOM boundaries
   * Walks shadow roots for labels
   * @private
   * @param {Element} element - Form element
   * @returns {string|null} Label text or null
   */
  FieldNameResolver.prototype._fromShadowDOMLabels = function (element) {
    var parent = element.parentElement;
    while (parent) {
      if (parent.shadowRoot) {
        var label = parent.shadowRoot.querySelector('label');
        if (label) return this._extractLabelText(label);
      }
      parent = parent.parentElement;
    }

    return null;
  };

  /**
   * Try to get label from cached iframe context
   * @private
   * @param {Element} element - Form element
   * @returns {string|null} Frame label or null
   */
  FieldNameResolver.prototype._fromFrameContext = function (element) {
    return this._cachedFrameLabel || null;
  };

  /**
   * Safe querySelector wrapper (handles errors gracefully)
   * @private
   * @param {string} selector - CSS selector
   * @returns {Element|null} Element or null
   */
  FieldNameResolver.prototype._safeQuery = function (selector) {
    try {
      return document.querySelector(selector);
    } catch {
      return null;
    }
  };

  /**
   * Extract meaningful text from label element
   * @private
   * @param {Element} label - Label element
   * @returns {string|null} Label text or null
   */
  FieldNameResolver.prototype._extractLabelText = function (label) {
    if (!label) return null;
    var text = label.innerText || label.textContent;
    return text && text.trim() ? text.trim() : null;
  };

  /**
   * Check if a name is quality/meaningful
   * @private
   * @param {string} name - Name to check
   * @returns {boolean} true if name is quality
   */
  FieldNameResolver.prototype._isQualityName = function (name) {
    if (!name || name.length === 0) return false;
    if (name.length > 200) return false;
    var lower = name.toLowerCase();
    return !GENERIC_NAMES.has(lower);
  };

  /**
   * Check if a string looks auto-generated
   * @private
   * @param {string} str - String to check
   * @returns {boolean} true if string appears auto-generated
   */
  FieldNameResolver.prototype._isGenerated = function (str) {
    if (!str || str.length < 3) return false;
    return GENERATED_ID_PATTERNS.some(pattern => pattern.test(str));
  };

  /**
   * Clean and normalize field name
   * Converts to Title Case, removes special chars, etc.
   * @private
   * @param {string} text - Raw field name
   * @returns {string} Cleaned field name
   */
  FieldNameResolver.prototype._cleanFieldName = function (text) {
    return text
      .replace(/^\*+|\*+$/g, '')                     // Remove leading/trailing asterisks
      .replace(/:\s*$/g, '')                         // Remove trailing colons
      .replace(/([a-z])([A-Z])/g, '$1 $2')          // camelCase to spaces
      .replace(/[_-]+/g, ' ')                        // Underscores/hyphens to spaces
      .replace(/\s+/g, ' ')                          // Multiple spaces to single
      .trim()
      .split(' ')
      .map(function (word) {
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(' ');
  };

  // Export
  return FieldNameResolver;
})();

// Make globally available for content script
if (typeof window !== 'undefined') {
  if (!window.FieldNameResolver) {
    window.FieldNameResolver = FieldNameResolver;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FieldNameResolver };
}
