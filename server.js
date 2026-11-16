#!/usr/bin/env node
/*
 * TELEPROMPTER SYNC SYSTEM (TSS) — host hub
 * -----------------------------------------------------------------------------
 * Serves the control pad and fans every command out to all connected agents.
 * Pure Node built-ins, except the optional `qrcode` dependency used to render
 * the join QR (degrades gracefully if it isn't installed).
 *
 *   - Control pad:        GET  /
 *   - Agents subscribe:   GET  /events   (Server-Sent Events)
 *   - Commands in:        POST /cmd
 *   - Who's connected:    GET  /status
 *   - Join info:          GET  /join      → { primary, urls, port }
 *   - Join QR:            GET  /qr.svg    → on-brand QR of the join URL
 *
 * Usable as a CLI (`node server.js`) or embedded (`require('./server').start()`).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

let QRCode = null;
try { QRCode = require('qrcode'); } catch (_) { /* QR just won't render */ }

const PUBLIC_DIR = path.join(__dirname, 'public');

function createHub() {
  let nextAgentId = 1;
  const agents = new Map();  // id -> { id, name, ip, res, speed, connectedAt }
  const observers = new Set(); // read-only SSE streams (HUD): receive feed, never counted

  function broadcast(payload) {
    const line = `data: ${JSON.stringify(payload)}\n\n`;
    for (const agent of agents.values()) {
      try { agent.res.write(line); } catch (_) { removeAgent(agent.id); }
    }
    for (const res of observers) {
      try { res.write(line); } catch (_) { observers.delete(res); }
    }
  }
  function removeAgent(id) {
    const a = agents.get(id);
    if (a) {
      agents.delete(id);
      try { a.res.end(); } catch (_) {}
      console.log(`[-] agent #${id} (${a.name}) disconnected — ${agents.size} connected`);
    }
  }
  const heartbeat = setInterval(() => {
    for (const agent of agents.values()) {
      try { agent.res.write(`: ping\n\n`); } catch (_) { removeAgent(agent.id); }
    }
    for (const res of observers) { try { res.write(`: ping\n\n`); } catch (_) { observers.delete(res); } }
  }, 15000);
  heartbeat.unref && heartbeat.unref();

  return { get nextAgentId() { return nextAgentId++; }, agents, observers, broadcast, removeAgent };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};
function serveStatic(res, file) {
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR)) { res.writeHead(403).end('forbidden'); return; }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  });
}
function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(body));
  });
}

function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

/**
 * Start the hub. Returns a promise resolving to { server, port, urls, primary }.
 */
function start(opts = {}) {
  // Note: port 0 is valid (OS picks a free port), so don't use `||` here — it
  // would treat 0 as falsy and fall back to 3000.
  const port = opts.port != null ? Number(opts.port)
    : (process.env.PORT != null ? Number(process.env.PORT) : 3000);
  const hub = createHub();

  function joinInfo(reqPort) {
    const ips = lanAddresses();
    const urls = ips.map((ip) => `http://${ip}:${reqPort}`);
    return { primary: urls[0] || `http://localhost:${reqPort}`, urls, port: reqPort };
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    const boundPort = server.address() ? server.address().port : port;

    if (url.pathname === '/events' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*',
      });
      res.write(`retry: 2000\n\n`);

      // Observer (e.g. the activity HUD): watches the feed, never counted or injected to.
      if (url.searchParams.get('observer') === '1') {
        hub.observers.add(res);
        req.on('close', () => hub.observers.delete(res));
        return;
      }

      const id = hub.nextAgentId;
      const name = url.searchParams.get('name') || `agent-${id}`;
      const speed = Math.max(1, Math.min(10, Math.round(Number(url.searchParams.get('speed')) || 1)));
      res.write(`data: ${JSON.stringify({ type: 'hello', id })}\n\n`);
      hub.agents.set(id, { id, name, ip, res, speed, connectedAt: Date.now() });
      console.log(`[+] agent #${id} (${name}) from ${ip} — ${hub.agents.size} connected`);
      req.on('close', () => hub.removeAgent(id));
      return;
    }

    if (url.pathname === '/cmd' && req.method === 'POST') {
      const body = await readBody(req);
      let cmd;
      try { cmd = JSON.parse(body); } catch (_) { res.writeHead(400).end('bad json'); return; }
      cmd.ts = Date.now();
      if (cmd.type === 'speed' && cmd.id != null) {
        const v = Math.max(1, Math.min(10, Math.round(Number(cmd.value) || 1)));
        if (cmd.id === 'all') { for (const a of hub.agents.values()) a.speed = v; }
        else { const a = hub.agents.get(Number(cmd.id)); if (a) a.speed = v; }
      }
      hub.broadcast(cmd);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, delivered: hub.agents.size }));
      return;
    }

    if (url.pathname === '/status' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        count: hub.agents.size,
        agents: [...hub.agents.values()].map((a) => ({
          id: a.id, name: a.name, ip: a.ip, speed: a.speed, connectedAt: a.connectedAt,
        })),
      }));
      return;
    }

    if (url.pathname === '/join' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(joinInfo(boundPort)));
      return;
    }

    if (url.pathname === '/qr.svg' && req.method === 'GET') {
      const target = url.searchParams.get('u') || joinInfo(boundPort).primary;
      if (!QRCode) { res.writeHead(501).end('<!-- qr unavailable: npm install qrcode -->'); return; }
      QRCode.toString(target, {
        type: 'svg', margin: 1, errorCorrectionLevel: 'M',
        color: { dark: '#0c0e12', light: '#ffffff' },
      }, (err, svg) => {
        if (err) { res.writeHead(500).end('qr error'); return; }
        res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-cache' });
        res.end(svg);
      });
      return;
    }

    if (url.pathname === '/' || url.pathname === '') { serveStatic(res, 'index.html'); return; }
    serveStatic(res, url.pathname.replace(/^\/+/, ''));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.removeListener('error', reject);
      const boundPort = server.address().port;
      const info = joinInfo(boundPort);
      resolve({ server, port: boundPort, urls: info.urls, primary: info.primary });
    });
  });
}

module.exports = { start };

// --- CLI ---------------------------------------------------------------------
if (require.main === module) {
  start().then(({ port, urls }) => {
    console.log('\n  TELEPROMPTER SYNC SYSTEM (TSS) — host hub running');
    console.log('  ───────────────────────────────────────────────');
    console.log(`  Control pad (open on this laptop):  http://localhost:${port}`);
    if (urls.length) {
      console.log('\n  Phones / tablets — open or scan:');
      for (const u of urls) console.log(`      ${u}`);
      console.log('\n  Backup laptop agent:');
      for (const u of urls) console.log(`      node agent.js --host ${u} --target "Your App"`);
    }
    console.log('\n  Waiting for agents…\n');
  });
}
