// Renders every page of a PDF to PNG with macOS PDFKit, for machines without poppler.
// Used by landing-demo-documents.mts; the Docker build uses pdftoppm instead.
// swift pdf-pages.swift <pdf> <output directory> <width in px>
import AppKit
import Foundation
import PDFKit

let arguments = CommandLine.arguments
guard arguments.count == 4,
  let document = PDFDocument(url: URL(fileURLWithPath: arguments[1])),
  let width = Double(arguments[3])
else {
  FileHandle.standardError.write("usage: pdf-pages.swift <pdf> <output directory> <width>\n".data(using: .utf8)!)
  exit(1)
}
for index in 0..<document.pageCount {
  guard let page = document.page(at: index) else { continue }
  let bounds = page.bounds(for: .mediaBox)
  let scale = width / bounds.width
  let size = NSSize(width: width, height: (bounds.height * scale).rounded())
  guard
    let bitmap = NSBitmapImageRep(
      bitmapDataPlanes: nil, pixelsWide: Int(size.width), pixelsHigh: Int(size.height),
      bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
      colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
    let context = NSGraphicsContext(bitmapImageRep: bitmap)
  else { exit(1) }
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = context
  context.cgContext.setFillColor(NSColor.white.cgColor)
  context.cgContext.fill(CGRect(origin: .zero, size: size))
  context.cgContext.scaleBy(x: scale, y: scale)
  page.draw(with: .mediaBox, to: context.cgContext)
  NSGraphicsContext.restoreGraphicsState()
  let output = URL(fileURLWithPath: arguments[2]).appendingPathComponent("page-\(index + 1).png")
  guard let png = bitmap.representation(using: .png, properties: [:]) else { exit(1) }
  try png.write(to: output)
}
