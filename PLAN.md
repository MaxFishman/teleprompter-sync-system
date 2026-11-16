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

## Phase 1 — Sync confidence & safety  (production-critical)  ✅ mostly done
Server + agent + console. The operator must *know* both rigs are in sync.
- [x] **Rig acknowledgements** — agent acks each command (incl. 2s heartbeat ping); server tracks per-rig.
- [x] **"All rigs in sync" state** — header chip: IN SYNC / SYNCING / DRIFT.
- [x] **Per-rig latency + heartbeat** — round-trip ms + stale dot shown per rig.
- [x] **Connect/drop toasts** — "rig connected / dropped" notifications.
- [x] **Arm / disarm toggle** — server-enforced; blocks key/mouse when disarmed; console + tray toggle.
- [x] **Join PIN** — host sets a code; agents & controllers must present it; server-enforced, with a console unlock gate.

## Phase 2 — Desktop power (Electron)  ⏳ in progress
- [x] **Global hotkeys** — ⌘⇧↑/↓/←/→/Space drive scroll with the console unfocused (host only).
- [x] **Menu-bar / tray** — status + Open console / Arm / Leave / Updates / Quit; shows rig count.
- [x] **Background hosting** — closing the window keeps the session live in the tray (macOS).
- [ ] Remember window size/position.
- [ ] Launch at login (opt-in).
- [ ] Compact "mini controller" mode.
- [ ] Beta update channel.

## Phase 3 — Controls  ⏳ in progress
- [x] **Auto-scroll (WPM crawl)** — timed scroll broadcast to all rigs; play/pause + rate (lines/min).
- [x] **App picker** — datalist of running apps (osascript) on the launch screen.
- [x] **Remember last settings** — target/speed/host/name/pin persisted and prefilled next launch.
- [x] **Per-rig enable/disable** — toggle a rig out of the sync set (server-gated).
- [ ] **Named presets** — multiple saved show configs (beyond last-used).
- [ ] **Custom key maps** — per-target key bindings (apps differ).

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

_Last updated: 2026-11-16 — Phases 0 & 1 done; Phase 2 hotkeys+tray+background done; Phase 3 auto-scroll + app-picker + remember-settings + per-rig enable done. Next: named presets, custom key maps, then Phase 2 leftovers (window state, launch-at-login, mini mode) and Phase 4 (phone Remote mode)._
