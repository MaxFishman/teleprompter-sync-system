# Changelog

All notable changes to **Teleprompter Sync System (TSS)** are recorded here.
Format based on [Keep a Changelog](https://keepachangelog.com/). Dates are ISO (YYYY-MM-DD).

## [1.5.0] - 2026-11-16

### Added
- **Remote mode** — a phone-first full-screen controller: a giant scroll up/down rocker, Page
  Up/Down, Play/Pause, speed, and auto-scroll. Opens automatically on phone-width screens; there's
  a **⛶ Remote** toggle on desktop too. (`public/index.html`)
- **Launch at login** (opt-in) — from the app menu or the tray. (`electron/main.js`)
- **Beta update channel** (opt-in) — the in-app updater then includes prereleases. (`electron/main.js`)

### Changed
- The app **remembers its window size and position** between launches. (`electron/main.js`)

## [1.4.0] - 2026-11-16

### Added
- **Auto-scroll** — a WPM-style crawl that ticks scroll to every rig at an adjustable rate
  (lines/min), with play/pause. (`public/index.html`)
- **Join PIN** — the host can set a session PIN; agents and controllers must present it, and the
  console shows an unlock gate. Server-enforced on `/events`, `/cmd`, `/arm`, `/rig`.
  (`server.js`, `agent.js`, `public/index.html`, `electron/`)
- **Per-rig enable/disable** — toggle any rig out of the sync set from the RIGS panel; the server
  skips disabled rigs for key/mouse while keeping them live. (`server.js`, `public/index.html`)
- **App picker** — the launch screen lists running apps (a datalist) so you pick instead of typing.
  (`electron/main.js`, `electron/launch.html`)
- **Remembers your last session** — target app, speed, host, rig name, and PIN are saved and
  prefilled next launch. (`electron/main.js`, `electron/launch.html`)

## [1.3.0] - 2026-11-16

### Added
- **Sync confidence** — every rig acknowledges each command (plus a 2s heartbeat ping), so the
  console shows a live **IN SYNC / SYNCING / DRIFT** chip, **per-rig latency**, stale dots, and
  **connect / drop toasts**. (`server.js`, `agent.js`, `public/index.html`)
- **Arm / disarm** — a server-enforced safety gate; disarmed, key & mouse never transmit. Toggle
  from the console header or the tray. (`server.js`, `public/index.html`, `electron/main.js`)
- **Global hotkeys** — ⌘⇧↑ / ⌘⇧↓ / ⌘⇧← / ⌘⇧→ / ⌘⇧Space drive scroll on every rig even when the
  console isn't focused (host sessions). (`electron/main.js`)
- **Menu-bar tray** — status + Open console / Arm / Leave / Check for Updates / Quit, with the live
  rig count shown in the menu bar. Closing the window keeps the session **hosting in the background**.
- **Website scroll experience** — native scroll-driven progress bar, reveal-on-scroll, hero parallax,
  and a scale-in for the console screenshot (reduced-motion + unsupported-browser safe). (`docs/`)

## [1.2.0] - 2026-11-16

### Added
- **In-app updates** — the app checks GitHub Releases on launch and from the menu
  (**Teleprompter Sync System → Check for Updates…**). When a newer version exists, the
  launch screen shows a banner that downloads the new DMG with a progress bar and opens the
  installer — no browser trip. (`electron/main.js`, `electron/preload.js`, `electron/launch.html`)
- **Native application menu** — a proper macOS menu with Check for Updates, standard
  Edit/View/Window roles, and Help links (website, releases). (`electron/main.js`)
- `publish` config + `repository` field so releases are update-discoverable. (`package.json`)

### Changed
- **Site nav collapses by overflow, not a fixed width** — it switches to a hamburger the
  moment the links would overflow, so menu labels never wrap to a second line. (`docs/index.html`)

> Note: fully silent auto-install (replace-in-place) needs a signed + notarized build;
> the current unsigned flow downloads and opens the DMG for a one-drag install.

## [1.1.0] - 2026-11-16

### Added
- **Installable PWA** — the console can be added to the Home Screen on iPad/iPhone and
  launches full-screen (web app manifest, apple-touch-icon, apple meta). (`public/`)
- **Screen Wake Lock** — a controller device stays awake while in use. (`public/index.html`)
- **Built by Max Fishman** credit across the app, console, site, README, and LICENSE.

### Changed
- **Mobile/tablet hardening** — safe-area insets (notch / home indicator), no rubber-band
  overscroll, no double-tap zoom or long-press callouts on controls, dynamic viewport
  height, and the keyboard-focus warning hidden on touch. (`public/index.html`)
- **Phone layout fix** — the console no longer overflows narrow screens: grid tracks can
  shrink (`min-width:0`), and the decorative jog rail is dropped below 560px so the
  transport keys get the full width. (`public/index.html`)
- Server now serves `.png` / `.json` / `.webmanifest` with correct MIME types. (`server.js`)

## [1.0.0] - 2026-11-15

### Added
- **Master scroll-speed control on the main console** — a `Speed` module in the transport
  cluster sets the line-scroll rate for *all* rigs at once, with a 10-segment level meter.
  Keyboard: `-` slower, `=`/`+` faster. (`public/index.html`)
- **Floating activity HUD** — a small always-on-top widget appears in the top-right when
  the TSS app window loses focus during an active session, showing live status, rig count,
  host URL, and a per-command activity ticker. Click it to bring the console forward.
  (`electron/main.js`, `electron/hud.html`)
- **Observer stream** — `GET /events?observer=1` subscribes to the live command feed
  without registering as a counted/injecting rig (powers the HUD ticker). (`server.js`)
- **Broadcast speed command** — `{type:'speed', id:'all', value}` sets every rig's speed
  in one message. (`server.js`, `agent.js`)
- **Customer-facing README** with brand banner, product screenshot, and feature overview.
- **Marketing + download site** in `docs/` for GitHub Pages — branded landing page
  (synced-rigs hero, features, 3-step how-it-works, download CTA).
- Brand assets (`assets/banner.svg|png`, `assets/og.svg|png`), `LICENSE` (MIT), `.gitignore`.
- This changelog.
- Core sync hub (`server.js`): serves the control console and fans keyboard/mouse commands
  to all connected rigs over Server-Sent Events. Zero runtime deps beyond optional `qrcode`.
- Per-laptop agent (`agent.js`): injects real macOS input into a target app.
- `keypost.swift` helper: focus-safe key injection via `CGEventPostToPid`, plus full mouse
  synthesis (`move`/`drag`/`click`/`scroll`) via `CGEvent`.
- Instrument-console control pad with illuminated transport keys, jog rail, and live TX/latency.
- Per-rig scroll-speed steppers.
- Mouse mirroring (POINTER panel: Mirror + Trackpad modes) to backup rigs only.
- Mobile-friendly sizing (`clamp()` + touch targets).
- Join panel with LAN URL + scannable QR (`/qr.svg`).
- Electron app with branded Host/Join launch screen; runs the agent under Electron's own
  Node and auto-builds `keypost`. Packaged to DMG via electron-builder.
- Generated app icon (`build/icon.icns`) and `start-host.command` / `start-agent.command`
  double-click launchers.

### Changed
- `/events` and `/status` send `Access-Control-Allow-Origin: *` so the HUD and joined screen
  can read live status cross-origin. (`server.js`)

### Fixed
- Hosting now falls back to a free port instead of failing with `EADDRINUSE` when 3000 is
  busy (port `0` was being treated as falsy). (`server.js`)
