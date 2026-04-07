// QA-TOOLS MODULE PRODUCTION (DISABLED)
// Round 26: QA tools removed from production to prevent client-side exploitation.
// All spin results are now server-authoritative.

function applyUrlDebugConfig() {}
function getDebugState() {
    return { deterministicMode: false, deterministicSeed: null, queuedForcedSpins: [] };
}
function initQaTools() {}
function toggleQaTools() {}
function refreshQaStateDisplay() {}
function renderGameToText() {
    return JSON.stringify({ mode: 'production', qaDisabled: true });
}

// Expose globally so bundled modules can find these
if (typeof window !== 'undefined') {
    window.applyUrlDebugConfig = applyUrlDebugConfig;
    window.getDebugState = getDebugState;
    window.initQaTools = initQaTools;
    window.toggleQaTools = toggleQaTools;
    window.refreshQaStateDisplay = refreshQaStateDisplay;
    window.renderGameToText = renderGameToText;
}