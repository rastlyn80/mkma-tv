// MKMA TV — lightweight digital signage server. No external dependencies.
// Runs on Node 18+. Serves the TV display (/display) and the admin (/admin).
'use strict';
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const os = require('os');

const PORT = parseInt(process.env.PORT || '8080', 10);
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const MEDIA_DIR = process.env.MEDIA_DIR || path.join(ROOT, 'media');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const MAX_UPLOAD = 1024 * 1024 * 1024; // 1 GB

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(MEDIA_DIR, { recursive: true });

const DEFAULT_SETTINGS = {
  academyName: 'Milton Keynes Music Academy',
  defaultDuration: 10,
  transition: 'fade',
  screenSchedule: { enabled: false, on: '08:00', off: '21:30' },
  showClock: false,
};

// ---------- storage ----------
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJSON(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file); // atomic, survives power cuts mid-write
}
let db = readJSON(DB_FILE, null);
if (!db) {
  db = { version: 1, items: [], settings: { ...DEFAULT_SETTINGS } };
  writeJSON(DB_FILE, db);
}
db.settings = { ...DEFAULT_SETTINGS, ...db.settings };
let auth = readJSON(AUTH_FILE, { hash: null, salt: null });
const sessions = new Map(); // token -> expiry

function saveDb() { db.updatedAt = Date.now(); writeJSON(DB_FILE, db); broadcast(); }

// ---------- auth ----------
function hashPassword(pw, salt) {
  return crypto.scryptSync(String(pw), salt, 32).toString('hex');
}
function setPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  auth = { salt, hash: hashPassword(pw, salt) };
  writeJSON(AUTH_FILE, auth);
}
function checkPassword(pw) {
  if (!auth.hash) return false;
  const a = Buffer.from(hashPassword(pw, auth.salt), 'hex');
  const b = Buffer.from(auth.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function newSession() {
  const t = crypto.randomBytes(24).toString('hex');
  sessions.set(t, Date.now() + 30 * 24 * 3600 * 1000);
  return t;
}
function getCookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
function isAuthed(req) {
  const t = getCookie(req, 'mkma_session');
  const exp = t && sessions.get(t);
  return !!exp && exp > Date.now();
}
// login rate limit
const attempts = new Map();
function tooMany(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  attempts.set(ip, list);
  return list.length >= 10;
}

// ---------- live updates (Server-Sent Events) ----------
const clients = new Set();
function broadcast() {
  const msg = `data: ${JSON.stringify({ updatedAt: db.updatedAt })}\n\n`;
  for (const res of clients) res.write(msg);
}
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000);

// ---------- helpers ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm',
  '.mov': 'video/quicktime', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const VIDEO_EXT = new Set(['.mp4', '.m4v', '.webm', '.mov']);

function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}
function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJsonBody(req) {
  const buf = await readBody(req);
  return buf.length ? JSON.parse(buf.toString('utf8')) : {};
}
function safeMediaPath(name) {
  const base = path.basename(String(name || ''));
  if (!base || base.startsWith('.')) return null;
  return path.join(MEDIA_DIR, base);
}
function slugify(name) {
  const ext = path.extname(name).toLowerCase();
  const stem = path.basename(name, path.extname(name)).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'file';
  return `${stem}-${crypto.randomBytes(3).toString('hex')}${ext}`;
}
function probeVideo(file) {
  return new Promise((resolve) => {
    execFile('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,width,height:format=duration', '-of', 'json', file],
    { timeout: 20000 }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        const j = JSON.parse(stdout); const s = (j.streams || [])[0] || {};
        resolve({ codec: s.codec_name, width: s.width, height: s.height,
          duration: j.format && j.format.duration ? Math.round(parseFloat(j.format.duration)) : null });
      } catch { resolve(null); }
    });
  });
}
function videoWarnings(info) {
  const w = [];
  if (!info) return ['Could not check this video. If it stutters, convert it to H.264 MP4 at 720p.'];
  if (info.codec && info.codec !== 'h264') w.push(`This video uses ${info.codec.toUpperCase()}. The NUC plays H.264 MP4 smoothly; other formats may stutter or not play.`);
  if (info.height && info.height > 1080) w.push(`This video is ${info.width}×${info.height}. Above 1080p will not play smoothly on this NUC; 720p is safest.`);
  return w;
}

