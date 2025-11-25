/**
 * Enhanced Selector Engine - Multi-Strategy Locator Generation
 * Mimics: SelectorsHub, ChroPath, Truepath, Scraper
 * Generates multiple selector candidates with scoring
 */

class SelectorEngine {
  constructor() {
    this.strategies = [
      'id',
      'data-testid',
      'name',
      'aria-label',
      'placeholder',
      'type-based',
      'class-based',
      'text-based',
      'relative-css',
      'xpath-absolute',
      'xpath-relative',
      'parent-child'
    ];
  }

  /**
   * Generate multiple selector candidates for an element
   * Returns array of {selector, type, score, isUnique}
   */
  generateSelectors(element) {
    if (!element || !element.tagName) return null;

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

    // Return top candidates with metadata
    return {
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
  }

  /**
   * Legacy method for backward compatibility
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

  _addIdSelectors(element, candidates) {
    if (element.id) {
      const selector = `#${CSS.escape(element.id)}`;
      candidates.push({
        selector: selector,
        type: 'css-id',
        strategy: 'ID',
        isUnique: this._isUnique(selector, element),
        length: selector.length
      });

      // XPath version
      candidates.push({
        selector: `//*[@id="${element.id}"]`,
        type: 'xpath-id',
        strategy: 'ID (XPath)',
        isUnique: true,
        length: 8 + element.id.length
      });
    }
  }

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

  _addClassSelectors(element, candidates) {
    if (!element.className || typeof element.className !== 'string') return;

    const classes = element.className.trim().split(/\s+/)
      .filter(c => c && !c.match(/^(ng-|is-|has-|active|selected|focus)/));

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

  _addTextSelectors(element, candidates) {
    const tag = element.tagName.toLowerCase();
    const text = (element.innerText || element.textContent || '').trim();

    if (!text || text.length > 50) return;

    if (['button', 'a', 'span', 'div'].includes(tag)) {
      // CSS with :contains-like approach (not standard, but documented)
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

  _addRelativeCssSelectors(element, candidates) {
    // Find nearest parent with stable ID or class
    let parent = element.parentElement;
    let depth = 0;
    const maxDepth = 3;

    while (parent && depth < maxDepth) {
      if (parent.id) {
        const childSelector = this._getChildPath(parent, element);
        const selector = `#${CSS.escape(parent.id)} ${childSelector}`;
        
        candidates.push({
          selector: selector,
          type: 'css-relative-id',
          strategy: 'parent-id + child',
          isUnique: this._isUnique(selector, element),
          length: selector.length
        });
        break;
      }

      if (parent.className && typeof parent.className === 'string') {
        const classes = parent.className.trim().split(/\s+/)[0];
        if (classes && !classes.match(/^(ng-|is-|has-)/)) {
          const childSelector = this._getChildPath(parent, element);
          const selector = `.${CSS.escape(classes)} ${childSelector}`;
          
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

  _addXPathRelative(element, candidates) {
    // Find nearest stable parent (with id/name/role)
    let parent = element.parentElement;
    let depth = 0;

    while (parent && depth < 5) {
      if (parent.id) {
        const relativePath = this._getRelativeXPath(parent, element);
        const xpath = `//*[@id="${parent.id}"]${relativePath}`;
        
        candidates.push({
          selector: xpath,
          type: 'xpath-relative',
          strategy: 'relative-xpath (id)',
          isUnique: this._isUniqueXPath(xpath, element),
          length: xpath.length
        });
        break;
      }

      if (parent.getAttribute('role')) {
        const role = parent.getAttribute('role');
        const relativePath = this._getRelativeXPath(parent, element);
        const xpath = `//*[@role="${role}"]${relativePath}`;
        
        if (this._isUniqueXPath(xpath, element)) {
          candidates.push({
            selector: xpath,
            type: 'xpath-relative-role',
            strategy: 'relative-xpath (role)',
            isUnique: true,
            length: xpath.length
          });
          break;
        }
      }

      parent = parent.parentElement;
      depth++;
    }
  }

  _addNthSelectors(element, candidates) {
    const tag = element.tagName.toLowerCase();
    const parent = element.parentElement;

    if (!parent) {
      candidates.push({
        selector: tag,
        type: 'css-tag',
        strategy: 'tag-only',
        isUnique: false,
        length: tag.length
      });
      return;
    }

    const siblings = Array.from(parent.children).filter(
      child => child.tagName.toLowerCase() === tag
    );

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

  _getRelativeXPath(parent, target) {
    const path = [];
    let current = target;

    while (current && current !== parent) {
      const tag = current.tagName.toLowerCase();
      const siblings = Array.from((current.parentElement || parent).children)
        .filter(c => c.tagName.toLowerCase() === tag);
      
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        path.unshift(`/${tag}[${index}]`);
      } else {
        path.unshift(`/${tag}`);
      }

      current = current.parentElement;
    }

    return path.join('');
  }

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

  _isUnique(selector, element) {
    try {
      const matches = document.querySelectorAll(selector);
      return matches.length === 1 && matches[0] === element;
    } catch (e) {
      return false;
    }
  }

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

  _scoreSelector(candidate, element) {
    let score = 0;

    // Uniqueness is most important
    if (candidate.isUnique) score += 100;

    // Strategy priority
    const strategyScores = {
      'ID': 95,
      'data-testid': 90,
      'name': 85,
      'aria-label': 80,
      'type+placeholder': 75,
      'placeholder': 70,
      'single-class': 60,
      'parent-id + child': 55,
      'text-exact': 50,
      'relative-xpath (id)': 50,
      'parent-class + child': 45,
      'text-content': 40,
      'multi-class': 35,
      'relative-xpath (role)': 30,
      'nth-of-type': 20,
      'absolute-xpath': 10
    };

    score += strategyScores[candidate.strategy] || 0;

    // Penalize long selectors
    if (candidate.length > 100) score -= 20;
    else if (candidate.length > 50) score -= 10;

    // Prefer CSS over XPath (generally more readable)
    if (candidate.type.startsWith('css')) score += 5;

    return score;
  }

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

  extractFieldName(element) {
    const sources = [
      () => element.getAttribute('aria-label'),
      () => element.getAttribute('aria-labelledby') && this._getTextFromId(element.getAttribute('aria-labelledby')),
      () => element.placeholder,
      () => element.name,
      () => element.id,
      () => this._getLabelText(element),
      () => element.title,
      () => this.getElementText(element),
      () => element.getAttribute('data-testid')
    ];

    for (const source of sources) {
      try {
        const name = source();
        if (name && name.trim()) {
          return name.trim();
        }
      } catch (e) {
        // Continue to next source
      }
    }

    return element.tagName.toLowerCase();
  }

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

  _getTextFromId(id) {
    const element = document.getElementById(id);
    return element ? (element.innerText || element.textContent || '').trim() : null;
  }

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
}

// Make globally available for content script
if (typeof window !== 'undefined') {
  window.SelectorEngine = SelectorEngine;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SelectorEngine };
}