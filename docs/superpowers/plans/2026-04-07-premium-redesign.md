# Premium Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan.

**Goal:** Transform Matrix Spins Casino into a premium, industry-standard online slots platform competing with Stake, Ignition, and BetOnline.

**Architecture:** Token-first CSS redesign — extend existing `premium-redesign.css` into authoritative `design-tokens.css`, rebuild layout shell (header + collapsible rail + mobile bottom nav), replace game cards with info-rich 16:10 design, polish all modals.

**Tech Stack:** Vanilla JS, CSS custom properties, Lucide SVG icons, canvas-confetti, crypto.getRandomValues(), Playwright QA

**Spec:** `docs/superpowers/specs/2026-04-07-premium-redesign-design.md`

---

## Chunk 1: Token Foundation + Production Cleanup

### Task 1.1: Create `design-tokens.css`

**Files:**
- Create: `design-tokens.css`
- Modify: `index.html` (load order — add design-tokens.css as FIRST stylesheet)

- [ ] Read `premium-redesign.css` fully — it has existing `--ms-*` tokens we extend
- [ ] Create `design-tokens.css` with ALL tokens:

```css
/* design-tokens.css — AUTHORITATIVE TOKEN SOURCE
   Loaded first. All components use var() references from here.
   NEVER put component rules here — tokens only. */

:root {
  /* ── Surfaces (layered charcoal, no pure black) ── */
  --surface-base:     #0D0F14;
  --surface-raised:   #141720;
  --surface-high:     #1A1E28;
  --surface-overlay:  #1E2230;
  --surface-glass:    rgba(13,15,20,0.82);
  --surface-tinted:   rgba(0,255,65,0.07);
  --surface-card:     #1C1F2A;
  --surface-hover:    #252838;

  /* ── Brand Green (primary CTA) ── */
  --green-brand:        #00ff41;
  --green-hover:        #00cc34;
  --green-dim:          rgba(0,255,65,0.55);
  --green-subtle:       rgba(0,255,65,0.08);
  --green-border:       rgba(0,255,65,0.22);
  --glow-green-sm:      0 0 6px  rgba(0,255,65,0.15);
  --glow-green-md:      0 0 14px rgba(0,255,65,0.30);
  --glow-green-lg:      0 0 24px rgba(0,255,65,0.45);

  /* ── Gold / VIP / Premium ── */
  --gold:           #F0A500;
  --gold-light:     #FFD166;
  --gold-deep:      #A07010;
  --gold-dim:       rgba(240,165,0,0.15);
  --gold-border:    rgba(240,165,0,0.35);
  --glow-gold-sm:   0 0 8px  rgba(240,165,0,0.25);
  --glow-gold-md:   0 0 20px rgba(240,165,0,0.40);

  /* ── Semantic accents ── */
  --accent-hot:         #ef4444;
  --accent-new:         #8b5cf6;
  --accent-jackpot:     #f59e0b;        /* solid amber — safe for color/border */
  --accent-info:        #00d4ff;
  --accent-success:     #10b981;
  --accent-danger:      #ef4444;
  --accent-cyan:        #00D4FF;
  --accent-violet:      #8B5CF6;

  /* ── Text ── */
  --text-primary:   #E8E8ED;
  --text-secondary: #9CA3AF;
  --text-muted:     #6B7280;
  --text-brand:     var(--green-brand);
  --text-gold:      var(--gold);
  --text-inverse:   #0D0F14;

  /* ── Provider studio accents ── */
  --studio-goldenreels:  #D4A017;
  --studio-nebula:       #00F0FF;
  --studio-mythicforge:  #C8A415;
  --studio-wildfrontier: #CC5500;
  --studio-shadowworks:  #8B0000;
  --studio-dragonpearl:  #CC0000;
  --studio-ironclad:     #B5651D;
  --studio-cascadelabs:  #0066FF;

  /* ── Spacing (4px base) ── */
  --sp-1: 4px;   --sp-2: 8px;   --sp-3: 12px;
  --sp-4: 16px;  --sp-5: 20px;  --sp-6: 24px;
  --sp-8: 32px;  --sp-10: 40px; --sp-12: 48px;
  --sp-16: 64px;

  /* ── Border radius ── */
  --r-sm:   4px;
  --r-md:   8px;
  --r-lg:   12px;
  --r-xl:   16px;
  --r-2xl:  24px;
  --r-pill: 9999px;

  /* ── Elevation shadows ── */
  --shadow-xs:    0 1px 3px  rgba(0,0,0,0.40);
  --shadow-sm:    0 2px 8px  rgba(0,0,0,0.50);
  --shadow-card:  0 4px 24px rgba(0,0,0,0.60);
  --shadow-modal: 0 24px 64px rgba(0,0,0,0.80);

  /* ── Transitions ── */
  --t-fast:   120ms ease-out;
  --t-base:   200ms ease-out;
  --t-move:   300ms cubic-bezier(0.34, 1.56, 0.64, 1);
  --t-modal:  280ms cubic-bezier(0.16, 1, 0.3, 1);
  --t-slide:  350ms cubic-bezier(0.16, 1, 0.3, 1);

  /* ── Layout constants ── */
  --header-h:      56px;
  --trust-bar-h:   36px;
  --rail-w:        64px;
  --rail-w-open:   220px;
  --mobile-nav-h:  60px;
  --content-max:   1600px;

  /* ── Z-index budget ── */
  --z-base:       1;
  --z-card-hover: 10;
  --z-rail:       50;
  --z-header:     100;
  --z-trust-bar:  101;
  --z-dropdown:   200;
  --z-toast:      500;
  --z-modal:      1000;
  --z-slot-modal: 1100;
  /* existing system overlays: 9000–99999 — do not change */

  /* ── Typography ── */
  --font-base:    'Inter', 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-display: 'Clash Display', 'Satoshi', 'Inter', sans-serif;
  --font-mono:    'JetBrains Mono', 'Fira Code', monospace;

  --text-xs:   11px;
  --text-sm:   13px;
  --text-base: 15px;
  --text-lg:   18px;
  --text-xl:   22px;
  --text-2xl:  28px;
  --text-3xl:  36px;
  --text-4xl:  48px;
}
```

