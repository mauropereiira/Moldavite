import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

// Usage: iconmask in.png out.png outSize dilateRadius
let a = CommandLine.arguments
let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: a[1]) as CFURL, nil)!
let img = CGImageSourceCreateImageAtIndex(src, 0, nil)!
let w = img.width, h = img.height, out = Int(a[3])!, r = Int(a[4])!
var g = [UInt8](repeating: 0, count: w * h)
let gc = CGContext(data: &g, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
                   space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)!
gc.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
var ink = g.map { v -> UInt8 in let i = 255 - Int(v); return UInt8(i < 40 ? 0 : min(255, (i - 40) * 255 / 160)) }
// Separable max filter thickens hairlines so they survive heavy downscaling.
func dilate(_ s: [UInt8], horizontal: Bool) -> [UInt8] {
    var d = s
    for y in 0..<h { for x in 0..<w {
        var m: UInt8 = 0
        for k in -r...r {
            let xx = horizontal ? x + k : x, yy = horizontal ? y : y + k
            if xx >= 0 && xx < w && yy >= 0 && yy < h { m = max(m, s[yy * w + xx]) }
        }
        d[y * w + x] = m
    } }
    return d
}
if r > 0 { ink = dilate(dilate(ink, horizontal: true), horizontal: false) }
var rgba = [UInt8](repeating: 0, count: w * h * 4)
for i in 0..<(w * h) { rgba[i * 4 + 3] = ink[i] }
let big = CGContext(data: &rgba, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!.makeImage()!
let small = CGContext(data: nil, width: out, height: out, bitsPerComponent: 8, bytesPerRow: out * 4,
                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
small.interpolationQuality = .high
small.draw(big, in: CGRect(x: 0, y: 0, width: out, height: out))
let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: a[2]) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, small.makeImage()!, nil)
CGImageDestinationFinalize(dest)
