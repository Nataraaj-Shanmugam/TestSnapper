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
   * @constructor
   * @param {Object} [selectorEngine] - Optional reference to the SelectorEngine instance
   */
  function FieldNameResolver(selectorEngine) {
    this._selectorEngine = selectorEngine || null;
    this._cache = new WeakMap();
    this._cachedFrameLabel = null;
  }

  // ══════════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ══════════════════════════════════════════════════════════════════

  /**
   * Main entry point. Returns a cleaned, meaningful field name or null.
   * @param {Element} element
   * @returns {string|null}
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
      this._fromElementText,         // Generic: title attr + innerText for ANY element
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
   * Clear the resolution cache (call on navigation or DOM mutation).
   */
  FieldNameResolver.prototype.clearCache = function () {
    this._cache = new WeakMap();
  };

  /**
   * Pre-fetch iframe label context (async, call at recording start).
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
      // Not critical — iframe label is a bonus
    }
  };

  // ══════════════════════════════════════════════════════════════════
  //  STRATEGY 1: Explicit Label
  // ══════════════════════════════════════════════════════════════════

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

  // ══════════════════════════════════════════════════════════════════
  //  STRATEGY 2: ARIA Attributes
  // ══════════════════════════════════════════════════════════════════

  FieldNameResolver.prototype._fromAriaAttributes = function (element) {
    var ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

    var labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      var text = this._getTextFromIds(labelledBy);
      if (text) return text;
    }

    var describedBy = element.getAttribute('aria-describedby');
    if (describedBy) {
      var descText = this._getTextFromIds(describedBy);
      if (descText && descText.length < 60) return descText;
    }

    return null;
  };

  // ══════════════════════════════════════════════════════════════════
  //  STRATEGY 3: Placeholder
  // ══════════════════════════════════════════════════════════════════

  FieldNameResolver.prototype._fromPlaceholder = function (element) {
    if (element.placeholder && element.placeholder.trim()) {
      return element.placeholder.trim();
    }
    return null;
  };

  // ══════════════════════════════════════════════════════════════════
  //  STRATEGY 4: Form Group
  // ══════════════════════════════════════════════════════════════════

  FieldNameResolver.prototype._fromFormGroup = function (element) {
    // 4a. fieldset/legend
    var fieldset = element.closest('fieldset');
    if (fieldset) {
      var legend = fieldset.querySelector('legend');
      if (legend) {
        var inputs = fieldset.querySelectorAll('input, select, textarea');
        if (inputs.length === 1 && inputs[0] === element) {
          return legend.textContent.trim();
        }
      }
    }

    // 4b. role="group" with aria-label
    var group = element.closest('[role="group"]');
    if (group) {
      var groupLabel = group.getAttribute('aria-label');
      if (!groupLabel) {
        var groupLabelledBy = group.getAttribute('aria-labelledby');
        if (groupLabelledBy) groupLabel = this._getTextFromIds(groupLabelledBy);
      }
      if (groupLabel) {
        var groupInputs = group.querySelectorAll('input, select, textarea');
        if (groupInputs.length === 1 && groupInputs[0] === element) {
          return groupLabel;
        }
      }
    }

    // 4c. Framework form group patterns
    var formGroup = element.closest(
      '.form-group, .MuiFormControl-root, .ant-form-item, .v-input, ' +
      '.el-form-item, .chakra-form-control, .field, .form-field'
    );
    if (formGroup) {
      var fgLabel = formGroup.querySelector(
        '.form-label, .MuiFormLabel-root, .MuiInputLabel-root, ' +
        '.ant-form-item-label label, .v-label, .el-form-item__label, ' +
        '.chakra-form__label, label'
      );
      if (fgLabel && !fgLabel.contains(element)) {
        return this._extractLabelText(fgLabel);
      }
    }

    return null;
  };

  // ══════════════════════════════════════════════════════════════════
  //  STRATEGY 5: Meaningful Attributes (name, id)
  // ══════════════════════════════════════════════════════════════════

  FieldNameResolver.prototype._fromMeaningfulAttributes = function (element) {
    if (element.name && !this._isGeneratedId(element.name)) {
      return element.name;
    }
    if (element.id && !this._isGeneratedId(element.id)) {
      return element.id;
    }
    return null;
  };

  // ══════════════════════════════════════════════════════════════════
  //  STRATEGY 6: Button Context
  // ══════════════════════════════════════════════════════════════════

  FieldNameResolver.prototype._fromButtonContext = function (element) {
    var tag = element.tagName.toLowerCase();
    var role = element.getAttribute('role');
    var type = element.type;

    var isButton = tag === 'button' || tag === 'a' ||
      role === 'button' || role === 'link' || role === 'tab' || role === 'menuitem' ||
      type === 'submit' || type === 'button';

    if (!isButton) return null;

    // 6a. Visible text content
    var text = (element.innerText || '').trim();
    if (text && text.length > 0 && text.length < 50) return text;

    // 6b. aria-label
    var ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();

    // 6c. title attribute
    if (element.title) return element.title.trim();

    // 6d. SVG title element inside button
    var svg = element.querySelector('svg');
    if (svg) {
      var svgTitle = svg.querySelector('title');
      if (svgTitle && svgTitle.textContent.trim()) return svgTitle.textContent.trim();
      var svgAriaLabel = svg.getAttribute('aria-label');
      if (svgAriaLabel) return svgAriaLabel.trim();
    }

    // 6e. img alt text inside button
    var img = element.querySelector('img');
    if (img && img.alt) return img.alt.trim();

    // 6f. Icon class interpretation
    var icon = element.querySelector(
      'i[class*="fa-"], span[class*="icon-"], .material-icons, .material-symbols-outlined'
    );
    if (icon) {
      if (icon.classList.contains('material-icons') || icon.classList.contains('material-symbols-outlined')) {
        var iconText = icon.textContent.trim();
        if (iconText) return iconText;
      }
      var faMatch = icon.className.match(/fa-([a-z][a-z-]+)/);
      if (faMatch) return faMatch[1].replace(/-/g, ' ');
    }

    // 6g. value attribute for submit/button inputs
    if (element.value && (type === 'submit' || type === 'button')) {
      return element.value.trim();
    }

    return null;
  };

  // ══════════════════════════════════════════════════════════════════
  //  STRATEGY 7: Element Own Text (generic — works on ANY element)
  //  Extracts the element's title attribute or its own visible text.
  // ══════════════════════════════════════════════════════════════════

  FieldNameResolver.prototype._fromElementText = function (element) {
    // 7a. title attribute — most explicit
    if (element.title && element.title.trim()) {
      return element.title.trim();
    }

    // 7b. data-testid (often a meaningful human-readable name)
    var testId = element.getAttribute('data-testid') || element.getAttribute('data-test') ||
                 element.getAttribute('data-cy');
    if (testId && testId.trim()) {
      return testId.trim();
    }

    // 7c. Direct text content of the element itself
    //     Use innerText (visible text only, ignores hidden and comments)
    var text = (element.innerText || '').trim();
    if (text && text.length > 0 && text.length < 60) {
      // If the text contains newlines, take just the first line
      var firstLine = text.split('\n')[0].trim();
      if (firstLine && firstLine.length > 0) return firstLine;
    }

    // 7d. textContent fallback (includes non-visible text)
    //     Only use if innerText was empty and textContent has something short
    if (!text) {
      var tc = (element.textContent || '').trim();
      if (tc && tc.length > 0 && tc.length < 40) {
        return tc;
      }
    }

    // 7e. value attribute (for inputs, selects, etc.)
    if (element.value && typeof element.value === 'string' && element.value.trim()) {
      var val = element.value.trim();
      if (val.length < 40) return val;
    }

    return null;
  };

  // ══════════════════════════════════════════════════════════════════
  //  STRATEGY 8: Proximity Text (spatial distance scoring)
  // ══════════════════════════════════════════════════════════════════

  FieldNameResolver.prototype._fromProximityText = function (element) {
    var elementRect = element.getBoundingClientRect();
    if (!elementRect.width && !elementRect.height) return null;

    var candidates = [];
    var maxDistance = 150;
    var maxDepth = 4;
    var parent = element.parentElement;
    var depth = 0;

    while (parent && depth < maxDepth) {
      // Text nodes
      var childNodes = parent.childNodes;
      for (var i = 0; i < childNodes.length; i++) {
        var node = childNodes[i];
        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
          try {
            var range = document.createRange();
            range.selectNodeContents(node);
            var rect = range.getBoundingClientRect();
            if (rect.width > 0 || rect.height > 0) {
              var distance = this._calculateDistance(elementRect, rect);
              if (distance < maxDistance) {
                var posBonus = (rect.right <= elementRect.left || rect.bottom <= elementRect.top) ? -20 : 0;
                candidates.push({ text: node.textContent.trim(), distance: distance + posBonus });
              }
            }
          } catch (e) { /* skip */ }
        }
      }

      // Inline elements (span, label, p, small, strong, em)
      var textEls = parent.querySelectorAll(
        'span:not(:has(input, select, textarea)), label, p, small, strong, em, ' +
        'div:not(:has(input, select, textarea, button))'
      );
      for (var j = 0; j < textEls.length; j++) {
        var el = textEls[j];
        if (el.contains(element) || element.contains(el)) continue;
        var elText = el.textContent.trim();
        if (elText && elText.length > 0 && elText.length < 60) {
          var elRect = el.getBoundingClientRect();
          var elDist = this._calculateDistance(elementRect, elRect);
          if (elDist < maxDistance) {
            var elBonus = (elRect.right <= elementRect.left || elRect.bottom <= elementRect.top) ? -20 : 0;
            candidates.push({ text: elText, distance: elDist + elBonus });
          }
        }
      }

      parent = parent.parentElement;
      depth++;
    }

    if (candidates.length === 0) return null;

    candidates.sort(function (a, b) { return a.distance - b.distance; });
    return candidates[0].text;
  };

  // ══════════════════════════════════════════════════════════════════
  //  STRATEGY 8: Shadow DOM Labels
  // ══════════════════════════════════════════════════════════════════

  FieldNameResolver.prototype._fromShadowDOMLabels = function (element) {
    var node = element;
    while (node) {
      var root = node.getRootNode();
      if (root instanceof ShadowRoot) {
        var host = root.host;

        // Check the host's surrounding light DOM for labels
        if (host.id) {
          var label = document.querySelector('label[for="' + CSS.escape(host.id) + '"]');
          if (label) return this._extractLabelText(label);
        }

        // Check host's aria-label
        var hostAriaLabel = host.getAttribute('aria-label');
        if (hostAriaLabel) return hostAriaLabel.trim();

        // Check slots for projected label content
        if (element.assignedSlot) {
          var slotLabel = element.assignedSlot.closest('label');
          if (slotLabel) return this._extractLabelText(slotLabel);
        }

        node = host; // Continue walking up
      } else {
        break;
      }
    }
    return null;
  };

  // ══════════════════════════════════════════════════════════════════
  //  STRATEGY 9: Frame Context
  // ══════════════════════════════════════════════════════════════════

  FieldNameResolver.prototype._fromFrameContext = function () {
    return this._cachedFrameLabel || null;
  };

  // ══════════════════════════════════════════════════════════════════
  //  HELPERS
  // ══════════════════════════════════════════════════════════════════

  /**
   * Extract clean text from a label element, removing interactive children
   * and "required"/"optional" indicators.
   */
  FieldNameResolver.prototype._extractLabelText = function (labelEl) {
    var clone = labelEl.cloneNode(true);
    clone.querySelectorAll('input, select, textarea, button, .required, .optional').forEach(function (el) {
      el.remove();
    });
    var text = clone.textContent.trim();
    text = text
      .replace(/\*\s*$/, '')
      .replace(/\(required\)/gi, '')
      .replace(/\(optional\)/gi, '')
      .replace(/^\*\s*/, '')
      .trim();
    return text || null;
  };

  /**
   * Get combined text from space-separated IDs (for aria-labelledby/describedby).
   */
  FieldNameResolver.prototype._getTextFromIds = function (idStr) {
    var parts = idStr.split(/\s+/);
    var texts = [];
    for (var i = 0; i < parts.length; i++) {
      var el = document.getElementById(parts[i]);
      if (el && el.textContent.trim()) {
        texts.push(el.textContent.trim());
      }
    }
    return texts.length > 0 ? texts.join(' ') : null;
  };

  /**
   * Safe querySelector that won't throw on invalid selectors.
   */
  FieldNameResolver.prototype._safeQuery = function (selector) {
    try {
      return document.querySelector(selector);
    } catch (e) {
      return null;
    }
  };

  /**
   * Check if a name/id is auto-generated (framework-specific patterns).
   */
  FieldNameResolver.prototype._isGeneratedId = function (id) {
    if (!id || id.length < 2) return false;

    // Allow short IDs
    if (id.length < 4) return false;

    // Allow meaningful prefixes
    var lowerID = id.toLowerCase();
    for (var i = 0; i < MEANINGFUL_PREFIXES.length; i++) {
      if (lowerID.startsWith(MEANINGFUL_PREFIXES[i])) return false;
    }

    for (var j = 0; j < GENERATED_ID_PATTERNS.length; j++) {
      if (GENERATED_ID_PATTERNS[j].test(id)) return true;
    }

    return false;
  };

  /**
   * Quality gate — reject generic names that would be unhelpful.
   */
  FieldNameResolver.prototype._isQualityName = function (name) {
    if (!name || name.trim().length === 0) return false;
    if (name.trim().length > 80) return false;
    return !GENERIC_NAMES.has(name.trim().toLowerCase());
  };

  /**
   * Calculate Euclidean distance between two bounding rects (center-to-center).
   */
  FieldNameResolver.prototype._calculateDistance = function (rect1, rect2) {
    var cx1 = rect1.left + rect1.width / 2;
    var cy1 = rect1.top + rect1.height / 2;
    var cx2 = rect2.left + rect2.width / 2;
    var cy2 = rect2.top + rect2.height / 2;
    return Math.sqrt((cx1 - cx2) * (cx1 - cx2) + (cy1 - cy2) * (cy1 - cy2));
  };

  /**
   * Clean and format field names for readability.
   */
  FieldNameResolver.prototype._cleanFieldName = function (text) {
    if (!text) return '';
    return text
      .trim()
      .replace(/[*:]/g, '')
      .replace(/\(required\)/gi, '')
      .replace(/\(optional\)/gi, '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')       // camelCase
      .replace(/[_-]/g, ' ')                       // underscores/hyphens
      .replace(/\s+/g, ' ')                        // collapse whitespace
      .split(' ')
      .filter(function (w) { return w.length > 0; })
      .map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); })
      .join(' ')
      .trim();
  };

  return FieldNameResolver;
})();
