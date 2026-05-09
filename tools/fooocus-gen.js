// Submit Fooocus async generations for casino assets and download results.
// Usage: node tools/fooocus-gen.js
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const FOOOCUS = 'http://127.0.0.1:7865';

function post(pathPart, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(FOOOCUS + pathPart, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve({ raw: data, status: res.statusCode }); }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve({ raw: data }); }
      });
    }).on('error', reject);
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    http.get(url, (res) => {
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error('HTTP ' + res.statusCode + ' on ' + url));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', reject);
  });
}

async function generate(prompt, opts = {}) {
  const body = {
    prompt,
    negative_prompt: opts.negative || 'blurry, lowres, watermark, text, jpeg artifacts, distorted',
    aspect_ratios_selection: opts.aspect || '1024*1024',
    image_number: 1,
    async_process: true,
    performance_selection: opts.perf || 'Speed',
    save_extension: 'png',
    save_name: opts.name || ('asset_' + Date.now()),
    style_selections: opts.styles || ['Fooocus V2', 'Fooocus Enhance', 'Fooocus Sharp'],
  };
  const job = await post('/v1/generation/text-to-image', body);
  if (!job.job_id) throw new Error('No job_id: ' + JSON.stringify(job).slice(0,200));
  return job.job_id;
}

async function waitFor(jobId, timeoutMs = 240000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 3000));
    const status = await get(FOOOCUS + '/v1/generation/query-job?job_id=' + jobId);
    if (status.job_stage === 'SUCCESS') return status.job_result;
    if (status.job_stage === 'FAILED' || status.job_stage === 'ERROR') {
      throw new Error('Job failed: ' + JSON.stringify(status).slice(0, 300));
    }
  }
  throw new Error('Timeout waiting for ' + jobId);
}

const ASSETS = [
  // 8 generic UI symbols referenced by js/globals.js
  { dest: 'assets/ui/sym_diamond.png', prompt: 'glowing emerald green diamond gem, glossy faceted, isolated on transparent black background, casino slot symbol, sharp digital art, matrix theme, centered, high contrast, vibrant green glow' },
  { dest: 'assets/ui/sym_cherry.png',  prompt: 'two glossy red cherries with stem and green leaf, isolated on transparent black background, casino slot symbol, premium 3d render, vibrant, centered' },
  { dest: 'assets/ui/sym_seven.png',   prompt: 'lucky number 7 in chrome and neon green, casino slot symbol, isolated on transparent black background, glowing edges, centered, high contrast, premium' },
  { dest: 'assets/ui/sym_star.png',    prompt: 'glowing five-pointed star, neon green and gold, casino slot symbol, isolated on transparent black background, vibrant, centered, premium digital art' },
  { dest: 'assets/ui/sym_bell.png',    prompt: 'classic golden casino slot machine bell, glossy 3d, isolated on transparent black background, premium render, centered, glowing edges' },
  { dest: 'assets/ui/sym_bar.png',     prompt: 'classic stacked BAR symbol in red and gold, casino slot symbol, isolated on transparent black background, glossy 3d render, centered' },
  { dest: 'assets/ui/sym_watermelon.png', prompt: 'glossy half watermelon slice, vibrant red flesh with dark seeds, green rind, casino slot symbol, isolated on transparent black background, centered' },
  { dest: 'assets/ui/sym_lemon.png',   prompt: 'bright yellow lemon with leaf, glossy 3d render, casino slot symbol, isolated on transparent black background, centered, vibrant' },

  // Custom branding assets — Matrix Spins logo + alt OG banner
  { dest: 'assets/branding/logo_matrix_spins.png',
    prompt: 'minimalist casino logo for "Matrix Spins" — stylized green digital rain code falling behind a glowing slot reel symbol, neon green on black, premium clean design, centered, dramatic',
    aspect: '1024*1024' },
  { dest: 'assets/branding/hero_matrix_rain.png',
    prompt: 'cinematic matrix-style green digital rain falling code on pure black background, glowing emerald green characters, premium hero banner, ultra-detailed, atmospheric',
    aspect: '1408*704' },
  { dest: 'assets/branding/loading_screen.png',
    prompt: 'matrix-themed loading screen background, slow green digital rain on black, subtle glow, central blank space for spinner, premium minimal',
    aspect: '1152*896' },
];

async function main() {
  // Ensure dest dirs
  for (const a of ASSETS) {
    const d = path.dirname(a.dest);
    fs.mkdirSync(d, { recursive: true });
  }

  // Submit all jobs in parallel
  console.log('Submitting', ASSETS.length, 'jobs...');
  const submitted = [];
  for (let i = 0; i < ASSETS.length; i++) {
    const a = ASSETS[i];
    try {
      const jobId = await generate(a.prompt, {
        aspect: a.aspect,
        name: 'casino_' + path.basename(a.dest, '.png'),
      });
      submitted.push({ ...a, jobId });
      console.log('  [' + (i+1) + '/' + ASSETS.length + '] queued ' + jobId.slice(0,8) + ' -> ' + a.dest);
    } catch (e) {
      console.log('  [' + (i+1) + '/' + ASSETS.length + '] FAILED to queue ' + a.dest + ': ' + e.message);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  // Wait + download sequentially (Fooocus runs one at a time anyway)
  console.log('\nWaiting for jobs and downloading...');
  let ok = 0, fail = 0;
  for (const j of submitted) {
    try {
      const result = await waitFor(j.jobId);
      if (!Array.isArray(result) || !result[0] || !result[0].url) {
        console.log('  ✗ ' + j.dest + ': no result url');
        fail++;
        continue;
      }
      await download(result[0].url, j.dest);
      console.log('  ✓ ' + j.dest);
      ok++;
    } catch (e) {
      console.log('  ✗ ' + j.dest + ': ' + e.message);
      fail++;
    }
  }
  console.log('\nDone. ' + ok + ' ok / ' + fail + ' failed / ' + ASSETS.length + ' total');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