- [ ] In `index.html`, add `<link rel="stylesheet" href="design-tokens.css">` as the **very first** `<link rel="stylesheet">` tag (before popup-nuke.css)
- [ ] Remove the inline `:root { --ms-* }` block from `premium-redesign.css` (tokens now live in design-tokens.css). Keep all component rules in premium-redesign.css.
- [ ] Run `npm run qa:regression` → must pass
- [ ] Commit: `git add design-tokens.css index.html premium-redesign.css && git commit -m "feat: add design-tokens.css as authoritative token foundation"`

---

### Task 1.2: Fix Math.random() violations in social-proof.js

**Files:**
- Modify: `js/social-proof.js`

CLAUDE.md Rule #7: No `Math.random()` on server side. Although this is client-side, fix for consistency and future server-render safety.

- [ ] Replace all `Math.random()` calls with crypto-based equivalents:

```js
// Add at top of IIFE:
function cryptoRandom() {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 0xFFFFFFFF;
}
function cryptoRandInt(min, max) {
  return Math.floor(cryptoRandom() * (max - min + 1)) + min;
}
```

- [ ] Replace `Math.floor(Math.random() * arr.length)` → `Math.floor(cryptoRandom() * arr.length)`
- [ ] Replace `(Math.random() * 490 + 10).toFixed(2)` → `(cryptoRandom() * 490 + 10).toFixed(2)`
- [ ] Replace `30000 + Math.random() * 60000` → `30000 + cryptoRandom() * 60000`
- [ ] Run `npm run qa:regression` → must pass
- [ ] Commit: `git add js/social-proof.js && git commit -m "fix: replace Math.random with crypto.getRandomValues in social-proof.js"`

---

### Task 1.3: Fix wagering multiplier fallback (revenue protection)

**Files:**
- Modify: `js/ui-wallet.js` (~line 3012)

- [ ] Search for `|| 20` near `wageringMult` in `ui-wallet.js`
- [ ] Change fallback from `|| 20` to `|| 30` to match server-side depositmatch.routes.js constant
- [ ] Commit: `git add js/ui-wallet.js && git commit -m "fix: correct deposit match wagering multiplier fallback 20→30"`

---

### Task 1.4: Gate QA/debug tools behind dev mode

**Files:**
- Modify: `js/qa-tools.js`
- Modify: `index.html` (script tag for qa-tools.js)

- [ ] In `index.html`, wrap qa-tools.js script tag:
```html
<!-- QA tools: dev only -->
<script>
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.search.includes('devtools=ms2026')) {
  var s = document.createElement('script'); s.src = 'js/qa-tools.js'; document.head.appendChild(s);
}
</script>
```
- [ ] Remove direct `<script src="js/qa-tools.js">` tag if it exists
- [ ] Run `npm run qa:regression` → must pass
- [ ] Commit: `git add index.html && git commit -m "feat: gate qa-tools.js behind localhost/devtools param only"`

---

### Task 1.5: Update manifest.json theme colors

**Files:**
- Modify: `manifest.json`

- [ ] Change `"background_color": "#0a0a1a"` → `"background_color": "#0D0F14"`
- [ ] Change `"theme_color": "#f59e0b"` → `"theme_color": "#0D0F14"`
- [ ] Update icon paths: ensure `"src": "/assets/icons/icon-192.png"` entries added (create placeholder PNGs from favicon.svg if needed)
- [ ] Run `npm run qa:regression` → must pass
- [ ] Commit: `git add manifest.json && git commit -m "feat: update PWA manifest theme colors to premium charcoal"`

---

## Chunk 2: Layout Shell — Header + Trust Bar + Rail

### Task 2.1: Premium header redesign

**Files:**
- Modify: `index.html` (header section, ~lines 155–220)
- Create: `layout-shell.css`

- [ ] Create `layout-shell.css` with header styles:

```css
/* ── HEADER ── */
#casinoHeader, .casino-header {
  position: sticky;
  top: 0;
  z-index: var(--z-header);
  height: var(--header-h);
  background: var(--surface-glass);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--green-border);
  display: flex;
  align-items: center;
  padding: 0 var(--sp-6);
  gap: var(--sp-4);
  font-family: var(--font-base);
}

/* Logo */
.header-logo {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  text-decoration: none;
  flex-shrink: 0;
  width: 140px;
}
.header-logo-mark {
  width: 32px; height: 32px;
  background: var(--green-subtle);
  border: 1.5px solid var(--green-border);
  border-radius: var(--r-md);
  display: flex; align-items: center; justify-content: center;
  color: var(--green-brand);
  font-weight: 900; font-size: 13px;
  box-shadow: var(--glow-green-sm);
}
.header-logo-text {
  color: var(--green-brand);
  font-size: 12px; font-weight: 700;
  letter-spacing: 2px; text-transform: uppercase;
  font-family: var(--font-display);
}

/* Search */
.header-search {
  flex: 1;
  max-width: 400px;
  position: relative;
}
.header-search input {
  width: 100%;
  background: var(--surface-raised);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: var(--r-pill);
  padding: 8px 16px 8px 40px;
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-family: var(--font-base);
  transition: border-color var(--t-base), box-shadow var(--t-base);
  outline: none;
}
.header-search input:focus {
  border-color: var(--green-border);
  box-shadow: var(--glow-green-sm);
}
.header-search-icon {
  position: absolute; left: 14px; top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  pointer-events: none;
}

/* Balance */
.header-balance {
  display: flex; flex-direction: column; align-items: flex-end;
  cursor: pointer;
  gap: 2px;
}
.header-balance-amount {
  color: var(--gold);
  font-size: var(--text-lg);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.header-balance-label {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

/* Cashier CTA */
.header-cashier-btn {
  background: var(--green-brand);
  color: var(--text-inverse);
  border: none;
  border-radius: var(--r-md);
  padding: 10px 20px;
  font-size: var(--text-sm);
  font-weight: 700;
  letter-spacing: 0.5px;
  cursor: pointer;
  transition: background var(--t-fast), transform var(--t-fast), box-shadow var(--t-fast);
  flex-shrink: 0;
}
.header-cashier-btn:hover {
  background: var(--green-hover);
  transform: scale(1.02);
  box-shadow: var(--glow-green-md);
}
.header-cashier-btn:active { transform: scale(0.97); }

/* Avatar */
.header-avatar {
  width: 32px; height: 32px;
  border-radius: var(--r-pill);
  background: var(--surface-high);
  border: 1.5px solid rgba(255,255,255,0.12);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  font-size: 13px; font-weight: 700; color: var(--text-secondary);
  transition: border-color var(--t-fast);
}
.header-avatar:hover { border-color: var(--green-border); }
```

