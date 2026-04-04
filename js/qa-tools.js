// ═══════════════════════════════════════════════════════
// QA-TOOLS MODULE — PRODUCTION (DISABLED)
// ═══════════════════════════════════════════════════════
// Round 26: QA tools removed from production to prevent client-side exploitation.
// The localStorage admin check was trivially bypassable — any player could
// set ms_is_admin=true and force winning spin outcomes.
// All spin results are now server-authoritative.

        function applyUrlDebugConfig() {
            // No-op in production
        }

        function getDebugState() {
            return { deterministicMode: false, deterministicSeed: null, queuedForcedSpins: [] };
        }

        function initQaTools() {
            // No-op in production
        }

        function toggleQaTools() {
            // No-op in production
        }

        function refreshQaStateDisplay() {
            // No-op in production
        }

        function renderGameToText() {
            return JSON.stringify({ mode: 'production', qaDisabled: true });
        }
