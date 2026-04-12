#!/usr/bin/env node
/**
 * remove-demo-spin.js
 *
 * Removes the dangerous demoSpin fallback from all 100 top-level game HTML files
 * in games/*.html. These files allow free untracked spins when the API is unavailable,
 * which is unacceptable for real-money operation.
 *
 * Changes:
 * 1. var balance = 100000; // cents (demo)  -->  var balance = 0; // fetched from server
 * 2. Remove the entire demoSpin() function
 * 3. Replace if (!API_AVAILABLE) { demoSpin(betCents); return; } with error message
 * 4. On API health check failure, show error overlay instead of silently degrading
 * 5. On fetch error/non-ok, show error + refund bet instead of calling demoSpin
 * 6. Add server balance fetch on init
 */

const fs = require('fs');
const path = require('path');

const GAMES_DIR = path.join(__dirname, '..', 'games');

// Only process top-level *.html files (not subdirectory index.html which use the proper engine)
const files = fs.readdirSync(GAMES_DIR)
    .filter(f => f.endsWith('.html') && !fs.statSync(path.join(GAMES_DIR, f)).isDirectory())
    .map(f => path.join(GAMES_DIR, f));

console.log(`Found ${files.length} game HTML files to process.\n`);

let processed = 0;
let skipped = 0;
let errors = [];

