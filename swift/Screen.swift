import SwiftUI
import AppKit

// MARK: - Glowing Rectangle ---------------------------------------------------
/// A self-contained view that renders a rounded rectangle with the same
/// animated rainbow-glow effect used in `SpeechView`'s background.
/// Position it anywhere by supplying an `offset`.
struct GlowRectangle: View {
    /// Where to place the rectangle relative to its parent.
    var offset: CGSize = .zero

    /// Rectangle size. Default mimics the one in the original code.
    var size: CGSize = CGSize(width: 320, height: 160)

    /// Blend mode for the glow effect.
    var blendMode: BlendMode = .plusLighter

    /// Animation start time offset to stagger multiple rectangles.
    var startTime: Double = 0

    /// Duration in seconds for one complete animation cycle.
    var cycleDuration: Double = 24.0

    /// Duration in seconds for one complete glow radius cycle.
    var glowCycleDuration: Double = 1.25

    /// Blur radius for the glow effect.
    var blurRadius: CGFloat = 16

    /// Base hue used to start the rainbow.
    private let baseHue: Double = 60

    /// Scale factor. 1.0 produces the same visual size as the original.
    private let zoom: CGFloat = 1.0

    var body: some View {
        TimelineView(.animation) { tl in
            let time      = tl.date.timeIntervalSinceReferenceDate + startTime
            // ── Rotation speed (vertical = fast / horizontal = slow) ──
            let baseRate  = 360.0 / cycleDuration // deg/sec based on cycle duration
            let rawAngle  = time * baseRate
            let cosAbs    = abs(cos(Angle(degrees: rawAngle).radians))
            let speedK    = 0.9 + 0.1 * (1 - cosAbs) // horiz:0.9, vert:1.0
            let angleDeg  = rawAngle * speedK
            let hueShift  = (time / cycleDuration) * 360 // Full hue cycle based on cycleDuration
            let hue       = baseHue + hueShift

            // ── Convert angle to start/end points in unit space ──
            let θ         = Angle(degrees: angleDeg).radians
            let dx        = CGFloat(cos(θ))
            let dy        = CGFloat(sin(θ))
            let startPt   = UnitPoint(x: (1 - dx) * 0.5, y: (1 - dy) * 0.5)
            let endPt     = UnitPoint(x: (1 + dx) * 0.5, y: (1 + dy) * 0.5)

            let radius    = 24 * zoom
            let rectShape = RoundedRectangle(cornerRadius: radius, style: .continuous)

            // ── Animated glow radius using Sin/Cos ──
            let glowAnimationSpeed = 1.0 / glowCycleDuration // cycles per second based on glowCycleDuration
            let glowSin = sin(time * glowAnimationSpeed * 2 * .pi)
            let minGlowRadius: CGFloat = blurRadius * 10 * zoom
            let maxGlowRadius: CGFloat = blurRadius * 30 * zoom
            let animatedGlowRadius = minGlowRadius + (maxGlowRadius - minGlowRadius) * CGFloat((glowSin + 1) / 2)

            ZStack {
                // ① Base gradient fill ------------------------------------------------
                // 透明な塗り（内側は抜けてグローだけ見せる）
                // rectShape.fill(Color.clear)

                // ② Enhanced Multi-layer Glow (複数レイヤーでより濃いグロー) --------
                // Layer 0: Outer bright halo
                rectShape
                    .stroke(
                        LinearGradient(
                            gradient: Gradient(stops: [
                                .init(color: brightColor(hue), location: 0.00),
                            ]),
                            startPoint: startPt,
                            endPoint:   endPt
                        ),
                        lineWidth: 16 * zoom
                    )
                    .compositingGroup()
                    .blur(radius: animatedGlowRadius * 2.0)
                
                // Layer 1: Wide glow base
                rectShape
                    .stroke(
                        LinearGradient(
                            gradient: Gradient(stops: [
                                .init(color: color(hue), location: 0.00),
                            ]),
                            startPoint: startPt,
                            endPoint:   endPt
                        ),
                        lineWidth: 12 * zoom
                    )
                    .compositingGroup()
                    .blur(radius: animatedGlowRadius * 1.5)
                
                // Layer 2: Medium glow
                rectShape
                    .stroke(
                        LinearGradient(
                            gradient: Gradient(stops: [
                                .init(color: color(hue), location: 0.00),
                            ]),
                            startPoint: startPt,
                            endPoint:   endPt
                        ),
                        lineWidth: 8 * zoom
                    )
                    .compositingGroup()
                    .blur(radius: animatedGlowRadius)
                
                // Layer 3: Tight glow
                rectShape
                    .stroke(
                        LinearGradient(
                            gradient: Gradient(stops: [
                                .init(color: color(hue), location: 0.00),
                            ]),
                            startPoint: startPt,
                            endPoint:   endPt
                        ),
                        lineWidth: 4 * zoom
                    )
                    .compositingGroup()
                    .blur(radius: animatedGlowRadius * 0.5)
                
                // Layer 4: Inner bright core
                rectShape
                    .stroke(
                        LinearGradient(
                            gradient: Gradient(stops: [
                                .init(color: color(hue), location: 0.00),
                            ]),
                            startPoint: startPt,
                            endPoint:   endPt
                        ),
                        lineWidth: 2 * zoom
                    )
                    .compositingGroup()
                    .blur(radius: animatedGlowRadius * 0.25)
            }
            .compositingGroup() // Prevent tiling seams
        }
        .frame(width: size.width, height: size.height)
        .blendMode(blendMode)
        .offset(offset)
        // Allows tapping through if placed above other content.
        .allowsHitTesting(false)
    }

