
// Mock Selector Dependencies
const SelectorEngine = class {
    isStepDuplicate(newStep, existingSteps, timeWindow = 3000) {
        if (!existingSteps || existingSteps.length === 0) return false;
        const recentSteps = existingSteps.filter(step =>
            newStep.timestamp - step.timestamp < timeWindow
        );
        return recentSteps.some(step =>
            step.action === newStep.action &&
            step.selector?.css === newStep.selector?.css &&
            step.value === newStep.value &&
            step.fieldName === newStep.fieldName
        );
    }
};

async function runTests() {
    console.log('🧪 Testing SelectorEngine...');
    const engine = new SelectorEngine();

    // Test 1: Duplicate Detection
    console.log('Test 1: Duplicate Detection (3000ms window)');
    const now = Date.now();
    const step1 = { action: 'click', selector: { css: '#btn' }, value: null, fieldName: 'Btn', timestamp: now };
    const step2 = { action: 'click', selector: { css: '#btn' }, value: null, fieldName: 'Btn', timestamp: now + 500 }; // 500ms diff
    const step3 = { action: 'click', selector: { css: '#btn' }, value: null, fieldName: 'Btn', timestamp: now + 4000 }; // 4000ms diff

    const isDup1 = engine.isStepDuplicate(step2, [step1], 3000);
    const isDup2 = engine.isStepDuplicate(step3, [step1], 3000);

    if (isDup1 === true && isDup2 === false) {
        console.log('✅ Duplicate detection passed (catch < 3s, ignore > 3s)');
    } else {
        console.error('❌ Duplicate detection failed', { isDup1, isDup2 });
    }
}

runTests();
