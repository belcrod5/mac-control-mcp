// OCRTool.swift
import Foundation
import Vision
import AppKit

@main
struct OCRTool {
    static func pixelBox(from normalized: CGRect, in size: CGSize) -> [String: Int] {
        let x = Int(normalized.minX * size.width)
        let y = Int((1 - normalized.maxY) * size.height)   // Y 軸反転
        let w = Int(normalized.width  * size.width)
        let h = Int(normalized.height * size.height)
        return ["x": x, "y": y, "w": w, "h": h]
    }

    static func main() throws {
        guard CommandLine.arguments.count > 1 else {
            fputs("usage: OCRTool <image-path>\n", stderr)
            exit(1)
        }

        let url = URL(fileURLWithPath: CommandLine.arguments[1])
        guard let img = NSImage(contentsOf: url),
              let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            fputs("failed to load image\n", stderr)
            exit(1)
        }

        let req = VNRecognizeTextRequest()
        req.revision = VNRecognizeTextRequestRevision3   // macOS 12.3 以降
        req.recognitionLanguages = ["ja-JP"]             // 日本語だけに絞る
        req.recognitionLevel = .accurate

        try VNImageRequestHandler(cgImage: cg).perform([req])

        let results = (req.results as? [VNRecognizedTextObservation] ?? []).compactMap { ob -> [String: Any]? in
            guard let best = ob.topCandidates(1).first else { return nil }
            return ["text": best.string,
                    "box": pixelBox(from: ob.boundingBox,
                                    in: CGSize(width: cg.width, height: cg.height))]
        }

        let json = try JSONSerialization.data(withJSONObject: results, options: [.prettyPrinted])
        FileHandle.standardOutput.write(json)
    }
}
