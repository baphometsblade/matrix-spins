# Premium Polish — Industry Standard Slot Upgrades

**Date:** 2026-04-15
**Status:** Draft
**Scope:** 8 enhancements to bring slot UX to Pragmatic Play / NetEnt / BTG industry standard

## Context

The slot engine has a solid foundation — proper reel mechanics, tiered win celebrations, provider-themed audio, particle systems, and turbo mode. A comprehensive audit identified specific gaps vs industry-leading providers. This spec targets the 8 highest-impact improvements ranked by player perception and feasibility.

## Constraints

- All changes are client-side only (JS/CSS). No server-side changes.
- Must respect existing animation quality settings (`_animSettingEnabled`, `appSettings.animationQuality`).
- Must not break turbo mode, autoplay, or free spins.
- Must pass `npm run qa:regression` before commit.
- No external audio files — continue using Web Audio API synthesis.
- Total JS additions should stay under 400 lines across all files.

## Enhancements

### 1. Win Line Sequential Replay

**Problem:** All winning paylines display simultaneously. Industry standard cycles through each line individually.

**Design:**
- After the initial 2.8s all-lines flash (existing behavior), start a cycling loop.
- Each cycle: highlight ONE payline, dim all non-winning cells to `opacity: 0.28`, show a floating badge with "Line N: +$X.XX" near the winning cells.
- Dwell time: 1.5s per line.
- Loop 2x through all winning lines, then stop.
- Skip entirely in turbo mode.
- Skip if only 1 winning line (no cycling needed).
- Cancel if player taps spin or closes slot.

**Files:** `js/ui-slot.js` (new `_cycleWinLines()` function), `styles.css` (`.win-line-badge` styling)

**Constants:**
```
WIN_LINE_CYCLE_DWELL = 1500   // ms per line
WIN_LINE_CYCLE_LOOPS = 2      // number of full cycles
```

### 2. Progressive Big Win Tier Escalation

**Problem:** The big win overlay immediately shows the final tier label (e.g., "MEGA WIN!"). No suspense.

**Design:**
- The counter always starts at the LOWEST qualifying tier.
- As the counter crosses each threshold, fire a tier upgrade:
  1. Flash the overlay white (opacity 0.3, 100ms)
  2. Scale the label 0.8→1.2→1.0 with spring easing (300ms)
  3. Play the next tier's sound (`bigwin` → `megawin`)
  4. Update the label text and CSS class
- Thresholds (multiplier of bet): 20x = BIG, 50x = SUPER, 100x = MEGA.
- A 200x+ win crosses all three thresholds during the counter animation, giving three distinct "level up" moments.

**Files:** `js/ui-slot.js` (modify `showBigWinCelebration()`)

### 3. Click-to-Stop / Quick Reveal

**Problem:** Tapping during a spin does nothing. Every major provider allows skip-to-result.

**Design:**
- During the spinning phase (after spin starts, before all reels stopped):
  - First tap: skip remaining reel animations — snap all unstopped reels to final positions in 200ms.
  - The result was already determined server-side, so this is purely visual.
- Guard: Only works if `spinning === true` and at least one reel is still animating.
- Do NOT allow during free spin bonus trigger sequence.
- The quick-stop snaps strips to `targetY` positions, removes `.spinning` classes, adds `.stopped`, and fires `onComplete` callback.

**Files:** `js/ui-slot.js` (add `_quickStopReels()`, bind click on `.slot-reel-area`)

### 4. Winning Symbol Scale Pop

**Problem:** Winning symbols only get glow/brightness filters. No satisfying scale pop.

**Design:**
- After grid render on win, add `.reel-cell-win-pop` class to each winning cell.
- CSS keyframe: scale(1) → scale(1.15) → scale(1.0) over 400ms with `cubic-bezier(0.34, 1.56, 0.64, 1)`.
- Stagger: 50ms delay per cell (left-to-right, top-to-bottom) for a cascade effect.
- Remove class after 500ms.
- Gate on `_animSettingEnabled('animations')`.

