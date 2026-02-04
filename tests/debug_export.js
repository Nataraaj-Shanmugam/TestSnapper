
// Mock Dependencies
const Utils = { generateUUID: () => 'step-uuid-1' };
const exportService = {
    _escapeHtml: (s) => s,
    _resolveAssetUrl: async (asset) => asset.dataUrl, // Simpler mock
    _resizeImageForExport: async (url) => url, // Mock pass-through
    storage: {
        getAllAssets: async () => [
            { stepId: 'step-uuid-1', dataUrl: 'data:image/png;base64,FAKEIMAGE' }
        ]
    }
};

// Paste relevant logic from _exportDOCX to test it
async function testExportLogic() {
    const session = { id: 'sess-1', name: 'Test' };
    const steps = [
        { id: 'step-uuid-1', action: 'screenshot', isManual: true }
    ];

    console.log('Test 1: Map Population');
    const screenshotAssets = await exportService.storage.getAllAssets(session.id);
    const screenshotMap = new Map();

    for (const asset of screenshotAssets) {
        let url = await exportService._resolveAssetUrl(asset);
        if (url) {
            url = await exportService._resizeImageForExport(url);
            screenshotMap.set(asset.stepId, url);
            console.log(`Mapped asset for stepId: ${asset.stepId} -> URL length: ${url.length}`);
        }
    }

    console.log('Test 2: Step Retrieval');
    let html = '';
    const regularSteps = steps.filter(step => step.action === 'screenshot' && step.isManual);

    for (const step of regularSteps) {
        console.log(`Processing step: ${step.id}`);
        const screenshotData = screenshotMap.get(step.id);
        if (screenshotData) {
            console.log('✅ Found screenshot data!');
            html += `<img src="${screenshotData}" />`;
        } else {
            console.error('❌ Failed to find screenshot data for step', step.id);
        }
    }

    if (html.includes('data:image/png;base64,FAKEIMAGE')) {
        console.log('✅ HTML contains correct image data');
    } else {
        console.error('❌ HTML missing image data');
    }
}

testExportLogic();
