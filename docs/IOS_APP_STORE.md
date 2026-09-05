# iOS App Store and TestFlight handoff

Working release guide, checked against Apple and Tauri documentation on
2026-09-05. **This branch is not ready to upload yet.** The authoritative
functional checklist is [MOBILE_QA.md](MOBILE_QA.md). No signed device archive,
TestFlight upload, App Store record or export declaration has been verified.

## Actions Mauro needs to take in his Apple account

1. Confirm an active Apple Developer Program membership and accept outstanding
   agreements. Sign into Xcode under Settings → Accounts with that team.
2. In Certificates, Identifiers & Profiles, register or verify the explicit app
   ID `app.moldavite` and extension ID `app.moldavite.widget`. The tracked team is
   `J6Z5WJKHZB`; confirm that it is the intended distribution team.
3. Enable iCloud Documents for the main app ID, create or select
   `iCloud.app.moldavite`, and associate that container with the main app. Refresh
   provisioning profiles after changing capabilities. The current widget only
   opens a deep link and needs no shared App Group or iCloud entitlement.
4. Create the iOS app record in App Store Connect using the exact bundle ID
   `app.moldavite`, the name Moldavite if available, the intended primary language
   and a private SKU such as `moldavite-ios`. An app record must exist before
   uploading a build. [Apple's workflow](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-workflow)
5. Choose territories and price; complete the applicable tax, banking and EU
   trader-status forms. These are account-owner decisions, not build settings.
6. Complete the encryption questions described below. Supply the actual review
   contact details and any documentation requested by Apple.
7. Add internal TestFlight testers. Uploading a build, inviting external testers
   and submitting for App Review are separate actions; none has been performed
   on Mauro's behalf.

## Prepare the release candidate

- Use Node 20 or 22, the repository's locked dependencies, the stable Xcode
  installation and the `aarch64-apple-ios` Rust target. Since April 28, 2026,
  uploads require Xcode 26 or later and an iOS 26 SDK or later. The deployment
  target is a separate setting; building with a newer SDK does not require all
  users to run that OS. [Apple's current SDK requirement](https://developer.apple.com/news/upcoming-requirements/?id=02032026a)
- Finish every requirement in MOBILE_QA.md, including iPad, photo selection,
  device keyboard behavior, lifecycle saves and iCloud offline/conflict tests.
- Run every frontend and Rust gate listed there against the exact commit being
  archived. Also run the Swift core tests documented in MOBILE.md.
- Inspect the icon and launch screen on devices. Audit the final app and widget
  privacy manifests and required-reason APIs. A simulator build does not prove
  App Store privacy validation; the manifest work is still outstanding.
  [Apple's required-reason API guidance](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api)
- Verify a release build starts without the Vite server. Development builds load
  localhost; they are not the build to distribute.

## Version and signing settings

Choose the public version using the existing repository release process in
[RELEASING.md](RELEASING.md). Choose an increasing build number for each upload.
The app and embedded widget must have matching version/build values.

The source of the Xcode project is `src-tauri/gen/apple/project.yml`:

- Set `CFBundleShortVersionString` and `CFBundleVersion` in both app and widget
  `info.properties` blocks.
- Set the same iOS build number in `bundle.iOS.bundleVersion` in
  `src-tauri/tauri.conf.json`, so Tauri's generated app plist agrees with the
  widget. A sequential string such as `"100"` is supported. Do not change the
  macOS build number as a side effect. [Tauri's version configuration](https://v2.tauri.app/distribute/app-store/)
- Run `xcodegen generate` from `src-tauri/gen/apple`, review its diff, and verify
  the generated plists. Never run `tauri ios init`; it drops this project's
  widget setup.
- In Xcode's Signing & Capabilities, confirm the intended team for both targets
  and a distribution profile that includes the main app's iCloud container.
  Resolve signing errors rather than stripping the entitlement to make an
  archive pass.

## Build, validate and upload

From the repository root with Node 20/22 active:

```sh
npm ci
npx tauri ios build --target aarch64 --export-method app-store-connect --open
```

This prepares the production frontend and native build and opens Xcode with the
Tauri build environment. Keep the launching terminal available while Xcode
builds. Select `moldavite_iOS` and a generic iOS device destination, not an iPhone
simulator. Use Product → Archive if an archive is not already available.
[Tauri's iOS distribution instructions](https://v2.tauri.app/distribute/app-store/)

In Xcode's Organizer, select the archive, inspect its version, build number and
team, then validate it. Resolve every signing, extension, entitlement and
privacy error. Choose Distribute App → App Store Connect → Upload when ready.
Alternatively, the CLI export produces an IPA under
`src-tauri/gen/apple/build/arm64/`; verify the actual filename and upload it with
Transporter. Use the App Store Connect distribution method for this route to
TestFlight as well. [Apple's supported upload routes](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/)

An uploaded build must finish Apple's processing before it can be selected in
App Store Connect. Keep the archive and symbols for that build. Record the
commit, public version, build number, signing team, archive path and processing
result in the release handoff.

## Privacy and encryption answers

The intended privacy label is **Data Not Collected**: no Moldavite account,
analytics, advertising or developer server receives notes. Confirm that against
the final native build and bundled libraries, not just the frontend. Local
storage alone is not collection under Apple's definition. Optional iCloud is
user-selected storage through Apple and must be described accurately in the
policy. [Apple's collection definition](https://developer.apple.com/app-store/app-privacy-details/)

The policy URL is `https://mauropereiira.github.io/Moldavite/privacy.html`.
Check that the published page reflects the iOS features and that Settings →
About opens it. The in-app policy and support links are implemented. A privacy
policy URL is required for every app, even one that collects no data.
[Apple's privacy fields](https://developer.apple.com/help/app-store-connect/reference/app-information/app-privacy)

Moldavite **does use encryption**. `src-tauri/src/encryption.rs` implements note
locking with AES-256-GCM through RustCrypto and derives keys with Argon2id.
It is standard cryptography implemented outside Apple's OS libraries; do not
describe it as HTTPS-only or OS-only encryption.

In App Store Connect → App Information → App Encryption Documentation, answer
the questions for that implementation and the intended territories. Apple's
table asks for a French encryption declaration for industry-standard encryption
outside its OS when distributing in France. US mass-market classification does
not by itself remove that French requirement. Do not prefill
`ITSAppUsesNonExemptEncryption=false` merely because AES is standard. Record the
actual classification and Apple's requested documentation, then set the plist
value and any supplied compliance code accordingly. This account declaration
is outstanding. [Apple's encryption table](https://developer.apple.com/help/app-store-connect/reference/export-compliance-documentation-for-encryption/),
[questionnaire and upload steps](https://developer.apple.com/help/app-store-connect/manage-app-information/determine-and-upload-app-encryption-documentation)

## Store listing and review information

Prepare the following against the final app, without claiming unfinished sync
or desktop-only features:

| Field | Prepared direction / action |
| --- | --- |
| Name | Moldavite, subject to name availability |
| Subtitle | Local-first Markdown notes |
| Category | Productivity |
| Description | Explain real Markdown files, local Forges, editing, links, tags, locking and verified optional iCloud sync |
| Support URL | Verify a working public support route; the current project uses `https://github.com/mauropereiira/Moldavite/issues` |
| Privacy Policy URL | The published privacy URL above, updated for the shipped iOS build |
| Age rating | Complete Apple's current questionnaire based on actual app features |
| Copyright | Mauro's chosen legal copyright attribution |
| Review contact | Real name, email and phone entered by Mauro |
| Review login | No app login is required; do not provide an Apple account password |
| Release | Select manual release for the first submission unless Mauro chooses otherwise |

Capture screenshots from the final release candidate using sample notes, with
no personal content. Include iPhone and iPad because the app targets both.
Apple accepts 13-inch iPad screenshots at 2064×2752 or 2048×2732 in portrait;
use the current accepted iPhone size from the linked specification. The current
iPhone 17 simulator's 1206×2622 capture may not satisfy the required large iPhone
slot, so do not assume one simulator covers the listing.
[Apple's screenshot dimensions](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)

Suggested reviewer notes, to be updated only after the features are verified:

> Moldavite is a local-first Markdown note app. It opens a local Forge without
> requiring an account. Optional iCloud Drive uses the reviewer's own system
> iCloud account; all local features work without it. Note locking is tested by
> creating a sample note and choosing Lock from its actions. The passphrase is
> chosen by the reviewer and cannot be recovered by the developer. The widget
> opens today's note. Desktop executable plugins, self-updates and desktop
> integrations are not available in this iOS build.

## TestFlight and final submission

In App Store Connect → TestFlight, select the processed build, resolve Missing
Compliance if shown, and add it to an internal testing group. Supply beta test
details and App Review information before requesting external testing; external
distribution can require Beta App Review. Install through TestFlight on a real
iPhone and iPad and run the release checklist again, including iCloud with the
distribution build. [Apple's TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/)

After testing, attach that exact build to the App Store version, complete the
listing, privacy, age rating, availability and review fields, and submit it for
review. Respond to App Review requests using reproducible steps. Approval and
release are separate from a successful upload. Record the approved build and
release decision before changing the repository's public iOS shipping claims.
