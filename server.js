// EuroVote local server
// ---------------------
// Only needed to run the site on your own computer: the published version on
// GitHub Pages is just the files in ./public, with no server at all.
//
// It does two small jobs (no npm packages, needs Node 18 or newer):
//   1. Serves the files in ./public at http://localhost:8787
//   2. Refreshes public/data/parties.json (national parties) when it is missing
//      or more than a day old, using scripts/update-parties.mjs
//
// Start it with:  npm start

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { updateParties, PARTIES_FILE } from './scripts/update-parties.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8787);
const DAY = 24 * 60 * 60 * 1000;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
    const file = path.normalize(path.join(PUBLIC_DIR, relative));
    // Never serve anything outside ./public (protects against "../" tricks).
    if (!file.startsWith(PUBLIC_DIR + path.sep) || !existsSync(file) || (await stat(file)).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(await readFile(file));
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500);
    res.end('Server error');
  }
});

async function partiesNeedUpdate() {
  try {
    return Date.now() - (await stat(PARTIES_FILE)).mtimeMs > DAY;
  } catch {
    return true; // no file yet
  }
}

server.listen(PORT, async () => {
  const address = `http://localhost:${PORT}`;
  console.log(`EuroVote is running at ${address}  (stop with Ctrl+C)`);
  // On a Mac, open the browser automatically. Set NO_OPEN=1 to skip this.
  if (process.platform === 'darwin' && !process.env.NO_OPEN) exec(`open ${address}`);
  if (await partiesNeedUpdate()) await updateParties().catch((err) => console.warn(err.message));
});