    // MARK: - Helper drawing functions ---------------------------------------
    private func color(_ h: Double) -> Color {
        Color(
            hue:        (h.truncatingRemainder(dividingBy: 360)) / 360,
            saturation: 1.0,      // 最大彩度
            brightness: 1.0       // 最大輝度
        )
    }
    
    // より明るい白っぽいグローのためのヘルパー関数
    private func brightColor(_ h: Double) -> Color {
        Color(
            hue:        (h.truncatingRemainder(dividingBy: 360)) / 360,
            saturation: 0.8,      // やや低い彩度で白っぽく
            brightness: 1.0       // 最大輝度
        )
    }
}

// MARK: - ContentView with stacked GlowRectangles ----------------------------
struct ContentView: View {
    let glowSize: CGSize
    
    init(glowSize: CGSize = CGSize(width: 320, height: 160)) {
        self.glowSize = glowSize
    }
    
    var body: some View {
        ZStack {
            GlowRectangle(
                size: glowSize,
                blendMode: .plusLighter, 
                startTime: 0,
                cycleDuration: 1.0,
                glowCycleDuration: 0.5,
                blurRadius: 1
            )
            GlowRectangle(
                size: glowSize,
                blendMode: .normal, 
                startTime: 0.25,
                cycleDuration: 3.0,
                glowCycleDuration: 1.5,
                blurRadius: 3
            )
        }
    }
}

// MARK: - Command Line Arguments Parser ------------------------------------
struct CommandLineArgs {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
    let padding: Double
    let duration: Double
    
    init() {
        let args = CommandLine.arguments
        var x: Double = 200
        var y: Double = 200
        var width: Double = 320
        var height: Double = 160
        var padding: Double = 40
        var duration: Double = 10
        
        var i = 1
        while i < args.count {
            switch args[i] {
            case "--x", "-x":
                if i + 1 < args.count, let value = Double(args[i + 1]) { x = value; i += 1 }
            case "--y", "-y":
                if i + 1 < args.count, let value = Double(args[i + 1]) { y = value; i += 1 }
            case "--width", "-w":
                if i + 1 < args.count, let value = Double(args[i + 1]) { width = value; i += 1 }
            case "--height", "-h":
                if i + 1 < args.count, let value = Double(args[i + 1]) { height = value; i += 1 }
            case "--padding", "-p":
                if i + 1 < args.count, let value = Double(args[i + 1]) { padding = value; i += 1 }
            case "--duration", "-d":
                if i + 1 < args.count, let value = Double(args[i + 1]) { duration = value; i += 1 }
            case "--help":
                print("Usage: \(args[0]) [options]")
                print("Options:")
                print("  --x, -x <value>        X position of window (default: 200)")
                print("  --y, -y <value>        Y position of window (default: 200)")
                print("  --width, -w <value>    Width of glow rectangle (default: 320)")
                print("  --height, -h <value>   Height of glow rectangle (default: 160)")
                print("  --padding, -p <value>  Padding around glow rectangle (default: 40)")
                print("  --duration, -d <secs>  Display duration before exit (default: 10)")
                print("  --help                 Show this help message")
                exit(0)
            default:
                break
            }
            i += 1
        }
        self.x = x
        self.y = y
        self.width = width
        self.height = height
        self.padding = padding
        self.duration = duration
    }
}

// MARK: - Minimal AppKit runner (no @main) -----------------------------------

/// シンプルな `NSWindowController` で `ContentView` を表示するだけ
final class AnimatedGlowWindowController: NSWindowController {
    init(args: CommandLineArgs) {
        // パディングを追加してグローが切れないように少し大きめのウィンドウを作成
        let glowSize = CGSize(width: args.width, height: args.height)
        let margin: CGFloat = CGFloat(args.padding)          // ← ここを調整すると余白が変わる
        let rect = NSRect(x: args.x,
                          y: args.y,
                          width: glowSize.width + margin * 2,
                          height: glowSize.height + margin * 2)
        let window = NSWindow(contentRect: rect,
                              styleMask: [.borderless],
                              backing: .buffered,
                              defer: false)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.title = "Glow Demo"
        window.level = .floating
        // Make the window completely click-through so that it doesn't block interaction with
        // whatever is underneath. This lets the glowing effect behave like a purely visual
        // overlay.
        window.ignoresMouseEvents = true

        // SwiftUI content (wrapper with padding) - グローサイズを引数から設定
        let contentView = ContentView(glowSize: glowSize)
        let host = NSHostingView(rootView: contentView.padding(margin))
        window.contentView = host

        super.init(window: window)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }
}

// アプリ起動 --------------------------------------------------------------
let args = CommandLineArgs()
let fadeTime: Double = 0.75

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let controller = AnimatedGlowWindowController(args: args)
controller.showWindow(nil)
app.activate(ignoringOtherApps: true)

// Initial window transparency for fade-in
controller.window?.alphaValue = 0

// Fade-in animation
NSAnimationContext.runAnimationGroup { ctx in
    ctx.duration = fadeTime
    controller.window?.animator().alphaValue = 1
}

// Schedule fade-out and termination
let displayTime = max(0, args.duration - fadeTime)
DispatchQueue.main.asyncAfter(deadline: .now() + displayTime) {
    NSAnimationContext.runAnimationGroup({ ctx in
        ctx.duration = fadeTime
        controller.window?.animator().alphaValue = 0
    }) {
        NSApplication.shared.terminate(nil)
    }
}

app.run()