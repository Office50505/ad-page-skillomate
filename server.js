const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 5174);
const backend = new URL(process.env.SKILLOMATE_API_ORIGIN || 'http://127.0.0.1:3000');
const appOrigin = process.env.SKILLOMATE_APP_ORIGIN || 'http://localhost:5173';
if (process.env.NODE_ENV === 'production' && (!process.env.SKILLOMATE_API_ORIGIN || !process.env.SKILLOMATE_APP_ORIGIN)) throw new Error('Set Skillomate API and app origins');
const allowed = new Set(['/api/auth/send-mobile-otp', '/api/auth/resend-mobile-otp', '/api/auth/verify-mobile-otp', '/api/onboarding/config', '/api/onboarding/session', '/api/onboarding/checkout', '/api/onboarding/verify', '/api/onboarding/status', '/api/onboarding/handoff', '/api/onboarding/cancel']);
function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/ad-config' && req.method === 'GET') return json(res, 200, { appOrigin });
    if (allowed.has(url.pathname)) {
      if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { error: 'Method not allowed' });
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 16000) return json(res, 413, { error: 'Request too large' }); }
      const headers = { 'Content-Type': 'application/json' };
      if (req.headers.authorization) headers.Authorization = req.headers.authorization;
      // Do not trust caller-supplied forwarding headers. Backend sees this proxy's IP for rate limiting.
      const response = await fetch(new URL(url.pathname, backend), { method: req.method, headers, ...(req.method === 'POST' ? { body } : {}), signal: AbortSignal.timeout(30000), redirect: 'error' });
      res.writeHead(response.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(await response.text());
    }
    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
    const name = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1);
    if (!['index.html', 'script.js', 'styles.css'].includes(name) && !/^assets\/[a-zA-Z0-9_.-]+$/.test(name)) return json(res, 404, { error: 'Not found' });
    const file = path.join(__dirname, name);
    const stat = await fs.promises.stat(file);
    const type = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.mp4': 'video/mp4' }[path.extname(file)] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes' };
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    if (range) {
      const start = Number(range[1]), end = range[2] ? Number(range[2]) : stat.size - 1;
      if (start > end || end >= stat.size) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end-start+1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': stat.size }); fs.createReadStream(file).pipe(res);
  } catch (error) { if (!res.headersSent) json(res, error.code === 'ENOENT' ? 404 : 502, { error: 'Service unavailable. Please retry.' }); else res.destroy(); }
}).listen(port, host, () => console.log(`Skillomate ad page: http://${host}:${port}`));
