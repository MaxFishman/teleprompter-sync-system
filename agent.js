#!/usr/bin/env node
/*
 * SYNC CONTROL — agent  (runs on EVERY laptop you want to drive)
 * -----------------------------------------------------------------------------
 * Subscribes to the host hub and injects real macOS keystrokes into a target
 * application whenever a command arrives.
 *
 * Injection strategy (best available wins):
 *   1. ./keypost <pid> <keycode>   — posts the key straight to the target app's
 *      process via CGEventPostToPid WITHOUT stealing focus. Build it once with:
 *            swiftc keypost.swift -o keypost
 *      This is what lets the HOST laptop keep the browser pad focused while its
 *      own teleprompter app still scrolls.
 *   2. osascript (built in) fallback — activates the target app, sends the key,
 *      then (optionally) restores focus to whatever was frontmost.
 *
 * Examples:
 *   HOST   (same machine as the browser pad):
 *       node agent.js --host http://localhost:3000 --target "Teleprompter" --name host
 *   CLIENT (redundant, unattended laptop):
 *       node agent.js --host http://192.168.1.42:3000 --target "Teleprompter" --name backup
 *
 * If you omit --target, keys go to whatever app is frontmost on that machine.
 * macOS will require Accessibility permission for Terminal/node (see README).
 */

