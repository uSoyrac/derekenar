// Derlenmiş web uygulamasını (web/dist) sunan küçük statik sunucu; yalnızca testler için.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.wasm': 'application/wasm', '.gz': 'application/gzip',
};

export function startStatic(port = 0, extra = {}) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    // Testler gerçek projeye bağlanmasın: yayın ayarı yerine boş ayar sunulur.
    if (url.pathname === '/config.json') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{}'); }
    if (extra[url.pathname]) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(extra[url.pathname]); }
    let file = path.join(dist, decodeURIComponent(url.pathname));
    if (!file.startsWith(dist)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) }));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await startStatic(Number(process.env.PORT || 0));
  console.log(s.url);
}
