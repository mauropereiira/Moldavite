#if os(macOS)
import Foundation

public typealias CloudChangeCallback = @convention(c) (UnsafePointer<CChar>?) -> Void

/// macOS initializes the same native container as iOS, including on first use.
/// The metadata query also tracks names whose bytes are still remote.
private final class DesktopCloudConnection {
    static let shared = DesktopCloudConnection()
    let connecting = NSLock()
    var observer: CloudMetadataObserver?
}

@_cdecl("moldavite_connect_cloud")
public func connectDesktopCloud(
    _ context: UnsafeMutableRawPointer?, _ result: FileAccessor,
    _ onChange: @escaping CloudChangeCallback
) {
    func fail(_ error: Error) {
        error.localizedDescription.withCString { result(context, nil, $0) }
    }
    guard !Thread.isMainThread else { fail(CloudError.preparing); return }
    let connection = DesktopCloudConnection.shared
    guard connection.connecting.try() else { fail(CloudError.preparing); return }
    defer { connection.connecting.unlock() }
    do {
        let documents = try CloudDocuments.resolve()
        try FileManager.default.createDirectory(at: documents.root, withIntermediateDirectories: true)
        CloudSession.shared.bind(documents)
        let gathered = DispatchSemaphore(value: 0)
        DispatchQueue.main.async {
            connection.observer?.stop()
            let observer = CloudMetadataObserver(documents: documents) { change in
                guard CloudSession.shared.apply(change, from: documents) else { return }
                if let data = try? JSONEncoder().encode(change),
                   let json = String(data: data, encoding: .utf8) {
                    json.withCString { onChange($0) }
                }
                if change.kind == "initial" || change.kind == "accountChanged" { gathered.signal() }
            }
            do {
                try observer.start()
                connection.observer = observer
            } catch {
                CloudSession.shared.invalidate()
                gathered.signal()
            }
        }
        guard gathered.wait(timeout: .now() + 15) == .success else { throw CloudError.preparing }
        let root = try CloudSession.shared.root()
        root.path.withCString { result(context, $0, nil) }
    } catch { fail(error) }
}
#endif
