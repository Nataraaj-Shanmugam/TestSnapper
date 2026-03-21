/**
 * Enhanced Selector Engine - Multi-Strategy Locator Generation
 * Mimics: SelectorsHub, ChroPath, Truepath, Scraper
 * Generates multiple selector candidates with scoring
 * UPDATED: Added deduplication check method
 */

class SelectorEngine {
  /**
   * Initialize the selector engine
   */
  constructor() {
    this.strategies = [
      'id', 'data-testid', 'name', 'aria-label', 'placeholder',
      'framework-attrs', 'type-based', 'class-based', 'text-based',
      'relative-css', 'xpath-absolute', 'xpath-relative', 'parent-child'
    ];

    this.selectorCache = new WeakMap();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Check if this step is a duplicate of recent steps
   * Helps prevent duplicate entries from rapid interactions
   * @param {Object} newStep - New step to check
   * @param {Array} existingSteps - Existing steps array
   * @param {number} [timeWindow=3000] - Time window in milliseconds
   * @returns {boolean} true if step is a duplicate
   */
  isStepDuplicate(newStep, existingSteps, timeWindow = 3000) {
    if (!existingSteps || existingSteps.length === 0) return false;

    // Get recent steps within time window
    const recentSteps = existingSteps.filter(step =>
      newStep.timestamp - step.timestamp < timeWindow
    );

    // Check for exact duplicate
    return recentSteps.some(step =>
      step.action === newStep.action &&
      step.selector?.css === newStep.selector?.css &&
      step.value === newStep.value &&
      step.fieldName === newStep.fieldName
    );
  }

  /**
   * Generate multiple selector candidates for an element
   * Returns array of {selector, type, score, isUnique}
   * @param {Element} element - DOM element to generate selectors for
   * @returns {Object|null} Selectors object with primary, alternatives, all, element metadata
   * @example
   * const result = selectorEngine.generateSelectors(element);
   * console.log(result.primary); // Best selector
   * console.log(result.alternatives); // Top 5 alternatives
   */
  generateSelectors(element) {
    if (!element || !element.tagName) return null;

    if (this.selectorCache.has(element)) {
      this.cacheHits++;
      return this.selectorCache.get(element);
    }

    this.cacheMisses++;

    const candidates = [];

    // Strategy 1: ID-based (highest priority)
    this._addIdSelectors(element, candidates);

    // Strategy 2: data-testid
    this._addTestIdSelectors(element, candidates);

    // Strategy 3: name attribute
    this._addNameSelectors(element, candidates);

    // Strategy 4: aria-label
    this._addAriaSelectors(element, candidates);

    // Strategy 5: placeholder + type
    this._addPlaceholderSelectors(element, candidates);

    // Strategy 5.5: Framework attributes (React/Vue/Angular)
    this._addFrameworkSelectors(element, candidates);

    // Strategy 6: class-based
    this._addClassSelectors(element, candidates);

    // Strategy 7: text-based (for buttons, links)
    this._addTextSelectors(element, candidates);

    // Strategy 8: relative CSS (parent context)
    this._addRelativeCssSelectors(element, candidates);

    // Strategy 9: XPath absolute
    this._addXPathAbsolute(element, candidates);

    // Strategy 10: XPath relative (smart parent)
    this._addXPathRelative(element, candidates);

    // Strategy 11: nth-of-type fallback
    this._addNthSelectors(element, candidates);

    // Score and sort candidates
    candidates.forEach(c => {
      c.score = this._scoreSelector(c, element);
    });

    candidates.sort((a, b) => b.score - a.score);

    // Cache result
    const result = {
      primary: candidates[0] || this._getFallbackSelector(element),
      alternatives: candidates.slice(0, 5),
      all: candidates,
      element: {
        tag: element.tagName.toLowerCase(),
        text: this.getElementText(element),
        role: element.getAttribute('role') || element.tagName.toLowerCase(),
        path: this._getElementPath(element)
      }
    };

    this.selectorCache.set(element, result);
    return result;
  }

  /**
   * Legacy method for backward compatibility
   * @param {Element} element - DOM element
   * @returns {Object|null} Simple selector object with css, xpath, text, role
   */
  generateSelector(element) {
    const result = this.generateSelectors(element);
    return result ? {
      css: result.primary.selector,
      xpath: result.alternatives.find(a => a.type.includes('xpath'))?.selector,
      text: result.element.text,
      role: result.element.role
    } : null;
  }

  // ==================== Strategy Implementations ====================

  /**
   * Add ID-based selectors
   * Checks if ID looks auto-generated and adjusts score accordingly
   * @private
   * @param {Element} element - DOM element
   * @param {Array} candidates - Candidates array to populate
   */
  _addIdSelectors(element, candidates) {
    if (element.id) {
      // Check if ID looks auto-generated
      if (this._isGeneratedId(element.id)) {
        // Still add but with lower score
        const selector = `#${CSS.escape(element.id)}`;
        candidates.push({
          selector: selector,
          type: 'css-id',
          strategy: 'ID (auto-generated)',
          isUnique: this._isUnique(selector, element),
          length: selector.length,
          penalty: 30 // Score penalty for generated IDs
        });
      } else {
        const selector = `#${CSS.escape(element.id)}`;
        candidates.push({
          selector: selector,
          type: 'css-id',
          strategy: 'ID',
          isUnique: this._isUnique(selector, element),
          length: selector.length
        });
      }

      // XPath version
      candidates.push({
        selector: `//*[@id="${element.id}"]`,
        type: 'xpath-id',
        strategy: 'ID (XPath)',
        isUnique: true,
        length: 8 + element.id.length,
        penalty: this._isGeneratedId(element.id) ? 30 : 0
      });
    }
  }

  /**
   * Detect if ID looks auto-generated
   * Less aggressive - only matches clearly generated patterns
   * Short IDs (< 4 chars) are never considered generated
   * Human-readable IDs with hyphens/underscores are allowed
   * @private
   * @param {string} id - ID attribute value
   * @returns {boolean} true if ID appears auto-generated
   */
  _isGeneratedId(id) {
    // Short IDs are almost always human-authored
    if (id.length < 4) return false;

    // IDs with meaningful words are likely human-authored
    if (/^(header|footer|nav|main|sidebar|content|menu|form|login|search|modal|dialog|btn|button|input|container|wrapper)[-_]/i.test(id)) {
      return false;
    }

    const patterns = [
      /^[a-f0-9]{12,}$/i,          // Long hex strings (12+ chars)
      /^ember\d+$/,                 // Ember.js (exact match)
      /^react-[a-z0-9]{6,}$/,      // React (6+ random chars after prefix)
      /^__next[-_]/,                // Next.js internal
      /^\d{4,}$/,                   // 4+ digit numbers only
      /^[a-z]{1,2}-\d+-\d+$/,      // Short prefix + two number groups
      /^:r[a-z0-9]+:$/,            // React 18+ useId
      /^mui-\d+$/,                  // Material-UI
      /^[a-z]{1,3}\d{6,}$/i,       // 1-3 letter prefix + 6+ digits
      /^_[a-f0-9]{8,}$/i,          // Underscore + hex (CSS modules)
      /^css-[a-z0-9]{6,}$/         // Emotion/styled-components
    ];
    return patterns.some(pattern => pattern.test(id));
  }

  /**
   * Add test ID selectors (data-testid, data-test-id, data-cy)
   * @private
   * @param {Element} element - DOM element
   * @param {Array} candidates - Candidates array to populate
   */
  _addTestIdSelectors(element, candidates) {
    const testId = element.dataset.testid || element.getAttribute('data-test-id') ||
      element.getAttribute('data-cy') || element.getAttribute('data-testid');

    if (testId) {
      candidates.push({
        selector: `[data-testid="${testId}"]`,
        type: 'css-testid',
        strategy: 'data-testid',
        isUnique: this._isUnique(`[data-testid="${testId}"]`, element),
        length: 17 + testId.length
      });

      candidates.push({
        selector: `//*[@data-testid="${testId}"]`,
        type: 'xpath-testid',
        strategy: 'data-testid (XPath)',
        isUnique: true,
        length: 20 + testId.length
      });
    }
  }

  /**
   * Add name attribute selectors
   * @private
   * @param {Element} element - DOM element
   * @param {Array} candidates - Candidates array to populate
   */
  _addNameSelectors(element, candidates) {
    if (element.name) {
      const tag = element.tagName.toLowerCase();
      const selector = `${tag}[name="${element.name}"]`;
      candidates.push({
        selector: selector,
        type: 'css-name',
        strategy: 'name',
        isUnique: this._isUnique(selector, element),
        length: selector.length
      });

      candidates.push({
        selector: `//${tag}[@name="${element.name}"]`,
        type: 'xpath-name',
        strategy: 'name (XPath)',
        isUnique: this._isUnique(selector, element),
        length: selector.length + 2
      });
    }
  }

  /**
   * Add ARIA attribute selectors
   * @private
   * @param {Element} element - DOM element
   * @param {Array} candidates - Candidates array to populate
   */
  _addAriaSelectors(element, candidates) {
    const ariaLabel = element.getAttribute('aria-label');
    const ariaLabelledBy = element.getAttribute('aria-labelledby');
    const tag = element.tagName.toLowerCase();

    if (ariaLabel) {
      candidates.push({
        selector: `${tag}[aria-label="${ariaLabel}"]`,
        type: 'css-aria',
        strategy: 'aria-label',
        isUnique: this._isUnique(`[aria-label="${ariaLabel}"]`, element),
        length: 16 + ariaLabel.length
      });
    }

    if (ariaLabelledBy) {
      candidates.push({
        selector: `${tag}[aria-labelledby="${ariaLabelledBy}"]`,
        type: 'css-aria-ref',
        strategy: 'aria-labelledby',
        isUnique: this._isUnique(`[aria-labelledby="${ariaLabelledBy}"]`, element),
        length: 22 + ariaLabelledBy.length
      });
    }
  }

  /**
   * Add placeholder and type selectors
   * @private
   * @param {Element} element - DOM element
   * @param {Array} candidates - Candidates array to populate
   */
  _addPlaceholderSelectors(element, candidates) {
    const tag = element.tagName.toLowerCase();
    if (tag === 'input' && element.placeholder) {
      const selector = `input[placeholder="${element.placeholder}"]`;
      candidates.push({
        selector: selector,
        type: 'css-placeholder',
        strategy: 'placeholder',
        isUnique: this._isUnique(selector, element),
        length: selector.length
      });

      if (element.type) {
        const typeSelector = `input[type="${element.type}"][placeholder="${element.placeholder}"]`;
        candidates.push({
          selector: typeSelector,
          type: 'css-type-placeholder',
          strategy: 'type+placeholder',
          isUnique: this._isUnique(typeSelector, element),
          length: typeSelector.length
        });
      }
    }
  }

  /**
   * Add framework-specific selectors (React, Vue, Angular, Svelte, Solid)
   * @private
   * @param {Element} element - DOM element
   * @param {Array} candidates - Candidates array to populate
   */
  _addFrameworkSelectors(element, candidates) {
    // React detection
    const hasReactProps = Object.keys(element).some(k => k.startsWith('__react'));
    if (hasReactProps) {
      ['data-reactid', 'data-react-checksum', 'data-reactroot'].forEach(attr => {
        if (element.hasAttribute(attr)) {
          candidates.push({
            selector: `[${attr}="${element.getAttribute(attr)}"]`,
            type: 'react-attr',
            strategy: 'React',
            isUnique: this._isUnique(`[${attr}="${element.getAttribute(attr)}"]`, element),
            length: attr.length + element.getAttribute(attr).length + 4
          });
        }
      });
    }

    // Vue detection
    const hasVue = element.__vue__ || element.hasAttribute('v-bind') ||
      element.hasAttribute('v-model') || element.hasAttribute('v-for');
    if (hasVue && element.hasAttribute('v-model')) {
      const vModel = element.getAttribute('v-model');
      candidates.push({
        selector: `[v-model="${vModel}"]`,
        type: 'vue-model',
        strategy: 'Vue',
        isUnique: this._isUnique(`[v-model="${vModel}"]`, element),
        length: vModel.length + 12
      });
    }

    // Angular detection
    const hasAngular = element.hasAttribute('ng-model') ||
      element.hasAttribute('[ngModel]') ||
      element.hasAttribute('ng-click') ||
      element.hasAttribute('(click)');
    if (hasAngular) {
      const ngModel = element.getAttribute('ng-model') || element.getAttribute('[ngModel]');
      if (ngModel) {
        candidates.push({
          selector: `[ng-model="${ngModel}"], [[ngModel]="${ngModel}"]`,
          type: 'angular-model',
          strategy: 'Angular',
          isUnique: true,
          length: ngModel.length + 14
        });
      }
    }
  }

  /**
   * Add class-based selectors, handling both regular and SVG elements
   * @private
   * @param {Element} element - DOM element
   * @param {Array} candidates - Candidates array to populate
   */
  _addClassSelectors(element, candidates) {
    // Handle both regular elements and SVG elements
    let className = '';
    if (typeof element.className === 'string') {
      className = element.className;
    } else if (element.className && typeof element.className.baseVal === 'string') {
      // SVG elements use SVGAnimatedString for className
      className = element.className.baseVal;
    }

    if (!className) return;

    const classes = className.trim().split(/\s+/)
      .filter(c => c && !c.match(/^(ng-|is-|has-|active|selected|focus|hover|disabled)/));

    if (classes.length === 0) return;

    const tag = element.tagName.toLowerCase();

    // Single most unique class
    for (const cls of classes) {
      const selector = `${tag}.${CSS.escape(cls)}`;
      if (this._isUnique(selector, element)) {
        candidates.push({
          selector: selector,
          type: 'css-class-single',
          strategy: 'single-class',
          isUnique: true,
          length: selector.length
        });
        break;
      }
    }

    // All classes combined
    const allClassSelector = `${tag}.${classes.map(c => CSS.escape(c)).join('.')}`;
    candidates.push({
      selector: allClassSelector,
      type: 'css-class-full',
      strategy: 'multi-class',
      isUnique: this._isUnique(allClassSelector, element),
      length: allClassSelector.length
    });
  }

  /**
   * Add text-based selectors for buttons, links, spans
   * @private
   * @param {Element} element - DOM element
   * @param {Array} candidates - Candidates array to populate
   */
  _addTextSelectors(element, candidates) {
    const tag = element.tagName.toLowerCase();
    const text = (element.innerText || element.textContent || '').trim();

    if (!text || text.length > 50) return;

    if (['button', 'a', 'span', 'div'].includes(tag)) {
      // XPath with text substring
      const xpathText = `//${tag}[contains(text(), "${text.substring(0, 30)}")]`;
      candidates.push({
        selector: xpathText,
        type: 'xpath-text',
        strategy: 'text-content',
        isUnique: this._isUniqueXPath(xpathText, element),
        length: xpathText.length
      });

      // Exact text match
      const xpathExact = `//${tag}[text()="${text}"]`;
      candidates.push({
        selector: xpathExact,
        type: 'xpath-text-exact',
        strategy: 'text-exact',
        isUnique: this._isUniqueXPath(xpathExact, element),
        length: xpathExact.length
      });
    }
  }

  /**
   * Add relative CSS selectors using parent context
   * @private
   * @param {Element} element - DOM element
   * @param {Array} candidates - Candidates array to populate
   */
  _addRelativeCssSelectors(element, candidates) {
    // Find nearest parent with stable ID or class
    let parent = element.parentElement;
    let depth = 0;
    const maxDepth = 3;

    while (parent && depth < maxDepth) {
      if (parent.id && !this._isGeneratedId(parent.id)) {
        const childPath = this._getChildPath(parent, element);
        const selector = `#${CSS.escape(parent.id)} ${childPath}`;

        candidates.push({
          selector: selector,
          type: 'css-relative-id',
          strategy: 'parent-id + child',
          isUnique: this._isUnique(selector, element),
          length: selector.length
        });
        break;
      }

      let className = '';
      if (typeof parent.className === 'string') {
        className = parent.className;
      } else if (parent.className && typeof parent.className.baseVal === 'string') {
        className = parent.className.baseVal;
      }

      if (className) {
        const firstClass = className.trim().split(/\s+/)[0];
        if (firstClass && !firstClass.match(/^(ng-|is-|has-)/)) {
          const childPath = this._getChildPath(parent, element);
          const selector = `.${CSS.escape(firstClass)} ${childPath}`;

          if (this._isUnique(selector, element)) {
            candidates.push({
              selector: selector,
              type: 'css-relative-class',
              strategy: 'parent-class + child',
              isUnique: true,
              length: selector.length
            });
            break;
          }
        }
      }

      parent = parent.parentElement;
      depth++;
    }
  }

  /**
   * Add absolute XPath selector
   * @private
   * @param {Element} element - DOM element
   * @param {Array} candidates - Candidates array to populate
   */
  _addXPathAbsolute(element, candidates) {
    const xpath = this._generateAbsoluteXPath(element);
    candidates.push({
      selector: xpath,
      type: 'xpath-absolute',
      strategy: 'absolute-xpath',
      isUnique: true,
      length: xpath.length
    });
  }

  /**
   * Add semantic XPath with attributes over positions
   * @private
   * @param {Element} element - DOM element
   * @param {Array} candidates - Candidates array to populate
   */
  _addXPathRelative(element, candidates) {
    const parts = [];
    let current = element;
    let depth = 0;
    const maxDepth = 5;

    while (current && current !== document.body && depth < maxDepth) {
      const tag = current.tagName.toLowerCase();
      let part = tag;

      // Prefer stable attributes over positional indexes
      if (current.id && !this._isGeneratedId(current.id)) {
        // Found ID - use as anchor point
        part = `${tag}[@id='${current.id}']`;
        parts.unshift('//' + part);
        break; // Stop here, ID is stable anchor
      } else if (current.name && current.tagName.toLowerCase() === 'input') {
        part = `${tag}[@name='${current.name}']`;
      } else if (current.getAttribute('data-testid')) {
        part = `${tag}[@data-testid='${current.getAttribute('data-testid')}']`;
      } else if (current.className && !this._isGeneratedClass(current.className)) {
        const firstClass = current.className.trim().split(' ')[0];
        part = `${tag}[contains(@class, '${firstClass}')]`;
      } else if (current.getAttribute('type')) {
        part = `${tag}[@type='${current.getAttribute('type')}']`;
      } else if (current.getAttribute('role')) {
        part = `${tag}[@role='${current.getAttribute('role')}']`;
      } else {
        // Fallback to position, but make it more resilient
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children)
            .filter(el => el.tagName === current.tagName);
          if (siblings.length === 1) {
            // Only child of this type - no index needed
            part = tag;
          } else {
            const index = siblings.indexOf(current) + 1;
            part = `${tag}[${index}]`;
          }
        }
      }

      parts.unshift(part);
      current = current.parentElement;
      depth++;
    }

