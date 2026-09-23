import UIKit
import Tauri

private struct ExportOptions: Decodable {
    let path: String
}

final class DocumentExportPlugin: Plugin, UIDocumentPickerDelegate {
    private var pending: Invoke?

    @objc func exportFile(_ invoke: Invoke) throws {
        let options = try invoke.parseArgs(ExportOptions.self)
        let source = URL(fileURLWithPath: options.path)
        DispatchQueue.main.async {
            guard #available(iOS 14.0, *) else {
                invoke.reject("Document export requires iOS 14 or later.")
                return
            }
            guard self.pending == nil,
                  let presenter = self.manager.viewController,
                  presenter.presentedViewController == nil else {
                invoke.reject("Another dialog is already open.")
                return
            }
            guard FileManager.default.fileExists(atPath: source.path) else {
                invoke.reject("The export file is no longer available.")
                return
            }
            // iOS copies the complete source. Never return a destination path
            // for Rust to write after the picker has relinquished its access.
            let picker = UIDocumentPickerViewController(forExporting: [source], asCopy: true)
            picker.delegate = self
            picker.modalPresentationStyle = .fullScreen
            self.pending = invoke
            presenter.present(picker, animated: true)
        }
    }

    @objc func shareFile(_ invoke: Invoke) throws {
        let options = try invoke.parseArgs(ExportOptions.self)
        let source = URL(fileURLWithPath: options.path)
        DispatchQueue.main.async {
            guard self.pending == nil,
                  let presenter = self.manager.viewController,
                  presenter.presentedViewController == nil else {
                invoke.reject("Another dialog is already open.")
                return
            }
            guard FileManager.default.fileExists(atPath: source.path) else {
                invoke.reject("The shared file is no longer available.")
                return
            }
            let sheet = UIActivityViewController(activityItems: [source], applicationActivities: nil)
            // An iPad presents the sheet as a popover, which must have an anchor.
            if let popover = sheet.popoverPresentationController {
                let bounds = presenter.view.bounds
                popover.sourceView = presenter.view
                popover.sourceRect = CGRect(x: bounds.midX, y: bounds.midY, width: 0, height: 0)
                popover.permittedArrowDirections = []
            }
            // Cancelling an activity such as Mail returns to the sheet, which
            // still needs the file; only the sheet closing ends the share.
            sheet.completionWithItemsHandler = { [weak self] activity, completed, _, _ in
                if completed || activity == nil {
                    self?.finish(completed)
                }
            }
            self.pending = invoke
            presenter.present(sheet, animated: true)
        }
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        finish(!urls.isEmpty)
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        finish(false)
    }

    private func finish(_ exported: Bool) {
        let invoke = pending
        pending = nil
        invoke?.resolve(["exported": exported])
    }
}

@_cdecl("init_plugin_document_export")
func initPlugin() -> Plugin { DocumentExportPlugin() }
