import Foundation

public enum CloudError: LocalizedError {
    case unavailable, accountChanged, invalidPath

    public var errorDescription: String? {
        switch self {
        case .unavailable: return "iCloud Drive is unavailable. Check your iCloud account and app access."
        case .accountChanged: return "The iCloud account changed. Reopen the synced Forge before continuing."
        case .invalidPath: return "The requested file is outside the synced Forge."
        }
    }
}

public enum DownloadState: String, Codable {
    case local, current, downloaded, pending, unknown, missing

    public var hasLocalContents: Bool {
        self == .local || self == .current || self == .downloaded
    }

    static func from(status: URLUbiquitousItemDownloadingStatus?, ubiquitous: Bool) -> Self {
        guard ubiquitous else { return .local }
        switch status {
        case .current: return .current
        case .downloaded: return .downloaded
        case .notDownloaded: return .pending
        default: return .unknown
        }
    }
}

public struct CloudItem: Codable {
    public let path: String
    public let downloadState: DownloadState
    public let isDownloading: Bool
    public let isUploading: Bool
    public let hasConflicts: Bool
    public let error: String?
}

/// Only this app's Documents container, never an arbitrary caller-supplied root.
/// The Foundation-only core also builds on macOS for filesystem regression tests.
public final class CloudDocuments {
    public static let containerIdentifier = "iCloud.app.moldavite"
    public let root: URL
    private let checkIdentity: () throws -> Void

    init(root: URL, checkIdentity: @escaping () throws -> Void = {}) {
        self.root = root.standardizedFileURL.resolvingSymlinksInPath()
        self.checkIdentity = checkIdentity
    }

    /// FileManager may set up iCloud here, so callers must use a background queue.
    public static func resolve() throws -> CloudDocuments {
        let manager = FileManager.default
        guard let identity = manager.ubiquityIdentityToken,
              let container = manager.url(forUbiquityContainerIdentifier: containerIdentifier) else {
            throw CloudError.unavailable
        }
        // An account change while resolving must not bind the old identity to
        // a container belonging to the new account.
        let checkIdentity = {
            guard let current = manager.ubiquityIdentityToken, identity.isEqual(current) else {
                throw CloudError.accountChanged
            }
        }
        try checkIdentity()
        return CloudDocuments(root: container.appendingPathComponent("Documents", isDirectory: true),
                              checkIdentity: checkIdentity)
    }

    public func validateIdentity() throws {
        try checkIdentity()
    }

    public func url(for path: String) throws -> URL {
        try checkIdentity()
        let components = path.components(separatedBy: "/")
        guard !path.isEmpty, !path.contains("\0"), !path.contains("\\"),
              components.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else {
            throw CloudError.invalidPath
        }
        let url = root.appendingPathComponent(path).standardizedFileURL
        // resolvingSymlinksInPath alone does not resolve a parent symlink when
        // the leaf is missing. Inspect each component, including dangling links.
        var ancestor = root
        for component in components {
            ancestor.appendPathComponent(component)
            if (try? FileManager.default.destinationOfSymbolicLink(atPath: ancestor.path)) != nil {
                throw CloudError.invalidPath
            }
        }
        let resolved = url.resolvingSymlinksInPath()
        guard resolved.path == url.path, resolved.path.hasPrefix(root.path + "/") else {
            throw CloudError.invalidPath
        }
        return url
    }

    public func relativePath(for url: URL) -> String? {
        let prefix = root.path + "/"
        guard url.isFileURL, url.path.hasPrefix(prefix) else { return nil }
        let path = String(url.path.dropFirst(prefix.count))
        guard (try? self.url(for: path)) != nil else { return nil }
        return path
    }

    public func item(at path: String) throws -> CloudItem {
        let url = try self.url(for: path)
        let manager = FileManager.default
        // Older iCloud Drive versions expose .name.ext.icloud placeholders.
        // Their bytes are metadata, never the contents of the requested note.
        let placeholder = url.deletingLastPathComponent()
            .appendingPathComponent(".\(url.lastPathComponent).icloud")
        let keys: Set<URLResourceKey> = [
            .isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey,
            .ubiquitousItemIsDownloadingKey, .ubiquitousItemIsUploadingKey,
            .ubiquitousItemHasUnresolvedConflictsKey,
            .ubiquitousItemDownloadingErrorKey, .ubiquitousItemUploadingErrorKey
        ]
        let values: URLResourceValues?
        do {
            // Ask Foundation before checking physical existence: an iCloud URL
            // can have resource metadata while its contents are still remote.
            values = try url.resourceValues(forKeys: keys)
        } catch let error as NSError where error.domain == NSCocoaErrorDomain
            && (error.code == NSFileReadNoSuchFileError || error.code == NSFileNoSuchFileError) {
            values = nil
        }
        let state: DownloadState
        if values?.isUbiquitousItem == true {
            state = DownloadState.from(status: values?.ubiquitousItemDownloadingStatus, ubiquitous: true)
        } else if !manager.fileExists(atPath: url.path) {
            state = manager.fileExists(atPath: placeholder.path) ? .pending : .missing
        } else {
            state = .local
        }
        return CloudItem(
            path: path,
            downloadState: state,
            isDownloading: values?.ubiquitousItemIsDownloading == true,
            isUploading: values?.ubiquitousItemIsUploading == true,
            hasConflicts: values?.ubiquitousItemHasUnresolvedConflicts == true,
            error: (values?.ubiquitousItemDownloadingError ?? values?.ubiquitousItemUploadingError)?.localizedDescription
        )
    }

    public func startDownloading(_ path: String) throws -> CloudItem {
        let url = try self.url(for: path)
        try FileManager.default.startDownloadingUbiquitousItem(at: url)
        // The request is asynchronous. Success here never means bytes arrived.
        return try item(at: path)
    }
}
