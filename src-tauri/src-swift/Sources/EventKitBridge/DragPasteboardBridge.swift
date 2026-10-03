// The file paths on the drag pasteboard, for `src/dropped_files.rs`. macOS
// only: this package is also linked into the iOS build, which has none.
#if os(macOS)
import AppKit

// A JSON array of paths, freed with `free_string`. A cross-process drag may
// use another pasteboard; post-drop availability must be checked with a real drag.
@_cdecl("drag_pasteboard_file_paths")
public func dragPasteboardFilePaths() -> UnsafeMutablePointer<CChar>? {
    let pasteboard = NSPasteboard(name: .drag)
    let urls = pasteboard.readObjects(
        forClasses: [NSURL.self],
        options: [.urlReadingFileURLsOnly: true]
    ) as? [NSURL] ?? []
    var paths = urls.compactMap { $0.filePathURL?.path }
    if paths.isEmpty,
       let names = pasteboard.propertyList(
        forType: NSPasteboard.PasteboardType("NSFilenamesPboardType")
       ) as? [String] {
        paths = names
    }
    guard let data = try? JSONSerialization.data(withJSONObject: paths),
          let json = String(data: data, encoding: .utf8) else {
        return nil
    }
    return strdup(json)
}
#endif
