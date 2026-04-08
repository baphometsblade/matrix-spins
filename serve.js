const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const MIME = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.gif':'image/gif','.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.mp3':'audio/mpeg','.wav':'audio/wav','.webp':'image/webp'};
http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);

  // API routes → immediate 404 JSON (no backend on static server)
  if (url.startsWith('/api/')) {
    res.writeHead(404, {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'});
    res.end(JSON.stringify({error: 'No API server', demo: true}));
    return;
  }

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization'});
    res.end();
    return;
  }

  if (url === '/') url = '/index.html';
  const filePath = path.join(ROOT, url);
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found: ' + url); return; }
    res.writeHead(200, {'Content-Type': MIME[ext] || 'application/octet-stream'});
    res.end(data);
  });
}).listen(9999, () => console.log('Casino serving on http://localhost:9999'));
