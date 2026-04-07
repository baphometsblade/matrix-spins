# Premium Redesign — Design Spec (v2, Approved)
**Date:** 2026-04-07
**Project:** Matrix Spins Casino — msaart.online
**Status:** Approved — ready for implementation
**Reviewer notes:** All critical issues from spec-review pass addressed below.

---

## 1. Brief & Goals

Transform Matrix Spins Casino into a competitive, premium-tier online casino that rivals Stake, Ignition, and BetOnline. Full front-end redesign in one pass: lobby, slot game modal, wallet/cashier, profile, and all supporting screens.

**Success criteria:**
- Visual quality matches top-tier sites on first impression
- All premium UX patterns present: live social proof, trust signals, glass morphism, premium iconography, retention loops, mobile-native feel
- Zero functional regressions — all game mechanics, bonus logic, and revenue-protection rules preserved
- QA/debug tools removed from production build
- Passes `npm run qa:regression` after every phase

---

## 2. Design Decisions

| Question | Decision |
|---|---|
| Brand identity | **Premium Dark + Matrix Green** — deep charcoal base (#0D0F14) with Matrix green (#00ff41) as primary CTA accent; gold-to-amber for VIP/premium elements |
| Navigation | **Hybrid** — sticky top header + collapsible 64px icon rail (hamburger < 1440px, expands on hover on desktop) |
| Hero | **Games-First** — no carousel; full-width cinematic trust bar + live-wins ticker → game rows directly |
| Game cards | **Info-Rich** — 16:10 aspect ratio; hover-reveal RTP + provider logo + Play/Demo split CTA |
| Approach | **Token-First** — `design-tokens.css` as foundation; every component consumes tokens |
| Scope | **Full site** — lobby + slot modal + wallet + profile + daily wheel + onboarding |
| Icons | **SVG-only** — Lucide icon set; zero emoji in production UI |
| Typography | **Inter** body + **Clash Display** (or Satoshi) headings; tabular-nums for all monetary values |

---

## 3. Design Token System (`design-tokens.css`)

### 3.1 Color Tokens

```css
:root {
  /* ─── Surfaces ────────────────────────────────── */
  --surface-base:     #0D0F14;          /* Page background — deep charcoal, NOT pure black */
  --surface-raised:   #141720;          /* Cards, panels */
  --surface-high:     #1A1E28;          /* Elevated cards, active rail items */
  --surface-overlay:  #1E2230;          /* Modal backgrounds */
  --surface-glass:    rgba(13,15,20,0.82); /* Header — pair with backdrop-filter:blur(16px) */
  --surface-tinted:   rgba(0,255,65,0.07); /* Active/hover tints */
  --surface-noise:    url("data:image/svg+xml,..."); /* Subtle noise texture overlay */

  /* ─── Brand Green (primary CTA) ───────────────── */
  --green-brand:        #00ff41;
  --green-brand-hover:  #00cc34;
  --green-brand-dim:    rgba(0,255,65,0.55);
  --green-brand-subtle: rgba(0,255,65,0.08);
  --green-brand-border: rgba(0,255,65,0.22);

  /* ─── Gold / VIP / Premium ────────────────────── */
  --gold-bright:   #F5C842;
  --gold-mid:      #D4A017;
  --gold-deep:     #A07010;
  --gold-gradient: linear-gradient(135deg, #F5C842 0%, #D4A017 50%, #A07010 100%);
  --gold-glow:     0 0 20px rgba(245,200,66,0.40);

  /* ─── Semantic accents ────────────────────────── */
  --accent-hot:       #ef4444;          /* HOT tag */
  --accent-new:       #8b5cf6;          /* NEW tag */
  --accent-jackpot:   #f59e0b;          /* JACKPOT tag — solid amber, NOT gradient */
  --accent-jackpot-gradient: linear-gradient(135deg, #f59e0b, #ef4444); /* background-only use */
  --accent-info:      #00d4ff;          /* Info / Nebula accent */
  --accent-success:   #10b981;          /* Wins, success states */
  --accent-danger:    #ef4444;          /* Errors, withdrawal warnings */
  --accent-gold:      var(--gold-bright); /* Balance display */

  /* ─── Text ────────────────────────────────────── */
  --text-primary:   #F1F5F9;
  --text-secondary: #94A3B8;
  --text-muted:     #64748B;
  --text-brand:     var(--green-brand);
  --text-gold:      var(--gold-bright);
  --text-inverse:   #0D0F14;

  /* ─── Provider accents (8 studios) ────────────── */
  --studio-goldenreels:  #D4A017;
  --studio-nebula:       #00F0FF;
  --studio-mythicforge:  #C8A415;
  --studio-wildfrontier: #CC5500;
  --studio-shadowworks:  #8B0000;
  --studio-dragonpearl:  #CC0000;
  --studio-ironclad:     #B5651D;
  --studio-cascadelabs:  #0066FF;
}
```

### 3.2 Spacing, Radius, Shadow, Glow

```css
:root {
  /* Spacing (4px base) */
  --space-1: 4px;   --space-2: 8px;   --space-3: 12px;
  --space-4: 16px;  --space-5: 20px;  --space-6: 24px;
  --space-8: 32px;  --space-10: 40px; --space-12: 48px;
  --space-16: 64px;

  /* Border radius */
  --radius-sm:   4px;     /* Tags, badges */
  --radius-md:   8px;     /* Buttons, inputs */
  --radius-lg:   12px;    /* Cards */
  --radius-xl:   16px;    /* Modals, panels */
  --radius-2xl:  24px;    /* Hero elements */
  --radius-pill: 9999px;  /* Chips, toggles */

  /* Green glows */
  --glow-sm:    0 0 6px  rgba(0,255,65,0.15);
  --glow-md:    0 0 14px rgba(0,255,65,0.30);
  --glow-lg:    0 0 24px rgba(0,255,65,0.45);
  --glow-xl:    0 0 48px rgba(0,255,65,0.60);

  /* Elevation shadows (dark-mode appropriate) */
  --shadow-xs:    0 1px 3px  rgba(0,0,0,0.40);
  --shadow-sm:    0 2px 8px  rgba(0,0,0,0.50);
  --shadow-card:  0 4px 24px rgba(0,0,0,0.60);
  --shadow-modal: 0 24px 64px rgba(0,0,0,0.80);

  /* Gold glows */
  --glow-gold-sm: 0 0 8px  rgba(245,200,66,0.25);
  --glow-gold-md: 0 0 20px rgba(245,200,66,0.40);

  /* Transitions */
  --transition-fast:  120ms ease-out;
  --transition-base:  200ms ease-out;
  --transition-move:  300ms cubic-bezier(0.34, 1.56, 0.64, 1);
  --transition-modal: 280ms cubic-bezier(0.16, 1, 0.3, 1);
  --transition-slide: 350ms cubic-bezier(0.16, 1, 0.3, 1);
}
```

### 3.3 Layout Constants

```css
:root {
  --header-h:       56px;
  --trust-bar-h:    36px;   /* Trust signal bar below header */
  --rail-w:         64px;   /* Collapsed icon rail */
  --rail-w-open:    220px;  /* Expanded rail with labels */
  --content-max:    1600px;
  --card-aspect:    calc(10 / 16); /* 16:10 game cards */

  /* Z-index budget — authoritative */
  --z-base:         1;
  --z-card-hover:   10;
  --z-rail:         50;
  --z-header:       100;
  --z-trust-bar:    101;
  --z-dropdown:     200;
  --z-toast:        500;
  --z-modal:        1000;
  --z-slot-modal:   1100;   /* Slot game sits above other modals */
  --z-overlay:      9000;   /* Existing: free spins, jackpot win */
  --z-system:       99999;  /* Existing: age verify, terms */
}
```

### 3.4 Typography

```css
:root {
  /* Font stacks */
  --font-display: 'Clash Display', 'Satoshi', 'Inter', sans-serif; /* Headings */
  --font-base:    'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono:    'JetBrains Mono', 'Fira Code', monospace;

  /* Scale */
  --text-xs:   11px;   /* Tags, micro-copy */
  --text-sm:   13px;   /* Card metadata */
  --text-base: 15px;   /* Body */
  --text-lg:   18px;   /* Section titles */
  --text-xl:   22px;   /* Modal titles */
  --text-2xl:  28px;   /* Balance display */
  --text-3xl:  36px;   /* Jackpot display */
  --text-4xl:  48px;   /* Win celebration */

  /* Feature flags */
  --font-feature-tabular: "tnum" 1;  /* All monetary values use tabular-nums */
}
```

**Font loading:** Rely on existing `<link rel="preload">` in `index.html` for Inter and JetBrains Mono. Add Clash Display via Google Fonts preconnect. Do NOT use `@import` inside CSS files — causes double-load with bundle script.

---

## 4. Layout Shell

### 4.1 Trust Bar (NEW — between header and content)
- Height: `var(--trust-bar-h)` = 36px
- `position: sticky; top: var(--header-h); z-index: var(--z-trust-bar)`
- Background: `rgba(0,0,0,0.5)`, border-bottom: `1px solid rgba(255,255,255,0.06)`
- Content (centred, flex row, gap 24px):
  - `[lock icon] SSL Secured`
  - `[shield icon] Provably Fair`
  - `[scroll icon] Licensed`
  - `[users icon] X,XXX players online`
- Icons: Lucide SVG inline, 14px, `var(--text-muted)` colour
- All items `var(--text-xs)` / 500 / letter-spacing 0.5px

### 4.2 Top Header (`#casinoHeader`)
- Height: `var(--header-h)` = 56px
- `position: sticky; top: 0; z-index: var(--z-header)`
- Background: `var(--surface-glass)` + `backdrop-filter: blur(16px)`
- Border-bottom: `1px solid var(--green-brand-border)`
- Layout: `[Logo 140px] [Search flex-1 max-w-400] [Balance] [XP chip] [Cashier] [Avatar]`

**Logo:** "MS" monogram (32×32) + "MATRIX SPINS" wordmark in `var(--green-brand)`. No emoji. No Matrix rain canvas in header.

**Search:** styled `<input>` with Lucide Search icon left, clear × right. Debounce 200ms. Focus: glow-sm + border brand.

**Balance chip:** Amount in `var(--accent-gold)` tabular-nums. Wagering progress bar below (hidden unless bonus active). Click → wallet modal.

**XP badge:** Level + tier (BRONZE / SILVER / GOLD / PLATINUM / DIAMOND — 5 tiers). Mini XP fill bar. Matches existing 5-tier system in `ui-wallet.js`.

**Cashier button:** `var(--green-brand)` bg, `var(--text-inverse)` text. Hover: scale(1.02) + `var(--glow-md)`.

**Avatar:** 32px circle. Click → profile modal.

### 4.3 Left Rail (`#casinoRail`)
- `position: sticky; top: calc(var(--header-h) + var(--trust-bar-h))`
- Width: `var(--rail-w)` collapsed / `var(--rail-w-open)` expanded
- Collapses to hamburger on viewports < 1440px. Expands on hover (desktop).
- ARIA: `aria-expanded`, `aria-controls="casinoRail"`, focus-trap when open on mobile
- All `onclick="toggleSidebar()"` references updated to `toggleRail()` in both JS and HTML
- Old `#casinoSidebar`, `#csbHamburgerBtn`, `#csbOverlay` removed and replaced

**Rail items (icons always, labels when expanded):**
- Category: All · Hot · New · Jackpot · Favourites
- Mechanics (collapsible sub-list): 28 mechanic types
- Studios (8): with accent colour dot matching studio token
- ── divider ──
- Daily Wheel · Leaderboard · Wager Race
- ── divider ──
- Settings · Responsible Gambling

**Mobile (≤ 768px):** Bottom fixed nav. 5 items: Home | Games | Deposit | Bonuses | Profile. 48px tap targets, icon + label. Active item: `var(--glow-sm)`. Replaces current mobile sidebar.

---

## 5. Live Social Proof Bar

Thin strip between trust bar and first game row.

**Implementation:**
- Wins ticker: client-side simulated feed using `crypto.getRandomValues()` (NOT `Math.random()` — CLAUDE.md Rule #7). Array of ~50 pre-seeded username templates + game names from `game-definitions.js`. New "win" every 3–8 seconds with random interval derived from `crypto.getRandomValues()`.
- The existing `social-proof.js` will be refactored: replace all 3 `Math.random()` calls with `crypto.getRandomValues()` equivalents.
- If `/api/wins/recent` endpoint is created in the future it can be swapped in — design for replaceability.
- Jackpot pills: 4 tiers (GRAND / MAJOR / MINOR / MINI) using `requestAnimationFrame` counter. Jackpot pills excluded from `content-visibility: auto` (see §13).
- Online count: simulated with `crypto.getRandomValues()`, 800–2400 range.

**Design:**
- Full-width, 36px height
- Wins ticker: CSS `@keyframes scroll-x` marquee, pauses on hover, hardware-accelerated
- Jackpot pills: gold gradient background (`var(--accent-jackpot-gradient)`), `var(--glow-gold-sm)`

---

## 6. Game Rows (Info-Rich Cards)

### 6.1 Section Headers
```
[SVG icon]  HOT RIGHT NOW                    View all →
────────────────────────────────────────────────────────
```
- Lucide SVG icons (no emoji)
- Label: `var(--font-display)` / `var(--text-lg)` / 700 / letter-spacing 1.5px / uppercase
- Separator: `1px solid rgba(255,255,255,0.06)`

**Row order:**
1. 🕐 Recently Played (hidden if empty)
2. Hot Right Now — games where `hot: true` in `game-definitions.js` (uses existing hotgame.routes.js hourly rotation)
3. New Releases — games where `tag === 'NEW'` (static field; date-based filter deferred until `addedAt` field added to game-definitions.js)
4. Jackpot Games — `jackpot > 0`
5. [Active mechanic filter row] — conditional
6. Top Rated — sorted by `rtp` descending
7. All Games — full paginated grid

### 6.2 Info-Rich Game Card

**Aspect ratio:** 16:10 (`padding-top: 62.5%` trick or `aspect-ratio: 16/10`)

**Structure:**
```
┌─────────────────────────────┐
│  [Provider bgGradient art]  │  ← 16:10, lazy-loaded thumbnail
│  [HOT badge top-left]       │  ← conditional tag chip
│  [🔴 247 playing top-right] │  ← live count (simulated w/ crypto)
├─────────────────────────────┤
│  Game Name                  │  ← var(--font-base)/var(--text-base)/700, truncate
│  [Studio logo dot] Studio   │  ← studio accent colour, var(--text-sm)
│  [RTP 88%]  [250×]          │  ← var(--text-xs) chips, tabular-nums
│  [TUMBLE]   [MEGAWAYS]      │  ← mechanic tag chips
└─────────────────────────────┘
```

**Hover (desktop):**
- Scale 1.03, `var(--glow-md)`, border → `var(--green-brand)` 0.5 opacity
- Overlay slides up: `▶ PLAY` (primary) + `◎ DEMO` (secondary)

**Loading skeleton:**
```css
.game-card-skeleton {
  background: linear-gradient(
    90deg,
    var(--surface-raised) 25%,
    var(--surface-high) 50%,
    var(--surface-raised) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}
@keyframes shimmer {
  from { background-position: 200% 0; }
  to   { background-position: -200% 0; }
}
```

**Responsive columns:**
- `< 480px`: 2 cols
- `480–768px`: 3 cols
- `768–1200px`: 4 cols
- `> 1200px`: 5 cols

**Image format:** `<img loading="lazy" decoding="async" width="X" height="Y">`. Explicit dimensions prevent CLS. WebP preferred where thumbnails exist.

### 6.3 Tag System
| Tag | Token | Condition |
|---|---|---|
| HOT | `--accent-hot` | `hot: true` in game-def |
| NEW | `--accent-new` | `tag === 'NEW'` |
| JACKPOT | `--accent-jackpot` (amber solid) | `jackpot > 0` |
| MEGA | purple→pink gradient | `jackpot > 10000` |
| 18+ | neutral/muted | `volatility==='high' && rtp<86` |

Note: `--accent-jackpot` is a solid amber colour (`#f59e0b`) used for `color`, `border-color`, and `background-color`. The gradient variant `--accent-jackpot-gradient` is used for `background` only (jackpot pill in social proof bar, jackpot game gold border). Never assign gradient to `color` property.

---

## 7. Filter System

### Category chips (in rail)
- Pill chips: `background: var(--surface-tinted)`, border: `var(--green-brand-border)`
- Active: `background: var(--green-brand)`, `color: var(--text-inverse)`, `var(--glow-sm)`

### Mechanic filter (collapsible sub-section in rail)
28 types as chip list. Same pill styling as category.

### Studio filter
8 studios, accent colour dot (`width:8px height:8px border-radius:50%`) in studio token colour.

### Sort dropdown
Custom-styled `<select>` replacement (no browser default). Options: Popular · A–Z · Z–A · RTP High-Low · Volatility · New First.

---

## 8. Slot Game Modal (`#slotModal`)

- Fullscreen overlay: `100dvh` (not `100vh` — avoids mobile keyboard/notch issues)
- `z-index: var(--z-slot-modal)` = 1100
- Slide-up: `translateY(100%) → translateY(0)`, `var(--transition-modal)`
- Provider chrome: set `data-studio="[themeKey]"` on `#slotModal` element. Maps to existing `--studio-*` tokens. This reconciles the `data-theme` vs `data-studio` naming — **authoritative attribute is `data-studio`** on `#slotModal`, consistent with existing `studio-chrome.css` selectors.

**In-game header (56px):**
- Back (Lucide `ChevronLeft`) + game name + studio
- Right: Balance chip + Bet selector + Autoplay + Sound (Lucide `Volume2/VolumeX`) + Fullscreen

**Spin button:** 72px diameter, `var(--green-brand)` bg, pulsing `var(--glow-md)` animation.

**Win display:** odometer-style CSS counter animation on win.

**Preserved revenue rules:**
- Streak saver: `bonus_balance` (Rule #2 — ASCII box comment in spin.routes.js preserved)
- All free bonuses: `bonus_balance` + wagering
- `crypto.randomBytes()` for server-side randomness

---

## 9. Wallet / Cashier Modal (`#walletModal`)

- Centred modal, max-width 520px, `var(--radius-xl)`, `var(--shadow-modal)`
- `z-index: var(--z-modal)` = 1000
- **Classified as MODIFIED file** (not new) — merges with existing wallet markup

**Tabs:** Deposit · Withdraw · History · Bonuses

**Deposit tab:**
- Amount input + quick-pick buttons: $25 / $50 / $100 / $250
- Payment method grid
- Bonus preview: "Deposit $100 → $30 bonus · **30× wagering**"
  ⚠️ Fix: `ui-wallet.js` line ~3012 fallback `wageringMult` corrected from `|| 20` to `|| 30` to match `depositmatch.routes.js` constant. Revenue-protection fix.

**Bonus balance transparency:**
- Always-visible split: `Withdrawable: $X` / `Bonus (locked): $X`
- Radial progress ring (SVG, animated) showing wagering % complete
- Clear copy: "Wager $X more to unlock $Y"

**Withdraw tab:** Shows actual withdrawable balance only (not bonus_balance).

---

## 10. Profile Modal (`#profileModal`)

**Tabs:** Stats · Achievements · VIP · Settings · Limits

**VIP tab:** 5-tier progression: Bronze → Silver → Gold → Platinum → Diamond (matches existing `ui-wallet.js` 5-tier system). Header XP chip also shows all 5 tiers (corrected from earlier spec draft which showed only 4).

**Limits tab (Responsible Gambling):**
- Deposit limits (daily/weekly/monthly)
- Session time limit + alerts
- Cool-off / self-exclusion — prominent, accessible in ≤ 2 taps from anywhere in the app

---

## 11. Daily Wheel Redesign

- Full-screen takeover (`z-index: var(--z-overlay)`)
- 3D CSS wheel (rotateX perspective) or canvas-based
- Spin uses `crypto.getRandomValues()` to select segment
- Win: canvas-confetti burst (library: `canvas-confetti` ~15KB gzipped)
- Haptic simulation: brief CSS scale pulse + vibration on mobile (`navigator.vibrate(100)` guarded by feature-detect)
- Always credits `bonus_balance` + wagering (Rule #1)

---

## 12. Welcome Onboarding Flow (NEW)

Triggered on first login after registration. Replaces immediate modal dump.

**Steps:**
1. **Choose avatar** — 8 pixel art avatars grid, pick one
2. **Claim welcome bonus** — show bonus amount + wagering requirement clearly (honest UX)
3. **Play first game** — pre-selected "best for beginners" game with tutorial tooltip overlay

Tracked via `localStorage.onboardingComplete`. Skippable at any step. Does NOT block lobby access.

---

## 13. Trust & Compliance

**Trust bar:** See §4.1 (sticky below header).

**Footer:**
- Responsible gambling logos: NCPG, GamCare, BeGambleAware — rendered as SVG/img, not text
- 18+ badge (SVG)
- Certification: iTech Labs, Curaçao eGaming, PCI DSS — greyscale logos
- SSL lock icon near cashier CTA

**Meta tags (add to `<head>`):**
```html
<meta name="theme-color" content="#0D0F14">
<meta property="og:title" content="Matrix Spins Casino">
<meta property="og:description" content="Premium social casino slots">
<meta property="og:image" content="/assets/og-image.png">
<meta name="twitter:card" content="summary_large_image">
```

---

## 14. PWA

**`manifest.json`** — MODIFIED (exists, update values):
```json
{
  "name": "Matrix Spins Casino",
  "short_name": "MatrixSpins",
  "theme_color": "#0D0F14",
  "background_color": "#0D0F14",
  "display": "standalone",
  "start_url": "/",
  "icons": [
    { "src": "/assets/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/assets/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

**`sw.js`** — MODIFIED (exists, update cache strategy):
- Cache: design-tokens.css, styles.css, game-definitions.js, all thumbnails
- Strategy: cache-first for static assets, network-first for API calls
- "Add to Home Screen" prompt shown after 2nd visit (track in localStorage)

---

## 15. Performance

**Targets:** LCP < 2.5s · INP < 200ms · CLS < 0.1

**Implementation:**
- `aspect-ratio: 16/10` on all game card containers (eliminates CLS)
- `content-visibility: auto` on game row sections below the fold — **EXCLUDING** the social proof bar (§5) to prevent jackpot counter animation from breaking
- `loading="lazy" decoding="async"` on all game thumbnails
- `will-change: transform` only on actively animating elements (card hover, spin button)
- Skeleton shimmer replaces all spinners
- Game loading: branded splash with progress bar (not generic spinner)

---

## 16. Micro-interactions

- **Button press:** `transform: scale(0.97)` active, `var(--transition-fast)`
- **Card hover:** scale 1.03 + glow + overlay, `var(--transition-move)`
- **Balance update:** green flash pulse on increase; red on decrease
- **Win odometer:** CSS counter-style roll animation
- **Win celebration:** `canvas-confetti` burst
- **Toast:** slide from top-right, auto-dismiss 4s, `z-index: var(--z-toast)`
- **Jackpot counter:** `requestAnimationFrame` smooth increment
- **Level-up:** particle burst + toast
- **Ambient sound:** optional background hum (muted by default); `localStorage.soundEnabled`
- **`@media (prefers-reduced-motion: reduce)`:** All CSS animations disabled, JS animation skipped

---

## 17. Production Cleanup

Remove from production build (not just hidden — physically removed or env-gated):
- QA/seed controls panel
- Queue-outcome dev tools
- Admin panel link in footer
- Any `console.log` statements in production-facing JS
- Debug URL params (`?debug=1`, `?qa=1`)

Gate behind `process.env.NODE_ENV === 'development'` or `?devtools=secrettoken` where admin access still needed.

---

## 18. Files to Create / Modify

### New files
- `design-tokens.css` — token foundation
- `layout-shell.css` — header, trust bar, rail, bottom nav
- `game-cards.css` — info-rich card component + skeleton
- `social-proof.css` — wins ticker, jackpot pills
- `filter-rail.css` — filter chips, mechanic/studio sub-sections
- `modals-v2.css` — wallet + profile redesign
- `onboarding.css` + `onboarding.js` — welcome flow
- `assets/icons/` — Lucide SVG sprite or individual icons
- `assets/icons/icon-192.png` + `icon-512.png` — PWA icons
- `assets/og-image.png` — 1200×630 OG image

### Modified files
- `index.html` — full layout overhaul, new meta tags, font preloads, PWA link
- `styles.css` — consume tokens, remove magic numbers, eliminate redundant rules
- `visual-overhaul.css` — migrate provider colors to `--studio-*` tokens
- `phase5-lobby.css` — remove superseded rules post-token migration
- `manifest.json` — update theme colors and icons
- `sw.js` — update cache strategy
- `js/ui-lobby.js` — card render, filter render, `toggleRail()` replaces `toggleSidebar()`
- `js/ui-modals.js` — wallet + profile markup updates
- `js/social-proof.js` — replace `Math.random()` with `crypto.getRandomValues()`
- `js/app.js` — PWA registration, onboarding init
- `server/routes/depositmatch.routes.js` — verify 30x wagering constant correct (revenue check)

### Untouched (no changes)
- All `server/` route logic (game engine, payments, bonuses)
- `shared/game-definitions.js`
- `js/ui-slot.js` game engine internals
- `js/casino-engine.js`
- All bonus guard middleware
- `spin.routes.js` streak saver (bonus_balance Rule #2)

---

## 19. Implementation Phases

### Phase 1 — Token Foundation + Cleanup
- `design-tokens.css` with full token set
- Update `index.html` to load first
- Replace 8 provider colour magic numbers in `visual-overhaul.css` with `--studio-*` tokens
- Fix `social-proof.js` `Math.random()` → `crypto.getRandomValues()`
- Fix `ui-wallet.js` wagering multiplier fallback (20 → 30)
- Remove QA/debug tools from production
- Add meta tags + PWA manifest updates

### Phase 2 — Layout Shell
- New sticky header (HTML + CSS)
- Trust bar (HTML + CSS)
- Collapsible rail with `toggleRail()` — replaces `#casinoSidebar`
- Mobile bottom nav (≤ 768px)
- Main content area padding/layout adjustments

### Phase 3 — Social Proof Bar + Live Data
- Wins ticker with crypto-based randomness
- Jackpot counter pills (4 tiers)
- Online player count display
- Wire jackpot total from existing `/api/jackpot` endpoint

### Phase 4 — Game Cards & Grid
- 16:10 aspect ratio card component
- Hover overlay (Play + Demo)
- Skeleton shimmer
- Tag system (solid tokens, no gradients on `color`)
- Responsive 2/3/4/5 column breakpoints
- Lazy-load + `decoding="async"` + explicit dimensions

### Phase 5 — Filter Rail Upgrade
- Category/mechanic/studio chip pills in rail
- Hover-expand rail on desktop
- Custom sort dropdown

### Phase 6 — Slot Modal Polish
- `data-studio` attribute provider chrome (reconciled with existing `studio-chrome.css`)
- New in-game header bar with Lucide icons
- Spin button redesign
- Win odometer animation
- canvas-confetti win celebration

### Phase 7 — Wallet + Profile Modals
- Deposit tab with quick-picks + bonus preview (30× correct)
- Wagering progress ring
- VIP 5-tier bar (all 5 tiers incl. Diamond)
- Limits / responsible gambling tab

### Phase 8 — Daily Wheel + Onboarding
- 3D CSS daily wheel redesign
- canvas-confetti on spin win
- Welcome onboarding flow (3 steps)

### Phase 9 — Trust, PWA & Meta
- Footer with SVG certification badges
- PWA icon assets generation
- OG image creation
- Service worker cache strategy update
- "Add to Home Screen" prompt

### Phase 10 — Performance & Polish Pass
- `content-visibility: auto` audit (exclude social proof bar)
- `aspect-ratio` CLS audit
- `will-change` audit
- `prefers-reduced-motion` audit
- Lucide SVG icon replace for any remaining emoji
- Full `npm run qa:regression` pass
- Git cleanup + commit
