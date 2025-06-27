// AppInfo.swift
// Command-line tool to retrieve information about running applications.
// Usage:
//   AppInfo list      – Lists all running applications that currently have at least one on-screen window.
//
// The result is printed as JSON to standard output.
// -----------------------------------------------------------------------------
import Foundation
import AppKit

let args = CommandLine.arguments

// 引数が不足している場合は使用方法を表示して終了
if args.count < 2 {
    fputs("Usage: AppInfo <command>\n", stderr)
    fputs("  list  – Return JSON list of apps that own at least one on-screen window.\n", stderr)
    exit(1)
}

let command = args[1]

switch command {
case "list":
    // --- Collect window owning applications -----------------------------
    guard let infoList = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
        fputs("Failed to obtain window list\n", stderr)
        exit(1)
    }

    var windows: [[String: Any]] = []
    let minSize: CGFloat = 64

    for win in infoList {
        guard let pid   = win[kCGWindowOwnerPID as String] as? pid_t,
              let app   = NSRunningApplication(processIdentifier: pid) else { continue }

        // Filter same as before --------------------------------------
        if let layer = win[kCGWindowLayer as String] as? Int, layer != 0 { continue }
        guard let b = win[kCGWindowBounds as String] as? [String: CGFloat] else { continue }
        let w = b["Width"]  ?? 0
        let h = b["Height"] ?? 0
        if w < minSize || h < minSize { continue }

        let title = win[kCGWindowName as String] as? String ?? "(no title)"

        windows.append([
            "name"  : app.localizedName ?? "Unknown",
            "pid"   : Int(pid),
            "title" : title
        ])
    }

    let array = windows
    let json  = try JSONSerialization.data(withJSONObject: array, options: [.prettyPrinted])
    FileHandle.standardOutput.write(json)

case "front":
    // Bring app with given PID to the foreground
    guard args.count >= 3, let pidVal = Int32(args[2]) else {
        fputs("Usage: AppInfo front <pid>\n", stderr)
        exit(1)
    }
    guard let app = NSRunningApplication(processIdentifier: pidVal) else {
        fputs("No app for pid \(pidVal)\n", stderr)
        exit(1)
    }

    if #available(macOS 14.0, *) {
        app.activate(options: [.activateAllWindows])
    } else {
        app.activate(options: [.activateIgnoringOtherApps, .activateAllWindows])
    }
    print("done")

default:
    fputs("Unknown command: \(command)\n", stderr)
    exit(1)
} 