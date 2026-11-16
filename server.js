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
  let cmdSeq = 0, latestSeq = 0, armed = true;
  let commander = null;   // { id, name, at } — the controller currently allowed to drive
  const COMMANDER_TTL = 8000; // ms; a silent commander auto-releases so no one gets locked out
  function commanderInfo() {
    return (commander && Date.now() - commander.at < COMMANDER_TTL) ? { id: commander.id, name: commander.name } : null;
  }
  const agents = new Map();   // id -> { id, name, ip, res, speed, connectedAt, latency, lastAckSeq, lastAckAt }
  const observers = new Set();  // read-only SSE streams (HUD): receive feed, never counted
  const sentAt = new Map();   // seq -> send time, for round-trip latency
  const seenCids = new Set(); // agent client-ids seen this session — a repeat means a reconnect
  const STALE_REAP_MS = 9000; // reap an agent that hasn't acked a heartbeat in this long (half-open socket)
  let pendingCrit = [];       // critical one-shot commands re-delivered until acked
  const CRIT_TTL = 3000;      // ms to keep re-delivering a critical command (and to a rig that reconnects)

  function broadcast(payload) {
    payload.seq = ++cmdSeq; latestSeq = cmdSeq;
    sentAt.set(cmdSeq, Date.now());
    if (sentAt.size > 120) sentAt.delete(sentAt.keys().next().value);
    const line = `data: ${JSON.stringify(payload)}\n\n`;
    const gated = payload.type === 'key' || payload.type === 'mouse'; // skip disabled rigs
    for (const agent of agents.values()) {
      if (gated && agent.enabled === false) continue;
      try { agent.res.write(line); } catch (_) { removeAgent(agent.id); }
    }
    for (const res of observers) {
      try { res.write(line); } catch (_) { observers.delete(res); }
    }
    // Critical one-shot commands (All-stop, Roll, Re-home) must land even on a rig
    // that's briefly offline: keep them pending and re-deliver until acked / for a
    // short window — including to any rig that (re)connects during that window.
    if (payload.crit) {
      pendingCrit.push({ seq: cmdSeq, line, gated, deadline: Date.now() + CRIT_TTL });
      if (pendingCrit.length > 20) pendingCrit.shift();
    }
  }
  // Re-deliver pending critical commands to any connected rig that hasn't acked them.
  const retransmit = setInterval(() => {
    if (!pendingCrit.length) return;
    const now = Date.now();
    pendingCrit = pendingCrit.filter((p) => p.deadline > now);
    for (const p of pendingCrit) {
      for (const agent of agents.values()) {
        if (p.gated && agent.enabled === false) continue;
        if ((agent.lastAckSeq || 0) >= p.seq) continue;   // this rig already has it
        try { agent.res.write(p.line); } catch (_) { removeAgent(agent.id); }
      }
    }
  }, 400);
  retransmit.unref && retransmit.unref();
  function setEnabled(id, enabled) { const a = agents.get(Number(id)); if (a) a.enabled = !!enabled; }
  function ack(id, seq) {
    const a = agents.get(Number(id)); if (!a) return;
    seq = Number(seq);
    if (seq > (a.lastAckSeq || 0)) a.lastAckSeq = seq;
    a.lastAckAt = Date.now();
    const t = sentAt.get(seq); if (t) a.latency = Date.now() - t;
  }
  function removeAgent(id) {
    const a = agents.get(id);
    if (a) {
      agents.delete(id);
      try { a.res.end(); } catch (_) {}
      console.log(`[-] agent #${id} (${a.name}) disconnected — ${agents.size} connected`);
    }
  }
  // Heartbeat doubles as a latency probe: a data ping every 2s that agents ack.
  // It's also when we reap half-open rigs — a Wi-Fi drop without a clean close
  // leaves a socket that never throws on write, so an agent can linger "connected"
  // while receiving nothing. No ack for STALE_REAP_MS → drop it, so the rig count
  // and the console's sync state stay honest (and the operator gets a drop alert).
  const heartbeat = setInterval(() => {
    broadcast({ type: 'ping', ts: Date.now() });
    const now = Date.now();
    for (const a of [...agents.values()]) {
      const last = a.lastAckAt || a.connectedAt || now;
      if (now - last > STALE_REAP_MS) {
        console.log(`[-] agent #${a.id} (${a.name}) reaped — no ack for ${Math.round((now - last) / 1000)}s`);
        removeAgent(a.id);
      }
    }
    for (const res of observers) { try { res.write(`: k\n\n`); } catch (_) { observers.delete(res); } }
  }, 2000);
  heartbeat.unref && heartbeat.unref();

  return {
    get nextAgentId() { return nextAgentId++; },
    agents, observers, broadcast, removeAgent, ack, setEnabled,
    get latestSeq() { return latestSeq; },
    get armed() { return armed; },
    setArmed(v) { armed = !!v; },
    commander: commanderInfo,
    claim(id, name) { commander = { id, name: name || 'controller', at: Date.now() }; },
    release(id) { if (commander && commander.id === id) commander = null; },
    // A client-id we've already seen this session reconnecting means it was gone
    // for a while and may have missed commands — flag it until a re-home realigns.
    noteConnect(cid) {
      if (!cid) return false;
      const reconnected = seenCids.has(cid);
      seenCids.add(cid);
      return reconnected;
    },
    clearDesync() { for (const a of agents.values()) a.desynced = false; },
    // Replay still-pending critical commands to a freshly (re)connected rig, so a
    // rig that was offline when All-stop fired still stops the moment it returns.
    replayCrit(res) {
      const now = Date.now();
      for (const p of pendingCrit) { if (p.deadline > now) { try { res.write(p.line); } catch (_) {} } }
    },
    // Refresh (or auto-claim) command on a sent control cmd; returns false if someone else holds it.
    touchCommand(id, name) {
      const c = commanderInfo();
      if (!c) { commander = { id, name: name || 'controller', at: Date.now() }; return true; }
      if (c.id === id) { commander.at = Date.now(); return true; }
      return false;
    },
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
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
  const PIN = String(opts.pin || process.env.TSS_PIN || '').trim();

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

      if (PIN && url.searchParams.get('pin') !== PIN) { res.end(`data: ${JSON.stringify({ type: 'denied', reason: 'pin' })}\n\n`); return; }
      const id = hub.nextAgentId;
      const name = url.searchParams.get('name') || `agent-${id}`;
      const speed = Math.max(1, Math.min(10, Math.round(Number(url.searchParams.get('speed')) || 1)));
      const cid = url.searchParams.get('cid') || '';
      // A returning client-id missed whatever was sent while it was gone — mark it
      // out-of-sync so the console flags it and prompts a re-home.
      const desynced = hub.noteConnect(cid);
      res.write(`data: ${JSON.stringify({ type: 'hello', id })}\n\n`);
      hub.agents.set(id, { id, name, ip, res, speed, cid, enabled: true, desynced, connectedAt: Date.now() });
      console.log(`[+] agent #${id} (${name}) from ${ip} — ${hub.agents.size} connected${desynced ? ' (reconnected — flagged out of sync)' : ''}`);
      hub.replayCrit(res);   // deliver any still-pending critical command (e.g. a recent All-stop)
      req.on('close', () => hub.removeAgent(id));
      return;
    }

    if (url.pathname === '/cmd' && req.method === 'POST') {
      const body = await readBody(req);
      let cmd;
      try { cmd = JSON.parse(body); } catch (_) { res.writeHead(400).end('bad json'); return; }
      if (PIN && cmd.pin !== PIN) {
        res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: false, pin: true }));
        return;
      }
      cmd.ts = Date.now();
      // Control handoff: only the controller "in command" may drive. Diagnostic cmds (identify)
      // and controllers that don't send a cid (older clients) are not gated — backward compatible.
      if (cmd.cid && (cmd.type === 'key' || cmd.type === 'mouse' || cmd.type === 'speed')) {
        if (!hub.touchCommand(cmd.cid, cmd.cname)) {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ ok: false, notCommander: true, commander: hub.commander() }));
          return;
        }
      }
      // Disarmed: key/mouse are blocked so stray input can't go to air. Speed/config pass.
      if ((cmd.type === 'key' || cmd.type === 'mouse') && !hub.armed) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: false, disarmed: true }));
        return;
      }
      if (cmd.type === 'speed' && cmd.id != null) {
        const v = Math.max(1, Math.min(10, Math.round(Number(cmd.value) || 1)));
        if (cmd.id === 'all') { for (const a of hub.agents.values()) a.speed = v; }
        else { const a = hub.agents.get(Number(cmd.id)); if (a) a.speed = v; }
      }
      hub.broadcast(cmd);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, delivered: hub.agents.size, seq: hub.latestSeq }));
      return;
    }

    // Agent confirms a command was injected (powers latency + "in sync").
    if (url.pathname === '/ack' && req.method === 'POST') {
      const body = await readBody(req);
      let a; try { a = JSON.parse(body); } catch (_) { res.writeHead(400).end('bad json'); return; }
      hub.ack(a.id, a.seq);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end('{"ok":true}');
      return;
    }

    // Arm / disarm the whole session (server-enforced across every controller).
    if (url.pathname === '/arm' && req.method === 'POST') {
      const body = await readBody(req);
      let a; try { a = JSON.parse(body); } catch (_) { res.writeHead(400).end('bad json'); return; }
      if (PIN && a.pin !== PIN) { res.writeHead(403, { 'Access-Control-Allow-Origin': '*' }).end('{"ok":false,"pin":true}'); return; }
      hub.setArmed(!!a.armed);
      hub.broadcast({ type: 'armed', value: hub.armed });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, armed: hub.armed }));
      return;
    }

    // Enable / disable a rig (temporarily drop it from the sync set).
    if (url.pathname === '/rig' && req.method === 'POST') {
      const body = await readBody(req);
      let a; try { a = JSON.parse(body); } catch (_) { res.writeHead(400).end('bad json'); return; }
      if (PIN && a.pin !== PIN) { res.writeHead(403, { 'Access-Control-Allow-Origin': '*' }).end('{"ok":false,"pin":true}'); return; }
      hub.setEnabled(a.id, a.enabled);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // Re-home: send every rig to the top (absolute Home) to re-establish a known
    // common position, and clear the out-of-sync flags. The recovery primitive for
    // when a rig dropped, reconnected, and may have missed commands mid-show.
    if (url.pathname === '/rehome' && req.method === 'POST') {
      const body = await readBody(req);
      let a; try { a = JSON.parse(body); } catch (_) { a = {}; }
      if (PIN && a.pin !== PIN) { res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }).end('{"ok":false,"pin":true}'); return; }
      if (a.cid && !hub.touchCommand(a.cid, a.cname)) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: false, notCommander: true, commander: hub.commander() }));
        return;
      }
      if (!hub.armed) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: false, disarmed: true }));
        return;
      }
      hub.broadcast({ type: 'key', code: 'Home', crit: true });   // absolute jump to top on every enabled rig (retransmitted until acked)
      hub.clearDesync();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, delivered: hub.agents.size }));
      return;
    }

    // Control handoff: take or release "command" of the session.
    if (url.pathname === '/command' && req.method === 'POST') {
      const body = await readBody(req);
      let a; try { a = JSON.parse(body); } catch (_) { res.writeHead(400).end('bad json'); return; }
      if (PIN && a.pin !== PIN) { res.writeHead(403, { 'Access-Control-Allow-Origin': '*' }).end('{"ok":false,"pin":true}'); return; }
      if (a.action === 'take') hub.claim(a.cid, a.cname);
      else if (a.action === 'release') hub.release(a.cid);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, commander: hub.commander() }));
      return;
    }

    // Validate a session PIN (controllers call this before enabling control).
    if (url.pathname === '/pincheck' && req.method === 'POST') {
      const body = await readBody(req);
      let a; try { a = JSON.parse(body); } catch (_) { a = {}; }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: !PIN || a.pin === PIN }));
      return;
    }

    if (url.pathname === '/status' && req.method === 'GET') {
      const now = Date.now();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        count: hub.agents.size,
        armed: hub.armed,
        pinRequired: !!PIN,
        latestSeq: hub.latestSeq,
        commander: hub.commander(),
        keypost: !!opts.keypost,   // set by the Electron host — powers the readiness check
        accessibility: typeof opts.accessibility === 'function' ? !!opts.accessibility() : opts.accessibility !== false,
        agents: [...hub.agents.values()].map((a) => ({
          id: a.id, name: a.name, ip: a.ip, speed: a.speed, connectedAt: a.connectedAt,
          enabled: a.enabled !== false,
          latency: a.latency != null ? a.latency : null,
          lastAckSeq: a.lastAckSeq || 0,
          synced: a.enabled === false ? true : (a.lastAckSeq || 0) >= hub.latestSeq,
          stale: a.lastAckAt ? (now - a.lastAckAt > 5000) : true,
          desynced: !!a.desynced,
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

  // Low-latency, dead-peer-aware sockets: no Nagle delay on tiny command frames,
  // and OS keepalive so a silently-dropped peer is detected without waiting on the
  // 2h TCP default (backs up the app-level heartbeat/watchdog).
  server.on('connection', (s) => {
    try { s.setNoDelay(true); s.setKeepAlive(true, 15000); } catch (_) {}
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.removeListener('error', reject);
      const boundPort = server.address().port;
      const info = joinInfo(boundPort);
      resolve({ server, port: boundPort, urls: info.urls, primary: info.primary, hub });
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
