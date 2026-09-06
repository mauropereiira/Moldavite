import UIKit
import WebKit
import Tauri

private struct AppearanceOptions: Decodable {
    enum Mode: String, Decodable { case light, dark, system }
    let mode: Mode
}

final class MobileUiPlugin: Plugin {
    private weak var webview: WKWebView?

    override func load(webview: WKWebView) {
        self.webview = webview
        webview.configuration.userContentController.addUserScript(
            WKUserScript(source: textSizeScript(), injectionTime: .atDocumentEnd, forMainFrameOnly: true)
        )
        NotificationCenter.default.addObserver(self, selector: #selector(updateTextSize),
            name: UIContentSizeCategory.didChangeNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(updateTextSize),
            name: UIApplication.didBecomeActiveNotification, object: nil)
        updateTextSize()
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    private func textSizeScript() -> String {
        // Preserve Cream's custom typefaces while following the user's system
        // body-text scale. WebKit reflows text without zooming the touch targets.
        let scale = UIFont.preferredFont(forTextStyle: .body).pointSize / 17.0
        return """
        if (document.documentElement) {
            document.documentElement.style.webkitTextSizeAdjust = '\(scale * 100)%';
            document.documentElement.style.textSizeAdjust = '\(scale * 100)%';
            document.documentElement.style.setProperty('--mobile-text-scale', '\(scale)');
            document.documentElement.style.setProperty('--mobile-heading-text-adjust', '\(min(scale, 2) * 100)%');
            document.documentElement.dataset.largeText = '\(scale > 1.5)';
        }
        """
    }

    @objc private func updateTextSize() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.webview?.evaluateJavaScript(self.textSizeScript(), completionHandler: nil)
        }
    }

    @objc func setAppearance(_ invoke: Invoke) throws {
        let options = try invoke.parseArgs(AppearanceOptions.self)
        DispatchQueue.main.async {
            guard let controller = self.manager.viewController,
                  let window = controller.view.window else {
                invoke.reject("The app window is not ready.")
                return
            }
            switch options.mode {
            case .light: window.overrideUserInterfaceStyle = .light
            case .dark: window.overrideUserInterfaceStyle = .dark
            case .system: window.overrideUserInterfaceStyle = .unspecified
            }
            controller.setNeedsStatusBarAppearanceUpdate()
            invoke.resolve()
        }
    }
}

@_cdecl("init_plugin_mobile_ui")
func initPlugin() -> Plugin { MobileUiPlugin() }
