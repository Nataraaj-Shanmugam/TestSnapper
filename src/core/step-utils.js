/**
 * Step Utilities - Pure functions for step manipulation.
 * Extracted here so they can be imported and tested independently
 * from the review page (which has Chrome API dependencies).
 */

/**
 * Remove consecutive duplicate steps. If steps 2, 3, 4 are identical
 * (same action + fieldName + selector CSS + url), keep only step 2.
 * Screenshots and navigate actions are never considered duplicates.
 */
export function deduplicateConsecutiveSteps(steps) {
  if (!steps || steps.length <= 1) return steps;

  const result = [steps[0]];

  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1];
    const curr = steps[i];

    // Never deduplicate screenshots or navigation
    if (curr.action === 'screenshot' || curr.action === 'navigate') {
      result.push(curr);
      continue;
    }

    // Compare: same action + fieldName + url + selector CSS
    const isDup =
      prev.action === curr.action &&
      prev.fieldName === curr.fieldName &&
      prev.url === curr.url &&
      (prev.selector?.css || '') === (curr.selector?.css || '') &&
      // For type/select, also check value hasn't changed
      !((curr.action === 'type' || curr.action === 'select') && prev.value !== curr.value);

    if (isDup) {
      continue; // Skip this duplicate
    }

    result.push(curr);
  }

  return result;
}