- [ ] In `index.html`, add `<link rel="stylesheet" href="layout-shell.css">` after `design-tokens.css`
- [ ] Update header HTML: replace emoji icons with Lucide SVG inline icons (search = magnifying glass SVG, sound = speaker SVG, settings = gear SVG)
- [ ] Run `npm run qa:regression` → must pass
- [ ] Commit: `git add layout-shell.css index.html && git commit -m "feat: premium header with glass morphism and token system"`

---

### Task 2.2: Trust bar (sticky below header)

**Files:**
- Modify: `layout-shell.css` (append)
- Modify: `index.html` (add trust bar HTML after header)

- [ ] Add trust bar HTML in `index.html` immediately after the closing `</header>` tag:

```html
<div class="trust-bar" id="trustBar">
  <div class="trust-bar-inner">
    <span class="trust-item">
      <svg class="trust-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      SSL Secured
    </span>
    <span class="trust-sep">·</span>
    <span class="trust-item">
      <svg class="trust-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      Provably Fair
    </span>
    <span class="trust-sep">·</span>
    <span class="trust-item">
      <svg class="trust-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      Licensed
    </span>
    <span class="trust-sep">·</span>
    <span class="trust-item trust-online" id="trustOnlineCount">
      <span class="trust-dot"></span>
      <span id="onlineCountDisplay">1,247</span> players online
    </span>
  </div>
</div>
```

- [ ] Add to `layout-shell.css`:

```css
/* ── TRUST BAR ── */
.trust-bar {
  position: sticky;
  top: var(--header-h);
  z-index: var(--z-trust-bar);
  height: var(--trust-bar-h);
  background: rgba(0,0,0,0.5);
  border-bottom: 1px solid rgba(255,255,255,0.05);
  display: flex;
  align-items: center;
  justify-content: center;
}
.trust-bar-inner {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
}
.trust-item {
  display: flex; align-items: center; gap: 6px;
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: 500;
  letter-spacing: 0.4px;
}
.trust-icon { opacity: 0.6; }
.trust-sep { color: rgba(255,255,255,0.12); font-size: 10px; }
.trust-dot {
  width: 6px; height: 6px;
  border-radius: var(--r-pill);
  background: var(--accent-success);
  box-shadow: 0 0 6px var(--accent-success);
  animation: pulse-dot 2s ease-in-out infinite;
}
@keyframes pulse-dot {
  0%,100% { opacity: 1; } 50% { opacity: 0.5; }
}
@media (max-width: 600px) {
  .trust-sep, .trust-item:not(.trust-online) { display: none; }
}
```

- [ ] In `js/app.js`, add online count simulation with crypto:
```js
function initOnlineCount() {
  var el = document.getElementById('onlineCountDisplay');
  if (!el) return;
  function rand(min, max) {
    return min + Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] / 0xFFFFFFFF * (max - min));
  }
  var count = rand(900, 1800);
  el.textContent = count.toLocaleString();
  setInterval(function() {
    count += rand(-15, 20);
    count = Math.max(800, Math.min(2400, count));
    el.textContent = count.toLocaleString();
  }, 8000);
}
```
- [ ] Call `initOnlineCount()` from app init
- [ ] Run `npm run qa:regression` → must pass
- [ ] Commit: `git add layout-shell.css index.html js/app.js && git commit -m "feat: sticky trust bar with SSL/Provably Fair/Licensed signals"`

---

### Task 2.3: Collapsible left rail (replaces sidebar)

**Files:**
- Modify: `layout-shell.css`
- Modify: `index.html` (sidebar section → rail section)
- Modify: `js/ui-lobby.js` (toggleSidebar → toggleRail)

- [ ] Add rail CSS to `layout-shell.css`:

```css
/* ── LEFT RAIL ── */
#casinoRail {
  position: fixed;
  top: calc(var(--header-h) + var(--trust-bar-h));
  left: 0;
  width: var(--rail-w);
  height: calc(100dvh - var(--header-h) - var(--trust-bar-h));
  background: var(--surface-raised);
  border-right: 1px solid rgba(255,255,255,0.06);
  z-index: var(--z-rail);
  overflow: hidden;
  transition: width var(--t-slide);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  scrollbar-width: none;
}
#casinoRail::-webkit-scrollbar { display: none; }
#casinoRail.rail-open { width: var(--rail-w-open); }

/* Rail nav item */
.rail-item {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: 10px 20px;
  color: var(--text-muted);
  text-decoration: none;
  cursor: pointer;
  border-radius: 0;
  transition: background var(--t-fast), color var(--t-fast);
  white-space: nowrap;
  font-size: var(--text-sm);
  font-weight: 500;
  user-select: none;
  border: none; background: none; width: 100%; text-align: left;
}
.rail-item:hover { background: var(--surface-tinted); color: var(--text-primary); }
.rail-item.active {
  color: var(--green-brand);
  background: var(--green-subtle);
}
.rail-item.active .rail-icon { filter: drop-shadow(0 0 4px var(--green-brand)); }
.rail-icon { width: 18px; height: 18px; flex-shrink: 0; }
.rail-label { opacity: 0; transition: opacity var(--t-base); pointer-events: none; }
#casinoRail.rail-open .rail-label { opacity: 1; }

.rail-section-title {
  padding: 16px 20px 4px;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  white-space: nowrap;
  opacity: 0;
  transition: opacity var(--t-base);
}
#casinoRail.rail-open .rail-section-title { opacity: 1; }

.rail-divider {
  height: 1px;
  background: rgba(255,255,255,0.06);
  margin: var(--sp-2) var(--sp-3);
}

/* Studio dot */
.rail-studio-dot {
  width: 8px; height: 8px;
  border-radius: var(--r-pill);
  flex-shrink: 0;
}

/* Main content offset */
#mainContent {
  margin-left: var(--rail-w);
  transition: margin-left var(--t-slide);
  max-width: calc(var(--content-max) + var(--rail-w));
  padding: var(--sp-6);
  padding-bottom: calc(var(--sp-6) + var(--mobile-nav-h));
}
body.rail-expanded #mainContent { margin-left: var(--rail-w-open); }

/* Desktop hover expand */
@media (min-width: 1440px) {
  #casinoRail:hover { width: var(--rail-w-open); }
  #casinoRail:hover .rail-label,
  #casinoRail:hover .rail-section-title { opacity: 1; }
}

/* Mobile: hide rail, show bottom nav */
@media (max-width: 768px) {
  #casinoRail { display: none; }
  #mainContent { margin-left: 0; padding-bottom: calc(var(--sp-6) + var(--mobile-nav-h)); }
}
```