for (const filePath of files) {
    const filename = path.basename(filePath);
    const raw = fs.readFileSync(filePath, 'utf-8');

    // Safety check: must contain demoSpin to be a target
    if (!raw.includes('demoSpin')) {
        console.log(`  SKIP (no demoSpin): ${filename}`);
        skipped++;
        continue;
    }

    // Normalize CRLF -> LF for reliable regex matching, restore before writing
    const hasCRLF = raw.includes('\r\n');
    let content = hasCRLF ? raw.replace(/\r\n/g, '\n') : raw;

    // =========================================================================
    // 1. Replace "var balance = 100000; // cents (demo)" with "var balance = 0;"
    // =========================================================================
    content = content.replace(
        /var balance = 100000;\s*\/\/\s*cents\s*\(demo\)/g,
        'var balance = 0; // fetched from server'
    );

    // =========================================================================
    // 2. Replace the initial balance display "$1,000.00" with "$0.00"
    // =========================================================================
    content = content.replace(
        /(<div class="amount" id="balanceDisplay">)\$1,000\.00(<\/div>)/g,
        '$1$0.00$2'
    );

    // =========================================================================
    // 3. Remove the entire demoSpin function
    //    Anchored from "function demoSpin(betCents)" to the IIFE "})();\n    }\n"
    // =========================================================================
    content = content.replace(
        /\n    function demoSpin\(betCents\) \{[\s\S]*?\}\)\(\);\n    \}\n/,
        '\n'
    );

    // =========================================================================
    // 4. Replace the API health check to show an error overlay on failure
    // =========================================================================
    content = content.replace(
        /\/\/ Detect if API server is available \(checked once on load\)\n    var API_AVAILABLE = false;\n    \(function checkAPI\(\) \{\n        var x = new XMLHttpRequest\(\);\n        x\.open\('HEAD', '\/api\/health', true\);\n        x\.timeout = 1500;\n        x\.onload = function\(\) \{ if \(x\.status === 200\) API_AVAILABLE = true; \};\n        x\.onerror = function\(\) \{ API_AVAILABLE = false; \};\n        x\.ontimeout = function\(\) \{ API_AVAILABLE = false; \};\n        try \{ x\.send\(\); \} catch\(e\) \{\}\n    \}\)\(\);/,
        [
            '// Server connection check — required for real-money play',
            '    var API_AVAILABLE = false;',
            '    function showConnectionError() {',
            '        var vp = document.getElementById(\'gameViewport\');',
            '        if (document.getElementById(\'connectionError\')) return;',
            '        var overlay = document.createElement(\'div\');',
            '        overlay.id = \'connectionError\';',
            '        overlay.style.cssText = \'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.85);z-index:50;flex-direction:column;gap:12px;\';',
            '        var title = document.createElement(\'div\');',
            '        title.style.cssText = \'color:#ff4444;font-size:20px;font-weight:700;\';',
            '        title.textContent = \'Server Unavailable\';',
            '        var msg = document.createElement(\'div\');',
            '        msg.style.cssText = \'color:#ccc;font-size:14px;text-align:center;max-width:300px;\';',
            '        msg.textContent = \'Cannot connect to game server. Please refresh the page or try again later.\';',
            '        var btn = document.createElement(\'button\');',
            '        btn.style.cssText = \'margin-top:8px;padding:10px 24px;background:#ffd700;color:#000;border:none;border-radius:8px;font-weight:700;cursor:pointer;\';',
            '        btn.textContent = \'Refresh Page\';',
            '        btn.addEventListener(\'click\', function() { location.reload(); });',
            '        overlay.appendChild(title);',
            '        overlay.appendChild(msg);',
            '        overlay.appendChild(btn);',
            '        vp.appendChild(overlay);',
            '        spinBtn.disabled = true;',
            '    }',
            '    (function checkAPI() {',
            '        var x = new XMLHttpRequest();',
            '        x.open(\'HEAD\', \'/api/health\', true);',
            '        x.timeout = 3000;',
            '        x.onload = function() {',
            '            if (x.status === 200) {',
            '                API_AVAILABLE = true;',
            '                fetchServerBalance();',
            '            } else {',
            '                showConnectionError();',
            '            }',
            '        };',
            '        x.onerror = function() { showConnectionError(); };',
            '        x.ontimeout = function() { showConnectionError(); };',
            '        try { x.send(); } catch(e) { showConnectionError(); }',
            '    })();',
            '',
            '    function fetchServerBalance() {',
            '        var token = getToken();',
            '        if (!token) return;',
            '        fetch(\'/api/user/profile\', {',
            '            headers: { \'Authorization\': \'Bearer \' + token }',
            '        }).then(function(r) { return r.json(); })',
            '          .then(function(data) {',
            '            if (data && typeof data.balance === \'number\') {',
            '                balance = data.balance;',
            '                updateBalance();',
            '            } else if (data && typeof data.balanceCents === \'number\') {',
            '                balance = data.balanceCents;',
            '                updateBalance();',
            '            }',
            '        }).catch(function() { /* will get balance from spin response */ });',
            '    }',
        ].join('\n')
    );

    // =========================================================================
    // 5. Replace "if (!API_AVAILABLE) { demoSpin(betCents); return; }"
    // =========================================================================
    content = content.replace(
        /\/\/ If no API server, run pure client-side demo\n        if \(!API_AVAILABLE\) \{\n            demoSpin\(betCents\);\n            return;\n        \}/,
        [
            '// Server connection required for real-money play',
            '        if (!API_AVAILABLE) {',
            '            balance += betCents; // refund the deducted bet',
            '            updateBalance();',
            '            showConnectionError();',
            '            spinning = false;',
            '            spinBtn.disabled = false;',
            '            spinBtn.textContent = \'SPIN\';',
            '            return;',
            '        }',
        ].join('\n')
    );

    // =========================================================================
    // 6. Replace "if (!resp.ok) { API_AVAILABLE = false; demoSpin; return; }"
    // =========================================================================
    content = content.replace(
        /if \(!resp\.ok\) \{\n                API_AVAILABLE = false;\n                demoSpin\(betCents\);\n                return;\n            \}/,
        [
            'if (!resp.ok) {',
            "                var errText = 'Spin failed (HTTP ' + resp.status + '). ';",
            '                if (resp.status === 401) errText += \'Please log in again.\';',
            '                else if (resp.status === 402) errText += \'Insufficient balance.\';',
            '                else errText += \'Please try again.\';',
            '                balance += betCents; // refund the deducted bet',
            '                updateBalance();',
            '                alert(errText);',
            '                spinning = false;',
            '                spinBtn.disabled = false;',
            '                spinBtn.textContent = \'SPIN\';',
            '                return;',
            '            }',
        ].join('\n')
    );

    // =========================================================================
    // 7. Replace the catch block that falls back to demoSpin
    // =========================================================================
    content = content.replace(
        /\} catch \(err\) \{\n            console\.warn\('\[GamePage\] Spin error, falling back to demo:', err\.message\);\n            API_AVAILABLE = false;\n            demoSpin\(betCents\);\n        \}/,
        [
            '} catch (err) {',
            '            console.error(\'[GamePage] Spin error:\', err.message);',
            '            balance += betCents; // refund the deducted bet',
            '            updateBalance();',
            '            if (err.name === \'AbortError\') {',
            '                alert(\'Server took too long to respond. Please try again.\');',
            '            } else {',
            '                showConnectionError();',
            '            }',
            '            spinning = false;',
            '            spinBtn.disabled = false;',
            '            spinBtn.textContent = \'SPIN\';',
            '        }',
        ].join('\n')
    );

    // =========================================================================
    // Verification: make sure demoSpin is fully removed
    // =========================================================================
    if (content.includes('demoSpin')) {
        errors.push(`${filename}: still contains "demoSpin" after processing!`);
        console.log(`  ERROR: ${filename} still contains demoSpin references`);
    }

    // Restore CRLF if original had it
    if (hasCRLF) {
        content = content.replace(/\n/g, '\r\n');
    }

    // Write only if changed
    if (content !== raw) {
        fs.writeFileSync(filePath, content, 'utf-8');
        processed++;
        console.log(`  DONE: ${filename}`);
    } else {
        console.log(`  UNCHANGED: ${filename}`);
        skipped++;
    }
}

console.log(`\n========================================`);
console.log(`Processed: ${processed}`);
console.log(`Skipped:   ${skipped}`);
console.log(`Errors:    ${errors.length}`);
if (errors.length) {
    console.log('\nErrors:');
    errors.forEach(e => console.log('  - ' + e));
}
console.log(`========================================`);

// Final verification pass
console.log('\nVerification pass...');
let demoSpinCount = 0;
let balance100kCount = 0;
for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf-8');
    if (content.includes('demoSpin')) {
        demoSpinCount++;
        console.log(`  FAIL: ${path.basename(filePath)} still has demoSpin`);
    }
    if (content.includes('var balance = 100000')) {
        balance100kCount++;
        console.log(`  FAIL: ${path.basename(filePath)} still has balance = 100000`);
    }
}
console.log(`Files still containing demoSpin: ${demoSpinCount}`);
console.log(`Files still containing balance=100000: ${balance100kCount}`);
if (demoSpinCount === 0 && balance100kCount === 0) {
    console.log('\nAll clear! Demo spin fallback removed from all game files.');
} else {
    console.log('\nWARNING: Some files were not fully cleaned. Manual review needed.');
    process.exit(1);
}
