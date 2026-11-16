# Changelog

All notable changes to **Teleprompter Sync System (TSS)** are recorded here.
Format based on [Keep a Changelog](https://keepachangelog.com/). Dates are ISO (YYYY-MM-DD).

## [Unreleased]

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

### Changed
- `/events` and `/status` now send `Access-Control-Allow-Origin: *` so the HUD and joined
  screen can read live status cross-origin. (`server.js`)

### Fixed
- **Hosting failed with `EADDRINUSE` when port 3000 was busy** instead of falling back to a
  free port. `start()` used `Number(opts.port) || 3000`, which treated the port-`0`
  ("OS picks a free port") fallback as falsy and re-bound 3000. Now port 0 is honored.
  (`server.js`)

## [1.0.0] - 2026-11-15

### Added
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