**Files:** `styles.css` (keyframe + class), `js/ui-slot.js` (apply to winning cells in `renderGrid` callback)

### 5. Symbol Landing Impact Particles

**Problem:** No visual feedback at the moment each reel column stops.

**Design:**
- On each reel stop (inside the `setTimeout` that fires after decel), call `burstParticles(colCenterX, colCenterY, 5, providerKey)`.
- The canvas particle engine already exists with provider theming and object pooling.
- Particle count: 5 per column (25 total for a 5-reel game) — well within the 300 ULTRA budget.
- Skip in turbo mode (visual is too fast to notice).
- Gate on animation quality `high` or `ultra`.

**Files:** `js/ui-slot.js` (add `burstParticles` call in reel stop handler)

### 6. Intermediate Reel Scatter Anticipation

**Problem:** Only the final reel gets tension slowdown when scatters are tracking.

**Design:**
- When 2+ scatters have landed on stopped reels, apply graduated slowdown to ALL remaining spinning reels:
  - Reel N+1 after 2nd scatter: 0.7x speed (mild tension)
  - Reel N+2: 0.5x speed (building)
  - Final reel: 0.35x speed (existing `REEL_NEARMISS_SPEED_MULT`)
- Apply `.reel-scatter-tension` class to each slowing reel (existing CSS already does orange pulse).
- Play `scatter` sound on 2nd scatter land, `playNearMissTension` on 3rd.

**Files:** `js/ui-slot.js` (modify reel stop scheduling to check scatter count on prior reels)

### 7. Heavier Spin Blur + Decel Sharpening

**Problem:** Current 2.5px blur is too subtle. No graduated sharpening during deceleration.

**Design:**
- Increase `.reel-column.spinning .reel-cell` blur from 2.5px to 4px, brightness from 1.05 to 1.08.
- Add `.reel-strip.decelerating .reel-cell` rule: `filter: blur(1px) brightness(1.03)` with `transition: filter 400ms ease-out`. This creates a visible "coming into focus" effect.
- Stopped cells already have `filter: blur(0) brightness(1)` with 200ms transition — no change needed.

**Files:** `styles.css` (modify 2 existing rules, add 1 new rule)

### 8. Ambient Idle Polish

**Problem:** Between-spin idle state is static. Breath animation is barely visible.

**Design:**
- Increase `.reel-ambient-breath` from `brightness(1→1.03)` to `brightness(1→1.06)` + `saturate(1→1.05)`.
- After each non-turbo spin completes, trigger 3 slow ambient particles via `burstParticles()` with reduced speed (0.3x normal), drifting upward from random reel positions. Use existing particle engine.
- Add a 6s CSS shimmer sweep across the reel area between spins (a pseudo-element with a diagonal gradient translating left-to-right, very subtle).

**Files:** `styles.css` (modify ambient breath, add shimmer), `js/ui-slot.js` (trigger ambient particles on spin complete)

## Implementation Order

1. Enhancement 7 (spin blur) — CSS-only, immediate visual impact
2. Enhancement 4 (symbol scale pop) — CSS + minimal JS
3. Enhancement 5 (landing particles) — 1 line JS call
4. Enhancement 3 (click-to-stop) — new JS function + event binding
5. Enhancement 2 (big win escalation) — modify existing function
6. Enhancement 8 (ambient idle) — CSS + minimal JS
7. Enhancement 6 (scatter anticipation) — modify reel stop logic
8. Enhancement 1 (win line cycling) — most complex, new system

## Testing

- Visual: verify in browser at each step via dev server.
- QA: `npm run qa:regression` must pass after each enhancement.
- Turbo mode: all enhancements must degrade gracefully (skip or abbreviate).
- Autoplay: win line cycling and big win escalation must not block autoplay flow.
- Free spins: all enhancements must work during bonus rounds.

## Out of Scope

- Real audio file support (would require CDN hosting)
- Multiplier ladder display (game-specific, not universal)
- Progressive jackpot in-slot ticker (requires backend changes)
- Cascading/tumble animation overhaul (existing implementation is adequate)
- Autoplay session summary popup
