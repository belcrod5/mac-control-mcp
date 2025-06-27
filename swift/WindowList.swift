// WindowList.swift
// Outputs JSON array of on-screen windows with bounds.
// Usage: swift WindowList.swift

import Foundation
import AppKit

let minSize: CGFloat = 64

guard let infoList = CGWindowListCopyWindowInfo([
    .optionOnScreenOnly,
    .excludeDesktopElements
], kCGNullWindowID) as? [[String: Any]] else {
    fputs("Failed to obtain window list\n", stderr)
    exit(1)
}

var windows: [[String: Any]] = []

for win in infoList {
    guard let layer = win[kCGWindowLayer as String] as? Int, layer == 0 else { continue }
    guard let pid   = win[kCGWindowOwnerPID as String] as? pid_t,
          let app   = NSRunningApplication(processIdentifier: pid) else { continue }
    guard let boundsDict = win[kCGWindowBounds as String] as? [String: CGFloat] else { continue }
    let w = boundsDict["Width"]  ?? 0
    let h = boundsDict["Height"] ?? 0
    if w < minSize || h < minSize { continue }

    let x = boundsDict["X"] ?? 0
    let y = boundsDict["Y"] ?? 0

    let title = win[kCGWindowName as String] as? String ?? "(no title)"

    windows.append([
        "appName": app.localizedName ?? "Unknown",
        "pid"    : Int(pid),
        "windowTitle": title,
        "bounds": [
            "x": x,
            "y": y,
            "w": w,
            "h": h
        ]
    ])
}

do {
    let json = try JSONSerialization.data(withJSONObject: windows, options: [])
    FileHandle.standardOutput.write(json)
} catch {
    fputs("Failed to write JSON: \(error)\n", stderr)
    exit(1)
} 