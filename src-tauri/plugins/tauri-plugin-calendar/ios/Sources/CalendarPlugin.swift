import AuthenticationServices
import Tauri
import UIKit

private struct AuthenticateArgs: Decodable {
    let url: String
    let callbackScheme: String
}

private struct AuthenticateResult: Encodable {
    let url: String?
}

final class CalendarPlugin: Plugin, ASWebAuthenticationPresentationContextProviding {
    // The session must outlive this call or it is torn down mid-sign-in.
    private var session: ASWebAuthenticationSession?

    @objc func authenticate(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(AuthenticateArgs.self)
        guard let url = URL(string: args.url), url.scheme == "https" else {
            invoke.reject("The sign-in address is not valid.")
            return
        }
        DispatchQueue.main.async {
            guard self.session == nil else {
                invoke.reject("A sign-in is already in progress.")
                return
            }
            let session = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: args.callbackScheme
            ) { callbackURL, error in
                DispatchQueue.main.async { self.session = nil }
                if let callbackURL = callbackURL {
                    invoke.resolve(AuthenticateResult(url: callbackURL.absoluteString))
                } else if let error = error as? ASWebAuthenticationSessionError,
                          error.code == .canceledLogin {
                    invoke.resolve(AuthenticateResult(url: nil))
                } else {
                    invoke.reject(error?.localizedDescription ?? "Sign-in did not finish.")
                }
            }
            session.presentationContextProvider = self
            // Shares Safari's cookies, so a signed-in Google user only picks an account.
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            if !session.start() {
                self.session = nil
                invoke.reject("Could not open the sign-in sheet.")
            }
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        manager.viewController?.view.window ?? ASPresentationAnchor()
    }
}

@_cdecl("init_plugin_calendar")
func initPlugin() -> Plugin { CalendarPlugin() }
