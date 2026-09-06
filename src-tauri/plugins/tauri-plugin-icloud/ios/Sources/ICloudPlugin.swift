import Foundation
import MoldaviteCloud
import Tauri

private struct PathArgs: Decodable { let path: String }
private struct ObserveArgs: Decodable { let onChange: Channel }
private struct Container: Encodable { let path: String }

class ICloudPlugin: Plugin {
    // Serialize container access and keep potentially blocking Foundation work
    // away from WebKit's main thread. Only query lifecycle belongs on main.
    private let queue = DispatchQueue(label: "app.moldavite.icloud", qos: .userInitiated)
    private var documents: CloudDocuments?
    private var observer: CloudMetadataObserver?

    @objc public func resolve(_ invoke: Invoke) {
        queue.async {
            do {
                let documents = try CloudDocuments.resolve()
                try FileManager.default.createDirectory(at: documents.root, withIntermediateDirectories: true)
                self.documents = documents
                CloudSession.shared.bind(documents)
                DispatchQueue.main.async {
                    self.observer?.stop()
                    self.observer = nil
                    invoke.resolve(Container(path: documents.root.path))
                }
            } catch {
                self.documents = nil
                CloudSession.shared.invalidate()
                DispatchQueue.main.async {
                    self.observer?.stop()
                    self.observer = nil
                    invoke.reject(error.localizedDescription)
                }
            }
        }
    }

    @objc public func status(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(PathArgs.self)
        queue.async {
            do {
                guard let documents = self.documents else { throw CloudError.unavailable }
                invoke.resolve(try documents.item(at: args.path))
            } catch { invoke.reject(error.localizedDescription) }
        }
    }

    @objc public func startDownloading(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(PathArgs.self)
        queue.async {
            do {
                guard let documents = self.documents else { throw CloudError.unavailable }
                invoke.resolve(try documents.startDownloading(args.path))
            } catch { invoke.reject(error.localizedDescription) }
        }
    }

    @objc public func observe(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(ObserveArgs.self)
        queue.async {
            guard let documents = self.documents else {
                invoke.reject(CloudError.unavailable.localizedDescription)
                return
            }
            DispatchQueue.main.async {
                self.observer?.stop()
                let observer = CloudMetadataObserver(documents: documents) { change in
                    // CloudChange contains only strings, booleans and arrays.
                    // Channel encoding cannot contain non-JSON numeric values.
                    if CloudSession.shared.apply(change, from: documents) {
                        try? args.onChange.send(change)
                    }
                }
                do {
                    try observer.start()
                    self.observer = observer
                    invoke.resolve()
                } catch { invoke.reject(error.localizedDescription) }
            }
        }
    }

    @objc public func stopObserving(_ invoke: Invoke) {
        DispatchQueue.main.async {
            self.observer?.stop()
            self.observer = nil
            invoke.resolve()
        }
    }
}

@_cdecl("init_plugin_icloud")
func initPlugin() -> Plugin { ICloudPlugin() }
