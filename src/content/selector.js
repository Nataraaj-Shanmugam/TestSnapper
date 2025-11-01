/**
 * Selector Engine - Generates robust CSS selectors and extracts field names
 * Priority: id > data-testid > name > aria-label > class > text content
 */

class SelectorEngine {
  constructor() {
    this.selectorPriority = [
      'id',
      'data-testid',
      'name',
      'aria-label',
      'type',
      'class',
      'tag'
    ];
  }

  /**
   * Generate a robust CSS selector for an element
   */
  generateSelector(element) {
    if (!element || !element.tagName) {
      return null;
    }

    const selectors = [];

    // Try ID first (most specific)
    if (element.id) {
      const idSelector = `#${CSS.escape(element.id)}`;
      if (this.isUniqueSelector(idSelector, element)) {
        selectors.push({ selector: idSelector, score: 100 });
      }
    }

    // Try data-testid
    if (element.dataset.testid) {
      const testIdSelector = `[data-testid="${element.dataset.testid}"]`;
      if (this.isUniqueSelector(testIdSelector, element)) {
        selectors.push({ selector: testIdSelector, score: 95 });
      }
    }

    // Try name attribute
    if (element.name) {
      const nameSelector = `${element.tagName.toLowerCase()}[name="${element.name}"]`;
      if (this.isUniqueSelector(nameSelector, element)) {
        selectors.push({ selector: nameSelector, score: 90 });
      }
    }

    // Try aria-label
    if (element.getAttribute('aria-label')) {
      const ariaSelector = `${element.tagName.toLowerCase()}[aria-label="${element.getAttribute('aria-label')}"]`;
      if (this.isUniqueSelector(ariaSelector, element)) {
        selectors.push({ selector: ariaSelector, score: 85 });
      }
    }

    // Try type + placeholder for inputs
    if (element.tagName.toLowerCase() === 'input' && element.type) {
      const placeholder = element.placeholder;
      if (placeholder) {
        const typeSelector = `input[type="${element.type}"][placeholder="${placeholder}"]`;
        if (this.isUniqueSelector(typeSelector, element)) {
          selectors.push({ selector: typeSelector, score: 80 });
        }
      }
    }

    // Try class-based selector
    if (element.className && typeof element.className === 'string') {
      const classes = element.className.trim().split(/\s+/).filter(c => c && !c.match(/^(ng-|is-|has-)/));
      if (classes.length > 0) {
        const classSelector = `${element.tagName.toLowerCase()}.${classes.map(c => CSS.escape(c)).join('.')}`;
        if (this.isUniqueSelector(classSelector, element)) {
          selectors.push({ selector: classSelector, score: 70 });
        }
      }
    }

    // Try nth-of-type as fallback
    const nthSelector = this.getNthSelector(element);
    if (nthSelector) {
      selectors.push({ selector: nthSelector, score: 50 });
    }

    // Sort by score and return the best one
    if (selectors.length > 0) {
      selectors.sort((a, b) => b.score - a.score);
      return {
        css: selectors[0].selector,
        text: this.getElementText(element),
        role: element.getAttribute('role') || element.tagName.toLowerCase()
      };
    }

    // Last resort: generate XPath
    return {
      css: this.getNthSelector(element),
      xpath: this.generateXPath(element),
      text: this.getElementText(element),
      role: element.getAttribute('role') || element.tagName.toLowerCase()
    };
  }

  /**
   * Extract the field name from various sources
   */
  extractFieldName(element) {
    // Priority order for field name extraction
    const sources = [
      () => element.getAttribute('aria-label'),
      () => element.getAttribute('aria-labelledby') && this.getTextFromId(element.getAttribute('aria-labelledby')),
      () => element.placeholder,
      () => element.name,
      () => element.id,
      () => this.getLabelText(element),
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

  /**
   * Get text content from an element
   */
  getElementText(element) {
    if (!element) return '';

    // For input elements, try value or placeholder
    if (element.tagName.toLowerCase() === 'input') {
      return element.value || element.placeholder || '';
    }

    // For buttons, get innerText
    if (element.tagName.toLowerCase() === 'button') {
      return (element.innerText || element.textContent || '').trim();
    }

    // For other elements, get text content (first 50 chars)
    const text = (element.innerText || element.textContent || '').trim();
    return text.length > 50 ? text.substring(0, 50) + '...' : text;
  }

  /**
   * Find associated label text
   */
  getLabelText(element) {
    // Try to find label by 'for' attribute
    if (element.id) {
      const label = document.querySelector(`label[for="${element.id}"]`);
      if (label) {
        return label.innerText || label.textContent;
      }
    }

    // Try to find parent label
    const parentLabel = element.closest('label');
    if (parentLabel) {
      return parentLabel.innerText || parentLabel.textContent;
    }

    // Try to find preceding label sibling
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
   * Get text from element by ID
   */
  getTextFromId(id) {
    const element = document.getElementById(id);
    return element ? (element.innerText || element.textContent || '').trim() : null;
  }

  /**
   * Check if selector is unique
   */
  isUniqueSelector(selector, element) {
    try {
      const matches = document.querySelectorAll(selector);
      return matches.length === 1 && matches[0] === element;
    } catch (e) {
      return false;
    }
  }

  /**
   * Generate nth-of-type selector
   */
  getNthSelector(element) {
    const tag = element.tagName.toLowerCase();
    const parent = element.parentElement;

    if (!parent) {
      return tag;
    }

    const siblings = Array.from(parent.children).filter(
      child => child.tagName.toLowerCase() === tag
    );

    const index = siblings.indexOf(element) + 1;

    if (siblings.length === 1) {
      return `${tag}`;
    }

    return `${tag}:nth-of-type(${index})`;
  }

  /**
   * Generate XPath for element (fallback)
   */
  generateXPath(element) {
    if (element.id) {
      return `//*[@id="${element.id}"]`;
    }

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

    return paths.length ? `/${paths.join('/')}` : null;
  }

  /**
   * Validate if element is interactable
   */
  isInteractable(element) {
    if (!element) return false;

    const tag = element.tagName.toLowerCase();
    const interactableTags = ['input', 'button', 'select', 'textarea', 'a'];

    if (interactableTags.includes(tag)) {
      return true;
    }

    // Check for click handlers
    if (element.onclick || element.getAttribute('onclick')) {
      return true;
    }

    // Check for role
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
