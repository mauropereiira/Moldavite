import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

// Usage: tomask in.png out.png cropTopFraction
let args = CommandLine.arguments
let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: args[1]) as CFURL, nil)!
let image = CGImageSourceCreateImageAtIndex(src, 0, nil)!
let cropTop = Int(Double(image.height) * Double(args[3])!)
let w = image.width, h = image.height - cropTop
let cropped = image.cropping(to: CGRect(x: 0, y: cropTop, width: w, height: h))!
var gray = [UInt8](repeating: 0, count: w * h)
let gctx = CGContext(data: &gray, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
                     space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)!
gctx.draw(cropped, in: CGRect(x: 0, y: 0, width: w, height: h))
var rgba = [UInt8](repeating: 0, count: w * h * 4)
for i in 0..<(w * h) {
    // Paper (light) becomes transparent; ink keeps its darkness as opacity.
    let ink = 255 - Int(gray[i])
    let a = ink < 24 ? 0 : min(255, (ink - 24) * 255 / 200)
    // Fade toward the top so the scene sits behind the wordmark.
    let y = i / w
    let ramp = min(1.0, Double(y) / (Double(h) * 0.45))
    rgba[i * 4 + 3] = UInt8(Double(a) * ramp)
}
let octx = CGContext(data: &rgba, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                     space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
let out = octx.makeImage()!
let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: args[2]) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, out, nil)
CGImageDestinationFinalize(dest)
print("\(w)x\(h)")
