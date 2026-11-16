// TELEPROMPTER SYNC SYSTEM (TSS) — Electron main process.
// Bundles the hub + agent so hosting/joining needs no Terminal and no separate
// Node install (the agent runs under Electron's own Node via ELECTRON_RUN_AS_NODE).

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFileSync } = require('child_process');
const hub = require('../server.js');

let win = null;
let hudWin = null;
let agentProc = null;
let hubServer = null;
let keypostPath = null;
let sessionActive = false;
let sessionHost = '';   // URL the HUD watches for live status

// Build (or locate) the keypost helper so key/mouse injection is focus-safe.
function resolveKeypost() {
  const bundled = path.join(__dirname, '..', 'keypost');
  try { fs.accessSync(bundled, fs.constants.X_OK); return bundled; } catch (_) {}
  const out = path.join(app.getPath('userData'), 'keypost');
  try { fs.accessSync(out, fs.constants.X_OK); return out; } catch (_) {}
  const candidates = [
    path.join(process.resourcesPath || '', 'keypost.swift'),
    path.join(__dirname, '..', 'keypost.swift'),
  ];
  const src = candidates.find((p) => { try { fs.accessSync(p); return true; } catch (_) { return false; } });
  if (!src) return null;
  try {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    execFileSync('swiftc', [src, '-o', out], { stdio: 'ignore' });
    return out;
  } catch (_) { return null; } // no swiftc → agent falls back to osascript (keys only)
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 880, minWidth: 380, minHeight: 600,
    backgroundColor: '#101317',
    title: 'Teleprompter Sync System',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.loadFile(path.join(__dirname, 'launch.html'));
  // Show the floating HUD whenever the console loses focus during a live session.
  win.on('blur', () => { if (sessionActive) showHud(); });
  win.on('focus', hideHud);
}

// --- floating activity HUD (top-right, always-on-top, non-stealing) ----------
function createHud() {
  if (hudWin) return;
  const W = 320, H = 158, M = 14;
  const { workArea } = screen.getPrimaryDisplay();
  hudWin = new BrowserWindow({
    width: W, height: H,
    x: workArea.x + workArea.width - W - M,
    y: workArea.y + M,
    frame: false, transparent: true, resizable: false, movable: true,
    skipTaskbar: true, fullscreenable: false, maximizable: false, minimizable: false,
    hasShadow: false, show: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  hudWin.setAlwaysOnTop(true, 'floating');
  hudWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  hudWin.loadFile(path.join(__dirname, 'hud.html'), { query: { host: sessionHost } });
  hudWin.on('closed', () => { hudWin = null; });
}
function showHud() { if (!hudWin) createHud(); if (hudWin && !win.isFocused()) hudWin.showInactive(); }
function hideHud() { if (hudWin) hudWin.hide(); }
function destroyHud() { if (hudWin) { try { hudWin.destroy(); } catch (_) {} hudWin = null; } }

function stopAgent() { if (agentProc) { try { agentProc.kill(); } catch (_) {} agentProc = null; } }
function stopHub() { if (hubServer) { try { hubServer.close(); } catch (_) {} hubServer = null; } }

function spawnAgent(args) {
  stopAgent();
  const agentPath = path.join(__dirname, '..', 'agent.js');
  const full = [...args];
  if (keypostPath) full.push('--keypost', keypostPath);
  agentProc = spawn(process.execPath, [agentPath, ...full], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'ignore',
  });
  agentProc.on('exit', () => { agentProc = null; });
}

async function startHub(preferred) {
  try { return await hub.start({ port: preferred }); }
  catch (_) { return await hub.start({ port: 0 }); } // port busy → let the OS pick one
}

app.whenReady().then(() => {
  keypostPath = resolveKeypost();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { stopAgent(); stopHub(); destroyHud(); if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { stopAgent(); stopHub(); destroyHud(); });

ipcMain.handle('host-session', async (_e, opts = {}) => {
  const res = await startHub(Number(opts.port) || 3000);
  hubServer = res.server;
  const args = ['--host', `http://localhost:${res.port}`, '--name', 'host', '--no-mouse', '--speed', String(opts.speed || 1)];
  if (opts.target) args.push('--target', opts.target);
  spawnAgent(args);
  sessionActive = true;
  sessionHost = `http://localhost:${res.port}`;
  createHud();
  await win.loadURL(`http://localhost:${res.port}`);
  return { port: res.port, primary: res.primary, urls: res.urls, keypost: !!keypostPath };
});

ipcMain.handle('join-session', async (_e, opts = {}) => {
  const host = opts.host;
  const args = ['--host', host, '--name', opts.name || 'backup', '--speed', String(opts.speed || 1)];
  if (opts.target) args.push('--target', opts.target);
  spawnAgent(args);
  sessionActive = true;
  sessionHost = host;
  createHud();
  await win.loadFile(path.join(__dirname, 'joined.html'), {
    query: { host, target: opts.target || '', keypost: keypostPath ? '1' : '0' },
  });
  return { ok: true, keypost: !!keypostPath };
});

ipcMain.handle('leave-session', async () => {
  sessionActive = false; sessionHost = '';
  stopAgent(); stopHub(); destroyHud();
  await win.loadFile(path.join(__dirname, 'launch.html'));
  return { ok: true };
});

ipcMain.handle('focus-main', () => {
  if (win) { win.show(); win.focus(); }
  hideHud();
  return { ok: true };
});
