'use strict';

/**
 * MatrixModal — a small, self-contained, accessible blocking-modal helper.
 *
 * Why this exists:
 *   ui-slot.js historically used native alert() for ~73 messages. Most of
 *   them were migrated to non-blocking toasts (see scripts/migrate-alerts.js),
 *   but ~10 must remain blocking — the user has to acknowledge them before
 *   compliance-critical or destructive code (redirects, reloads, etc.) runs.
 *   Those need a real modal, not a native alert(), to deliver a premium UX
 *   that still preserves the "must-acknowledge" semantics.
 *
 * API (single global, no module system needed):
 *
 *   window.MatrixModal.show({
 *     title:           string,        // dialog heading (required)
 *     body:            string,        // plain-text body (use newlines for breaks)
 *     severity:        'info'|'warning'|'danger',   // default 'info'
 *     primaryLabel:    string,        // OK-button text (default 'OK')
 *     secondaryLabel:  string|null,   // optional second button; null = no second button
 *     dismissable:     boolean,       // Escape / click-outside close? default true
 *     copyableText:    string|null,   // if set, renders a copyable text block (e.g. 2FA backup code)
 *     requireAck:      boolean,       // require a "I saved it / I understand" checkbox before primary enables. default false
 *     ackLabel:        string,        // text for the require-ack checkbox label
 *   }).then(result => { result.confirmed === true; result.secondary === true })
 *
 *   Convenience:
 *     MatrixModal.info(body, title?)        — single-OK info dialog
 *     MatrixModal.warning(body, title?)     — single-OK warning
 *     MatrixModal.danger(body, title?)      — single-OK danger
 *     MatrixModal.confirm({ title, body, ...}) — primary + secondary (cancel)
 *
 * Behavior guarantees:
 *   - role="dialog" aria-modal="true" aria-labelledby + aria-describedby
 *   - Focus trapped inside the panel (Tab loops, Shift+Tab loops backward)
 *   - Focus returns to the opener on close
 *   - Escape closes ONLY if dismissable
 *   - Click on backdrop closes ONLY if dismissable
 *   - All DOM built via createElement + textContent (no innerHTML interpolation)
 *   - CSS injected once on first show() so the module is fully self-contained
 *   - Resolves the returned promise exactly once
 */