// ---------- static files (with Range support for video) ----------
async function serveFile(req, res, file, cache) {
  let stat;
  try { stat = await fsp.stat(file); } catch { return send(res, 404, 'Not found'); }
  if (!stat.isFile()) return send(res, 404, 'Not found');
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes',
    'Cache-Control': cache ? 'public, max-age=31536000, immutable' : 'no-cache' };
  const range = req.headers.range;
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
    if (m && !m[1] && m[2]) { start = stat.size - parseInt(m[2], 10); end = stat.size - 1; }
    if (start >= stat.size || end >= stat.size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end();
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

// ---------- validation ----------
const ITEM_TYPES = new Set(['image', 'video', 'slide']);
function cleanItems(items) {
  if (!Array.isArray(items)) throw new Error('items must be an array');
  return items.slice(0, 500).map((it) => {
    if (!it || !ITEM_TYPES.has(it.type)) throw new Error('Invalid item type');
    return {
      id: String(it.id || crypto.randomBytes(6).toString('hex')).slice(0, 40),
      type: it.type,
      title: String(it.title || '').slice(0, 120),
      enabled: it.enabled !== false,
      duration: Math.max(0, Math.min(3600, Number(it.duration) || 0)),
      startDate: /^\d{4}-\d{2}-\d{2}$/.test(it.startDate || '') ? it.startDate : '',
      endDate: /^\d{4}-\d{2}-\d{2}$/.test(it.endDate || '') ? it.endDate : '',
      days: Array.isArray(it.days) ? it.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [],
      src: it.src ? path.basename(String(it.src)) : undefined,
      fit: it.fit === 'contain' ? 'contain' : 'cover',
      muted: it.muted !== false,
      slide: it.type === 'slide' ? it.slide : undefined,
      info: it.info,
    };
  });
}

// ---------- routes ----------
async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const ip = req.socket.remoteAddress;

  // pages
  if (p === '/') return send(res, 302, '', { Location: '/admin' });
  if (p === '/favicon.ico') return serveFile(req, res, path.join(PUBLIC_DIR, 'icons', 'favicon-32.png'));
  if (p === '/manifest.webmanifest') { res.setHeader('Content-Type', 'application/manifest+json'); return serveFile(req, res, path.join(PUBLIC_DIR, 'manifest.webmanifest')); }
  if (p === '/sw.js') return serveFile(req, res, path.join(PUBLIC_DIR, 'sw.js'));
  if (p === '/display') return serveFile(req, res, path.join(PUBLIC_DIR, 'display.html'));
  if (p === '/admin') return serveFile(req, res, path.join(PUBLIC_DIR, 'admin.html'));
  if (p.startsWith('/media/')) {
    const f = safeMediaPath(decodeURIComponent(p.slice(7)));
    return f ? serveFile(req, res, f, true) : send(res, 404, 'Not found');
  }
  if (p.startsWith('/static/')) {
    const rel = path.normalize(decodeURIComponent(p.slice(8))).replace(/^(\.\.[/\\])+/, '');
    const f = path.join(PUBLIC_DIR, rel);
    if (!f.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden');
    return serveFile(req, res, f);
  }

  // live updates
  if (p === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ updatedAt: db.updatedAt || 0 })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  // public state for the display
  if (p === '/api/state' && req.method === 'GET') {
    const ips = Object.values(os.networkInterfaces()).flat()
      .filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);
    return send(res, 200, { items: db.items, settings: db.settings, updatedAt: db.updatedAt || 0,
      host: { name: os.hostname(), ips, port: PORT } });
  }

  // auth
  if (p === '/api/me') return send(res, 200, { authed: isAuthed(req), needsSetup: !auth.hash });
  if (p === '/api/setup' && req.method === 'POST') {
    if (auth.hash) return send(res, 403, { error: 'Password already set' });
    const { password } = await readJsonBody(req);
    if (!password || String(password).length < 6) return send(res, 400, { error: 'Use at least 6 characters' });
    setPassword(password);
    return send(res, 200, { ok: true }, { 'Set-Cookie': `mkma_session=${newSession()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000` });
  }
  if (p === '/api/login' && req.method === 'POST') {
    if (tooMany(ip)) return send(res, 429, { error: 'Too many attempts. Wait 10 minutes.' });
    const { password } = await readJsonBody(req);
    if (!checkPassword(password)) { attempts.get(ip).push(Date.now()); return send(res, 401, { error: 'Wrong password' }); }
    return send(res, 200, { ok: true }, { 'Set-Cookie': `mkma_session=${newSession()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000` });
  }
  if (p === '/api/logout' && req.method === 'POST') {
    sessions.delete(getCookie(req, 'mkma_session'));
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'mkma_session=; Path=/; Max-Age=0' });
  }

  // everything below needs login
  if (p.startsWith('/api/') && !isAuthed(req)) return send(res, 401, { error: 'Not logged in' });

  if (p === '/api/items' && req.method === 'PUT') {
    const body = await readJsonBody(req);
    db.items = cleanItems(body.items);
    saveDb();
    return send(res, 200, { ok: true, updatedAt: db.updatedAt });
  }
  if (p === '/api/settings' && req.method === 'PUT') {
    const s = await readJsonBody(req);
    db.settings = {
      ...db.settings,
      academyName: String(s.academyName ?? db.settings.academyName).slice(0, 100),
      defaultDuration: Math.max(3, Math.min(600, Number(s.defaultDuration) || 10)),
      transition: s.transition === 'cut' ? 'cut' : 'fade',
      showClock: !!s.showClock,
      screenSchedule: {
        enabled: !!(s.screenSchedule && s.screenSchedule.enabled),
        on: /^\d{2}:\d{2}$/.test(s.screenSchedule?.on) ? s.screenSchedule.on : '08:00',
        off: /^\d{2}:\d{2}$/.test(s.screenSchedule?.off) ? s.screenSchedule.off : '21:30',
      },
    };
    saveDb();
    return send(res, 200, { ok: true, settings: db.settings });
  }
  if (p === '/api/password' && req.method === 'POST') {
    const { current, next } = await readJsonBody(req);
    if (!checkPassword(current)) return send(res, 401, { error: 'Current password is wrong' });
    if (!next || String(next).length < 6) return send(res, 400, { error: 'Use at least 6 characters' });
    setPassword(next); sessions.clear();
    return send(res, 200, { ok: true }, { 'Set-Cookie': `mkma_session=${newSession()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000` });
  }

  // uploads: raw body, original filename in ?name=
  if (p === '/api/upload' && req.method === 'PUT') {
    const original = url.searchParams.get('name') || 'upload.jpg';
    const ext = path.extname(original).toLowerCase();
    if (!IMAGE_EXT.has(ext) && !VIDEO_EXT.has(ext)) return send(res, 400, { error: 'Only photos (JPG, PNG, WebP) and videos (MP4, WebM, MOV) are supported' });
    const name = slugify(original);
    const dest = path.join(MEDIA_DIR, name);
    const out = fs.createWriteStream(dest);
    let size = 0, aborted = false;
    req.on('data', (c) => { size += c.length; if (size > MAX_UPLOAD && !aborted) { aborted = true; req.destroy(); out.destroy(); fs.unlink(dest, () => {}); } });
    req.pipe(out);
    out.on('finish', async () => {
      if (aborted) return;
      const kind = VIDEO_EXT.has(ext) ? 'video' : 'image';
      let info = null, warnings = [];
      if (kind === 'video') { info = await probeVideo(dest); warnings = videoWarnings(info); }
      send(res, 200, { file: name, kind, size, info, warnings });
    });
    out.on('error', () => send(res, 500, { error: 'Could not save the file' }));
    req.on('error', () => fs.unlink(dest, () => {}));
    return;
  }
  if (p === '/api/media' && req.method === 'GET') {
    const files = await fsp.readdir(MEDIA_DIR);
    const used = new Set();
    for (const it of db.items) {
      if (it.src) used.add(it.src);
      if (it.slide && it.slide.bgImage) used.add(it.slide.bgImage);
      for (const b of (it.slide && it.slide.blocks) || []) if (b.src) used.add(b.src);
    }
    const list = await Promise.all(files.filter((f) => !f.startsWith('.')).map(async (f) => {
      const st = await fsp.stat(path.join(MEDIA_DIR, f));
      return { file: f, size: st.size, kind: VIDEO_EXT.has(path.extname(f).toLowerCase()) ? 'video' : 'image', used: used.has(f) };
    }));
    return send(res, 200, { files: list });
  }
  if (p === '/api/media' && req.method === 'DELETE') {
    const f = safeMediaPath(url.searchParams.get('file'));
    if (!f) return send(res, 400, { error: 'Bad file' });
    await fsp.unlink(f).catch(() => {});
    return send(res, 200, { ok: true });
  }

  send(res, 404, { error: 'Not found' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: err.message || 'Server error' });
  });
});
server.requestTimeout = 0; // allow long video uploads
server.listen(PORT, () => console.log(`MKMA TV running on http://localhost:${PORT}  (admin: /admin, display: /display)`));
