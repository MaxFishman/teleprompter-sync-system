// scrollwatch — passively observe the host's global scroll (trackpad / mouse wheel)
// and print the vertical delta to stdout, one line per event:  "s <dy>\n".
//
// This is what lets the HOST drive the rigs by scrolling inside their own app,
// with the TSS console in the background: a listen-only CGEventTap sees every
// scroll-wheel event system-wide and reports it; the Electron host turns the
// stream into ArrowDown/ArrowUp ticks and fans them to every rig.
//
// Build once (needs Xcode command line tools):
//     swiftc scrollwatch.swift -o scrollwatch
//
// The process must have Accessibility permission (same as keypost). The tap is
// .listenOnly, so it never swallows or alters the user's own scrolling.
//
// Sign convention: CGEvent axis-1 delta is POSITIVE when scrolling up and
// NEGATIVE when scrolling down (the same magnitude a DOM wheel event negates),
// so the reader maps dy < 0 → advance (ArrowDown).

import Cocoa
import CoreGraphics

let mask = CGEventMask(1 << CGEventType.scrollWheel.rawValue)

func onScroll(proxy: CGEventTapProxy, type: CGEventType, event: CGEvent, refcon: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
    // macOS disables a tap if it ever times out / the system is busy — re-enable it.
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let p = refcon?.assumingMemoryBound(to: CFMachPort.self).pointee { CGEvent.tapEnable(tap: p, enable: true) }
        return Unmanaged.passUnretained(event)
    }
    if type == .scrollWheel {
        // Prefer the continuous point delta (trackpad / Magic Mouse); fall back to the
        // coarse line delta (classic wheel) when there's no pixel precision.
        let pts = event.getDoubleValueField(.scrollWheelEventPointDeltaAxis1)
        let dy = pts != 0 ? pts : Double(event.getIntegerValueField(.scrollWheelEventDeltaAxis1))
        if dy != 0 {
            FileHandle.standardOutput.write(Data("s \(dy)\n".utf8))
        }
    }
    return Unmanaged.passUnretained(event)
}

var tapRef: CFMachPort?
guard let tap = CGEvent.tapCreate(
    tap: .cgSessionEventTap,
    place: .headInsertEventTap,
    options: .listenOnly,
    eventsOfInterest: mask,
    callback: onScroll,
    userInfo: withUnsafeMutablePointer(to: &tapRef) { UnsafeMutableRawPointer($0) }
) else {
    FileHandle.standardError.write(Data("scrollwatch: could not create event tap — grant Accessibility permission\n".utf8))
    exit(1)
}
tapRef = tap

let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)
FileHandle.standardError.write(Data("scrollwatch: watching global scroll\n".utf8))
CFRunLoopRun()
