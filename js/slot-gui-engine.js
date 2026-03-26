(function() {
    'use strict';

    // ════════════════════════════════════════════════════════════════════════
    // SLOT GUI ENGINE v2 — Per-Game HD Asset-Based Unique Interface
    // Every single slot game gets a completely unique visual interface.
    // Uses HD image textures for reel frames, spin buttons, bars, panels.
    // Falls back to per-game procedural CSS when images haven't loaded.
    // ════════════════════════════════════════════════════════════════════════

    var GUI_ASSET_BASE = 'assets/gui/';
    var _imageCache = {};
    var _probeCache = {};

    // ── Color Extraction & Unique Per-Game Palette ────────────────────────
    // Instead of 15 shared skins, every game gets a unique palette derived
    // from its accentColor, bgGradient, and reelBg — no two are the same.

    function hexToHSL(hex) {
        if (!hex) return { h: 0, s: 50, l: 50 };
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
        var r = parseInt(hex.substring(0,2),16)/255;
        var g = parseInt(hex.substring(2,4),16)/255;
        var b = parseInt(hex.substring(4,6),16)/255;
        var max = Math.max(r,g,b), min = Math.min(r,g,b);
        var h = 0, s = 0, l = (max+min)/2;
        if (max !== min) {
            var d = max - min;
            s = l > 0.5 ? d/(2-max-min) : d/(max+min);
            if (max === r) h = ((g-b)/d + (g < b ? 6 : 0)) / 6;
            else if (max === g) h = ((b-r)/d + 2) / 6;
            else h = ((r-g)/d + 4) / 6;
        }
        return { h: Math.round(h*360), s: Math.round(s*100), l: Math.round(l*100) };
    }

    function hslToCSS(h, s, l) {
        return 'hsl(' + h + ',' + s + '%,' + l + '%)';
    }

    function deriveGamePalette(game) {
        var accent = hexToHSL(game.accentColor || '#f0a500');
        var h = accent.h;
        var s = Math.min(accent.s + 10, 95);
        // Generate a full unique palette from the game's accent
        return {
            primary: hslToCSS(h, s, 45),
            primaryLight: hslToCSS(h, s, 60),
            primaryDark: hslToCSS(h, s, 25),
            secondary: hslToCSS((h + 30) % 360, Math.max(s - 15, 30), 40),
            secondaryLight: hslToCSS((h + 30) % 360, Math.max(s - 15, 30), 55),
            accent: hslToCSS((h + 180) % 360, Math.min(s + 5, 90), 55),
            dark: hslToCSS(h, 30, 10),
            darker: hslToCSS(h, 25, 6),
            glow: hslToCSS(h, s, 60),
            text: hslToCSS(h, 15, 90),
            hue: h,
            sat: s
        };
    }

    // ── Per-Game Unique Style Variations ──────────────────────────────────
    // Use game ID hash to pick unique frame shapes, border styles, etc.

    function hashStr(str) {
        var hash = 0;
        for (var i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash = hash & hash;
        }
        return Math.abs(hash);
    }

    var SPIN_SHAPES = [
        '50%',                            // circle
        '12px',                           // rounded square
        '0',                              // square
        '50% 0 50% 0',                    // diamond-ish
        '40% 60% 40% 60%',               // organic blob 1
        '30% 70% 70% 30% / 30% 30% 70% 70%', // organic blob 2
        '50% 50% 0 50%',                  // leaf shape
        '20%',                            // soft square
    ];

    var BORDER_STYLES = ['solid', 'double', 'ridge', 'groove', 'outset', 'inset'];
    var BORDER_WIDTHS = ['2px', '3px', '4px', '3px double'];

    var FRAME_PATTERNS = [
        'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(255,255,255,0.05) 4px, rgba(255,255,255,0.05) 8px)',
        'repeating-linear-gradient(-45deg, transparent, transparent 6px, rgba(255,255,255,0.04) 6px, rgba(255,255,255,0.04) 12px)',
        'repeating-linear-gradient(90deg, transparent, transparent 3px, rgba(255,255,255,0.06) 3px, rgba(255,255,255,0.06) 6px)',
        'radial-gradient(circle at 20% 50%, rgba(255,255,255,0.08) 1px, transparent 1px)',
        'repeating-conic-gradient(rgba(255,255,255,0.03) 0deg 10deg, transparent 10deg 20deg)',
        'linear-gradient(135deg, rgba(255,255,255,0.06) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.06) 75%, transparent 75%)',
        'none',
        'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.04) 2px, rgba(255,255,255,0.04) 4px)',
    ];

    var SPIN_ICONS = ['▶', '⊛', '◉', '⟳', '★', '♦', '⚡', '✦', '⊕', '☆', '◆', '✧',
        '⬟', '⎈', '⊚', '⍟', '❖', '⊙', '◈', '✶', '⬡', '⟐', '⊗', '⟡'];

    var TITLE_FONTS = [
        '"Palatino Linotype", Palatino, serif',
        '"Trebuchet MS", Helvetica, sans-serif',
        'Georgia, "Times New Roman", serif',
        '"Segoe UI", Tahoma, sans-serif',
        '"Lucida Console", Monaco, monospace',
        '"Brush Script MT", cursive',
        'Impact, "Arial Black", sans-serif',
        '"Courier New", Courier, monospace',
        '"Comic Sans MS", cursive',
        '"Copperplate", "Copperplate Gothic Light", serif',
        '"Bookman Old Style", serif',
        '"Gill Sans", "Gill Sans MT", sans-serif',
    ];

    // ── HD Asset Probing ─────────────────────────────────────────────────

    function probeImage(url, callback) {
        if (_probeCache[url] !== undefined) {
            callback(_probeCache[url]);
            return;
        }
        var img = new Image();
        img.onload = function() {
            _probeCache[url] = true;
            _imageCache[url] = img;
            callback(true);
        };
        img.onerror = function() {
            _probeCache[url] = false;
            callback(false);
        };
        img.src = url;
    }

    function getAssetURL(gameId, assetType) {
        // Try WebP first, then PNG
        return {
            webp: GUI_ASSET_BASE + gameId + '/' + assetType + '.webp',
            png: GUI_ASSET_BASE + gameId + '/' + assetType + '.png'
        };
    }

    // ── Build Unique Per-Game CSS ─────────────────────────────────────────

    function buildGameCSS(game) {
        var gid = game.id || 'unknown';
        var h = hashStr(gid);
        var pal = deriveGamePalette(game);
        var S = '.slot-modal-fullscreen[data-gui-game="' + gid + '"]';

        // Pick unique variations based on hash
        var spinShape = SPIN_SHAPES[h % SPIN_SHAPES.length];
        var borderStyle = BORDER_STYLES[(h >> 3) % BORDER_STYLES.length];
        var borderWidth = BORDER_WIDTHS[(h >> 5) % BORDER_WIDTHS.length];
        var framePattern = FRAME_PATTERNS[(h >> 7) % FRAME_PATTERNS.length];
        var spinIcon = SPIN_ICONS[(h >> 9) % SPIN_ICONS.length];
        var titleFont = TITLE_FONTS[(h >> 11) % TITLE_FONTS.length];
        var spinSize = 72 + (h % 36);  // 72-108px unique per game
        var barAngle = 90 + (h % 90);  // unique gradient angle

        // Each game gets unique decoration characters
        var decoChars = ['◈','◆','★','✦','♦','⚜','❖','✧','◉','⬟','⟐','⎈','⊛','⊕','⍟','☆','♕','⊙'];
        var deco = decoChars[(h >> 13) % decoChars.length];

        // Unique corner radius for reel area
        var reelRadius = 4 + (h % 12);  // 4-16px

        // Asset URLs
        var frameUrl = getAssetURL(gid, 'reel_frame');
        var btnUrl = getAssetURL(gid, 'spin_btn');
        var topUrl = getAssetURL(gid, 'top_bar');
        var bottomUrl = getAssetURL(gid, 'bottom_bar');
        var panelUrl = getAssetURL(gid, 'panel_bg');

        // Common — hide default SVG icon, set up ::before for themed icon
        var css = '';
        css += S + ' #spinBtn .spin-btn-icon { display: none !important; }\n';
        css += S + ' #spinBtn::before { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; border: none !important; border-radius: inherit; animation: none !important; }\n';

        // CSS Variables
        css += S + ' {\n';
        css += '  --gui-primary: ' + pal.primary + ';\n';
        css += '  --gui-primary-light: ' + pal.primaryLight + ';\n';
        css += '  --gui-primary-dark: ' + pal.primaryDark + ';\n';
        css += '  --gui-secondary: ' + pal.secondary + ';\n';
        css += '  --gui-accent: ' + pal.accent + ';\n';
        css += '  --gui-dark: ' + pal.dark + ';\n';
        css += '  --gui-glow: ' + pal.glow + ';\n';
        css += '  --gui-text: ' + pal.text + ';\n';
        css += '}\n';

        // Top bar — unique per game with HD texture attempt
        css += S + ' .slot-top-bar {\n';
        css += '  background: linear-gradient(' + barAngle + 'deg, ' + pal.primaryDark + ' 0%, ' + pal.primary + ' 50%, ' + pal.primaryDark + ' 100%);\n';
        css += '  background-image: url("' + topUrl.webp + '"), url("' + topUrl.png + '"), linear-gradient(' + barAngle + 'deg, ' + pal.primaryDark + ' 0%, ' + pal.primary + ' 50%, ' + pal.primaryDark + ' 100%);\n';
        css += '  background-size: cover;\n';
        css += '  background-position: center;\n';
        css += '  border: ' + borderWidth + ' ' + borderStyle + ' ' + pal.primary + ';\n';
        css += '  border-bottom: 3px ' + borderStyle + ' ' + pal.primaryLight + ';\n';
        css += '  position: relative;\n';
        css += '  box-shadow: 0 2px 12px rgba(0,0,0,0.5), inset 0 1px 0 ' + pal.primaryLight + ';\n';
        css += '}\n';

        // Top bar decorative overlay
        css += S + ' .slot-top-bar::before {\n';
        css += '  content: "";\n';
        css += '  position: absolute; inset: 0;\n';
        css += '  background: ' + framePattern + ';\n';
        css += '  pointer-events: none;\n';
        css += '  opacity: 0.7;\n';
        css += '}\n';

        // Top bar decorative symbols
        css += S + ' .slot-top-bar::after {\n';
        css += '  content: "' + deco + ' ' + deco + ' ' + deco + '";\n';
        css += '  position: absolute; bottom: -1px; left: 50%; transform: translateX(-50%);\n';
        css += '  font-size: 10px; color: ' + pal.primaryLight + ';\n';
        css += '  letter-spacing: 6px; opacity: 0.6;\n';
        css += '}\n';

        // Bottom bar — unique texture
        css += S + ' .slot-bottom-bar {\n';
        css += '  background: linear-gradient(' + ((barAngle + 180) % 360) + 'deg, ' + pal.primaryDark + ' 0%, ' + pal.primary + ' 50%, ' + pal.primaryDark + ' 100%);\n';
        css += '  background-image: url("' + bottomUrl.webp + '"), url("' + bottomUrl.png + '"), linear-gradient(' + ((barAngle + 180) % 360) + 'deg, ' + pal.primaryDark + ' 0%, ' + pal.primary + ' 50%, ' + pal.primaryDark + ' 100%);\n';
        css += '  background-size: cover;\n';
        css += '  background-position: center;\n';
        css += '  border: ' + borderWidth + ' ' + borderStyle + ' ' + pal.primary + ';\n';
        css += '  border-top: 3px ' + borderStyle + ' ' + pal.primaryLight + ';\n';
        css += '  position: relative;\n';
        css += '  box-shadow: 0 -2px 12px rgba(0,0,0,0.5), inset 0 -1px 0 ' + pal.primaryLight + ';\n';
        css += '}\n';

        // Bottom bar overlay
        css += S + ' .slot-bottom-bar::before {\n';
        css += '  content: "";\n';
        css += '  position: absolute; inset: 0;\n';
        css += '  background: ' + framePattern + ';\n';
        css += '  pointer-events: none;\n';
        css += '  opacity: 0.5;\n';
        css += '}\n';

        // Reel area — HD frame overlay + unique border
        css += S + ' .slot-reel-area {\n';
        css += '  border: ' + borderWidth + ' ' + borderStyle + ' ' + pal.primary + ';\n';
        css += '  border-radius: ' + reelRadius + 'px;\n';
        css += '  box-shadow: inset 0 0 20px rgba(0,0,0,0.6), 0 0 15px ' + pal.glow + '33;\n';
        css += '  position: relative;\n';
        css += '}\n';

        // Reel frame overlay (HD image positioned on top)
        css += S + ' .slot-reel-area::after {\n';
        css += '  content: "";\n';
        css += '  position: absolute; inset: -3px;\n';
        css += '  background-image: url("' + frameUrl.webp + '"), url("' + frameUrl.png + '");\n';
        css += '  background-size: 100% 100%;\n';
        css += '  background-repeat: no-repeat;\n';
        css += '  pointer-events: none;\n';
        css += '  z-index: 2;\n';
        css += '  border-radius: ' + reelRadius + 'px;\n';
        css += '}\n';

        // Spin button — per-game unique shape, size, and HD texture
        css += S + ' #spinBtn {\n';
        css += '  width: ' + spinSize + 'px;\n';
        css += '  height: ' + spinSize + 'px;\n';
        css += '  border-radius: ' + spinShape + ';\n';
        css += '  background: radial-gradient(circle at 35% 35%, ' + pal.primaryLight + ', ' + pal.primary + ', ' + pal.primaryDark + ');\n';
        css += '  background-image: url("' + btnUrl.webp + '"), url("' + btnUrl.png + '"), radial-gradient(circle at 35% 35%, ' + pal.primaryLight + ', ' + pal.primary + ', ' + pal.primaryDark + ');\n';
        css += '  background-size: cover;\n';
        css += '  background-position: center;\n';
        css += '  border: 3px ' + borderStyle + ' ' + pal.primaryDark + ';\n';
        css += '  box-shadow: 0 4px 15px rgba(0,0,0,0.5), 0 0 20px ' + pal.glow + '44, inset 0 2px 4px rgba(255,255,255,0.2);\n';
        css += '  position: relative;\n';
        css += '  overflow: hidden;\n';
        css += '  transition: transform 0.15s, box-shadow 0.15s;\n';
        css += '}\n';

        // Spin button icon overlay
        css += S + ' #spinBtn::before {\n';
        css += '  content: "' + spinIcon + '";\n';
        css += '  font-size: ' + Math.round(spinSize * 0.38) + 'px;\n';
        css += '  color: ' + pal.text + ';\n';
        css += '  text-shadow: 0 0 8px ' + pal.glow + ', 0 2px 4px rgba(0,0,0,0.6);\n';
        css += '}\n';

        // Spin button hover
        css += S + ' #spinBtn:hover:not(:disabled) {\n';
        css += '  transform: scale(1.08);\n';
        css += '  box-shadow: 0 6px 25px rgba(0,0,0,0.5), 0 0 35px ' + pal.glow + '66;\n';
        css += '}\n';

        // Spin button disabled
        css += S + ' #spinBtn:disabled {\n';
        css += '  opacity: 0.5;\n';
        css += '  filter: grayscale(60%);\n';
        css += '}\n';

        // Title font — unique per game
        css += S + ' .slot-title {\n';
        css += '  font-family: ' + titleFont + ';\n';
        css += '  color: ' + pal.primaryLight + ';\n';
        css += '  text-shadow: 0 0 10px ' + pal.glow + '88, 0 2px 4px rgba(0,0,0,0.8);\n';
        css += '  letter-spacing: 1px;\n';
        css += '}\n';

        // Bet chips — unique per game
        css += S + ' .bet-chip {\n';
        css += '  background: radial-gradient(circle at 40% 40%, ' + pal.secondary + ', ' + pal.primaryDark + ');\n';
        css += '  border: 2px ' + borderStyle + ' ' + pal.primaryLight + ';\n';
        css += '  color: ' + pal.text + ';\n';
        css += '  box-shadow: 0 2px 8px rgba(0,0,0,0.4);\n';
        css += '}\n';

        // Close button — unique per game
        css += S + ' .slot-close-btn {\n';
        css += '  background: linear-gradient(135deg, ' + pal.primaryDark + ', ' + pal.primary + ');\n';
        css += '  border: 1px ' + borderStyle + ' ' + pal.primaryLight + ';\n';
        css += '  color: ' + pal.text + ';\n';
        css += '}\n';
        css += S + ' .slot-close-btn:hover {\n';
        css += '  background: linear-gradient(135deg, ' + pal.primary + ', ' + pal.primaryLight + ');\n';
        css += '  box-shadow: 0 0 12px ' + pal.glow + '44;\n';
        css += '}\n';

        // Balance display area — use panel texture
        css += S + ' .slot-info-panel, ' + S + ' .slot-balance-display {\n';
        css += '  background: ' + pal.darker + ';\n';
        css += '  background-image: url("' + panelUrl.webp + '"), url("' + panelUrl.png + '");\n';
        css += '  background-size: cover;\n';
        css += '  border: 1px ' + borderStyle + ' ' + pal.primaryDark + ';\n';
        css += '  border-radius: 6px;\n';
        css += '  color: ' + pal.text + ';\n';
        css += '}\n';

        // Win display area
        css += S + ' .slot-win-display {\n';
        css += '  color: ' + pal.primaryLight + ';\n';
        css += '  text-shadow: 0 0 15px ' + pal.glow + ', 0 0 30px ' + pal.glow + '66;\n';
        css += '}\n';

        // Stat badges if visible
        css += S + ' .stat-badge {\n';
        css += '  background: ' + pal.primaryDark + ';\n';
        css += '  border: 1px solid ' + pal.primary + ';\n';
        css += '  color: ' + pal.text + ';\n';
        css += '}\n';

        // ── Per-Game Unique Reel Cell Styling ──
        var cellBorderRadius = (h % 8) + 2; // 2-10px unique per game
        var cellBg = 'rgba(' + parseInt(pal.primaryDark.slice(1,3),16) + ',' + parseInt(pal.primaryDark.slice(3,5),16) + ',' + parseInt(pal.primaryDark.slice(5,7),16) + ',0.85)';
        css += S + ' .reel-cell {\n';
        css += '  border-radius: ' + cellBorderRadius + 'px;\n';
        css += '  background: ' + cellBg + ';\n';
        css += '  border: 1px solid ' + pal.primary + '22;\n';
        css += '  transition: background 0.2s, border-color 0.2s, box-shadow 0.2s;\n';
        css += '}\n';

        // Win glow on cells — unique color per game
        css += S + ' .reel-win-glow {\n';
        css += '  border-color: ' + pal.primaryLight + ' !important;\n';
        css += '  box-shadow: 0 0 12px ' + pal.glow + ', inset 0 0 8px ' + pal.glow + '44 !important;\n';
        css += '  background: ' + pal.primary + '22 !important;\n';
        css += '}\n';

        // Wild symbol glow — unique per game
        css += S + ' .reel-wild-glow {\n';
        css += '  border-color: ' + pal.accent + ' !important;\n';
        css += '  box-shadow: 0 0 15px ' + pal.accent + '88, inset 0 0 10px ' + pal.accent + '33 !important;\n';
        css += '}\n';

        // Scatter symbol glow — unique per game
        css += S + ' .reel-scatter-glow {\n';
        css += '  border-color: ' + pal.secondary + ' !important;\n';
        css += '  box-shadow: 0 0 15px ' + pal.secondary + '88, inset 0 0 10px ' + pal.secondary + '33 !important;\n';
        css += '}\n';

        // Per-game bar section styling
        css += S + ' .slot-bar-section {\n';
        css += '  background: ' + pal.primaryDark + '66;\n';
        css += '  border: 1px solid ' + pal.primary + '33;\n';
        css += '  border-radius: ' + (cellBorderRadius + 2) + 'px;\n';
        css += '}\n';

        // Per-game bar label color
        css += S + ' .slot-bar-label {\n';
        css += '  color: ' + pal.primaryLight + '99;\n';
        css += '}\n';

        // Per-game balance value color
        css += S + ' .slot-bar-balance .slot-bar-value {\n';
        css += '  color: ' + pal.text + ';\n';
        css += '}\n';

        // Per-game bet value color
        css += S + ' .slot-bet-display .slot-bar-value {\n';
        css += '  color: ' + pal.primaryLight + ';\n';
        css += '}\n';

        // Per-game win value color
        css += S + ' .slot-win-value {\n';
        css += '  color: ' + pal.accent + ';\n';
        css += '  text-shadow: 0 0 10px ' + pal.accent + '66;\n';
        css += '}\n';

        // Per-game reels container border glow
        css += S + ' .reels-container {\n';
        css += '  border-color: ' + pal.primary + '44 !important;\n';
        css += '  box-shadow: 0 0 25px ' + pal.glow + '22, inset 0 0 30px rgba(0,0,0,0.5) !important;\n';
        css += '}\n';

        // Per-game bet buttons
        css += S + ' .slot-bet-btn {\n';
        css += '  border-color: ' + pal.primary + '44;\n';
        css += '  color: ' + pal.primaryLight + ';\n';
        css += '}\n';
        css += S + ' .slot-bet-btn:hover {\n';
        css += '  border-color: ' + pal.primaryLight + ';\n';
        css += '  color: ' + pal.text + ';\n';
        css += '  background: ' + pal.primary + '33;\n';
        css += '}\n';

        // Per-game turbo/auto buttons
        css += S + ' .slot-turbo-btn, ' + S + ' .slot-auto-btn {\n';
        css += '  border-color: ' + pal.primary + '33;\n';
        css += '  color: ' + pal.primaryLight + '88;\n';
        css += '}\n';
        css += S + ' .slot-turbo-btn:hover, ' + S + ' .slot-auto-btn:hover {\n';
        css += '  border-color: ' + pal.primaryLight + ';\n';
        css += '  color: ' + pal.primaryLight + ';\n';
        css += '}\n';

        // ═══════════════════════════════════════════════════════════════
        // PER-GAME BONUS MODE CSS — Dramatically Different Free Spins UI
        // Each game's bonus round gets an inverted/altered visual identity
        // so players immediately know they're in the special game mode.
        // ═══════════════════════════════════════════════════════════════

        var B = '.slot-modal-fullscreen.bonus-mode-active[data-gui-game="' + gid + '"]';

        // Bonus palette: invert/shift the normal palette for dramatic contrast
        var bonusPrimary = pal.accent;       // swap accent → primary
        var bonusAccent = pal.primaryLight;   // swap primary → accent
        var bonusDark = '#0a0005';
        var bonusGlow = pal.accent + '88';

        // Pick a completely different border style and radius for bonus
        var bonusBorderStyle = BORDER_STYLES[((h >> 3) + 4) % BORDER_STYLES.length];
        var bonusBorderWidth = BORDER_WIDTHS[((h >> 5) + 2) % BORDER_WIDTHS.length];
        var bonusReelRadius = 16 - reelRadius + 4; // invert the radius (small→large, large→small)
        var bonusCellRadius = 10 - cellBorderRadius + 2; // invert cell radius too
        var bonusSpinSize = 80 + ((h + 7) % 28); // different size than normal

        // Different spin icon for bonus
        var bonusSpinIcon = SPIN_ICONS[((h >> 9) + 3) % SPIN_ICONS.length];

        // Bonus background: completely different gradient from normal
        css += B + ' {\n';
        css += '  background: radial-gradient(ellipse at 50% 40%, ' + bonusPrimary + '22 0%, ' + bonusDark + ' 60%, #000 100%) !important;\n';
        css += '}\n';

        // Bonus top bar: inverted colors, different border
        css += B + ' .slot-top-bar {\n';
        css += '  background: linear-gradient(90deg, ' + bonusDark + ' 0%, ' + bonusPrimary + '33 50%, ' + bonusDark + ' 100%) !important;\n';
        css += '  border-bottom: ' + bonusBorderWidth + ' ' + bonusBorderStyle + ' ' + bonusPrimary + ' !important;\n';
        css += '  box-shadow: 0 2px 20px ' + bonusGlow + ' !important;\n';
        css += '}\n';

        // Bonus bottom bar: inverted from normal
        css += B + ' .slot-bottom-bar {\n';
        css += '  background: linear-gradient(90deg, ' + bonusDark + ' 0%, ' + bonusPrimary + '22 50%, ' + bonusDark + ' 100%) !important;\n';
        css += '  border-top: ' + bonusBorderWidth + ' ' + bonusBorderStyle + ' ' + bonusPrimary + ' !important;\n';
        css += '  box-shadow: 0 -2px 20px ' + bonusGlow + ' !important;\n';
        css += '}\n';

        // Bonus reel area: different radius, border style, intense glow
        css += B + ' .slot-reel-area {\n';
        css += '  border: ' + bonusBorderWidth + ' ' + bonusBorderStyle + ' ' + bonusPrimary + ' !important;\n';
        css += '  border-radius: ' + bonusReelRadius + 'px !important;\n';
        css += '  box-shadow: 0 0 40px ' + bonusGlow + ', inset 0 0 30px ' + bonusPrimary + '22 !important;\n';
        css += '}\n';

        // Bonus reel frame overlay: use panel_bg as frame during bonus (different from normal reel_frame)
        css += B + ' .slot-reel-area::after {\n';
        css += '  background-image: url("' + panelUrl.webp + '"), url("' + panelUrl.png + '") !important;\n';
        css += '  background-size: cover !important;\n';
        css += '  opacity: 0.3 !important;\n';
        css += '  border-radius: ' + bonusReelRadius + 'px !important;\n';
        css += '  mix-blend-mode: screen !important;\n';
        css += '}\n';

        // Bonus reel cells: completely different look
        css += B + ' .reel-cell {\n';
        css += '  border-radius: ' + bonusCellRadius + 'px !important;\n';
        css += '  background: rgba(0,0,0,0.7) !important;\n';
        css += '  border: 1px solid ' + bonusPrimary + '44 !important;\n';
        css += '  box-shadow: inset 0 0 8px ' + bonusPrimary + '11 !important;\n';
        css += '}\n';

        // Bonus win glow: uses accent (swapped from normal)
        css += B + ' .reel-win-glow {\n';
        css += '  border-color: ' + bonusAccent + ' !important;\n';
        css += '  box-shadow: 0 0 20px ' + bonusAccent + 'aa, inset 0 0 12px ' + bonusAccent + '44 !important;\n';
        css += '  background: ' + bonusAccent + '22 !important;\n';
        css += '}\n';

        // Bonus spin button: completely different visual
        css += B + ' #spinBtn {\n';
        css += '  width: ' + bonusSpinSize + 'px !important;\n';
        css += '  height: ' + bonusSpinSize + 'px !important;\n';
        css += '  border-radius: 50% !important;\n';
        css += '  background: radial-gradient(circle at 35% 35%, ' + bonusPrimary + ', ' + bonusPrimary + 'aa, ' + bonusDark + ') !important;\n';
        css += '  border: 3px ' + bonusBorderStyle + ' ' + bonusPrimary + ' !important;\n';
        css += '  box-shadow: 0 0 30px ' + bonusGlow + ', 0 0 60px ' + bonusPrimary + '33, inset 0 2px 6px rgba(255,255,255,0.25) !important;\n';
        css += '}\n';
        css += B + ' #spinBtn::before {\n';
        css += '  content: "' + bonusSpinIcon + '" !important;\n';
        css += '  font-size: ' + Math.round(bonusSpinSize * 0.4) + 'px !important;\n';
        css += '  color: #fff !important;\n';
        css += '  text-shadow: 0 0 12px ' + bonusPrimary + ', 0 0 24px ' + bonusGlow + ' !important;\n';
        css += '}\n';

        // Bonus reels container: different border and glow
        css += B + ' .reels-container {\n';
        css += '  border: 2px ' + bonusBorderStyle + ' ' + bonusPrimary + '66 !important;\n';
        css += '  border-radius: ' + bonusReelRadius + 'px !important;\n';
        css += '  box-shadow: 0 0 35px ' + bonusGlow + ', inset 0 0 40px rgba(0,0,0,0.6) !important;\n';
        css += '}\n';

        // Bonus bar sections: themed to bonus palette
        css += B + ' .slot-bar-section {\n';
        css += '  background: ' + bonusPrimary + '11 !important;\n';
        css += '  border: 1px solid ' + bonusPrimary + '44 !important;\n';
        css += '}\n';

        // Bonus bar labels and values: accent colored
        css += B + ' .slot-bar-label {\n';
        css += '  color: ' + bonusPrimary + 'aa !important;\n';
        css += '}\n';
        css += B + ' .slot-bar-value {\n';
        css += '  color: #fff !important;\n';
        css += '  text-shadow: 0 0 8px ' + bonusGlow + ' !important;\n';
        css += '}\n';

        // Bonus bet/turbo/auto buttons
        css += B + ' .slot-bet-btn, ' + B + ' .slot-turbo-btn, ' + B + ' .slot-auto-btn {\n';
        css += '  border-color: ' + bonusPrimary + '55 !important;\n';
        css += '  color: ' + bonusPrimary + 'cc !important;\n';
        css += '}\n';

        return css;
    }

    // ── Clutter Management ────────────────────────────────────────────────

    function suppressClutter() {
        var selectors = [
            '.battle-pass-fab',
            '.cashback-widget',
            '.milestone-widget',
            '.quickfire-strip',
            '#engagementOverlay',
            '.promo-popup',
            '#tourney-notif',
            '#achievementFloater'
        ];

        for (var i = 0; i < selectors.length; i++) {
            var els = document.querySelectorAll(selectors[i]);
            for (var j = 0; j < els.length; j++) {
                els[j].setAttribute('data-gui-suppressed', 'true');
                els[j].style.display = 'none';
            }
        }

        var badges = document.querySelectorAll('.stat-badge-floating, .lobby-stat-badge');
        for (var b = 0; b < badges.length; b++) {
            badges[b].classList.add('gui-suppressed');
        }

        var toasts = document.querySelectorAll('.toast, .notification');
        for (var k = 0; k < toasts.length; k++) {
            if (k > 0) toasts[k].style.display = 'none';
        }
    }

    function restoreClutter() {
        var suppressed = document.querySelectorAll('[data-gui-suppressed="true"]');
        for (var i = 0; i < suppressed.length; i++) {
            suppressed[i].style.display = '';
            suppressed[i].removeAttribute('data-gui-suppressed');
        }
        var guiSuppressed = document.querySelectorAll('.gui-suppressed');
        for (var j = 0; j < guiSuppressed.length; j++) {
            guiSuppressed[j].classList.remove('gui-suppressed');
        }
        var toasts = document.querySelectorAll('.toast, .notification');
        for (var k = 0; k < toasts.length; k++) {
            toasts[k].style.display = '';
        }
    }

    // ── Main Apply Function ───────────────────────────────────────────────

    function apply(modal, game) {
        if (!modal || !game) return;

        var gid = game.id || 'unknown';
        modal.setAttribute('data-gui-game', gid);

        // Remove old style
        var old = document.getElementById('gui-skin-style');
        if (old) old.parentNode.removeChild(old);

        // Build and inject unique per-game CSS
        var style = document.createElement('style');
        style.id = 'gui-skin-style';
        style.textContent = buildGameCSS(game);
        document.head.appendChild(style);

        // Preload HD assets in background (non-blocking)
        var assetTypes = ['reel_frame', 'spin_btn', 'top_bar', 'bottom_bar', 'panel_bg'];
        for (var i = 0; i < assetTypes.length; i++) {
            var urls = getAssetURL(gid, assetTypes[i]);
            probeImage(urls.webp, function(){});
            probeImage(urls.png, function(){});
        }
    }

    // ── Public API ────────────────────────────────────────────────────────

    window.SlotGUIEngine = {
        apply: apply,
        suppressClutter: suppressClutter,
        restoreClutter: restoreClutter,
        deriveGamePalette: deriveGamePalette
    };
})();
