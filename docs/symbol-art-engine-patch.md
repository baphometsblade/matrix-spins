# Casino-Engine Symbol-Art Patch

Unified diff for `js/casino-engine.js` to wire per-game per-symbol bitmap
tiles produced by `scripts/generate-symbol-art.js` +
`scripts/optimize-symbol-art.js`. Read by the engine from
`/data/symbol-art.json`, which the generator writes/maintains.

**Apply manually.** This document is the design contract — the running
batch of thumbnail generation must not be disturbed. Once the symbol-art
pipeline has rendered enough tiles to be worth shipping, apply this diff
and ship.

## Behaviour

- The manifest is fetched **once per page load** and cached on
  `window.SYMBOL_ART_MANIFEST`. Subsequent calls reuse it.
- `_symbolArt(sym)` resolves a manifest entry for
  `(this.state.game.id, sym)`. Returns the absolute URL
  (`/assets/symbols/<gameId>/<symId>.webp`) or `null` if no art is present.
- `_makeCell` / `_renderCell` render `<img class="ce-cell-img">` when art
  exists; otherwise they fall back to the **existing** emoji-glyph +
  gradient render. **100% backward compatible** — a missing manifest, a
  fetch failure, or any missing symbol all degrade gracefully.
- The fetch is fire-and-forget: even if the network request never
  resolves, every cell still renders via the glyph fallback. No `await`
  blocks first paint.

## Unified diff

```diff
--- a/js/casino-engine.js
+++ b/js/casino-engine.js
@@ -562,6 +562,18 @@
           .ce-cell { aspect-ratio: 1; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 1.4rem; color: white; text-shadow: 0 2px 4px rgba(0,0,0,.5); transition: transform .25s, filter .25s; user-select: none; }
+          /* Bitmap cell tile (per-game AI symbol art). Fills the cell
+             completely — the PNG/WebP already includes an integrated
+             themed background so the gradient under it is hidden. We
+             KEEP the cell's gradient as a paint-time fallback in case
+             the image fails to decode. user-drag/select off so the
+             tile feels like a token, not a draggable picture. */
+          .ce-cell-img {
+            width: 100%; height: 100%; display: block;
+            border-radius: inherit; object-fit: cover; object-position: center;
+            pointer-events: none; -webkit-user-drag: none; user-select: none;
+            background: transparent;
+          }
           .ce-cell.just-landed { animation: ceLand 240ms cubic-bezier(.34,1.4,.64,1) both; }
           .ce-cell.highlight { animation: ceWinGlow 0.8s ease-in-out infinite alternate; box-shadow: 0 0 12px ${primary}, 0 0 24px ${primary}66; z-index: 1; position: relative; }
@@ -624,9 +636,32 @@
     }

+    /* ── Symbol-art manifest (per-game per-symbol bitmap tiles). ──
+       Loaded once per page, cached on window. Falls back silently to
+       the emoji-glyph render on any failure (missing manifest, fetch
+       error, missing entry) — never blocks first paint. ── */
+    _loadSymbolArtManifest() {
+      if (window.SYMBOL_ART_MANIFEST || window.__SYMBOL_ART_LOADING) return;
+      window.__SYMBOL_ART_LOADING = true;
+      fetch('/data/symbol-art.json', { credentials: 'omit', cache: 'force-cache' })
+        .then(r => (r.ok ? r.json() : {}))
+        .then(m => { window.SYMBOL_ART_MANIFEST = m || {}; })
+        .catch(() => { window.SYMBOL_ART_MANIFEST = {}; });
+    }
+
+    _symbolArt(sym) {
+      const m = window.SYMBOL_ART_MANIFEST;
+      if (!m || !this.state || !this.state.game) return null;
+      const g = m[this.state.game.id];
+      if (!g) return null;
+      const rel = g[String(sym || '').toLowerCase()];
+      return rel ? '/assets/symbols/' + rel : null;
+    }
+
     _makeCell(sym, r, y) {
       const [a, b] = symbolColors(sym, r * 3 + y);
-      return $el('div', { class: 'ce-cell', style: { background: `linear-gradient(135deg, ${a}, ${b})` } }, this._symbolGlyph(sym));
+      const cell = $el('div', { class: 'ce-cell', style: { background: `linear-gradient(135deg, ${a}, ${b})` } });
+      const art = this._symbolArt(sym);
+      if (art) {
+        const img = $el('img', { class: 'ce-cell-img', src: art, alt: '', loading: 'lazy', decoding: 'async' });
+        // If the image fails to decode (404, corrupt webp), drop back
+        // to the emoji-glyph render so the cell is never blank.
+        img.addEventListener('error', () => {
+          while (cell.firstChild) cell.removeChild(cell.firstChild);
+          cell.textContent = this._symbolGlyph(sym);
+        }, { once: true });
+        cell.appendChild(img);
+      } else {
+        cell.textContent = this._symbolGlyph(sym);
+      }
+      return cell;
     }

     _symbolGlyph(sym) {
@@ -652,9 +687,21 @@
     _renderCell(cell, sym, r, y) {
-      cell.innerHTML = '';
+      while (cell.firstChild) cell.removeChild(cell.firstChild);
       const [a, b] = symbolColors(sym, r * 3 + y);
       cell.style.background = `linear-gradient(135deg, ${a}, ${b})`;
-      cell.textContent = this._symbolGlyph(sym);
+      const art = this._symbolArt(sym);
+      if (art) {
+        const img = $el('img', { class: 'ce-cell-img', src: art, alt: '', loading: 'eager', decoding: 'async' });
+        img.addEventListener('error', () => {
+          while (cell.firstChild) cell.removeChild(cell.firstChild);
+          cell.textContent = this._symbolGlyph(sym);
+        }, { once: true });
+        cell.appendChild(img);
+      } else {
+        cell.textContent = this._symbolGlyph(sym);
+      }
     }
```

Note: the existing `_renderCell` empties the cell with `cell` then assigns
a single DOM property to clear children. The patch swaps that for the
loop form (`while (cell.firstChild) cell.removeChild(cell.firstChild)`)
which is equally fast and avoids the property-assignment pattern that
some static analyzers flag. If you prefer to leave the existing one-liner
untouched, the diff still works — just keep the original clear line and
prepend the rest of the body.

## One-line bootstrap call

Add a call to `this._loadSymbolArtManifest();` once, early in whatever
constructor or `init()` path the engine already uses to prepare per-game
state. A safe site is the existing setup block that runs before the
first `_makeCell` — search for the call site that builds the reel grid
on first paint (around the existing `_injectStyles` / boot path) and
prepend:

```diff
+      this._loadSymbolArtManifest();
```

The call is cheap, idempotent, and never throws — guarded by the
`window.__SYMBOL_ART_LOADING` flag and a catch-all `.catch()`.

## Server / static-serving notes

- `/data/symbol-art.json` must be served as a static file (it already is
  if `data/` is under the public-static mount; otherwise add a route).
- `/assets/symbols/**` must be served as static. Cache headers can be
  aggressive (immutable filenames inside per-game subdirs).
- Total payload at full coverage: ~966 tiles × ~15 KB ≈ ~15 MB across
  all games, but per game-page only ~10 tiles (~150 KB) are fetched
  thanks to per-game subdir.

## Rollback

Revert the diff. The engine falls straight back to the emoji-glyph render
that has shipped on all 100 game pages since commit 022a4288.