- [ ] In `index.html`, replace `<aside class="casino-sidebar" id="casinoSidebar">` with new rail HTML:

```html
<nav id="casinoRail" aria-label="Main navigation" role="navigation">
  <!-- Category filters -->
  <div class="rail-section-title">Games</div>
  <button class="rail-item active" data-filter="all" onclick="setFilter('all')">
    <svg class="rail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
    <span class="rail-label">All Games</span>
  </button>
  <button class="rail-item" data-filter="hot" onclick="setFilter('hot')">
    <svg class="rail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2c0 6-6 8-6 14a6 6 0 0 0 12 0c0-6-6-8-6-14z"/></svg>
    <span class="rail-label">Hot</span>
  </button>
  <button class="rail-item" data-filter="new" onclick="setFilter('new')">
    <svg class="rail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
    <span class="rail-label">New</span>
  </button>
  <button class="rail-item" data-filter="jackpot" onclick="setFilter('jackpot')">
    <svg class="rail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
    <span class="rail-label">Jackpot</span>
  </button>
  <button class="rail-item" data-filter="favourites" onclick="setFilter('favourites')">
    <svg class="rail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
    <span class="rail-label">Favourites</span>
  </button>

  <div class="rail-divider"></div>

  <!-- Studios -->
  <div class="rail-section-title">Studios</div>
  <button class="rail-item" data-studio="goldenreels" onclick="setStudioFilter('goldenreels')">
    <span class="rail-studio-dot" style="background:var(--studio-goldenreels)"></span>
    <span class="rail-label">Golden Reels</span>
  </button>
  <button class="rail-item" data-studio="nebula" onclick="setStudioFilter('nebula')">
    <span class="rail-studio-dot" style="background:var(--studio-nebula)"></span>
    <span class="rail-label">Nebula Gaming</span>
  </button>
  <button class="rail-item" data-studio="mythicforge" onclick="setStudioFilter('mythicforge')">
    <span class="rail-studio-dot" style="background:var(--studio-mythicforge)"></span>
    <span class="rail-label">Mythic Forge</span>
  </button>
  <button class="rail-item" data-studio="wildfrontier" onclick="setStudioFilter('wildfrontier')">
    <span class="rail-studio-dot" style="background:var(--studio-wildfrontier)"></span>
    <span class="rail-label">Wild Frontier</span>
  </button>
  <button class="rail-item" data-studio="shadowworks" onclick="setStudioFilter('shadowworks')">
    <span class="rail-studio-dot" style="background:var(--studio-shadowworks)"></span>
    <span class="rail-label">Shadow Works</span>
  </button>
  <button class="rail-item" data-studio="dragonpearl" onclick="setStudioFilter('dragonpearl')">
    <span class="rail-studio-dot" style="background:var(--studio-dragonpearl)"></span>
    <span class="rail-label">Dragon Pearl</span>
  </button>
  <button class="rail-item" data-studio="ironclad" onclick="setStudioFilter('ironclad')">
    <span class="rail-studio-dot" style="background:var(--studio-ironclad)"></span>
    <span class="rail-label">Ironclad</span>
  </button>
  <button class="rail-item" data-studio="cascadelabs" onclick="setStudioFilter('cascadelabs')">
    <span class="rail-studio-dot" style="background:var(--studio-cascadelabs)"></span>
    <span class="rail-label">Cascade Labs</span>
  </button>

  <div class="rail-divider"></div>

  <!-- Account -->
  <div class="rail-section-title">Account</div>
  <button class="rail-item" onclick="openModal('wallet')">
    <svg class="rail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M16 10a2 2 0 0 1 0 4"/></svg>
    <span class="rail-label">Cashier</span>
  </button>
  <button class="rail-item" onclick="openModal('bonusWheel')">
    <svg class="rail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
    <span class="rail-label">Daily Wheel</span>
  </button>
</nav>
```

- [ ] Remove old `#casinoSidebar`, `#csbHamburgerBtn`, `#csbCloseBtn`, `#csbOverlay` elements from HTML
- [ ] In `js/ui-lobby.js`, add `toggleRail()` function and update all `toggleSidebar` references
- [ ] Run `npm run qa:regression` → must pass
- [ ] Commit: `git add layout-shell.css index.html js/ui-lobby.js && git commit -m "feat: replace sidebar with collapsible icon rail, add studio filters"`

---

### Task 2.4: Mobile bottom navigation

**Files:**
- Modify: `layout-shell.css`
- Modify: `index.html`

- [ ] Add to `index.html` before `</body>`:

```html
<nav class="mobile-bottom-nav" id="mobileBottomNav" aria-label="Mobile navigation">
  <button class="mbn-item active" onclick="setFilter('all')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
    <span>Lobby</span>
  </button>
  <button class="mbn-item" onclick="document.getElementById('gameSearchInput')?.focus()">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
    <span>Search</span>
  </button>
  <button class="mbn-item mbn-deposit" onclick="openModal('wallet')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    <span>Deposit</span>
  </button>
  <button class="mbn-item" onclick="openModal('bonusWheel')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
    <span>Bonuses</span>
  </button>
  <button class="mbn-item" onclick="openModal('profile')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
    <span>Profile</span>
  </button>
</nav>
```

- [ ] Add CSS to `layout-shell.css`:

```css
/* ── MOBILE BOTTOM NAV ── */
.mobile-bottom-nav {
  display: none;
  position: fixed;
  bottom: 0; left: 0; right: 0;
  height: var(--mobile-nav-h);
  background: var(--surface-overlay);
  border-top: 1px solid rgba(255,255,255,0.08);
  z-index: var(--z-header);
  padding-bottom: env(safe-area-inset-bottom);
}
.mbn-item {
  flex: 1;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 4px;
  background: none; border: none;
  color: var(--text-muted);
  font-size: 10px; font-weight: 500;
  cursor: pointer;
  transition: color var(--t-fast);
  min-height: 48px;
}
.mbn-item.active, .mbn-item:hover { color: var(--green-brand); }
.mbn-item.active svg { filter: drop-shadow(0 0 4px var(--green-brand)); }
.mbn-deposit {
  background: var(--green-subtle);
  border-radius: var(--r-lg);
  margin: 6px 4px;
  color: var(--green-brand);
}
@media (max-width: 768px) {
  .mobile-bottom-nav { display: flex; }
}
```