    const xpath = parts.length > 0 ? '/' + parts.join('/') : null;
    if (xpath) {
      candidates.push({
        selector: xpath,
        type: 'xpath-relative',
        strategy: 'XPath (Semantic)',
        isUnique: this._testXPath(xpath, element),
        length: xpath.length
      });
    }
  }

  /**
   * Test if XPath is unique and finds the element
   * @private
   * @param {string} xpath - XPath expression
   * @param {Element} element - Element to test against
   * @returns {boolean} true if XPath uniquely identifies the element
   */
  _testXPath(xpath, element) {
    try {
      const result = document.evaluate(
        xpath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      return result.singleNodeValue === element;
    } catch {
      return false;
    }
  }

  /**
   * Check if class looks generated/dynamic
   * @private
   * @param {string} className - Class name or names
   * @returns {boolean} true if class appears auto-generated
   */
  _isGeneratedClass(className) {
    // Check for CSS modules, emotion, styled-components patterns
    return /^(_|css-|sc-|makeStyles|jss\d)/.test(className);
  }

  /**
   * Add nth-of-type selectors for fallback
   * @private
   * @param {Element} element - DOM element
   * @param {Array} candidates - Candidates array to populate
   */
  _addNthSelectors(element, candidates) {
    const tag = element.tagName.toLowerCase();
    const parent = element.parentElement;
    if (!parent) return;

    const siblings = Array.from(parent.children).filter(c => c.tagName.toLowerCase() === tag);
    const index = siblings.indexOf(element) + 1;

    if (siblings.length === 1) {
      candidates.push({
        selector: tag,
        type: 'css-tag',
        strategy: 'tag-only',
        isUnique: this._isUnique(tag, element),
        length: tag.length
      });
    } else {
      candidates.push({
        selector: `${tag}:nth-of-type(${index})`,
        type: 'css-nth',
        strategy: 'nth-of-type',
        isUnique: false,
        length: tag.length + 15
      });
    }
  }

  // ==================== Helper Methods ====================

  /**
   * Get the path from parent to target element
   * @private
   * @param {Element} parent - Parent element
   * @param {Element} target - Target element
   * @returns {string} CSS path (e.g., "div > input:nth-of-type(1)")
   */
  _getChildPath(parent, target) {
    const path = [];
    let current = target;

    while (current && current !== parent) {
      const tag = current.tagName.toLowerCase();
      const siblings = Array.from((current.parentElement || parent).children)
        .filter(c => c.tagName.toLowerCase() === tag);

      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        path.unshift(`${tag}:nth-of-type(${index})`);
      } else {
        path.unshift(tag);
      }

      current = current.parentElement;
    }

    return path.join(' > ');
  }

  /**
   * Generate absolute XPath from element to document root
   * @private
   * @param {Element} element - DOM element
   * @returns {string} Absolute XPath expression
   */
  _generateAbsoluteXPath(element) {
    const paths = [];
    let current = element;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let index = 0;
      let sibling = current.previousSibling;

      while (sibling) {
        if (sibling.nodeType === Node.ELEMENT_NODE && sibling.nodeName === current.nodeName) {
          index++;
        }
        sibling = sibling.previousSibling;
      }

      const tagName = current.nodeName.toLowerCase();
      const pathIndex = index > 0 ? `[${index + 1}]` : '';
      paths.unshift(`${tagName}${pathIndex}`);

      current = current.parentNode;
    }

    return '/' + paths.join('/');
  }

  /**
   * Get element path for display (e.g., "body > div#main > input.email")
   * @private
   * @param {Element} element - DOM element
   * @returns {string} Element path string
   */
  _getElementPath(element) {
    const path = [];
    let current = element;
    let depth = 0;

    while (current && current.tagName && depth < 5) {
      const tag = current.tagName.toLowerCase();
      const id = current.id ? `#${current.id}` : '';
      const classes = current.className && typeof current.className === 'string'
        ? `.${current.className.trim().split(/\s+/)[0]}`
        : '';

      path.unshift(`${tag}${id}${classes}`);
      current = current.parentElement;
      depth++;
    }

    return path.join(' > ');
  }

  /**
   * Check if CSS selector is unique in the document
   * @private
   * @param {string} selector - CSS selector
   * @param {Element} element - Element to verify
   * @returns {boolean} true if selector matches only this element
   */
  _isUnique(selector, element) {
    try {
      const matches = document.querySelectorAll(selector);
      return matches.length === 1 && matches[0] === element;
    } catch (e) {
      return false;
    }
  }

  /**
   * Check if XPath is unique in the document
   * @private
   * @param {string} xpath - XPath expression
   * @param {Element} element - Element to verify
   * @returns {boolean} true if XPath matches only this element
   */
  _isUniqueXPath(xpath, element) {
    try {
      const result = document.evaluate(
        xpath,
        document,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null
      );
      return result.snapshotLength === 1 && result.snapshotItem(0) === element;
    } catch (e) {
      return false;
    }
  }

  /**
   * Score a selector candidate based on strategy, uniqueness, and length
   * @private
   * @param {Object} candidate - Candidate object
   * @param {Element} element - DOM element
   * @returns {number} Score (higher is better)
   */
  _scoreSelector(candidate, element) {
    let score = 0;

    // Uniqueness is most important
    if (candidate.isUnique) score += 100;

    const strategyScores = {
      'ID': 95, 'data-testid': 90, 'name': 85,
      'aria-label': 80, 'aria-labelledby': 78,
      'type+placeholder': 75, 'placeholder': 70,
      'Vue': 68, 'Angular': 67, 'React': 66, 'Svelte': 65, 'Solid': 64,
      'single-class': 60, 'parent-id + child': 55,
      'text-exact': 50, 'XPath (Semantic)': 48,
      'parent-class + child': 45, 'text-content': 40,
      'ID (auto-generated)': 40, 'ID (XPath)': 38,
      'multi-class': 35, 'tag-only': 25, 'nth-of-type': 20,
      'absolute-xpath': 10, 'fallback': 1
    };

    score += strategyScores[candidate.strategy] || 0;

    // Apply penalty if exists
    if (candidate.penalty) score -= candidate.penalty;

    // Penalize long selectors
    if (candidate.length > 100) score -= 20;
    else if (candidate.length > 50) score -= 10;

    // Prefer CSS over XPath
    if (candidate.type.startsWith('css')) score += 5;

    return score;
  }

  /**
   * Get fallback selector (absolute XPath)
   * @private
   * @param {Element} element - DOM element
   * @returns {Object} Fallback selector object
   */
  _getFallbackSelector(element) {
    const xpath = this._generateAbsoluteXPath(element);
    return {
      selector: xpath,
      type: 'xpath-absolute',
      strategy: 'fallback',
      isUnique: true,
      length: xpath.length,
      score: 1
    };
  }

  // ==================== Field Name Extraction ====================

  /**
   * Extract a meaningful field name from element
   * Delegates to FieldNameResolver if available, otherwise uses legacy sources
   * @param {Element} element - DOM element
   * @returns {string|null} Field name or null
   */
  extractFieldName(element) {
    // Delegate to the advanced FieldNameResolver if available
    if (typeof FieldNameResolver !== 'undefined' && window.fieldNameResolver) {
      const resolved = window.fieldNameResolver.resolve(element);
      if (resolved) return resolved;
    }

    // Fallback to legacy sources
    const sources = [
      () => element.getAttribute('aria-label'),
      () => element.getAttribute('aria-labelledby') && this._getTextFromId(element.getAttribute('aria-labelledby')),
      () => element.placeholder,
      () => element.name && !this._isGeneratedId(element.name) ? element.name : null,
      () => element.id && !this._isGeneratedId(element.id) ? element.id : null,
      () => this._getLabelText(element),
      () => element.title,
      () => this.getElementText(element),
      () => element.getAttribute('data-testid')
    ];

    for (const source of sources) {
      try {
        const name = source();
        if (name && name.trim()) {
          return this._cleanFieldName(name.trim());
        }
      } catch (e) {
        // Continue to next source
      }
    }

    return element.tagName.toLowerCase();
  }

  /**
   * Clean and format field names for better readability
   * @private
   * @param {string} text - Raw field name
   * @returns {string} Cleaned field name in Title Case
   */
  _cleanFieldName(text) {
    return text
      .replace(/[*:]/g, '')                          // Remove asterisks and colons
      .replace(/([a-z])([A-Z])/g, '$1 $2')          // camelCase to spaces
      .replace(/[_-]/g, ' ')                         // Underscores and hyphens to spaces
      .replace(/\s+/g, ' ')                          // Multiple spaces to single
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())  // Title Case
      .join(' ')
      .trim();
  }

  /**
   * Get text content from an element
   * @param {Element} element - DOM element
   * @returns {string} Text content (limited to 50 chars for display)
   */
  getElementText(element) {
    if (!element) return '';

    if (element.tagName.toLowerCase() === 'input') {
      return element.value || element.placeholder || '';
    }

    if (element.tagName.toLowerCase() === 'button') {
      return (element.innerText || element.textContent || '').trim();
    }

    const text = (element.innerText || element.textContent || '').trim();
    return text.length > 50 ? text.substring(0, 50) + '...' : text;
  }

  /**
   * Get associated label text for an element
   * @private
   * @param {Element} element - DOM element
   * @returns {string|null} Label text or null
   */
  _getLabelText(element) {
    if (element.id) {
      const label = document.querySelector(`label[for="${element.id}"]`);
      if (label) {
        return label.innerText || label.textContent;
      }
    }

    const parentLabel = element.closest('label');
    if (parentLabel) {
      return parentLabel.innerText || parentLabel.textContent;
    }

    let prev = element.previousElementSibling;
    while (prev) {
      if (prev.tagName.toLowerCase() === 'label') {
        return prev.innerText || prev.textContent;
      }
      prev = prev.previousElementSibling;
    }

    return null;
  }

  /**
   * Get text content from element ID reference
   * @private
   * @param {string} id - Element ID
   * @returns {string|null} Text content or null
   */
  _getTextFromId(id) {
    const element = document.getElementById(id);
    return element ? (element.innerText || element.textContent || '').trim() : null;
  }

  /**
   * Check if an element is interactable (clickable, fillable)
   * @param {Element} element - DOM element
   * @returns {boolean} true if element is interactable
   */
  isInteractable(element) {
    if (!element) return false;

    const tag = element.tagName.toLowerCase();
    const interactableTags = ['input', 'button', 'select', 'textarea', 'a'];

    if (interactableTags.includes(tag)) {
      return true;
    }

    if (element.onclick || element.getAttribute('onclick')) {
      return true;
    }

    const role = element.getAttribute('role');
    if (role && ['button', 'link', 'checkbox', 'radio', 'tab'].includes(role)) {
      return true;
    }

    return false;
  }

  /**
   * Clear the selector cache and get statistics
   * @returns {Object} Cache statistics { hits, misses, total, hitRate }
   */
  clearCache() {
    const stats = this.getCacheStats();
    this.selectorCache = new WeakMap();
    this.cacheHits = 0;
    this.cacheMisses = 0;
    console.log('Selector cache cleared:', stats);
    return stats;
  }

  /**
   * Get cache statistics
   * @returns {Object} { hits, misses, total, hitRate }
   */
  getCacheStats() {
    const total = this.cacheHits + this.cacheMisses;
    const hitRate = total > 0 ? ((this.cacheHits / total) * 100).toFixed(1) : 0;
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      total: total,
      hitRate: hitRate + '%'
    };
  }
}

// Make globally available for content script
if (typeof window !== 'undefined') {
  if (!window.SelectorEngine) {
    window.SelectorEngine = SelectorEngine;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SelectorEngine };
}
