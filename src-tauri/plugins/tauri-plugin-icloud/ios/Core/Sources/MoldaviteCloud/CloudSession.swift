import Foundation

/// Account-bound container and metadata state shared by native discovery and
/// synchronous Rust content access. A missing session never names local storage.
public final class CloudSession {
    public static let shared = CloudSession()
    private let lock = NSLock()
    private var documents: CloudDocuments?
    private var ready = false
    private var invalidated = false
    private var items: [String: CloudItem] = [:]

    public func bind(_ documents: CloudDocuments) {
        lock.lock()
        defer { lock.unlock() }
        self.documents = documents
        ready = false
        invalidated = false
        items.removeAll()
    }

    @discardableResult
    public func apply(_ change: CloudChange, from documents: CloudDocuments) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        // A delayed notification from an old query must not initialize the new
        // account's session with an empty or stale snapshot.
        guard self.documents === documents else { return false }
        guard change.kind != "accountChanged", (try? documents.validateIdentity()) != nil else {
            invalidated = true
            ready = false
            return true
        }
        if change.kind == "initial" {
            items.removeAll()
            ready = true
        }
        for item in change.items { items[item.path] = item }
        for path in change.removed { items.removeValue(forKey: path) }
        return true
    }

    public func invalidate() {
        lock.lock()
        defer { lock.unlock() }
        invalidated = true
        ready = false
    }

    public func root() throws -> URL {
        lock.lock()
        defer { lock.unlock() }
        guard let documents = documents else { throw CloudError.unavailable }
        try documents.validateIdentity()
        guard !invalidated else { throw CloudError.accountChanged }
        guard ready else { throw CloudError.preparing }
        return documents.root
    }

    /// Called again inside the file coordinator. A remotely listed name (or
    /// ancestor folder) cannot be mistaken for a new empty local file.
    public func validateAccess(to url: URL, includingDescendants: Bool = false) throws {
        // Inspecting files reads iCloud resource values; collect the listed
        // names under the lock and inspect them after releasing it.
        let (documents, listed): (CloudDocuments?, [CloudItem]) = try {
            lock.lock()
            defer { lock.unlock() }
            guard let documents = self.documents,
                  url.path == documents.root.path || url.path.hasPrefix(documents.root.path + "/") else {
                return (nil, [])
            }
            try documents.validateIdentity()
            guard !invalidated else { throw CloudError.accountChanged }
            guard ready else { throw CloudError.preparing }
            if url.path == documents.root.path { return (nil, []) }
            guard let relative = documents.relativePath(for: url) else { throw CloudError.invalidPath }
            var candidates: [String] = []
            var candidate = relative
            while !candidate.isEmpty {
                candidates.append(candidate)
                candidate = (candidate as NSString).deletingLastPathComponent
            }
            if includingDescendants {
                candidates.append(contentsOf: items.keys.filter { $0.hasPrefix(relative + "/") })
            }
            return (documents, candidates.compactMap { items[$0] })
        }()
        guard let documents = documents else { return }
        for listedItem in listed {
            let actual = try documents.item(at: listedItem.path)
            if actual.downloadState.hasLocalContents { continue }
            // Metadata trails the app's own deletes and renames: a name iCloud
            // last saw on this device that is gone now was removed here.
            if actual.downloadState == .missing && listedItem.downloadState.hasLocalContents { continue }
            // Metadata may still say pending just after a download;
            // actual local bytes win, but absent bytes never do.
            _ = try? documents.startDownloading(listedItem.path)
            throw CloudError.pendingDownload
        }
    }
}

extension CloudSession {
    /// Ask iCloud for a listed item's contents. Completion arrives as a metadata update.
    public func startDownloading(_ path: String) throws -> CloudItem {
        // The request and its resource reads go to iCloud's daemon. Do not hold
        // the lock the main-thread metadata callback needs while they run.
        let documents: CloudDocuments = try {
            lock.lock()
            defer { lock.unlock() }
            guard let documents = self.documents else { throw CloudError.unavailable }
            guard !invalidated else { throw CloudError.accountChanged }
            guard ready else { throw CloudError.preparing }
            guard items[path] != nil else { throw CloudError.invalidPath }
            return documents
        }()
        return try documents.startDownloading(path)
    }
}

/// `path` is relative to the Forge root. The accessor receives the item as JSON.
@_cdecl("moldavite_cloud_download")
public func downloadCloudItem(_ path: UnsafePointer<CChar>?, _ context: UnsafeMutableRawPointer?,
                              _ accessor: FileAccessor) {
    do {
        guard let path = path, let value = String(validatingUTF8: path) else { throw CloudError.invalidPath }
        let item = try CloudSession.shared.startDownloading(value)
        let json = String(data: try JSONEncoder().encode(item), encoding: .utf8) ?? "{}"
        json.withCString { accessor(context, $0, nil) }
    } catch {
        error.localizedDescription.withCString { accessor(context, nil, $0) }
    }
}

@_cdecl("moldavite_cloud_root")
public func activeCloudRoot(_ context: UnsafeMutableRawPointer?, _ accessor: FileAccessor) {
    do {
        let root = try CloudSession.shared.root()
        root.path.withCString { accessor(context, $0, nil) }
    } catch {
        error.localizedDescription.withCString { accessor(context, nil, $0) }
    }
}