- [ ] Run `npm run qa:regression` → must pass
- [ ] Commit: `git add layout-shell.css index.html && git commit -m "feat: mobile bottom nav with 5 tabs and 48px tap targets"`

---

## Chunk 3: Game Cards + Social Proof Bar

### Task 3.1: Info-rich game card component

**Files:**
- Create: `game-cards.css`
- Modify: `js/ui-lobby.js` (card render function)
- Modify: `index.html` (add game-cards.css link)

- [ ] Create `game-cards.css`:

```css
/* game-cards.css — Info-rich 16:10 game card component */

/* ── GAME ROW SECTION ── */
.game-section {
  margin-bottom: var(--sp-8);
  content-visibility: auto;
  contain-intrinsic-size: auto 400px;
}
/* IMPORTANT: social proof bar EXCLUDED from content-visibility */
#socialProofBar, .jackpot-pills-bar { content-visibility: visible !important; }

.game-section-header {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  margin-bottom: var(--sp-4);
  padding-bottom: var(--sp-3);
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.game-section-title {
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--text-primary);
  flex: 1;
}
.game-section-icon { color: var(--text-muted); width: 18px; height: 18px; }
.game-section-viewall {
  color: var(--text-brand);
  font-size: var(--text-sm);
  font-weight: 500;
  text-decoration: none;
  transition: opacity var(--t-fast);
  cursor: pointer;
  background: none; border: none;
}
.game-section-viewall:hover { opacity: 0.7; }

/* ── GAME GRID ── */
.game-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: var(--sp-3);
}
@media (max-width: 1200px) { .game-grid { grid-template-columns: repeat(4, 1fr); } }
@media (max-width: 768px)  { .game-grid { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 480px)  { .game-grid { grid-template-columns: repeat(2, 1fr); } }

/* ── GAME CARD ── */
.game-card {
  background: var(--surface-card);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: var(--r-lg);
  overflow: hidden;
  cursor: pointer;
  transition: transform var(--t-move), box-shadow var(--t-move), border-color var(--t-base);
  position: relative;
}
.game-card:hover {
  transform: scale(1.03);
  box-shadow: var(--glow-green-md);
  border-color: rgba(0,255,65,0.4);
  z-index: var(--z-card-hover);
}
.game-card:active { transform: scale(0.99); }

/* Art area: 16:10 aspect ratio */
.game-card-art {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  background: var(--surface-high);
}
.game-card-art img {
  width: 100%; height: 100%;
  object-fit: cover;
  display: block;
  transition: transform var(--t-move);
}
.game-card:hover .game-card-art img { transform: scale(1.06); }

/* Tag badge */
.game-tag {
  position: absolute;
  top: var(--sp-2); left: var(--sp-2);
  padding: 2px 7px;
  border-radius: var(--r-sm);
  font-size: 10px; font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  pointer-events: none;
  z-index: 2;
}
.game-tag-hot     { background: var(--accent-hot);     color: #fff; }
.game-tag-new     { background: var(--accent-new);     color: #fff; }
.game-tag-jackpot { background: var(--accent-jackpot); color: #000; }
.game-tag-mega    { background: linear-gradient(135deg, #a855f7, #ec4899); color: #fff; }

/* Live count badge */
.game-live-count {
  position: absolute;
  top: var(--sp-2); right: var(--sp-2);
  display: flex; align-items: center; gap: 4px;
  background: rgba(0,0,0,0.65);
  backdrop-filter: blur(4px);
  padding: 2px 7px;
  border-radius: var(--r-pill);
  font-size: 10px; color: var(--text-secondary);
  z-index: 2;
}
.game-live-dot {
  width: 5px; height: 5px;
  border-radius: var(--r-pill);
  background: var(--accent-success);
}

/* Hover play overlay */
.game-card-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.7);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  opacity: 0;
  transition: opacity var(--t-base);
  z-index: 3;
}
.game-card:hover .game-card-overlay { opacity: 1; }
.game-overlay-play {
  background: var(--green-brand);
  color: var(--text-inverse);
  border: none;
  border-radius: var(--r-md);
  padding: 10px 24px;
  font-size: var(--text-sm); font-weight: 700;
  cursor: pointer;
  transition: background var(--t-fast), transform var(--t-fast);
  font-family: var(--font-base);
}
.game-overlay-play:hover { background: var(--green-hover); transform: scale(1.04); }
.game-overlay-demo {
  color: var(--text-secondary);
  font-size: var(--text-xs);
  background: none; border: none; cursor: pointer;
  text-decoration: underline;
  font-family: var(--font-base);
}

/* Info strip */
.game-card-info {
  padding: var(--sp-3) var(--sp-3) var(--sp-3);
  background: var(--surface-card);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.game-card-name {
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
}
.game-card-studio {
  font-size: var(--text-xs);
  font-weight: 500;
  display: flex; align-items: center; gap: 5px;
}
.game-card-studio-dot {
  width: 6px; height: 6px;
  border-radius: var(--r-pill);
  flex-shrink: 0;
}
.game-card-chips {
  display: flex; gap: 4px; flex-wrap: wrap;
  margin-top: 2px;
}
.game-chip {
  padding: 2px 6px;
  border-radius: var(--r-sm);
  font-size: 10px; font-weight: 600;
  border: 1px solid rgba(255,255,255,0.10);
  background: var(--surface-high);
  color: var(--text-muted);
  white-space: nowrap;
}
.game-chip-rtp { color: var(--gold); border-color: var(--gold-border); background: var(--gold-dim); }
.game-chip-maxwin { color: var(--accent-info); border-color: rgba(0,212,255,0.25); }

/* Jackpot card: gold border treatment */
.game-card.is-jackpot {
  border-color: var(--gold-border);
  box-shadow: var(--glow-gold-sm);
}
.game-card.is-jackpot:hover {
  border-color: var(--gold);
  box-shadow: var(--glow-gold-md);
}

/* ── SKELETON CARD ── */
.game-card-skeleton {
  background: var(--surface-raised);
  border: 1px solid rgba(255,255,255,0.04);
  border-radius: var(--r-lg);
  overflow: hidden;
}
.game-card-skeleton-art {
  aspect-ratio: 16 / 10;
  background: linear-gradient(90deg, var(--surface-raised) 25%, var(--surface-high) 50%, var(--surface-raised) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}
.game-card-skeleton-info {
  padding: var(--sp-3);
  display: flex; flex-direction: column; gap: 6px;
}
.game-card-skeleton-line {
  height: 10px; border-radius: var(--r-sm);
  background: linear-gradient(90deg, var(--surface-raised) 25%, var(--surface-high) 50%, var(--surface-raised) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}
.game-card-skeleton-line.short { width: 60%; }
@keyframes shimmer {
  from { background-position: 200% 0; }
  to   { background-position: -200% 0; }
}

@media (prefers-reduced-motion: reduce) {
  .game-card { transition: none; }
  .game-card-skeleton-art,
  .game-card-skeleton-line { animation: none; }
}
```