(function () {
    if (typeof window === 'undefined') return;
    if (window.MatrixModal) return; // already loaded

    var styleInjected = false;
    var instanceCount = 0;
    var STYLE_ID = 'matrix-modal-styles';

    function injectStyles() {
        if (styleInjected || document.getElementById(STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = [
            '.mm-overlay{position:fixed;inset:0;z-index:11000;background:rgba(7,9,14,0.7);',
            '  display:flex;align-items:center;justify-content:center;padding:24px;',
            '  animation:mmFade 160ms ease-out;}',
            '@keyframes mmFade{from{opacity:0}to{opacity:1}}',
            '@keyframes mmPanel{from{opacity:0;transform:translateY(8px) scale(0.98)}to{opacity:1;transform:none}}',
            '.mm-panel{width:min(440px,calc(100vw - 32px));max-height:calc(100vh - 48px);',
            '  background:linear-gradient(180deg,#161B23,#0F1218);',
            '  border:1px solid rgba(255,255,255,0.08);border-radius:14px;',
            '  box-shadow:0 24px 60px rgba(0,0,0,0.55);',
            '  color:#F0F0F5;display:flex;flex-direction:column;overflow:hidden;',
            '  animation:mmPanel 180ms ease-out;}',
            '.mm-panel.mm-warning{border-color:rgba(255,165,0,0.4)}',
            '.mm-panel.mm-danger{border-color:rgba(220,38,38,0.45)}',
            '.mm-panel.mm-info{border-color:rgba(74,222,128,0.3)}',
            '.mm-header{padding:18px 22px 4px;display:flex;align-items:center;gap:12px;flex:0 0 auto}',
            '.mm-icon{width:24px;height:24px;flex:0 0 auto}',
            '.mm-icon.mm-info{color:#4ADE80}',
            '.mm-icon.mm-warning{color:#FFA500}',
            '.mm-icon.mm-danger{color:#F87171}',
            '.mm-title{margin:0;font-size:1.05rem;font-weight:700;flex:1;line-height:1.3}',
            '.mm-body{padding:8px 22px 18px;font-size:0.92rem;line-height:1.5;',
            '  color:#CDD3DE;white-space:pre-wrap;overflow-y:auto;flex:1 1 auto;max-height:50vh;',
            '  font-variant-numeric:tabular-nums;}',
            '.mm-copy{margin-top:14px;padding:12px 14px;border-radius:8px;',
            '  background:#0B0E14;border:1px solid rgba(255,255,255,0.08);',
            '  font-family:ui-monospace,Menlo,Consolas,monospace;font-size:0.85rem;',
            '  color:#F0C66E;word-break:break-all;display:flex;align-items:center;gap:10px;justify-content:space-between;}',
            '.mm-copy-text{flex:1;min-width:0}',
            '.mm-copy-btn{padding:6px 10px;border-radius:6px;background:rgba(212,168,83,0.15);',
            '  border:1px solid rgba(212,168,83,0.35);color:#F0C66E;font-size:0.78rem;',
            '  font-weight:600;cursor:pointer;flex:0 0 auto;}',
            '.mm-copy-btn:hover{background:rgba(212,168,83,0.25)}',
            '.mm-copy-btn:focus-visible{outline:2px solid #F0C66E;outline-offset:2px}',
            '.mm-ack{display:flex;gap:10px;align-items:flex-start;padding:0 22px 14px;',
            '  font-size:0.85rem;color:#CDD3DE;cursor:pointer;}',
            '.mm-ack input{margin-top:3px;flex:0 0 auto;accent-color:#4ADE80}',
            '.mm-actions{padding:14px 22px 18px;display:flex;gap:10px;justify-content:flex-end;',
            '  border-top:1px solid rgba(255,255,255,0.05);background:rgba(0,0,0,0.18);flex:0 0 auto;}',
            '.mm-btn{padding:9px 18px;border-radius:8px;font-size:0.88rem;font-weight:600;',
            '  cursor:pointer;border:1px solid transparent;transition:background 140ms ease,opacity 140ms ease;}',
            '.mm-btn-primary{background:linear-gradient(135deg,#D4A853,#B8860B);color:#0A0A0A;}',
            '.mm-btn-primary:hover:not(:disabled){background:linear-gradient(135deg,#E0B65F,#C8961F)}',
            '.mm-btn-primary:disabled{opacity:0.45;cursor:not-allowed}',
            '.mm-btn-secondary{background:transparent;color:#CDD3DE;border-color:rgba(255,255,255,0.15);}',
            '.mm-btn-secondary:hover{background:rgba(255,255,255,0.05)}',
            '.mm-btn:focus-visible{outline:2px solid #F0C66E;outline-offset:2px}',
            '@media (prefers-reduced-motion: reduce){',
            '  .mm-overlay,.mm-panel{animation:none}',
            '}'
        ].join('\n');
        document.head.appendChild(style);
        styleInjected = true;
    }

    function makeIcon(severity) {
        var ns = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('aria-hidden', 'true');
        svg.classList.add('mm-icon');
        svg.classList.add('mm-' + severity);

        var paths;
        if (severity === 'danger') {
            paths = ['M12 9v4', 'M12 17h.01', 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z'];
        } else if (severity === 'warning') {
            paths = ['M12 8v4', 'M12 16h.01', 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z'];
        } else {
            paths = ['M12 16v-4', 'M12 8h.01', 'M22 12c0 5.523-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2s10 4.477 10 10z'];
        }
        paths.forEach(function (d) {
            var p = document.createElementNS(ns, 'path');
            p.setAttribute('d', d);
            svg.appendChild(p);
        });
        return svg;
    }

    function getFocusable(root) {
        var sel = [
            'button:not([disabled])',
            '[href]',
            'input:not([disabled])',
            'select:not([disabled])',
            'textarea:not([disabled])',
            '[tabindex]:not([tabindex="-1"])'
        ].join(',');
        var list = root.querySelectorAll(sel);
        var out = [];
        for (var i = 0; i < list.length; i++) {
            var el = list[i];
            if (!el.hasAttribute('disabled') && el.offsetParent !== null) out.push(el);
        }
        return out;
    }

    function show(opts) {
        injectStyles();
        opts = opts || {};
        var severity = opts.severity || 'info';
        if (severity !== 'info' && severity !== 'warning' && severity !== 'danger') severity = 'info';
        var primaryLabel = opts.primaryLabel || 'OK';
        var secondaryLabel = opts.secondaryLabel || null;
        var dismissable = opts.dismissable !== false;
        var requireAck = !!opts.requireAck;
        var instanceId = 'mm-' + (++instanceCount);

        var opener = document.activeElement;

        var overlay = document.createElement('div');
        overlay.className = 'mm-overlay';

        var panel = document.createElement('div');
        panel.className = 'mm-panel mm-' + severity;
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-labelledby', instanceId + '-title');
        panel.setAttribute('aria-describedby', instanceId + '-body');

        var header = document.createElement('div');
        header.className = 'mm-header';
        header.appendChild(makeIcon(severity));
        var titleEl = document.createElement('h2');
        titleEl.className = 'mm-title';
        titleEl.id = instanceId + '-title';
        titleEl.textContent = opts.title || (severity === 'danger' ? 'Action required' : severity === 'warning' ? 'Heads up' : 'Notice');
        header.appendChild(titleEl);

        var body = document.createElement('div');
        body.className = 'mm-body';
        body.id = instanceId + '-body';
        body.textContent = opts.body || '';

        if (opts.copyableText) {
            var copyWrap = document.createElement('div');
            copyWrap.className = 'mm-copy';
            var copyText = document.createElement('span');
            copyText.className = 'mm-copy-text';
            copyText.textContent = opts.copyableText;
            var copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.className = 'mm-copy-btn';
            copyBtn.textContent = 'Copy';
            copyBtn.addEventListener('click', function () {
                var text = opts.copyableText;
                var done = function () {
                    var prev = copyBtn.textContent;
                    copyBtn.textContent = 'Copied';
                    setTimeout(function () { copyBtn.textContent = prev; }, 1400);
                };
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(done).catch(function () {
                        // fallback below
                        legacyCopy();
                    });
                } else {
                    legacyCopy();
                }
                function legacyCopy() {
                    var ta = document.createElement('textarea');
                    ta.value = text;
                    ta.style.position = 'fixed';
                    ta.style.left = '-9999px';
                    document.body.appendChild(ta);
                    ta.select();
                    try { document.execCommand('copy'); done(); } catch (e) { /* noop */ }
                    document.body.removeChild(ta);
                }
            });
            copyWrap.appendChild(copyText);
            copyWrap.appendChild(copyBtn);
            body.appendChild(copyWrap);
        }

        var ackInput = null;
        var ackWrap = null;
        if (requireAck) {
            ackWrap = document.createElement('label');
            ackWrap.className = 'mm-ack';
            ackInput = document.createElement('input');
            ackInput.type = 'checkbox';
            ackInput.id = instanceId + '-ack';
            var ackText = document.createElement('span');
            ackText.textContent = opts.ackLabel || 'I understand and have saved this.';
            ackWrap.appendChild(ackInput);
            ackWrap.appendChild(ackText);
        }

        var actions = document.createElement('div');
        actions.className = 'mm-actions';

        var primaryBtn = document.createElement('button');
        primaryBtn.type = 'button';
        primaryBtn.className = 'mm-btn mm-btn-primary';
        primaryBtn.textContent = primaryLabel;
        if (requireAck) primaryBtn.disabled = true;

        var secondaryBtn = null;
        if (secondaryLabel) {
            secondaryBtn = document.createElement('button');
            secondaryBtn.type = 'button';
            secondaryBtn.className = 'mm-btn mm-btn-secondary';
            secondaryBtn.textContent = secondaryLabel;
            actions.appendChild(secondaryBtn);
        }
        actions.appendChild(primaryBtn);

        panel.appendChild(header);
        panel.appendChild(body);
        if (ackWrap) panel.appendChild(ackWrap);
        panel.appendChild(actions);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        // Disable the primary while ack isn't checked
        if (ackInput) {
            ackInput.addEventListener('change', function () {
                primaryBtn.disabled = !ackInput.checked;
            });
        }

        return new Promise(function (resolve) {
            var resolved = false;
            function settle(result) {
                if (resolved) return;
                resolved = true;
                document.removeEventListener('keydown', onKey, true);
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                // Return focus to opener so keyboard users land back where they started
                try { if (opener && opener.focus) opener.focus(); } catch (e) { /* noop */ }
                resolve(result);
            }

            function onKey(e) {
                if (e.key === 'Escape') {
                    if (dismissable) { e.preventDefault(); settle({ confirmed: false, secondary: false, dismissed: true }); }
                    return;
                }
                if (e.key === 'Tab') {
                    // Focus trap
                    var focusables = getFocusable(panel);
                    if (focusables.length === 0) { e.preventDefault(); return; }
                    var first = focusables[0];
                    var last = focusables[focusables.length - 1];
                    var active = document.activeElement;
                    if (e.shiftKey && active === first) {
                        e.preventDefault();
                        last.focus();
                    } else if (!e.shiftKey && active === last) {
                        e.preventDefault();
                        first.focus();
                    }
                }
            }

            document.addEventListener('keydown', onKey, true);

            overlay.addEventListener('click', function (e) {
                if (e.target === overlay && dismissable) settle({ confirmed: false, secondary: false, dismissed: true });
            });
            primaryBtn.addEventListener('click', function () { settle({ confirmed: true, secondary: false }); });
            if (secondaryBtn) secondaryBtn.addEventListener('click', function () { settle({ confirmed: false, secondary: true }); });

            // Initial focus — primary if it's enabled, else ack checkbox, else close-equivalent
            setTimeout(function () {
                if (!primaryBtn.disabled) primaryBtn.focus();
                else if (ackInput) ackInput.focus();
                else if (secondaryBtn) secondaryBtn.focus();
            }, 0);
        });
    }

    function info(body, title) { return show({ severity: 'info', body: body, title: title }); }
    function warning(body, title) { return show({ severity: 'warning', body: body, title: title }); }
    function danger(body, title) { return show({ severity: 'danger', body: body, title: title }); }
    function confirm(opts) {
        opts = opts || {};
        if (!opts.secondaryLabel) opts.secondaryLabel = 'Cancel';
        if (!opts.primaryLabel) opts.primaryLabel = 'Confirm';
        return show(opts);
    }

    window.MatrixModal = {
        show: show,
        info: info,
        warning: warning,
        danger: danger,
        confirm: confirm
    };
})();
