const fs = require('fs');
const path = require('path');

const distHtml = path.join(__dirname, '..', 'dist', 'index.html');
if (!fs.existsSync(distHtml)) {
    console.log('[fix-encoding] No dist/index.html found, skipping');
    process.exit(0);
}

// Read as buffer to work at byte level
let bytes = fs.readFileSync(distHtml);
console.log('[fix-encoding] dist/index.html size:', bytes.length, 'bytes');

// Fix double-encoded FFFD: C3 AF C2 BF C2 BD (6 bytes) -> E2 80 A2 (bullet, 3 bytes)
let fixed = 0;
let chunks = [];
let i = 0;
while (i < bytes.length) {
    if (i <= bytes.length - 6 &&
        bytes[i] === 0xC3 && bytes[i+1] === 0xAF &&
        bytes[i+2] === 0xC2 && bytes[i+3] === 0xBF &&
        bytes[i+4] === 0xC2 && bytes[i+5] === 0xBD) {
        chunks.push(Buffer.from([0xE2, 0x80, 0xA2]));
        fixed++;
        i += 6;
    } else if (i <= bytes.length - 3 &&
        bytes[i] === 0xEF && bytes[i+1] === 0xBF && bytes[i+2] === 0xBD) {
        chunks.push(Buffer.from([0xE2, 0x80, 0xA2]));
        fixed++;
        i += 3;
    } else {
        chunks.push(Buffer.from([bytes[i]]));
        i++;
    }
}

if (fixed > 0) {
    const result = Buffer.concat(chunks);
    fs.writeFileSync(distHtml, result);
    console.log('[fix-encoding] Fixed', fixed, 'garbled sequences -> bullet character');
    console.log('[fix-encoding] New size:', result.length, 'bytes');
} else {
    console.log('[fix-encoding] No garbled sequences found - file is clean');
}