- [ ] In `js/ui-lobby.js`, update `createGameCard()` function to use new markup:

```js
function createGameCard(game) {
  var studioKey = (game.provider || '').toLowerCase().replace(/\s+/g, '');
  var studioColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--studio-' + studioKey).trim() || '#888';
  var tag = game.tag || '';
  var tagHtml = tag ? '<span class="game-tag game-tag-' + tag.toLowerCase() + '">' + tag + '</span>' : '';
  var isJackpot = game.jackpot > 0;
  var maxWin = game.payouts && game.payouts.maxMultiplier ? game.payouts.maxMultiplier + '×' : '';

  return '<div class="game-card' + (isJackpot ? ' is-jackpot' : '') + '" data-game-id="' + game.id + '" onclick="openSlot(\'' + game.id + '\')">'
    + '<div class="game-card-art">'
    + '<img src="' + (game.thumbnail || 'assets/thumbnails/' + game.id + '.png') + '"'
    + ' alt="' + game.name + '" loading="lazy" decoding="async" width="320" height="200"'
    + ' onerror="this.style.display=\'none\'">'
    + tagHtml
    + '<span class="game-live-count"><span class="game-live-dot"></span><span class="live-num">0</span></span>'
    + '<div class="game-card-overlay">'
    + '<button class="game-overlay-play" onclick="event.stopPropagation();openSlot(\'' + game.id + '\')">▶ PLAY</button>'
    + '<button class="game-overlay-demo" onclick="event.stopPropagation();openSlotDemo(\'' + game.id + '\')">Try Demo</button>'
    + '</div></div>'
    + '<div class="game-card-info">'
    + '<div class="game-card-name">' + game.name + '</div>'
    + '<div class="game-card-studio" style="color:' + studioColor + '">'
    + '<span class="game-card-studio-dot" style="background:' + studioColor + '"></span>'
    + (game.provider || '') + '</div>'
    + '<div class="game-card-chips">'
    + (game.rtp ? '<span class="game-chip game-chip-rtp">' + game.rtp + '% RTP</span>' : '')
    + (maxWin ? '<span class="game-chip game-chip-maxwin">' + maxWin + '</span>' : '')
    + (game.bonusType ? '<span class="game-chip">' + game.bonusType.replace(/_/g,' ').toUpperCase() + '</span>' : '')
    + '</div></div></div>';
}
```

- [ ] Add `<link rel="stylesheet" href="game-cards.css">` to `index.html`
- [ ] Run `npm run qa:regression` → must pass
- [ ] Commit: `git add game-cards.css js/ui-lobby.js index.html && git commit -m "feat: info-rich 16:10 game cards with RTP chips, skeleton loader, hover overlay"`

---

### Task 3.2: Social proof bar + jackpot pills

**Files:**
- Create: `social-proof.css`
- Modify: `index.html` (add social proof bar HTML after trust bar)
- Modify: `js/social-proof.js` (add scrolling ticker + jackpot pills)

- [ ] Add to `index.html` after `#trustBar`:

```html
<div id="socialProofBar" class="social-proof-bar">
  <div class="jackpot-pills">
    <span class="jackpot-pill jackpot-grand">
      <span class="jp-label">GRAND</span>
      <span class="jp-amount" id="jpGrand">$124,891</span>
    </span>
    <span class="jackpot-pill jackpot-major">
      <span class="jp-label">MAJOR</span>
      <span class="jp-amount" id="jpMajor">$12,440</span>
    </span>
    <span class="jackpot-pill jackpot-minor">
      <span class="jp-label">MINOR</span>
      <span class="jp-amount" id="jpMinor">$1,892</span>
    </span>
    <span class="jackpot-pill jackpot-mini">
      <span class="jp-label">MINI</span>
      <span class="jp-amount" id="jpMini">$248</span>
    </span>
  </div>
  <div class="wins-ticker-wrap">
    <span class="wins-ticker-label">LIVE WINS</span>
    <div class="wins-ticker" id="winsTicker">
      <div class="wins-ticker-track" id="winsTickerTrack"></div>
    </div>
  </div>
</div>
```

- [ ] Create `social-proof.css`:

```css
.social-proof-bar {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  padding: var(--sp-2) var(--sp-6);
  background: var(--surface-raised);
  border-bottom: 1px solid rgba(255,255,255,0.05);
  overflow: hidden;
  content-visibility: visible !important;
}
.jackpot-pills { display: flex; gap: var(--sp-2); flex-shrink: 0; }
.jackpot-pill {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 10px;
  border-radius: var(--r-pill);
  font-size: 11px; font-weight: 700;
  cursor: pointer;
  transition: transform var(--t-fast);
}
.jackpot-pill:hover { transform: scale(1.04); }
.jackpot-grand { background: var(--gold-dim); border: 1px solid var(--gold-border); color: var(--gold-light); box-shadow: var(--glow-gold-sm); }
.jackpot-major { background: rgba(240,165,0,0.08); border: 1px solid rgba(240,165,0,0.20); color: var(--gold); }
.jackpot-minor { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); color: var(--text-secondary); }
.jackpot-mini  { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); color: var(--text-muted); }
.jp-label { font-size: 9px; opacity: 0.7; letter-spacing: 0.5px; }
.jp-amount { font-variant-numeric: tabular-nums; }

.wins-ticker-wrap {
  flex: 1; display: flex; align-items: center; gap: var(--sp-3); overflow: hidden;
}
.wins-ticker-label {
  font-size: 9px; font-weight: 700; letter-spacing: 1.5px;
  color: var(--text-muted); flex-shrink: 0;
}
.wins-ticker { flex: 1; overflow: hidden; position: relative; }
.wins-ticker-track {
  display: flex; gap: var(--sp-8); white-space: nowrap;
  animation: ticker-scroll 40s linear infinite;
}
.wins-ticker:hover .wins-ticker-track { animation-play-state: paused; }
.win-item { display: flex; align-items: center; gap: 6px; font-size: var(--text-xs); color: var(--text-secondary); }
.win-item strong { color: var(--accent-success); font-variant-numeric: tabular-nums; }
.win-item .win-game { color: var(--text-muted); }
@keyframes ticker-scroll {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}
@media (max-width: 768px) { .jackpot-pills .jackpot-minor, .jackpot-pills .jackpot-mini { display: none; } }
@media (prefers-reduced-motion: reduce) { .wins-ticker-track { animation: none; } }
```

- [ ] In `js/social-proof.js`, add ticker initialization with `crypto.getRandomValues()` based wins feed
- [ ] Add `<link rel="stylesheet" href="social-proof.css">` to `index.html`
- [ ] Run `npm run qa:regression` → must pass
- [ ] Commit: `git add social-proof.css js/social-proof.js index.html && git commit -m "feat: jackpot pills + scrolling wins ticker with crypto randomness"`

---

## Chunk 4: Slot Modal + Wallet + Profile Polish

### Task 4.1: Slot modal premium header + spin button

**Files:**
- Create: `modals-v2.css`
- Modify: `index.html` (slot modal header markup)

- [ ] Create `modals-v2.css` with slot modal overrides:

```css
/* modals-v2.css */

/* ── SLOT MODAL ── */
#slotModal {
  z-index: var(--z-slot-modal);
  background: var(--surface-base);
}

/* In-game header */
.slot-modal-header {
  height: var(--header-h);
  background: var(--surface-glass);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--green-border);
  display: flex;
  align-items: center;
  padding: 0 var(--sp-4);
  gap: var(--sp-3);
  position: relative;
  z-index: 2;
}
.slot-header-back {
  width: 36px; height: 36px;
  border-radius: var(--r-md);
  background: var(--surface-raised);
  border: 1px solid rgba(255,255,255,0.08);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; color: var(--text-primary);
  transition: background var(--t-fast), border-color var(--t-fast);
  flex-shrink: 0;
}
.slot-header-back:hover { background: var(--surface-high); border-color: var(--green-border); }
.slot-header-game-info { flex: 1; }
.slot-header-game-name { color: var(--text-primary); font-weight: 700; font-size: var(--text-base); }
.slot-header-studio { color: var(--text-muted); font-size: var(--text-xs); }

/* Spin button */
.spin-btn, #spinButton, .spinBtn {
  width: 72px !important; height: 72px !important;
  border-radius: var(--r-pill) !important;
  background: var(--green-brand) !important;
  color: var(--text-inverse) !important;
  border: none !important;
  font-weight: 900 !important;
  font-size: var(--text-lg) !important;
  cursor: pointer;
  box-shadow: var(--glow-green-md) !important;
  transition: transform var(--t-fast), box-shadow var(--t-fast), background var(--t-fast) !important;
  animation: spin-btn-pulse 3s ease-in-out infinite;
}
.spin-btn:hover, #spinButton:hover { transform: scale(1.05) !important; box-shadow: var(--glow-green-lg) !important; }
.spin-btn:active, #spinButton:active { transform: scale(0.95) !important; }
.spin-btn:disabled, #spinButton:disabled { background: var(--surface-high) !important; box-shadow: none !important; animation: none !important; }
@keyframes spin-btn-pulse {
  0%,100% { box-shadow: var(--glow-green-md); }
  50%      { box-shadow: var(--glow-green-lg); }
}

/* ── WALLET MODAL ── */
#walletModal, .wallet-modal {
  z-index: var(--z-modal);
}
.wallet-modal-inner {
  background: var(--surface-overlay);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: var(--r-xl);
  box-shadow: var(--shadow-modal);
  max-width: 520px;
  width: 100%;
}
.wallet-tabs {
  display: flex;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  padding: 0 var(--sp-4);
}
.wallet-tab {
  padding: var(--sp-4) var(--sp-4);
  font-size: var(--text-sm); font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: color var(--t-base), border-color var(--t-base);
  background: none; border-top: none; border-left: none; border-right: none;
}
.wallet-tab.active { color: var(--green-brand); border-bottom-color: var(--green-brand); }

/* Quick deposit picks */
.deposit-quick-picks { display: flex; gap: var(--sp-2); margin: var(--sp-3) 0; }
.deposit-pick {
  flex: 1; padding: var(--sp-2) 0;
  background: var(--surface-high);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: var(--r-md);
  color: var(--text-secondary); font-size: var(--text-sm); font-weight: 600;
  cursor: pointer; text-align: center;
  transition: background var(--t-fast), border-color var(--t-fast), color var(--t-fast);
  font-variant-numeric: tabular-nums;
}
.deposit-pick:hover { background: var(--surface-raised); border-color: var(--green-border); color: var(--green-brand); }

/* Bonus balance clarity */
.balance-breakdown {
  background: var(--surface-high);
  border-radius: var(--r-lg);
  padding: var(--sp-4);
  display: flex; gap: var(--sp-4);
  margin: var(--sp-4) 0;
}
.balance-block { flex: 1; }
.balance-block-label { font-size: var(--text-xs); color: var(--text-muted); margin-bottom: 4px; }
.balance-block-amount { font-size: var(--text-xl); font-weight: 800; font-variant-numeric: tabular-nums; }
.balance-withdrawable .balance-block-amount { color: var(--accent-success); }
.balance-locked .balance-block-amount { color: var(--gold); }

/* Wagering progress ring */
.wagering-ring-wrap { display: flex; align-items: center; gap: var(--sp-4); }
.wagering-ring svg { transform: rotate(-90deg); }
.wagering-ring-text { font-size: var(--text-xs); color: var(--text-secondary); }
.wagering-ring-text strong { color: var(--text-primary); display: block; font-size: var(--text-base); }

/* ── PROFILE MODAL ── */
#profileModal, .profile-modal { z-index: var(--z-modal); }

/* VIP tier bar */
.vip-tier-bar {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-4);
  background: var(--surface-high);
  border-radius: var(--r-lg);
  margin: var(--sp-4) 0;
}
.vip-tier-step {
  flex: 1; text-align: center;
  font-size: 10px; font-weight: 600;
  color: var(--text-muted);
  position: relative;
  padding-top: var(--sp-5);
}
.vip-tier-step::before {
  content: '';
  position: absolute; top: 0; left: 50%; transform: translateX(-50%);
  width: 20px; height: 6px;
  border-radius: var(--r-sm);
  background: rgba(255,255,255,0.1);
}
.vip-tier-step.done { color: var(--gold); }
.vip-tier-step.done::before { background: var(--gold-dim); border: 1px solid var(--gold-border); }
.vip-tier-step.current { color: var(--green-brand); }
.vip-tier-step.current::before { background: var(--green-subtle); border: 1px solid var(--green-border); box-shadow: var(--glow-green-sm); }

@media (prefers-reduced-motion: reduce) {
  .spin-btn, #spinButton { animation: none; }
}
```

