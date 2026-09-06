import Foundation

public typealias TransactionAccessor = @convention(c) (
    UnsafeMutableRawPointer?, UnsafePointer<CChar>?, UnsafePointer<CChar>?
) -> Bool

private struct FileAccess: Decodable {
    let path: String
    let mode: String
    let moveTo: Int?

    func intent() throws -> NSFileAccessIntent {
        guard path.hasPrefix("/"), !path.contains("\0") else { throw CloudError.invalidPath }
        let url = URL(fileURLWithPath: path)
        switch mode {
        case "read": return .readingIntent(with: url, options: .immediatelyAvailableMetadataOnly)
        case "write": return .writingIntent(with: url, options: .forReplacing)
        case "move": return .writingIntent(with: url, options: .forMoving)
        case "delete": return .writingIntent(with: url, options: .forDeleting)
        default: throw CloudError.invalidPath
        }
    }

    func validate(_ url: URL) throws {
        try CloudSession.shared.validateAccess(to: url, includingDescendants: mode == "move" || mode == "delete")
        let item = try CloudDocuments.inspect(url: url, path: path)
        guard item.downloadState.hasLocalContents || item.downloadState == .missing else {
            try? FileManager.default.startDownloadingUbiquitousItem(at: url)
            throw CloudError.pendingDownload
        }
    }
}

/// Reserve every participating path in one request. Rust's borrowed callback
/// finishes before this C call returns, including when Foundation uses a worker.
@_cdecl("moldavite_access_transaction")
public func accessTransaction(
    _ json: UnsafePointer<CChar>?, _ forceCoordination: Bool,
    _ context: UnsafeMutableRawPointer?, _ accessor: @escaping TransactionAccessor
) {
    func fail(_ error: Error) {
        _ = error.localizedDescription.withCString { accessor(context, nil, $0) }
    }
    do {
        guard let json = json, let value = String(validatingUTF8: json) else { throw CloudError.invalidPath }
        let requests = try JSONDecoder().decode([FileAccess].self, from: Data(value.utf8))
        guard !requests.isEmpty else { throw CloudError.invalidPath }
        let intents = try requests.map { try $0.intent() }
        for (index, request) in requests.enumerated() {
            if let destination = request.moveTo {
                guard request.mode == "move", requests.indices.contains(destination), destination != index,
                      requests[destination].mode == "write" else { throw CloudError.invalidPath }
            }
            try request.validate(intents[index].url)
        }
        var cloud = forceCoordination
        for intent in intents {
            var ancestor = intent.url
            while !cloud && ancestor.path != "/" {
                cloud = (try? ancestor.resourceValues(forKeys: [.isUbiquitousItemKey]))?.isUbiquitousItem == true
                ancestor.deleteLastPathComponent()
            }
        }
        func perform(_ coordinator: NSFileCoordinator?) throws {
            for (request, intent) in zip(requests, intents) { try request.validate(intent.url) }
            let paths = try JSONEncoder().encode(intents.map { $0.url.path })
            guard let json = String(data: paths, encoding: .utf8) else { throw CloudError.invalidPath }
            for (index, request) in requests.enumerated() {
                if let destination = request.moveTo {
                    coordinator?.item(at: intents[index].url, willMoveTo: intents[destination].url)
                }
            }
            let succeeded = json.withCString { accessor(context, $0, nil) }
            if succeeded {
                for (index, request) in requests.enumerated() {
                    if let destination = request.moveTo {
                        coordinator?.item(at: intents[index].url, didMoveTo: intents[destination].url)
                    }
                }
            }
        }
        if !cloud { try perform(nil); return }
        guard !Thread.isMainThread else { throw CloudError.preparing }
        let coordinator = NSFileCoordinator(filePresenter: nil)
        let finished = DispatchSemaphore(value: 0)
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        coordinator.coordinate(with: intents, queue: queue) { error in
            defer { finished.signal() }
            do {
                if let error = error { throw error }
                try perform(coordinator)
            } catch { fail(error) }
        }
        // No timeout: returning while Foundation still borrows Rust's context
        // would permit a callback into freed stack storage.
        finished.wait()
    } catch { fail(error) }
}
