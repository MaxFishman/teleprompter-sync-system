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
const PIN = arg('--pin', ''); // optional session PIN enforced by the host
const RESTORE = process.argv.includes('--restore-focus'); // for osascript fallback only
// Loop guard (set by the host, which runs on the same machine as the controller
// console). When on, the agent will NEVER type into the controller: it refuses
// frontmost injection (no --target → frontmost is the console → key feedback loop
// that can flood macOS and hang the machine) and refuses a target that IS the
// controller app. A dedicated rig laptop runs without this flag and keeps the
// documented "frontmost app" convenience.
const GUARD_FRONTMOST = process.argv.includes('--guard-frontmost');
const SELF_NAME = arg('--self-name', ''); // controller app name to never inject into

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
  // letters
  KeyA: 0, KeyB: 11, KeyC: 8, KeyD: 2, KeyE: 14, KeyF: 3, KeyG: 5, KeyH: 4, KeyI: 34,
  KeyJ: 38, KeyK: 40, KeyL: 37, KeyM: 46, KeyN: 45, KeyO: 31, KeyP: 35, KeyQ: 12, KeyR: 15,
  KeyS: 1, KeyT: 17, KeyU: 32, KeyV: 9, KeyW: 13, KeyX: 7, KeyY: 16, KeyZ: 6,
  // digits + common punctuation
  Digit1: 18, Digit2: 19, Digit3: 20, Digit4: 21, Digit5: 23, Digit6: 22, Digit7: 26, Digit8: 28, Digit9: 25, Digit0: 29,
  Minus: 27, Equal: 24, BracketLeft: 33, BracketRight: 30, Semicolon: 41, Quote: 39, Comma: 43, Period: 47, Slash: 44, Backslash: 42,
  // function keys
  F1: 122, F2: 120, F3: 99, F4: 118, F5: 96, F6: 97, F7: 98, F8: 100, F9: 101, F10: 109, F11: 103, F12: 111,
};

// Optional per-app remap: logical code -> actual code to inject (e.g. Space -> KeyP).
let KEYMAP = {};
try { KEYMAP = JSON.parse(arg('--keymap', '') || '{}') || {}; } catch (_) { KEYMAP = {}; }

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

// --- injection rate backstop -------------------------------------------------
// Hard cap on how fast we inject, so a command feedback-loop can NEVER flood the
// macOS event queue and hang/crash the whole machine. This happens when the host
// is also a rig and keys land in the controller console (frontmost app with no
// explicit --target): the console re-transmits the synthetic keystroke, the agent
// injects it again, and it spins as fast as the network allows. Real input — a
// human at the keyboard, or auto-scroll — stays far below this ceiling; only a
// runaway loop ever hits it, and it gets clamped instead of taking the Mac down.
const INJECT_WINDOW_MS = 1000;
const INJECT_MAX_PER_WINDOW = 20;
let injectStamps = [];
let throttleWarned = false;
function injectAllowed() {
  const now = Date.now();
  while (injectStamps.length && now - injectStamps[0] > INJECT_WINDOW_MS) injectStamps.shift();
  if (injectStamps.length >= INJECT_MAX_PER_WINDOW) {
    if (!throttleWarned) {
      throttleWarned = true;
      process.stderr.write('inject rate capped — dropping excess commands (possible feedback loop)\n');
    }
    return false;
  }
  throttleWarned = false;
  injectStamps.push(now);
  return true;
}

// --- loop guard --------------------------------------------------------------
// Returns true if injecting now would type into the controller console (which
// re-transmits the keystroke → feedback loop). Only active on the host agent.
let guardWarned = false;
function wouldHitController() {
  if (!GUARD_FRONTMOST) return false;
  // No target → osascript/keypost would hit the frontmost app, which on the host
  // is the controller console. Refuse.
  if (!TARGET) return true;
  // Target explicitly set to the controller app → also a loop. Refuse.
  if (SELF_NAME && TARGET.trim().toLowerCase() === SELF_NAME.trim().toLowerCase()) return true;
  return false;
}
function guardSkip() {
  if (!guardWarned) {
    guardWarned = true;
    process.stderr.write('no injection target on the host — skipping (would type into the controller console)\n');
  }
}

// --- injection ---------------------------------------------------------------
function inject(code) {
  if (wouldHitController()) return guardSkip(); // never feed keys back into the console
  if (!injectAllowed()) return;  // safety: never let a feedback loop flood the OS
  // Line-scroll keys repeat SPEED times; jumps/toggles always fire once.
  const count = SCROLL_KEYS.has(code) ? SPEED : 1;

  const actual = KEYMAP[code] || code; // optional per-app remap
  const kc = KEYCODES[actual];
  if (kc === undefined) return;

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

// --- identify: make THIS laptop announce itself (beep + banner) --------------
// Lets an operator spot which physical machine a rig is, from the console.
function identify() {
  const label = String(NAME).replace(/["\\]/g, ''); // keep the AppleScript string safe
  console.log(`identify → ${NAME}`);
  execFile('osascript', [
    '-e', 'beep 2',
    '-e', `display notification "This is \\"${label}\\"" with title "TSS — Identify rig"`,
  ], () => {});
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
  if (PIN) url.searchParams.set('pin', PIN);

  const req = http.get(url, (res) => {
    if (res.statusCode !== 200) {
      console.error(`hub responded ${res.statusCode}; retrying…`);
      res.resume();
      return retry();
    }
    console.log(`connected to ${HOST} as "${NAME}"` +
      (TARGET ? `  → target "${TARGET}"`
              : (GUARD_FRONTMOST ? '  → no target (injection disabled — pick a target app)' : '  → frontmost app')) +
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
            if (msg.type === 'denied') { process.stderr.write(`connection denied (${msg.reason}) — check --pin\n`); continue; }
            if (msg.seq != null) postAck(msg.seq); // confirm receipt (latency + in-sync)
            if (msg.type === 'hello') { myId = msg.id; }
            else if (msg.type === 'key' && msg.code) { inject(msg.code); }
            else if (msg.type === 'mouse') { mouse(msg); }
            else if (msg.type === 'speed' && (msg.id === 'all' || Number(msg.id) === myId)) {
              SPEED = Math.max(1, Math.min(10, Math.round(Number(msg.value) || 1)));
              console.log(`speed → ${SPEED}`);
            }
            else if (msg.type === 'identify' && Number(msg.id) === myId) { identify(); }
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