const http = require('http');
const { execFile, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// --- args --------------------------------------------------------------------
function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const HOST = arg('--host', 'http://localhost:3000').replace(/\/+$/, '');
const TARGET = arg('--target', '');            // app name, e.g. "Teleprompter"
const NAME = arg('--name', `agent-${process.pid}`);
const RESTORE = process.argv.includes('--restore-focus'); // for osascript fallback only

// Scroll speed = how many line-scroll key presses this laptop makes per command.
// Tune per laptop so two different teleprompter apps advance at the same rate.
// Adjustable live from the control pad; this flag is just the starting value.
let SPEED = Math.max(1, Math.min(10, Math.round(Number(arg('--speed', '1')) || 1)));
let myId = null; // assigned by the hub on connect
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

// Mouse mirroring. The HOST laptop should pass --no-mouse (it has the real mouse);
// backup laptops accept mouse commands. Requires the keypost helper (no osascript path).
const MOUSE = !process.argv.includes('--no-mouse');

// --- key name -> macOS virtual key code --------------------------------------
const KEYCODES = {
  ArrowUp: 126, ArrowDown: 125, ArrowLeft: 123, ArrowRight: 124,
  PageUp: 116, PageDown: 121, Home: 115, End: 119,
  Space: 49, Enter: 36, Return: 36, Escape: 53, Tab: 48,
  KeyJ: 38, KeyK: 40, KeyW: 13, KeyS: 1, KeyA: 0, KeyD: 2,
};

// --- locate the optional keypost helper --------------------------------------
const KEYPOST = arg('--keypost', '') || path.join(__dirname, 'keypost');
const HAVE_KEYPOST = (() => {
  try { fs.accessSync(KEYPOST, fs.constants.X_OK); return true; } catch (_) { return false; }
})();

// --- resolve + cache the target app's PID ------------------------------------
let cachedPid = null;
function resolvePid() {
  if (!TARGET) return null;
  if (cachedPid && pidAlive(cachedPid)) return cachedPid;
  try {
    const out = execFileSync('osascript', [
      '-e', `tell application "System Events" to return unix id of (first process whose name is "${TARGET}")`,
    ], { encoding: 'utf8', timeout: 3000 }).trim();
    cachedPid = Number(out) || null;
  } catch (_) {
    cachedPid = null; // app not running (yet)
  }
  return cachedPid;
}
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

// --- injection ---------------------------------------------------------------
function inject(code) {
  const kc = KEYCODES[code];
  if (kc === undefined) return;

  // Line-scroll keys repeat SPEED times; jumps/toggles always fire once.
  const count = SCROLL_KEYS.has(code) ? SPEED : 1;

  // Best path: post straight to the target PID, no focus change.
  if (HAVE_KEYPOST && TARGET) {
    const pid = resolvePid();
    if (pid) { for (let i = 0; i < count; i++) execFile(KEYPOST, ['key', String(pid), String(kc)], () => {}); return; }
  }

  // Fallback: AppleScript System Events — build one script with `count` presses.
  const presses = Array(count).fill(`key code ${kc}`).join('\n');
  let script;
  if (TARGET) {
    if (RESTORE) {
      script =
        `set prev to name of first application process whose frontmost is true\n` +
        `tell application "${TARGET}" to activate\n` +
        `tell application "System Events"\n${presses}\nend tell\n` +
        `tell application "System Events" to set frontmost of process prev to true`;
    } else {
      script =
        `tell application "${TARGET}" to activate\n` +
        `tell application "System Events"\n${presses}\nend tell`;
    }
  } else {
    script = `tell application "System Events"\n${presses}\nend tell`;
  }
  execFile('osascript', ['-e', script], (err) => {
    if (err) process.stderr.write(`inject error: ${err.message}\n`);
  });
}

// --- mouse injection (keypost only — macOS has no osascript path for this) -----
let mouseWarned = false;
function mouse(m) {
  if (!MOUSE) return;
  if (!HAVE_KEYPOST) {
    if (!mouseWarned) { mouseWarned = true; process.stderr.write('mouse control needs the keypost helper — run: swiftc keypost.swift -o keypost\n'); }
    return;
  }
  const n = (v) => String(Number(v) || 0);
  const b = m.button === 'right' ? 'right' : 'left';
  let args;
  switch (m.action) {
    case 'move':     args = ['move', n(m.nx), n(m.ny)]; break;
    case 'drag':     args = ['drag', n(m.nx), n(m.ny), b]; break;
    case 'down':     args = ['down', n(m.nx), n(m.ny), b]; break;
    case 'up':       args = ['up',   n(m.nx), n(m.ny), b]; break;
    case 'click':    args = ['click', n(m.nx), n(m.ny), b]; break;
    case 'moveby':   args = ['moveby', n(m.dx), n(m.dy)]; break;
    case 'clickcur': args = ['clickcur', b]; break;
    case 'scroll':   args = ['scroll', String(Math.round(Number(m.dy) || 0))]; break;
    default: return;
  }
  execFile(KEYPOST, args, () => {});
}

// --- ack a received command so the host can show latency + "in sync" ---------
function postAck(seq) {
  if (myId == null) return;
  try {
    const u = new URL(HOST + '/ack');
    const data = JSON.stringify({ id: myId, seq });
    const req = http.request({
      hostname: u.hostname, port: u.port || 80, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (r) => r.resume());
    req.on('error', () => {});
    req.write(data); req.end();
  } catch (_) {}
}

// --- SSE client (hand-rolled, so we need no dependencies) ---------------------
function connect() {
  const url = new URL(`${HOST}/events`);
  url.searchParams.set('name', NAME);
  url.searchParams.set('speed', String(SPEED));

  const req = http.get(url, (res) => {
    if (res.statusCode !== 200) {
      console.error(`hub responded ${res.statusCode}; retrying…`);
      res.resume();
      return retry();
    }
    console.log(`connected to ${HOST} as "${NAME}"` +
      (TARGET ? `  → target "${TARGET}"` : '  → frontmost app') +
      `  [speed ${SPEED}]` +
      `  [mouse ${MOUSE ? (HAVE_KEYPOST ? 'on' : 'needs keypost') : 'off'}]` +
      (HAVE_KEYPOST ? '  [keypost: on]' : '  [keypost: off, using osascript]'));

    res.setEncoding('utf8');
    let buf = '';
    res.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data) continue;
          try {
            const msg = JSON.parse(data);
            if (msg.seq != null) postAck(msg.seq); // confirm receipt (latency + in-sync)
            if (msg.type === 'hello') { myId = msg.id; }
            else if (msg.type === 'key' && msg.code) { inject(msg.code); }
            else if (msg.type === 'mouse') { mouse(msg); }
            else if (msg.type === 'speed' && (msg.id === 'all' || Number(msg.id) === myId)) {
              SPEED = Math.max(1, Math.min(10, Math.round(Number(msg.value) || 1)));
              console.log(`speed → ${SPEED}`);
            }
          } catch (_) {}
        }
      }
    });
    res.on('end', retry);
    res.on('error', retry);
  });
  req.on('error', (e) => { console.error(`connection error: ${e.message}`); retry(); });
}

let retryTimer = null;
function retry() {
  if (retryTimer) return;
  retryTimer = setTimeout(() => { retryTimer = null; connect(); }, 2000);
}

console.log(`SYNC CONTROL agent "${NAME}" starting…`);
connect();
