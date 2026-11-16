// keypost — inject keyboard + mouse input on this Mac.
//
// Build once (needs Xcode command line tools):
//     swiftc keypost.swift -o keypost
// If swiftc is missing:  xcode-select --install
//
// The posting process (Terminal / node) must have Accessibility permission.
//
// Commands:
//   keypost key <pid> <keyCode>        key press delivered to a specific app (no focus steal)
//   keypost move <nx> <ny>             move cursor to a normalized point (0..1) on the main display
//   keypost moveby <dx> <dy>           move cursor by a pixel delta from where it is now
//   keypost drag <nx> <ny> [left|right]   move with a button held (drag)
//   keypost down <nx> <ny> [left|right]   press a button at a normalized point
//   keypost up   <nx> <ny> [left|right]   release a button at a normalized point
//   keypost click <nx> <ny> [left|right]  click (down+up) at a normalized point
//   keypost clickcur [left|right]      click wherever the cursor currently is
//   keypost scroll <dy>                scroll wheel by <dy> pixels (negative = up)
//
// Normalized coords (nx, ny) are 0..1 across the main display, origin top-left —
// so two laptops showing the same layout land on the same relative spot.

import Cocoa
import CoreGraphics

func fail(_ m: String) -> Never { FileHandle.standardError.write(Data((m + "\n").utf8)); exit(2) }

let a = CommandLine.arguments
guard a.count >= 2 else { fail("usage: keypost <key|move|moveby|drag|down|up|click|clickcur|scroll> ...") }

let src = CGEventSource(stateID: .combinedSessionState)

func mainBounds() -> CGRect { CGDisplayBounds(CGMainDisplayID()) }

func absPoint(_ nx: Double, _ ny: Double) -> CGPoint {
    let b = mainBounds()
    return CGPoint(x: b.minX + min(1, max(0, nx)) * b.width,
                   y: b.minY + min(1, max(0, ny)) * b.height)
}

func currentPoint() -> CGPoint { CGEvent(source: nil)?.location ?? .zero }

func button(_ s: String) -> (CGMouseButton, CGEventType, CGEventType, CGEventType) {
    s == "right"
        ? (.right, .rightMouseDown, .rightMouseUp, .rightMouseDragged)
        : (.left,  .leftMouseDown,  .leftMouseUp,  .leftMouseDragged)
}

func postMouse(_ type: CGEventType, _ p: CGPoint, _ btn: CGMouseButton) {
    CGEvent(mouseEventSource: src, mouseType: type, mouseCursorPosition: p, mouseButton: btn)?
        .post(tap: .cghidEventTap)
}

func dbl(_ i: Int) -> Double { Double(a[i]) ?? 0 }

switch a[1] {
case "key":
    guard a.count >= 4, let pid = Int32(a[2]), let kc = UInt16(a[3]) else { fail("usage: keypost key <pid> <keycode>") }
    CGEvent(keyboardEventSource: src, virtualKey: kc, keyDown: true)?.postToPid(pid_t(pid))
    CGEvent(keyboardEventSource: src, virtualKey: kc, keyDown: false)?.postToPid(pid_t(pid))

case "move":
    guard a.count >= 4 else { fail("usage: keypost move <nx> <ny>") }
    postMouse(.mouseMoved, absPoint(dbl(2), dbl(3)), .left)

case "moveby":
    guard a.count >= 4 else { fail("usage: keypost moveby <dx> <dy>") }
    var p = currentPoint(); let b = mainBounds()
    p.x = min(b.maxX - 1, max(b.minX, p.x + dbl(2)))
    p.y = min(b.maxY - 1, max(b.minY, p.y + dbl(3)))
    postMouse(.mouseMoved, p, .left)

case "drag":
    guard a.count >= 4 else { fail("usage: keypost drag <nx> <ny> [left|right]") }
    let (btn, _, _, drag) = button(a.count >= 5 ? a[4] : "left")
    postMouse(drag, absPoint(dbl(2), dbl(3)), btn)

case "down", "up", "click":
    guard a.count >= 4 else { fail("usage: keypost \(a[1]) <nx> <ny> [left|right]") }
    let (btn, dn, up, _) = button(a.count >= 5 ? a[4] : "left")
    let p = absPoint(dbl(2), dbl(3))
    postMouse(.mouseMoved, p, btn)
    if a[1] == "down" { postMouse(dn, p, btn) }
    else if a[1] == "up" { postMouse(up, p, btn) }
    else { postMouse(dn, p, btn); postMouse(up, p, btn) }

case "clickcur":
    let (btn, dn, up, _) = button(a.count >= 3 ? a[2] : "left")
    let p = currentPoint()
    postMouse(dn, p, btn); postMouse(up, p, btn)

case "scroll":
    guard a.count >= 3, let dy = Int32(a[2]) else { fail("usage: keypost scroll <dy>") }
    CGEvent(scrollWheelEvent2Source: src, units: .pixel, wheelCount: 1, wheel1: dy, wheel2: 0, wheel3: 0)?
        .post(tap: .cghidEventTap)

default:
    fail("unknown command \(a[1])")
}
