# Changelog

All notable changes to **Teleprompter Sync System (TSS)** are recorded here.
Format based on [Keep a Changelog](https://keepachangelog.com/). Dates are ISO (YYYY-MM-DD).

## [1.11.1] - 2026-11-16

### Fixed
- **Electron crash from a key feedback loop** — when hosting (the host is also a rig), with no explicit
  target the host agent injected keys into the frontmost app — the controller console itself — whose
  keydown/wheel handlers re-transmitted them, looping as fast as the network allowed and flooding the
  macOS event queue until the machine hung. The loop is now closed at the source and backstopped.
  (`agent.js`, `electron/main.js`, `electron/launch.html`)

### Added
- **Wheel-drives-rigs toggle** — mouse-wheel scroll control is now opt-in (off by default and
  persisted), so scrolling the console window never moves the prompters until you enable it.
  (`public/index.html`)
- **`--guard-frontmost` agent flag** — a host-side guard that refuses to inject into the frontmost app
  (no target) or into the controller app itself, so the host can never type into its own console. The
  Electron host passes it automatically; dedicated rig laptops keep the documented frontmost behavior.
  (`agent.js`, `electron/main.js`)

### Changed
- **One-window console** — the control console is laid out to fit the window (≥861px): transport,
  roll/all-stop, speed, rigs, and sync state are all visible without scrolling the page; the side column
  scrolls internally if needed. (`public/index.html`)
- **Hosting requires a target app** — the launch screen now requires you to name the teleprompter app
  before hosting, so input always has an explicit, non-console destination. (`electron/launch.html`)
- **Injection rate cap** — the agent caps injection at 20 commands/sec as a defense-in-depth backstop
  against any feedback loop; real input (a human, or auto-scroll) stays far below the ceiling.
  (`agent.js`)

## [1.11.0] - 2026-11-16

### Added
- **Control handoff / view-only** — only the controller "in command" can drive, so a second operator
  or a phone can watch without fighting for control. A header chip shows who's driving; **Take control**
  hands it over cleanly, **Go view-only** releases it, and a silent commander auto-releases after 8s so
  no one gets locked out. Server-enforced. (`server.js`, `public/index.html`)
- **MIDI controller mapping** — a settings page (🎹 **MIDI**) that maps a MIDI controller's keys, pads,
  or knobs to any TSS action (scroll, page, top/bottom, play, roll, all-stop, speed). Click **Learn**,
  press the control; mappings persist per device and drive TSS whenever you're in command.
  (`public/index.html`)
- **Pre-show readiness check** — a one-click panel (✓ **Ready?**) that verifies rigs connected, armed,
  in sync, latency healthy, you're in command, Accessibility granted, the mouse helper is built, and a
  PIN is set — with a clear **Ready to roll** / **Not ready** verdict. (`public/index.html`, `server.js`)
- **Accessibility-permission helper** — detects when macOS Accessibility isn't granted and offers a
  one-click path to the setting (launch-screen banner + a **File → Accessibility Permission…** menu
  item), instead of silently failing to inject. (`electron/main.js`, `electron/launch.html`)
- **Zero-config discovery (Bonjour / mDNS)** — hosts advertise `_tss._tcp`; the Join screen lists
  **Nearby sessions** to tap, so backup rigs no longer need the host's IP typed in.
  (`electron/main.js`, `electron/launch.html`)
- **Settings export / import** — move presets, key maps, and preferences between machines as a JSON
  file (**File** menu + links on the launch screen). (`electron/main.js`, `electron/launch.html`)

## [1.10.0] - 2026-11-16

### Added
- **Guided first-run tour** — the first time the console opens, a coach-mark walkthrough spotlights
  each control in turn (transport, roll/all-stop, speed, auto-scroll, rigs, sync, arm, join). It's
  skippable, keyboard-navigable (← → / Esc), and replayable any time from the `?` shortcut sheet.
  The app shows it once (tracked in its config); a browser falls back to local storage.
  (`public/index.html`, `electron/main.js`)

### Changed
- **README + website** now document and screenshot the newer features — roll countdown, all-stop,
  identify rig, the shortcut cheat-sheet, and the guided tour. (`README.md`, `docs/index.html`,
  `assets/features/`, `docs/features/`)

## [1.9.0] - 2026-11-16

### Added
- **Roll countdown / slate** — a 3·2·1 full-screen countdown (the **🎬 Roll** button or `R`) that
  starts every rig together at zero; cancel with `Esc`. (`public/index.html`)
- **All-stop / blackout** — a panic button (**■ All-stop** or `Esc`) that halts the auto-scroll
  crawl on the spot and pauses every rig, with a red flash. Distinct from arm/disarm.
  (`public/index.html`)
- **Identify rig** — a 🔦 button on each rig in the RIGS panel makes that physical laptop beep and
  show a notification banner, so you can tell which machine is which. (`public/index.html`, `agent.js`)
- **Keyboard cheat-sheet** — press `?` (or the header **?**) for an overlay listing every console
  and system-wide shortcut. (`public/index.html`)
- **Download checksum + requirements** — the site shows the DMG's SHA-256 (with a verify command)
  and an explicit "macOS 11+ · Apple silicon" line. (`docs/index.html`)

## [1.8.0] - 2026-11-16

### Added
- **Session run-timer + wall clock** — the console header shows elapsed session time and the
  current time of day, so you always know how long you've been live. (`public/index.html`)
- **Quit guard while hosting** — quitting with rigs still connected now asks for confirmation
  ("Quit while hosting?") so you can't accidentally drop the whole session. (`electron/main.js`)
- **Sync state in the tray** — the menu-bar item shows `in sync` / `syncing` / `DRIFT` and flags a
  `⚠` next to the rig count when a rig goes stale. (`electron/main.js`)
- **Live release info on the site** — the download page pulls the latest version and total download
  count from the GitHub Releases API and labels the "what's new" badge accordingly.
  (`docs/index.html`)

### Changed
- **Site intro plays every visit** — removed the one-time session gate and the "Skip intro" button;
  the 3D intro now reveals on each load (still click / scroll / key to dismiss, and fully skipped for
  reduced-motion or no-WebGL). (`docs/index.html`)
- **Intro is mobile/portrait-aware** — responsive FOV, laptop spread, and camera framing keep all
  three rigs on screen on phone-width/portrait screens. (`docs/index.html`)

## [1.7.0] - 2026-11-16

### Added
- **Drift / disconnect alarm** — an opt-in (default on) alert that beeps and flashes the console
  the moment a rig drifts or drops. Toggle it from the header; the setting is remembered.
  (`public/index.html`)
- **Latency-coded rig health + sparklines** — each rig's lamp is now green / amber / red by
  round-trip latency, with a live sparkline of recent values. (`public/index.html`)
- **Website FAQ** — a short Q&A (internet, app compatibility, Windows, pricing, privacy).
  (`docs/index.html`)

## [1.6.0] - 2026-11-16

### Added
- **Named presets** — save and load multiple show setups (target app, speed, PIN, host, key map)
  from the launch screen. (`electron/launch.html`, `electron/main.js`)
- **Custom key mapping** — remap any action (scroll, page, top/bottom, play) to the key your
  teleprompter app actually uses; click-to-capture, saved per machine, applied by the agent.
  (`agent.js`, `electron/launch.html`)
- **Compact mini-controller** — a tiny always-on-top transport window (▲ / ▼ / play), opened from
  the tray, the Window menu, or ⌘⇧M. (`electron/main.js`, `electron/mini.html`)

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
