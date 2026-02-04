
// Mock Browser Environment
global.window = { location: { href: 'http://localhost' } };
global.document = {
    getElementById: () => null,
    createElement: () => ({ style: {}, classList: { add: () => { }, remove: () => { } }, attachShadow: () => ({ appendChild: () => { }, getElementById: () => ({}) }) }),
    body: { appendChild: () => { } },
    addEventListener: () => { },
    removeEventListener: () => { },
    querySelectorAll: () => []
};
global.chrome = {
    runtime: {
        onMessage: { addListener: () => { } },
        sendMessage: () => { }
    }
};
global.Node = { TEXT_NODE: 3 };

// Mock dependencies
global.SelectorEngine = class { };
global.Redactor = class { };

console.log('🧪 Testing content.js variable definitions...');

try {
    // We can't easily "require" content.js because it's not a module and has top-level execution.
    // Instead, we'll read the file and check for the definitions via regex/ast or just by manual inspection in this script 
    // if we were running in a real browser context. 
    // BUT, since we have the file on disk, let's use a smarter approach:
    // We will read the file content and eval it in a safe context OR just do a static check.

    // Actually, let's just do a static check with fs for the specific definitions we added.
    const fs = require('fs');
    const path = require('path');
    const contentJsPath = path.resolve(__dirname, '../src/content/content.js');
    const content = fs.readFileSync(contentJsPath, 'utf8');

    let errors = [];

    // Check 1: isModalOpen definition
    if (!/let\s+isModalOpen\s+=\s+false/.test(content)) {
        errors.push('❌ isModalOpen is NOT defined');
    } else {
        console.log('✅ isModalOpen is defined');
    }

    // Check 2: modalTimeout definition
    if (!/let\s+modalTimeout\s+=\s+null/.test(content)) {
        errors.push('❌ modalTimeout is NOT defined');
    } else {
        console.log('✅ modalTimeout is defined');
    }

    // Check 3: formatTime definition
    if (!/function\s+formatTime\(totalSeconds\)/.test(content)) {
        errors.push('❌ formatTime is NOT defined');
    } else {
        console.log('✅ formatTime is defined');
    }

    // Check 4: Check if setInterval is structurally correct (basic check)
    if (content.includes('captureNavigation();\n  }\n}, 1000);')) {
        console.log('✅ setInterval logic appears structurally correct');
    }

    if (errors.length > 0) {
        console.error('FAILED:', errors.join('\n'));
        process.exit(1);
    } else {
        console.log('SUCCESS: All missing variables/functions are now present.');
    }

} catch (e) {
    console.error('Test failed:', e);
    process.exit(1);
}