- [ ] Add `<link rel="stylesheet" href="modals-v2.css">` to `index.html` (last CSS)
- [ ] Run `npm run qa:regression` → must pass
- [ ] Commit: `git add modals-v2.css index.html && git commit -m "feat: premium slot modal header, spin button glow, wallet tabs, VIP tier bar"`

---

## Chunk 5: Premium Overrides, Canvas Confetti, Performance Pass

### Task 5.1: Install canvas-confetti and wire win celebration

**Files:**
- Modify: `js/win-celebration.js`
- Modify: `index.html` (add canvas-confetti CDN or local copy)

- [ ] Add canvas-confetti script to `index.html` (CDN, deferred):
```html
<script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js" defer></script>
```
- [ ] In `js/win-celebration.js`, add/replace win celebration with confetti:
```js
function triggerWinConfetti(multiplier) {
  if (typeof confetti === 'undefined') return;
  if (multiplier >= 50) {
    // Big win: full burst
    confetti({ particleCount: 200, spread: 100, origin: { y: 0.6 }, colors: ['#00ff41','#FFD166','#fff'] });
  } else if (multiplier >= 10) {
    confetti({ particleCount: 80, spread: 70, origin: { y: 0.7 }, colors: ['#00ff41','#FFD166'] });
  } else {
    confetti({ particleCount: 30, spread: 50, origin: { y: 0.8 }, colors: ['#00ff41'] });
  }
}
window.triggerWinConfetti = triggerWinConfetti;
```
- [ ] Run `npm run qa:regression` → must pass
- [ ] Commit: `git add js/win-celebration.js index.html && git commit -m "feat: canvas-confetti win celebration with multiplier-scaled bursts"`

---

### Task 5.2: Premium global overrides sweep

**Files:**
- Modify: `premium-redesign.css`

Remove old `--ms-*` `:root` block (moved to design-tokens.css in Task 1.1), then add/update component overrides so entire site uses token system:

- [ ] Ensure `body` uses `var(--surface-base)` background and `var(--font-base)` font
- [ ] Replace all `#0a0a1a`, `#020c02`, `#111827` background references with `var(--surface-*)` tokens
- [ ] Replace all `rgba(0,255,65,*)` inline values with `var(--green-*)` tokens
- [ ] Replace all gold/amber `#f59e0b`, `#d4af37` references with `var(--gold*)` tokens
- [ ] Add button micro-interaction globally:
```css
button:active:not(:disabled) { transform: scale(0.97); }
```
- [ ] Add modal base:
```css
.modal-backdrop, [id$="Modal"] > .modal-backdrop {
  background: rgba(0,0,0,0.75);
  backdrop-filter: blur(4px);
}
```
- [ ] Run `npm run qa:regression` → must pass
- [ ] Commit: `git add premium-redesign.css && git commit -m "feat: wire all components to design-token system, remove magic numbers"`

---

### Task 5.3: Performance audit — CLS, content-visibility, lazy-load

**Files:**
- Modify: `game-cards.css`
- Modify: `index.html`

- [ ] Verify all `<img>` tags in game grid have explicit `width` and `height` attributes (prevents CLS)
- [ ] Verify `aspect-ratio: 16/10` applied to `.game-card-art` (already in Task 3.1)
- [ ] Add `content-visibility: auto; contain-intrinsic-size: auto 400px;` to `.game-section` (already in Task 3.1, verify social proof bar is excluded)
- [ ] Add `font-display: swap` to any `@font-face` declarations
- [ ] Set `theme-color` in `index.html` from `#0a0a1a` → `#0D0F14`
- [ ] Run `npm run qa:regression` → must pass
- [ ] Commit: `git add game-cards.css index.html && git commit -m "perf: CLS prevention, content-visibility, lazy-load audit"`

---

### Task 5.4: Final push — git clean, QA, push

- [ ] Run `npm run qa:regression` → full pass required
- [ ] `git status` — verify no untracked files related to the feature
- [ ] `git push origin master`

---

## Summary of Files

| File | Action | Purpose |
|---|---|---|
| `design-tokens.css` | Create | All CSS custom properties |
| `layout-shell.css` | Create | Header, trust bar, rail, mobile nav |
| `game-cards.css` | Create | Info-rich card component + skeleton |
| `social-proof.css` | Create | Jackpot pills, wins ticker |
| `modals-v2.css` | Create | Slot modal, wallet, profile overrides |
| `premium-redesign.css` | Modify | Remove `:root` block, update component rules |
| `index.html` | Modify | Load order, new HTML sections, meta |
| `js/social-proof.js` | Modify | crypto.getRandomValues(), ticker |
| `js/ui-lobby.js` | Modify | New card render, toggleRail |
| `js/ui-wallet.js` | Modify | Wagering multiplier fallback fix |
| `js/win-celebration.js` | Modify | canvas-confetti integration |
| `js/app.js` | Modify | Online count, onboarding init |
| `manifest.json` | Modify | Theme colors |
