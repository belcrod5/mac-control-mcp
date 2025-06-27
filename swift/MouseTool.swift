import CoreGraphics
import Foundation
import AppKit

// CommandLine argsを取得
let args = CommandLine.arguments

if args.count < 2 {
    print("Usage: MouseTool <command> [args...]")
    print("Commands:")
    print("  move <x> <y>  - Move mouse to coordinates")
    print("  click         - Click at current position")
    print("  key <keycode> - Send key press")
    exit(1)
}

let command = args[1]

switch command {
case "move":
    if args.count >= 4,
       let x = Double(args[2]),
       let y = Double(args[3]) {
        let endPoint = CGPoint(x: x, y: y)

        // 現在のマウス位置を開始点として取得
        guard let currentEvent = CGEvent(source: nil) else {
            print("Failed to get current mouse location")
            exit(1)
        }
        let startPoint = currentEvent.location

        // ベジェ曲線の制御点を計算 (開始点→終点方向に対して緩やかなカーブを描く)
        let cp1 = CGPoint(x: startPoint.x + (endPoint.x - startPoint.x) * 0.25,
                          y: startPoint.y + (endPoint.y - startPoint.y) * 0.0)
        let cp2 = CGPoint(x: startPoint.x + (endPoint.x - startPoint.x) * 0.75,
                          y: startPoint.y + (endPoint.y - startPoint.y) * 1.0)

        // イージング関数 (easeInOut: 3t^2 - 2t^3)
        func easeInOut(_ t: Double) -> Double {
            return 0.5 * (1 - cos(t * .pi))
        }


        // ベジェ曲線上の点を計算するヘルパー
        func bezierPoint(_ t: Double) -> CGPoint {
            let mt = 1.0 - t
            let mt2 = mt * mt
            let t2 = t * t
            let a = mt2 * mt       // (1-t)^3
            let b = 3 * mt2 * t    // 3(1-t)^2 t
            let c = 3 * mt * t2    // 3(1-t) t^2
            let d = t * t2         // t^3

            let xPos = a * startPoint.x + b * cp1.x + c * cp2.x + d * endPoint.x
            let yPos = a * startPoint.y + b * cp1.y + c * cp2.y + d * endPoint.y
            return CGPoint(x: xPos, y: yPos)
        }

        // アニメーション設定
        let duration: Double = 0.5 // seconds (定数)
        let steps = 120            // 60fps を想定した十分な分割数
        let stepDuration = duration / Double(steps)

        for i in 0...steps {
            let tRaw = Double(i) / Double(steps)
            let t = easeInOut(tRaw)
            let pos = bezierPoint(t)

            if let moveEvent = CGEvent(mouseEventSource: nil,
                                       mouseType: .mouseMoved,
                                       mouseCursorPosition: pos,
                                       mouseButton: .left) {
                moveEvent.post(tap: .cghidEventTap)
            }

            // スリープして次のフレームまで待機
            usleep(UInt32(stepDuration * 1_000_000))
        }

        print("Animated move from (\(Int(startPoint.x)), \(Int(startPoint.y))) to (\(Int(endPoint.x)), \(Int(endPoint.y)))")
    } else {
        print("Error: move command requires x and y coordinates")
        exit(1)
    }

case "click":
    print("click.swift")
    // 現在のマウス位置を取得
    let currentLocation = CGEvent(source: nil)!.location
    
    // クリック位置にあるウィンドウを検索して、そのアプリをアクティブ化
    let screenH = NSScreen.main?.frame.height ?? 0
    let queryPoint = CGPoint(x: currentLocation.x, y: screenH - currentLocation.y)

    if let winList = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] {
        for win in winList {
            guard let bounds = win[kCGWindowBounds as String] as? [String: CGFloat],
                  let pid    = win[kCGWindowOwnerPID as String] as? pid_t else { continue }

            let rect = CGRect(x: bounds["X"] ?? 0,
                              y: bounds["Y"] ?? 0,
                              width: bounds["Width"] ?? 0,
                              height: bounds["Height"] ?? 0)

            if rect.contains(queryPoint),
               let app = NSRunningApplication(processIdentifier: pid) {
                if #available(macOS 14.0, *) {
                    // macOS 14 以降では ignoreOtherApps は無効化されたため指定しない
                    app.activate(options: [.activateAllWindows])
                    print("activateAllWindows")
                } else {
                    app.activate(options: [.activateIgnoringOtherApps, .activateAllWindows])
                    print("activateIgnoringOtherApps")
                }

                // アクティブ化されたアプリの詳細を表示
                let appName     = app.localizedName ?? "Unknown"
                let bundleID    = app.bundleIdentifier ?? "Unknown"
                let windowTitle = win[kCGWindowName as String] as? String ?? "(no title)"
                print("Activated app → Name: \(appName), BundleID: \(bundleID), PID: \(pid), WindowTitle: \(windowTitle)")
                break
            }
        }
    }

    // マウスダウンとマウスアップでクリックを実行
    let clickDown = CGEvent(mouseEventSource: nil,
                           mouseType: .leftMouseDown,
                           mouseCursorPosition: currentLocation,
                           mouseButton: .left)
    let clickUp = CGEvent(mouseEventSource: nil,
                         mouseType: .leftMouseUp,
                         mouseCursorPosition: currentLocation,
                         mouseButton: .left)
    
    clickDown?.post(tap: .cghidEventTap)
    usleep(200_000)
    clickUp?.post(tap: .cghidEventTap)
    
    print("Clicked at (\(currentLocation.x), \(currentLocation.y))")

case "key":
    if args.count >= 3,
       let keyCode = CGKeyCode(args[2]) {
        
        // キーイベントに追加のフラグを設定
        let keyDown = CGEvent(keyboardEventSource: nil,
                             virtualKey: keyCode,
                             keyDown: true)
        let keyUp = CGEvent(keyboardEventSource: nil,
                           virtualKey: keyCode,
                           keyDown: false)
        
        // キーイベントが適切に作成されたかチェック
        guard let downEvent = keyDown, let upEvent = keyUp else {
            print("Failed to create key events")
            exit(1)
        }
        
        // イベントを送信
        downEvent.post(tap: .cghidEventTap)
        // 短い遅延を追加
        usleep(50000) // 50ms
        upEvent.post(tap: .cghidEventTap)
        
        print("Pressed key with code: \(keyCode)")
        
        // ESCキーの場合は追加の情報を表示
        if keyCode == 53 {
            print("ESC key detected - this is escape key")
        }
    } else {
        print("Error: key command requires keycode")
        exit(1)
    }

default:
    print("Unknown command: \(command)")
    exit(1)
} 