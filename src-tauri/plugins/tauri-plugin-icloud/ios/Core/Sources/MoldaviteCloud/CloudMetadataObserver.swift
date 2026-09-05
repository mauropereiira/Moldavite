import Foundation

public struct CloudChange: Codable {
    public let kind: String
    public let items: [CloudItem]
    public let removed: [String]
}

/// Metadata, including undownloaded items, is the iOS directory-change source.
/// All lifecycle and notification handling runs on the main run loop as required
/// by NSMetadataQuery. Only URLs inside the selected container leave this class.
public final class CloudMetadataObserver {
    private let documents: CloudDocuments
    private let query = NSMetadataQuery()
    private let onChange: (CloudChange) -> Void
    private var observers: [NSObjectProtocol] = []

    public init(documents: CloudDocuments, onChange: @escaping (CloudChange) -> Void) {
        self.documents = documents
        self.onChange = onChange
    }

    public func start() throws {
        dispatchPrecondition(condition: .onQueue(.main))
        try documents.validateIdentity()
        stop()
        query.searchScopes = [NSMetadataQueryUbiquitousDocumentsScope]
        query.predicate = NSPredicate(format: "%K BEGINSWITH %@", NSMetadataItemPathKey,
                                      documents.root.path + "/")
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: .NSMetadataQueryDidFinishGathering,
                                            object: query, queue: .main) { [weak self] _ in
            self?.publishInitial()
        })
        observers.append(center.addObserver(forName: .NSMetadataQueryDidUpdate,
                                            object: query, queue: .main) { [weak self] note in
            self?.publishUpdate(note)
        })
        observers.append(center.addObserver(forName: .NSUbiquityIdentityDidChange,
                                            object: nil, queue: .main) { [weak self] _ in
            guard let self = self else { return }
            self.stop()
            self.onChange(CloudChange(kind: "accountChanged", items: [], removed: []))
        })
        if !query.start() {
            stop()
            throw CloudError.unavailable
        }
    }

    public func stop() {
        dispatchPrecondition(condition: .onQueue(.main))
        query.stop()
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        observers.removeAll()
    }

    private func item(_ metadata: NSMetadataItem) -> CloudItem? {
        guard let url = metadata.value(forAttribute: NSMetadataItemURLKey) as? URL,
              let path = documents.relativePath(for: url) else { return nil }
        let status = metadata.value(forAttribute: NSMetadataUbiquitousItemDownloadingStatusKey) as? String
        let downloadState: DownloadState
        switch status {
        case NSMetadataUbiquitousItemDownloadingStatusCurrent: downloadState = .current
        case NSMetadataUbiquitousItemDownloadingStatusDownloaded: downloadState = .downloaded
        case NSMetadataUbiquitousItemDownloadingStatusNotDownloaded: downloadState = .pending
        default: downloadState = .unknown
        }
        let error = (metadata.value(forAttribute: NSMetadataUbiquitousItemDownloadingErrorKey)
            ?? metadata.value(forAttribute: NSMetadataUbiquitousItemUploadingErrorKey)) as? Error
        return CloudItem(
            path: path, downloadState: downloadState,
            isDownloading: metadata.value(forAttribute: NSMetadataUbiquitousItemIsDownloadingKey) as? Bool == true,
            isUploading: metadata.value(forAttribute: NSMetadataUbiquitousItemIsUploadingKey) as? Bool == true,
            hasConflicts: metadata.value(forAttribute: NSMetadataUbiquitousItemHasUnresolvedConflictsKey) as? Bool == true,
            error: error?.localizedDescription
        )
    }

    private func publishInitial() {
        query.disableUpdates()
        defer { query.enableUpdates() }
        let items = (query.results as? [NSMetadataItem] ?? []).compactMap(item)
        onChange(CloudChange(kind: "initial", items: items, removed: []))
    }

    private func publishUpdate(_ note: Notification) {
        query.disableUpdates()
        defer { query.enableUpdates() }
        let added = note.userInfo?[NSMetadataQueryUpdateAddedItemsKey] as? [NSMetadataItem] ?? []
        let changed = note.userInfo?[NSMetadataQueryUpdateChangedItemsKey] as? [NSMetadataItem] ?? []
        let removed = note.userInfo?[NSMetadataQueryUpdateRemovedItemsKey] as? [NSMetadataItem] ?? []
        // A pending or unknown download is an item update, never a removal.
        onChange(CloudChange(kind: "changed", items: (added + changed).compactMap(item),
                             removed: removed.compactMap { metadata in
            guard let url = metadata.value(forAttribute: NSMetadataItemURLKey) as? URL else { return nil }
            return documents.relativePath(for: url)
        }))
    }
}
