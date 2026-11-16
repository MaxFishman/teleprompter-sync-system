// TELEPROMPTER SYNC SYSTEM (TSS) — Electron main process.
// Bundles the hub + agent so hosting/joining needs no Terminal and no separate
// Node install (the agent runs under Electron's own Node via ELECTRON_RUN_AS_NODE).

const { app, BrowserWindow, ipcMain, screen, shell, dialog, Menu, globalShortcut, Tray, nativeImage, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { spawn, execFileSync } = require('child_process');
const hub = require('../server.js');

const REPO = 'MaxFishman/teleprompter-sync-system';

let win = null;
let hudWin = null;
let agentProc = null;
let hubServer = null;
let keypostPath = null;
let sessionActive = false;
let sessionHost = '';   // URL the HUD watches for live status
let hubRef = null;      // the running hub (host sessions only) for hotkeys + arm
let tray = null;
let trayTimer = null;
let sessionMode = null; // 'host' | 'join' | null
let quitConfirmed = false; // set once the user OKs quitting a live session
let joinedQuery = {};   // query for re-opening joined.html
let sessionPinValue = '';
let miniWin = null;     // compact always-on-top transport

// --- global hotkeys: drive scroll without focusing the console (host only) ----
const HOTKEYS = {
  'CommandOrControl+Shift+Down': 'ArrowDown',
  'CommandOrControl+Shift+Up': 'ArrowUp',
  'CommandOrControl+Shift+Right': 'PageDown',
  'CommandOrControl+Shift+Left': 'PageUp',
  'CommandOrControl+Shift+Space': 'Space',
};
function registerHotkeys() {
  for (const [accel, code] of Object.entries(HOTKEYS)) {
    try {
      globalShortcut.register(accel, () => {
        if (hubRef && hubRef.armed) hubRef.broadcast({ type: 'key', code, ts: Date.now() });
      });
    } catch (_) {}
  }
}
function unregisterHotkeys() { try { globalShortcut.unregisterAll(); } catch (_) {} }

// --- menu-bar tray: status + quick actions while hosting in the background -----
function createTray() {
  if (tray) return;
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, 'trayTemplate.png'));
    img.setTemplateImage(true);
    tray = new Tray(img);
    tray.setToolTip('Teleprompter Sync System');
    updateTray();
    trayTimer = setInterval(() => { if (sessionActive) updateTray(); }, 2000);
  } catch (_) {}
}
function updateTray() {
  if (!tray) return;
  const count = hubRef ? hubRef.agents.size : 0;
  const hosting = sessionActive && !!hubRef;
  const armedNow = hubRef ? hubRef.armed : true;
  const rigs = count + (count === 1 ? ' rig' : ' rigs');
  let sync = '', warn = false;
  if (hosting) {
    const ags = [...hubRef.agents.values()].filter((a) => a.enabled !== false), now = Date.now();
    const stale = ags.some((a) => (a.lastAckAt ? now - a.lastAckAt > 5000 : true));
    const synced = ags.length && ags.every((a) => (a.lastAckSeq || 0) >= hubRef.latestSeq);
    warn = stale && ags.length > 0;
    sync = ags.length ? (stale ? ' · DRIFT' : synced ? ' · in sync' : ' · syncing') : '';
  }
  const menu = Menu.buildFromTemplate([
    { label: hosting ? `Hosting · ${rigs}${sync}` : (sessionActive ? 'Backup rig · connected' : 'Idle'), enabled: false },
    { type: 'separator' },
    { label: 'Open console', enabled: sessionActive, click: () => openConsole() },
    { label: miniWin ? 'Hide mini controller' : 'Mini controller', enabled: sessionActive, click: () => toggleMini() },
    ...(hosting ? [{ label: armedNow ? 'Disarm (block input)' : 'Arm (go live)', click: () => {
      hubRef.setArmed(!hubRef.armed); hubRef.broadcast({ type: 'armed', value: hubRef.armed }); updateTray();
    } }] : []),
    { label: 'Leave session', enabled: sessionActive, click: () => leaveSession() },
    { type: 'separator' },
    { label: 'Open at Login', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }) },
    { label: 'Check for Updates…', click: checkUpdatesInteractive },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.setTitle(hosting ? `  ${count}${warn ? ' ⚠' : ''}` : '');
}

