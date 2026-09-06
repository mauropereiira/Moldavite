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
        lock.lock()
        defer { lock.unlock() }
        guard let documents = documents,
              url.path == documents.root.path || url.path.hasPrefix(documents.root.path + "/") else { return }
        try documents.validateIdentity()
        guard !invalidated else { throw CloudError.accountChanged }
        guard ready else { throw CloudError.preparing }
        if url.path == documents.root.path { return }
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
        for candidate in candidates {
            if items[candidate] != nil {
                let actual = try documents.item(at: candidate)
                if !actual.downloadState.hasLocalContents {
                    // Metadata may still say pending just after a download;
                    // actual local bytes win, but absent bytes never do.
                    try? documents.startDownloading(candidate)
                    throw CloudError.pendingDownload
                }
            }
        }
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
