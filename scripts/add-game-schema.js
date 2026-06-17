#!/usr/bin/env node
'use strict';

/**
 * Adds JSON-LD structured data (SoftwareApplication + BreadcrumbList)
 * to all game HTML pages in the /games/ directory.
 *
 * Idempotent: skips files that already have application/ld+json.
 */

const fs = require('fs');
const path = require('path');

const GAMES_DIR = path.join(__dirname, '..', 'games');

function extractTitle(html) {
    const match = html.match(/<title>([^<]+)<\/title>/i);
    if (!match) return 'Casino Game';
    // Strip " | Matrix Spins" or " — Matrix Spins" suffix
    return match[1].replace(/\s*[|—–-]\s*Matrix Spins.*$/i, '').trim();
}

function extractDescription(html) {
    const match = html.match(/<meta\s+(?:name|property)="(?:og:)?description"\s+content="([^"]+)"/i)
        || html.match(/<meta\s+content="([^"]+)"\s+(?:name|property)="(?:og:)?description"/i);
    return match ? match[1] : 'Play this premium slot game at Matrix Spins Casino.';
}

function slugToReadable(slug) {
    return slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function buildSchema(gameName, description, slug) {
    const app = {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        "name": gameName,
        "description": description,
        "applicationCategory": "GameApplication",
        "operatingSystem": "Web Browser",
        "offers": {
            "@type": "Offer",
            "price": "0",
            "priceCurrency": "USD"
        },
        "url": `https://msaart.online/games/${slug}.html`,
        "provider": {
            "@type": "Organization",
            "name": "Matrix Spins Casino",
            "url": "https://msaart.online"
        }
    };

    const breadcrumb = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {
                "@type": "ListItem",
                "position": 1,
                "name": "Home",
                "item": "https://msaart.online"
            },
            {
                "@type": "ListItem",
                "position": 2,
                "name": "Games",
                "item": "https://msaart.online/#games"
            },
            {
                "@type": "ListItem",
                "position": 3,
                "name": gameName,
                "item": `https://msaart.online/games/${slug}.html`
            }
        ]
    };

    return `<script type="application/ld+json">${JSON.stringify(app)}</script>\n    <script type="application/ld+json">${JSON.stringify(breadcrumb)}</script>`;
}

let updated = 0, skipped = 0;

const files = fs.readdirSync(GAMES_DIR).filter(f => f.endsWith('.html'));

for (const file of files) {
    const filePath = path.join(GAMES_DIR, file);
    let html = fs.readFileSync(filePath, 'utf8');

    if (html.includes('application/ld+json')) {
        skipped++;
        continue;
    }

    const slug = file.replace('.html', '');
    const title = extractTitle(html) || slugToReadable(slug);
    const description = extractDescription(html);
    const schema = buildSchema(title, description, slug);

    // Insert before </head>
    html = html.replace('</head>', `    ${schema}\n</head>`);

    fs.writeFileSync(filePath, html, 'utf8');
    updated++;
}

console.log(`Done: ${updated} game pages updated, ${skipped} already had schema.`);
