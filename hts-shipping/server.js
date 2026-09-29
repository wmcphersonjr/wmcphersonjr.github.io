#!/usr/bin/env node
// Local server for the HTS Shipping app.
// Serves the static UI from ./public and proxies the USITC HTS REST API
// (https://hts.usitc.gov/reststop) so the browser doesn't hit CORS limits.
// No dependencies: requires Node 18+ (global fetch).

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const HTS_BASE = process.env.HTS_BASE || 'https://hts.usitc.gov/reststop';
const PUBLIC_DIR = path.join(__dirname, 'public');
const CACHE_TTL_MS = 60 * 60 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const cache = new Map();

async function htsFetch(endpoint, params) {
  const url = `${HTS_BASE}/${endpoint}?${new URLSearchParams(params)}`;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'hts-shipping-local/1.0' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTS API responded ${res.status} for ${url}`);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`HTS API returned non-JSON for ${url}`);
  }
  cache.set(url, { at: Date.now(), data });
  return data;
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function handleApi(req, res, url) {
  const q = url.searchParams;
  try {
    if (url.pathname === '/api/search') {
      const keyword = (q.get('q') || '').trim();
      if (!keyword) return sendJson(res, 400, { error: 'Missing ?q=' });
      return sendJson(res, 200, await htsFetch('search', { keyword }));
    }
    if (url.pathname === '/api/range') {
      const from = (q.get('from') || '').trim();
      const to = (q.get('to') || from).trim();
      if (!from) return sendJson(res, 400, { error: 'Missing ?from=' });
      return sendJson(res, 200, await htsFetch('exportList', { from, to, format: 'JSON', styles: 'false' }));
    }
    return sendJson(res, 404, { error: 'Unknown API route' });
  } catch (err) {
    console.error(err.message);
    return sendJson(res, 502, { error: err.message });
  }
}

function serveStatic(req, res, url) {
  const rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  return serveStatic(req, res, url);
});

server.listen(PORT, () => {
  console.log(`HTS Shipping app running at http://localhost:${PORT}`);
  console.log(`Proxying HTS API: ${HTS_BASE}`);
});
