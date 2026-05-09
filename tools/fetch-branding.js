// Fetch the 3 branding assets that finished on Fooocus side but were not downloaded.
'use strict';
const fs = require('fs');
const http = require('http');

const FOOOCUS = 'http://127.0.0.1:7865';
const JOBS = [
  { jobId: 'e795e624', dest: 'assets/branding/logo_matrix_spins.png' },
  { jobId: '8007dd08', dest: 'assets/branding/hero_matrix_rain.png' },
  { jobId: '6448fa7e', dest: 'assets/branding/loading_screen.png' },
];

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
        try { fs.unlinkSync(dest); } catch (_) {}
        return reject(new Error('HTTP ' + res.statusCode + ' on ' + url));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', reject);
  });
}

async function findJobByPrefix(prefix) {
  const hist = await get(FOOOCUS + '/v1/generation/job-history');
  const all = (hist.history || hist.queue || []);
  return all.find(j => (j.job_id || '').startsWith(prefix));
}

(async () => {
  fs.mkdirSync('assets/branding', { recursive: true });
  for (const j of JOBS) {
    try {
      // Resolve full job_id from prefix
      const found = await findJobByPrefix(j.jobId);
      const fullId = found ? (found.job_id || j.jobId) : j.jobId;
      const status = await get(FOOOCUS + '/v1/generation/query-job?job_id=' + fullId);
      if (status.job_stage !== 'SUCCESS') {
        console.log('  ✗ ' + j.dest + ': stage=' + status.job_stage);
        continue;
      }
      const url = status.job_result && status.job_result[0] && status.job_result[0].url;
      if (!url) {
        console.log('  ✗ ' + j.dest + ': no url');
        continue;
      }
      await download(url, j.dest);
      console.log('  ✓ ' + j.dest);
    } catch (e) {
      console.log('  ✗ ' + j.dest + ': ' + e.message);
    }
  }
})();
