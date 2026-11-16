# TSS — Feature Plan & Roadmap

Living reference for the current build-out. Check items off as they ship. Keep the
**CHANGELOG** for released history; keep **this** for intent, design notes, and what's next.

**Product goal:** the most reliable way to run two+ redundant teleprompter rigs in lockstep
from one operator — on the local network, macOS-native, with live confidence that every rig
is truly in sync. Repo: `github.com/MaxFishman/teleprompter-sync-system`.

**Architecture:** `server.js` hub (SSE fan-out) · `agent.js` per-rig injector · `keypost.swift`
(focus-safe key+mouse) · `public/` web console · `electron/` macOS app · `docs/` site.

---

## Phase 0 — Website scroll experience  ✅ done
Uses the scroll-experience skill. Native CSS `animation-timeline` (no libraries), mobile-safe,
`prefers-reduced-motion` honored, content-first fallback via `@supports`.
- [x] Scroll progress bar (amber, top)
- [x] Reveal-on-scroll for feature cards, steps, band (per-element via view() timeline)
- [x] Subtle hero parallax on the synced-rigs visual
- [x] Console screenshot scale/zoom reveal in "A closer look"
- [x] Reduced-motion + unsupported-browser fallbacks (gated by @supports + @media)

## Phase 1 — Sync confidence & safety  (production-critical)
Server + agent + console. The operator must *know* both rigs are in sync.
- [ ] **Rig acknowledgements** — agent acks each injected command; server relays; console shows per-rig confirm.
- [ ] **"All rigs in sync" state** — green when every rig acked the latest command; amber/red on drift.
- [ ] **Per-rig latency + heartbeat** — agent heartbeat + round-trip; console shows ms + online dot.
- [ ] **Connect/drop toasts** — "backup-rig reconnected / dropped" notifications.
- [ ] **Arm / disarm toggle** — when disarmed, no commands transmit (prevents stray keys mid-show).
- [ ] **Join PIN** — host sets a code; agents/controllers must present it; server enforces.

## Phase 2 — Desktop power (Electron)
- [ ] **Global hotkeys** — drive scroll/page even when the console isn't focused (`globalShortcut`).
- [ ] **Menu-bar / tray** — host in the background; tray shows status + quick actions.
- [ ] Remember window size/position.
- [ ] Launch at login (opt-in).
- [ ] Compact "mini controller" mode.
- [ ] Beta update channel.

## Phase 3 — Controls
- [ ] **Auto-scroll (WPM crawl)** — continuous timed scroll broadcast to all rigs; adjustable speed; play/pause.
- [ ] **App picker** — dropdown of running apps (osascript) instead of typing the target name.
- [ ] **Presets** — remember target app + speed per show; named presets.
- [ ] **Custom key maps** — per-target key bindings (apps differ).
- [ ] **Per-rig enable/disable** — temporarily drop a rig from the sync set.

## Phase 4 — Mobile
- [ ] **Remote mode** — phone-only full-screen view: giant scroll rocker + play/pause + speed.

## Later / needs external
- [ ] Code signing + notarization → silent auto-update + no Gatekeeper prompt (needs Apple Developer ID).
- [ ] Session log / export.

---

## Protocol notes (as features land)
- Commands: `{type:'key'|'mouse'|'speed', ...}` broadcast over `/cmd` → SSE `/events`.
- (planned) `{type:'ack', id, cmdId}` from agent → host via a new `/ack` or reverse channel.
- (planned) `armed` gate on the host; `/cmd` rejects when disarmed.
- (planned) PIN: `/events?pin=` + `/cmd` require matching host PIN.

_Last updated: 2026-11-16 — starting Phase 0._