async function leaveSession() {
  sessionActive = false; sessionHost = ''; hubRef = null; sessionMode = null; sessionPinValue = '';
  unregisterHotkeys(); stopAdvertise();
  stopAgent(); stopHub(); destroyHud(); destroyMini();
  updateTray();
  if (!win || win.isDestroyed()) createWindow();
  else await win.loadFile(path.join(__dirname, 'launch.html'));
  win.show(); win.focus();
}

// Re-open the window to the right screen for the current session.
async function openConsole() {
  if (!win || win.isDestroyed()) createWindow();
  if (sessionMode === 'host' && sessionHost) await win.loadURL(sessionHost);
  else if (sessionMode === 'join') await win.loadFile(path.join(__dirname, 'joined.html'), { query: joinedQuery });
  win.show(); win.focus();
}

// --- in-app updates (checks GitHub Releases) ---------------------------------
function httpsJSON(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'TSS', Accept: 'application/vnd.github+json' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
        res.resume(); return httpsJSON(res.headers.location, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
function isNewer(current, latest) {
  const a = String(current).replace(/^v/, '').split('.').map(Number);
  const b = String(latest).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((b[i] || 0) > (a[i] || 0)) return true; if ((b[i] || 0) < (a[i] || 0)) return false; }
  return false;
}
async function getUpdate() {
  try {
    const beta = !!loadConfig().beta;
    const data = await httpsJSON(`https://api.github.com/repos/${REPO}/releases${beta ? '?per_page=5' : '/latest'}`);
    const rel = Array.isArray(data) ? (data.find((r) => !r.draft) || data[0]) : data; // beta: newest incl. prereleases
    if (!rel) throw new Error('no release');
    const latest = (rel.tag_name || '').replace(/^v/, '');
    const current = app.getVersion();
    const dmg = (rel.assets || []).find((a) => /\.dmg$/i.test(a.name));
    return { current, latest, newer: !!latest && isNewer(current, latest), notes: (rel.body || '').slice(0, 4000),
      page: rel.html_url, dmg: dmg ? dmg.browser_download_url : rel.html_url, beta };
  } catch (e) { return { current: app.getVersion(), latest: null, newer: false, error: String(e.message || e) }; }
}
function downloadFile(url, dest, onProgress, redirects = 0) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, { headers: { 'User-Agent': 'TSS' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
        file.close(); fs.unlink(dest, () => {});
        return downloadFile(res.headers.location, dest, onProgress, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); file.close(); fs.unlink(dest, () => {}); return reject(new Error('HTTP ' + res.statusCode)); }
      const total = Number(res.headers['content-length'] || 0); let got = 0;
      res.on('data', (c) => { got += c.length; if (total) onProgress(got / total); });
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
    }).on('error', (e) => { file.close(); fs.unlink(dest, () => {}); reject(e); });
  });
}
async function checkUpdatesInteractive() {
  const u = await getUpdate();
  if (u.newer) {
    const r = await dialog.showMessageBox(win, { type: 'info', buttons: ['Download', 'Later'], defaultId: 0, cancelId: 1,
      message: `Update available — TSS ${u.latest}`, detail: `You have ${u.current}. Download the new version?` });
    if (r.response === 0) shell.openExternal(u.dmg);
  } else {
    dialog.showMessageBox(win, { type: 'info', buttons: ['OK'],
      message: "You're up to date", detail: `TSS ${u.current} is the latest version.` });
  }
}
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ label: app.name, submenu: [
      { role: 'about' },
      { label: 'Check for Updates…', click: checkUpdatesInteractive },
      { label: 'Open at Login', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }) },
      { label: 'Use beta updates', type: 'checkbox', checked: !!loadConfig().beta,
        click: (item) => { const c = loadConfig(); c.beta = item.checked; saveConfig(c); } },
      { type: 'separator' },
      { role: 'services' }, { type: 'separator' },
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
      { type: 'separator' }, { role: 'quit' },
    ] }] : []),
    { label: 'File', submenu: [
      { label: 'Export Settings…', click: () => exportSettings() },
      { label: 'Import Settings…', click: () => importSettings() },
      { type: 'separator' },
      { label: 'Accessibility Permission…', click: async () => {
          if (axGranted()) { dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, { type: 'info', buttons: ['OK'], message: 'Accessibility is already granted.', detail: 'TSS can send keystrokes to your teleprompter app.' }); return; }
          const r = await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, { type: 'warning', buttons: ['Open Settings', 'Later'], defaultId: 0, cancelId: 1,
            message: 'TSS needs Accessibility permission to send keystrokes.', detail: 'Open System Settings → Privacy & Security → Accessibility and enable Teleprompter Sync System, then relaunch if needed.' });
          if (r.response === 0) shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
        } },
    ] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
    { label: 'Window', submenu: [
      { label: 'Mini Controller', accelerator: 'CommandOrControl+Shift+M', click: () => toggleMini() },
      { type: 'separator' },
      { role: 'minimize' }, { role: 'zoom' }, { role: 'close' },
    ] },
    { label: 'Help', submenu: [
      { label: 'TSS Website', click: () => shell.openExternal('https://maxfishman.github.io/teleprompter-sync-system/') },
      { label: 'Releases & Changelog', click: () => shell.openExternal(`https://github.com/${REPO}/releases`) },
      { label: 'Check for Updates…', click: checkUpdatesInteractive },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// --- remembered settings + running-app picker --------------------------------
function configPath() { return path.join(app.getPath('userData'), 'tss-config.json'); }
function loadConfig() { try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch (_) { return {}; } }
function saveConfig(obj) {
  try { fs.mkdirSync(path.dirname(configPath()), { recursive: true }); fs.writeFileSync(configPath(), JSON.stringify(obj, null, 2)); } catch (_) {}
}
ipcMain.handle('get-config', () => loadConfig());
ipcMain.handle('set-config', (_e, obj) => { const c = { ...loadConfig(), ...(obj || {}) }; saveConfig(c); return c; });
ipcMain.handle('list-apps', () => {
  try {
    const out = execFileSync('osascript', [
      '-e', 'tell application "System Events" to get name of every application process whose background only is false',
    ], { encoding: 'utf8', timeout: 4000 });
    return out.split(',').map((s) => s.trim())
      .filter((n) => n && n !== 'Teleprompter Sync System' && n !== 'Electron')
      .sort((a, b) => a.localeCompare(b));
  } catch (_) { return []; }
});

// --- Accessibility permission (needed to inject keystrokes) -------------------
function axGranted() {
  if (process.platform !== 'darwin') return true;
  try { return systemPreferences.isTrustedAccessibilityClient(false); } catch (_) { return true; }
}
ipcMain.handle('ax-status', () => axGranted());
ipcMain.handle('ax-prompt', () => {         // shows the system prompt, then returns current state
  try { if (process.platform === 'darwin') systemPreferences.isTrustedAccessibilityClient(true); } catch (_) {}
  return axGranted();
});
ipcMain.handle('open-accessibility', () => {
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
  return true;
});

// --- Settings export / import -------------------------------------------------
async function exportSettings() {
  const r = await dialog.showSaveDialog(win && !win.isDestroyed() ? win : undefined, {
    title: 'Export TSS settings', defaultPath: 'tss-settings.json', filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePath) return { ok: false };
  const cfg = loadConfig(); delete cfg.winBounds;   // window geometry is machine-specific
  fs.writeFileSync(r.filePath, JSON.stringify({ tss: true, exported: new Date().toISOString(), settings: cfg }, null, 2));
  return { ok: true, path: r.filePath };
}
async function importSettings() {
  const r = await dialog.showOpenDialog(win && !win.isDestroyed() ? win : undefined, {
    title: 'Import TSS settings', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false };
  let data;
  try { data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')); } catch (_) { return { ok: false, error: 'Not a valid settings file.' }; }
  const incoming = data && data.settings ? data.settings : data;   // accept wrapped or raw
  if (!incoming || typeof incoming !== 'object') return { ok: false, error: 'Not a TSS settings file.' };
  const cur = loadConfig();
  saveConfig({ ...cur, ...incoming, winBounds: cur.winBounds });    // keep this machine's window geometry
  if (win && !win.isDestroyed() && !sessionActive) win.webContents.reload();   // re-render the launch screen
  return { ok: true };
}
ipcMain.handle('export-settings', () => exportSettings());
ipcMain.handle('import-settings', () => importSettings());

// --- Zero-config discovery (Bonjour / mDNS) -----------------------------------
// Hosts advertise _tss._tcp; the Join screen lists them so no IP typing is needed.
let bonjour = null, mdnsService = null, mdnsBrowser = null;
const discovered = new Map();   // name -> { name, host, port }
function mdns() {
  if (bonjour) return bonjour;
  try { const { Bonjour } = require('bonjour-service'); bonjour = new Bonjour(); } catch (_) { bonjour = null; }
  return bonjour;
}
function advertiseSession(port) {
  const b = mdns(); if (!b) return;
  try {
    mdnsService = b.publish({ name: 'TSS · ' + os.hostname().replace(/\.local$/, ''), type: 'tss', port, txt: { v: app.getVersion() } });
  } catch (_) {}
}
function stopAdvertise() {
  try { if (mdnsService) mdnsService.stop(); } catch (_) {}
  mdnsService = null;
}
function startDiscovery() {
  const b = mdns(); if (!b || mdnsBrowser) return;
  try {
    mdnsBrowser = b.find({ type: 'tss' });
    mdnsBrowser.on('up', (s) => {
      const ip = (s.addresses || []).find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)) || (s.referer && s.referer.address);
      if (ip) discovered.set(s.name, { name: s.name, host: 'http://' + ip + ':' + s.port, port: s.port });
    });
    mdnsBrowser.on('down', (s) => { if (s && s.name) discovered.delete(s.name); });
  } catch (_) {}
}
ipcMain.handle('list-sessions', () => {
  startDiscovery();
  return [...discovered.values()].filter((s) => !mdnsService || s.port !== (hubServer && hubServer.address() && hubServer.address().port));
});

ipcMain.handle('check-updates', () => getUpdate());
ipcMain.handle('open-external', (_e, url) => shell.openExternal(url));
ipcMain.handle('download-update', async (_e, url) => {
  const name = (url.split('/').pop() || 'Teleprompter-Sync-System.dmg');
  const dest = path.join(app.getPath('downloads'), name);
  await downloadFile(url, dest, (p) => { if (win && !win.isDestroyed()) win.webContents.send('update-progress', p); });
  shell.openPath(dest); // mount the DMG so the user can drag to Applications
  return { path: dest };
});

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
  const b = loadConfig().winBounds || {};
  win = new BrowserWindow({
    width: b.width || 1200, height: b.height || 880,
    x: b.x != null ? b.x : undefined, y: b.y != null ? b.y : undefined,
    minWidth: 380, minHeight: 600,
    backgroundColor: '#101317',
    title: 'Teleprompter Sync System',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.loadFile(path.join(__dirname, 'launch.html'));
  // Remember window size/position (debounced).
  let saveT = null;
  const saveBounds = () => { clearTimeout(saveT); saveT = setTimeout(() => {
    if (win && !win.isDestroyed()) { const cfg = loadConfig(); cfg.winBounds = win.getBounds(); saveConfig(cfg); }
  }, 400); };
  win.on('resize', saveBounds); win.on('move', saveBounds);
  // Show the floating HUD whenever the console loses focus during a live session.
  win.on('blur', () => { if (sessionActive) showHud(); });
  win.on('focus', hideHud);
  win.on('closed', () => { win = null; });
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
function showHud() { if (!hudWin) createHud(); if (hudWin && win && !win.isDestroyed() && !win.isFocused()) hudWin.showInactive(); }
function hideHud() { if (hudWin) hudWin.hide(); }
function destroyHud() { if (hudWin) { try { hudWin.destroy(); } catch (_) {} hudWin = null; } }

// --- compact always-on-top mini controller -----------------------------------
function createMini() {
  if (miniWin) { miniWin.show(); miniWin.focus(); return; }
  if (!sessionActive) return;
  const W = 190, H = 300, M = 16;
  const { workArea } = screen.getPrimaryDisplay();
  miniWin = new BrowserWindow({
    width: W, height: H,
    x: workArea.x + workArea.width - W - M, y: workArea.y + workArea.height - H - M,
    frame: false, transparent: true, resizable: false, skipTaskbar: true,
    fullscreenable: false, maximizable: false, minimizable: false, hasShadow: false,
    backgroundColor: '#00000000', webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  miniWin.setAlwaysOnTop(true, 'floating');
  miniWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  miniWin.loadFile(path.join(__dirname, 'mini.html'), { query: { host: sessionHost, pin: sessionPinValue } });
  miniWin.on('closed', () => { miniWin = null; updateTray(); });
}
function destroyMini() { if (miniWin) { try { miniWin.destroy(); } catch (_) {} miniWin = null; } }
function toggleMini() { if (miniWin) destroyMini(); else createMini(); updateTray(); }

function stopAgent() { if (agentProc) { try { agentProc.kill(); } catch (_) {} agentProc = null; } }
function stopHub() { if (hubServer) { try { hubServer.close(); } catch (_) {} hubServer = null; } }

// A stable per-install client-id so this machine's rig is recognised across agent
// restarts (not just socket reconnects), letting the hub flag it out-of-sync if it
// missed commands while down.
function machineCid() {
  const cfg = loadConfig();
  if (!cfg.agentCid) { cfg.agentCid = 'cid-' + require('crypto').randomBytes(5).toString('hex'); saveConfig(cfg); }
  return cfg.agentCid;
}

function spawnAgent(args) {
  stopAgent();
  const agentPath = path.join(__dirname, '..', 'agent.js');
  const full = [...args];
  if (!full.includes('--cid')) full.push('--cid', machineCid());
  if (keypostPath) full.push('--keypost', keypostPath);
  agentProc = spawn(process.execPath, [agentPath, ...full], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'ignore',
  });
  agentProc.on('exit', () => { agentProc = null; });
}

async function startHub(preferred, pin) {
  const opts = { pin, keypost: !!keypostPath, accessibility: axGranted };   // powers the readiness check
  try { return await hub.start({ port: preferred, ...opts }); }
  catch (_) { return await hub.start({ port: 0, ...opts }); } // port busy → let the OS pick one
}

app.whenReady().then(() => {
  keypostPath = resolveKeypost();
  buildMenu();
  createTray();          // tray is always present; menu reflects session state
  createWindow();
  startDiscovery();      // begin listening for nearby sessions to join
  app.on('activate', () => openConsole());
});
// On macOS, closing the window keeps a live session hosting in the background (tray stays).
app.on('window-all-closed', () => {
  if (!sessionActive) { unregisterHotkeys(); stopAgent(); stopHub(); destroyHud(); app.quit(); }
});
app.on('before-quit', (e) => {
  // Guard against quitting out from under a live session with rigs still connected.
  const hosting = sessionActive && sessionMode === 'host' && !!hubRef;
  const rigs = hosting ? hubRef.agents.size : 0;
  if (!quitConfirmed && hosting && rigs > 0) {
    e.preventDefault();
    const choice = dialog.showMessageBoxSync(win && !win.isDestroyed() ? win : undefined, {
      type: 'warning',
      buttons: ['Quit', 'Keep hosting'],
      defaultId: 1,
      cancelId: 1,
      message: 'Quit while hosting?',
      detail: `${rigs} ${rigs === 1 ? 'rig is' : 'rigs are'} connected. Quitting ends the session and drops every rig.`,
    });
    if (choice === 0) { quitConfirmed = true; app.quit(); }
    return;
  }
  unregisterHotkeys(); stopAgent(); stopHub(); destroyHud(); destroyMini();
  stopAdvertise(); try { if (bonjour) bonjour.destroy(); } catch (_) {}
  if (trayTimer) clearInterval(trayTimer);
  if (tray) { try { tray.destroy(); } catch (_) {} tray = null; }
});

ipcMain.handle('host-session', async (_e, opts = {}) => {
  const pin = String(opts.pin || '').trim();
  sessionPinValue = pin;
  const res = await startHub(Number(opts.port) || 3000, pin);
  hubServer = res.server; hubRef = res.hub;
  const args = ['--host', `http://localhost:${res.port}`, '--name', 'host', '--no-mouse', '--speed', String(opts.speed || 1)];
  // Host runs on the same machine as the controller console, so guard against the
  // agent ever typing into it (which would feedback-loop and could hang the Mac):
  // no frontmost injection, and never target the controller app itself.
  args.push('--guard-frontmost', '--self-name', app.getName());
  if (opts.target) args.push('--target', opts.target);
  if (pin) args.push('--pin', pin);
  if (opts.keymap && Object.keys(opts.keymap).length) args.push('--keymap', JSON.stringify(opts.keymap));
  spawnAgent(args);
  sessionActive = true; sessionMode = 'host';
  sessionHost = `http://localhost:${res.port}`;
  advertiseSession(res.port);   // let backup rigs discover this host over mDNS
  registerHotkeys();
  createHud();
  updateTray();
  const cfg = loadConfig();
  const firstRun = !cfg.tourSeen;   // show the guided tour the first time the console ever opens
  saveConfig({ ...cfg, target: opts.target || '', speed: opts.speed || 1, pin, keymap: opts.keymap || {}, tourSeen: true });
  const q = new URLSearchParams();
  if (pin) q.set('pin', pin);
  if (firstRun) q.set('tour', '1');
  const consoleUrl = sessionHost + (q.toString() ? `/?${q.toString()}` : '');
  await win.loadURL(consoleUrl);
  return { port: res.port, primary: res.primary, urls: res.urls, keypost: !!keypostPath };
});

ipcMain.handle('join-session', async (_e, opts = {}) => {
  const host = opts.host;
  const pin = String(opts.pin || '').trim();
  sessionPinValue = pin;
  const args = ['--host', host, '--name', opts.name || 'backup', '--speed', String(opts.speed || 1)];
  if (opts.target) args.push('--target', opts.target);
  if (pin) args.push('--pin', pin);
  if (opts.keymap && Object.keys(opts.keymap).length) args.push('--keymap', JSON.stringify(opts.keymap));
  spawnAgent(args);
  sessionActive = true; sessionMode = 'join';
  sessionHost = host;
  joinedQuery = { host, target: opts.target || '', keypost: keypostPath ? '1' : '0' };
  createHud();
  updateTray();
  saveConfig({ ...loadConfig(), host, target: opts.target || '', speed: opts.speed || 1, name: opts.name || 'backup', pin, keymap: opts.keymap || {} });
  await win.loadFile(path.join(__dirname, 'joined.html'), { query: joinedQuery });
  return { ok: true, keypost: !!keypostPath };
});

ipcMain.handle('leave-session', async () => { await leaveSession(); return { ok: true }; });

ipcMain.handle('focus-main', () => {
  if (win) { win.show(); win.focus(); }
  hideHud();
  return { ok: true };
});
