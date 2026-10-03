import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

// Usage: field-splice in.(webp|png) out.png leftMin leftMax rightMin rightMax blend
// Joins columns [0, L) to [R, w) with a short crossfade, picking the L and R
// whose alpha columns match best so the horizon lines meet.
let a = CommandLine.arguments
let img = CGImageSourceCreateImageAtIndex(CGImageSourceCreateWithURL(URL(fileURLWithPath: a[1]) as CFURL, nil)!, 0, nil)!
let w = img.width, h = img.height
var px = [UInt8](repeating: 0, count: w * h * 4)
let ctx = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
func alpha(_ x: Int, _ y: Int) -> Int { Int(px[(y * w + x) * 4 + 3]) }
let lMin = Int(a[3])!, lMax = Int(a[4])!, rMin = Int(a[5])!, rMax = Int(a[6])!, blend = Int(a[7])!
var best = (Int.max, 0, 0)
for l in stride(from: lMin, through: lMax, by: 2) {
    for r in stride(from: rMin, through: rMax, by: 2) {
        var cost = 0
        for dx in 0..<blend {
            for y in stride(from: h / 2, to: h, by: 1) { cost += abs(alpha(l + dx, y) - alpha(r + dx, y)) }
        }
        if cost < best.0 { best = (cost, l, r) }
    }
}
let (_, l, r) = best
let ow = l + blend + (w - r - blend)
var out = [UInt8](repeating: 0, count: ow * h * 4)
for y in 0..<h {
    for x in 0..<ow {
        var v: Int
        if x < l { v = alpha(x, y) }
        else if x < l + blend {
            let t = Double(x - l) / Double(blend)
            v = Int(Double(alpha(x, y)) * (1 - t) + Double(alpha(r + (x - l), y)) * t)
        } else { v = alpha(r + (x - l), y) }
        out[(y * ow + x) * 4 + 3] = UInt8(v)
    }
}
let octx = CGContext(data: &out, width: ow, height: h, bitsPerComponent: 8, bytesPerRow: ow * 4,
                     space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
let d = CGImageDestinationCreateWithURL(URL(fileURLWithPath: a[2]) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(d, octx.makeImage()!, nil); CGImageDestinationFinalize(d)
print("L=\(l) R=\(r) \(ow)x\(h)")
