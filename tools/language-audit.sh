#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# Crypto / Blockchain Language Audit — CI Lint Step
# Spec §3: Player-facing files must NEVER contain blockchain,
# crypto, NFT, token, wallet, mint, burn, chain, or Polygon terms.
# ═══════════════════════════════════════════════════════════════
# Usage: bash tools/language-audit.sh
# Exit 0 = clean, Exit 1 = forbidden terms found
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Forbidden terms (case-insensitive grep pattern)
# Each term on its own line for readability
FORBIDDEN_TERMS=(
    '\bNFT\b'
    '\bnon.fungible\b'
    '\bblockchain\b'
    '\bcrypto.?currency\b'
    '\bcrypto.?wallet\b'
    '\bMetaMask\b'
    '\bWalletConnect\b'
    '\bCoinbase\b'
    '\bERC.?1155\b'
    '\bERC.?721\b'
    '\bERC.?20\b'
    '\bSolidity\b'
    '\bThirdweb\b'
    '\bsmart.contract\b'
    '\bgas.fee\b'
    '\btransaction.hash\b'
    '\btx.hash\b'
    '\bon.chain\b'
    '\btoken.?mint\b'
    '\btoken.?burn\b'
)
# NOTE: 'Polygon' and 'Ethereum' excluded from term list because CSS polygon()
# and SVG <polygon> generate massive false positives. Those terms are checked
# separately below with context-aware filtering.

# Allowlisted paths (server code, blockchain infra, build tools, this script)
EXCLUDE_DIRS=(
    "server/"
    "blockchain/"
    "node_modules/"
    "dist/"
    "tools/"
    "scripts/"
    ".git/"
    "output/"
    ".env"
)

# Build grep exclude args
EXCLUDE_ARGS=""
for dir in "${EXCLUDE_DIRS[@]}"; do
    EXCLUDE_ARGS="$EXCLUDE_ARGS --exclude-dir=$(basename "$dir" /)"
done

# Also exclude non-player-facing files
EXCLUDE_ARGS="$EXCLUDE_ARGS --exclude=*.md --exclude=CLAUDE.md --exclude=package*.json"

# Build the combined pattern
PATTERN=""
for term in "${FORBIDDEN_TERMS[@]}"; do
    if [ -z "$PATTERN" ]; then
        PATTERN="$term"
    else
        PATTERN="$PATTERN|$term"
    fi
done

echo "=== Crypto Language Audit ==="
echo "Scanning player-facing files for forbidden blockchain/crypto terminology..."
echo ""

FOUND=0

COMMON_EXCLUDES="--exclude-dir=server --exclude-dir=blockchain --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=tools --exclude-dir=scripts --exclude-dir=.git --exclude-dir=output --exclude=CLAUDE.md --exclude=package*.json"

# Scan JS and HTML files (not CSS — CSS has only class names, not player-visible text)
for ext in html js; do
    MATCHES=$(grep -rniE "$PATTERN" "$ROOT" \
        --include="*.$ext" \
        $COMMON_EXCLUDES \
        2>/dev/null \
        | grep -viE 'clip-path.*polygon|createElementNS.*polygon|\.polygon|<polygon' \
        | grep -v 'terms.html.*blockchain' \
        || true)

    if [ -n "$MATCHES" ]; then
        echo "VIOLATIONS in *.$ext files:"
        echo "$MATCHES"
        echo ""
        FOUND=$((FOUND + $(echo "$MATCHES" | wc -l)))
    fi
done

# Context-aware check for Ethereum/Polygon (excluding CSS polygon() and SVG)
for term in '\bEthereum\b' '\bPolygon\b'; do
    MATCHES=$(grep -rniE "$term" "$ROOT" \
        --include="*.html" --include="*.js" \
        $COMMON_EXCLUDES \
        2>/dev/null \
        | grep -viE 'clip-path|createElementNS|\.polygon|<polygon|polygon\(|points=' \
        | grep -v 'terms.html' \
        || true)
    if [ -n "$MATCHES" ]; then
        echo "VIOLATIONS ($term):"
        echo "$MATCHES"
        echo ""
        FOUND=$((FOUND + $(echo "$MATCHES" | wc -l)))
    fi
done

echo "=== Audit Complete ==="
if [ "$FOUND" -gt 0 ]; then
    echo "FAIL: $FOUND forbidden term(s) found in player-facing files."
    echo "Fix all violations before deploying."
    exit 1
else
    echo "PASS: No forbidden crypto/blockchain terms found."
    exit 0
fi
