# Releasing Moldavite

Moldavite ships signed and notarized macOS builds (Apple Silicon and Intel) and
unsigned Windows and Linux builds (an AppImage, a deb and an rpm) via GitHub Actions. Every platform's updater artifacts,
including Windows, are signed with `TAURI_SIGNING_PRIVATE_KEY` so the updater can
verify their integrity. Windows installers are not Authenticode-signed, so
Windows may show a SmartScreen warning, and Linux bundles are unsigned as well. This is the
end-to-end release process.

## 1. Prepare the release branch

1. Branch from `main`: `git checkout -b release/vX.Y.Z`.
2. Bump the version everywhere it lives (keeps all five files in sync):

   ```bash
   npm run release:version -- X.Y.Z
   ```

   This updates `package.json`, `package-lock.json`,
   `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and
   `src-tauri/Cargo.lock`. `node scripts/bump-version.mjs --check` verifies that
   the five manifests agree with each other, without changing anything and
   without looking at any tag. The tag is checked separately: `create-release`
   runs `--check`, then compares `github.ref_name` to `package.json`'s version
   and fails the run if they differ (`release.yml`, "Verify tag and manifest
   versions").

   Use the Node version in `.nvmrc` (20; 22 also works). On newer Node, vitest
   fails to give jsdom's globals to the test context and a couple of hundred
   tests fail for reasons that have nothing to do with the code. CI does not
   read `.nvmrc`: `ci.yml` and `release.yml` each hardcode `node-version: 20`,
   so bumping `.nvmrc` means editing both workflows in the same change.

3. Add a `## [X.Y.Z] - YYYY-MM-DD` section to `CHANGELOG.md` (Keep-a-Changelog
   format: `### Added` / `### Changed` / `### Fixed` / `### Removed`). This is
   the single source of truth: it becomes both the GitHub release body and the
   in-app "What's New" popup. Get the heading right. A missing or misspelled
   one does not fail the run; `scripts/extract-changelog.mjs` falls back to the
   placeholder "See CHANGELOG.md for details on vX.Y.Z." and the release ships
   with that as its notes. The workflow appends its own Installation section to
   whatever the script returns.
4. Commit and open a PR into `main`. Let the `Checks` workflow (`ci.yml`) pass.
   It is not only unit tests: it runs real `tauri build` runs on Windows and on
   Ubuntu 24.04, and launches the resulting AppImage and rpm on Fedora under
   Xvfb, so a first run takes a while.

## 2. Tag and publish

1. Merge the PR.
2. From `main`, create and push the tag:
   ```bash
   git checkout main && git pull
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
3. The tag push triggers `.github/workflows/release.yml`. It listens for pushed
   tags matching `v*` and has no `workflow_dispatch`, so there is no way to
   start a release by hand: a botched run can only be re-run, never
   re-dispatched. The workflow:
   - creates the GitHub Release **as a draft**, with a body extracted from the
     `CHANGELOG.md` section for this version,
   - builds macOS aarch64 + x86_64, Windows installers, and a Linux AppImage,
     deb and rpm, signs and notarizes the macOS builds, and signs updater
     artifacts for every platform,
   - uploads artifacts and generates `latest.json` (the updater manifest),
   - **publishes the draft only once `publish-release` has verified it**, and
     triggers the Homebrew bump after that. The gate is strict: the release must
     still be a draft on the right tag, all 18 expected asset names must be
     present, uploaded and non-empty, there must be no asset it did not expect,
     `latest.json` must parse and carry this version, every `.sig` must verify
     as a real minisign Ed25519 signature against `plugins.updater.pubkey` from
     `tauri.conf.json`, and each of the 11 `latest.json` platform entries must
     point at a matching asset URL and signature. The release used to be created
     public before the builds ran, so a signing failure left a broken "latest"
     that the updater and the cask would both follow,
   - bumps `Casks/moldavite.rb` in
     [mauropereiira/homebrew-moldavite](https://github.com/mauropereiira/homebrew-moldavite)
     and pushes it to that repo's `main`.

**A published tag is immutable.** Never move or re-cut one. The Homebrew cask
pins a SHA-256 per DMG, so replacing a release's binaries under an existing tag
makes `brew install` fail with a checksum mismatch for everyone. Ship X.Y.Z+1
instead.

## 3. Verify

- Confirm the Release has the two DMGs, both unversioned
  `Moldavite_<arch>.app.tar.gz` updater payloads, the `.msi`, the
  `-setup.exe`, the `.AppImage`, the `.deb` and the `.rpm`, a `.sig` next to
  every one of those except the DMGs, plus `latest.json` and
  `moldavite-clipper-chrome.zip`. `publish-release` already enforces exactly
  this list, so a release that went public passed it; check anyway if something
  looks off.
- Open an older install → it should detect the update after about 15s (or via
  Settings → About → Check for Updates), download, install, and relaunch.
- On relaunch, the "What's New" popup shows this version's notes.
- Confirm the tap commit landed, then
  `brew update && brew info --cask mauropereiira/moldavite/moldavite` reports the
  new version.

### If a macOS build fails to sign

`failed to run command codesign: failed to sign app` on one macOS target while
the other signs fine is a transient runner fault, not a code problem. It
happened during 2.2.3, on Intel only.

The draft-then-publish design handles it: `publish-release` is skipped, the
release stays a draft with an incomplete asset list, and nothing reaches users.
Re-run only the failed job and let publication proceed:

```bash
gh run rerun <run-id> --failed
```

This is safe because the workflow itself is unchanged. Reruns reuse the
workflow snapshot from when the run was created, so a rerun is the wrong tool
for a workflow _fix_ and the right one for a flake.

Once the release is public, re-running `publish-release` fails on purpose with
`Release <id> is already public; refusing to bypass verification`. That is the
guard working, not a broken run: publishing is the one step that must never run
against a release nobody can still inspect as a draft.

### If the tap bump failed

Re-run it alone from the Actions tab: **Update Homebrew tap** →
**Run workflow**, with the version as input. No re-tag is needed, and the job is
idempotent, so running it against an already-current cask is a no-op.

Two failure modes worth recognising:

- `Version 'X' differs from 'Y' retrieved by livecheck`: the cask version and
  the newest GitHub release disagree. Usually means a later release landed while
  this job was running. Re-run with the newer version.
- A `403` on the push step: `HOMEBREW_TAP_DEPLOY_KEY` is missing or was
  rotated on the tap. Generate a new ed25519 keypair, POST the public half to
  `repos/mauropereiira/homebrew-moldavite/keys` with `read_only=false`, and
  store the private half as that secret. (Do not reach for a PAT: a deploy key
  is bound to the tap repo alone, which no PAT can promise.) Verify it by
  pushing a throwaway ref and deleting it. `git push --dry-run` reports
  "Everything up-to-date" when there is nothing to push and proves nothing.

## 4. Sign and attach the Firefox clipper (manual)

Do this **after** the release is public, never while it is still a draft:
`publish-release` rejects any asset it did not expect, so an `.xpi` attached
early fails the publish gate and blocks the whole release.

CI builds and attaches `moldavite-clipper-chrome.zip` on its own. The Firefox
build cannot be automated here: release Firefox installs only signed add-ons, and
signing goes through a Mozilla account.

```bash
cd extension && npm ci && npm run build
npx web-ext sign --source-dir=dist/firefox --channel=unlisted \
  --api-key="$AMO_JWT_ISSUER" --api-secret="$AMO_JWT_SECRET"
mv web-ext-artifacts/*.xpi web-ext-artifacts/moldavite-clipper.xpi
gh release upload "vX.Y.Z" web-ext-artifacts/moldavite-clipper.xpi --clobber
```

`extension/node_modules` is not checked in, so `npm ci` comes first, and
`web-ext` is not a project dependency, so `npx` fetches it. The rename matters:
web-ext names the file after the manifest's own name and version
(`moldavite_clipper-0.1.0.xpi`, which does not track the app version), while
`docs/CLIPPER.md` and `extension/README.md` tell people to download
`moldavite-clipper.xpi`. The asset name is what ends up in the download URL, so
rename before uploading.

`--channel=unlisted` means Mozilla signs the file without listing it on
addons.mozilla.org: no public listing, no review queue, and the download still
comes from the GitHub release. The API credentials come from the Mozilla add-on
developer hub; they are not GitHub secrets, because the signing step is not run
by CI.

Skipping this step is a valid release: Chrome users get the clipper, Firefox
users see no `.xpi` on that release.

## Required GitHub secrets

| Secret                                                            | Purpose                                                                                                                                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`                 | Developer ID signing cert (base64 .p12)                                                                                                                                   |
| `APPLE_MAC_ICLOUD_PROFILE` | Base64 Developer ID provisioning profile for `app.moldavite`, authorizing `iCloud.app.moldavite`. |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`                     | Apple notarization                                                                                                                                                        |
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Updater artifact signing on every platform (not Windows Authenticode code signing)                                                                                        |
| `MOLDAVITE_WPCOM_CLIENT_ID`, `MOLDAVITE_WPCOM_CLIENT_SECRET`      | WordPress.com OAuth app credentials, baked into all three build legs with `option_env!`                                                                                   |
| `MOLDAVITE_GOOGLE_CLIENT_ID`, `MOLDAVITE_GOOGLE_CLIENT_SECRET`    | Google Calendar OAuth app credentials, same mechanism                                                                                                                     |
| `HOMEBREW_TAP_DEPLOY_KEY`                                         | SSH private key of a deploy key with write access on `mauropereiira/homebrew-moldavite` only. Scoped to that one repository, and unlike a PAT it cannot be widened later. |

The four OAuth secrets are optional in the sense that a missing one is not a
build error: `option_env!` resolves to `None`, the feature ships disabled, and
the app says so rather than failing at runtime.

The Developer ID identity string is **not** a secret. It is a literal in both
`release.yml` (`APPLE_SIGNING_IDENTITY`) and `src-tauri/tauri.conf.json`
(`bundle.macOS.signingIdentity`), so moving to a different certificate means
editing both files, not just rotating `APPLE_CERTIFICATE`.

## Updater key rotation

The updater verifies downloads against the public key hardcoded in
`src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). It MUST correspond to
the private key in `TAURI_SIGNING_PRIVATE_KEY`. To rotate keys, generate a new
keypair with `npm run tauri signer generate`, update both the secret and the
`pubkey` in `tauri.conf.json` in the same release, and note that clients on the
old key cannot verify updates signed with the new key, so plan a transition.

Updating only one half is caught before anything ships: `publish-release`
verifies every `.sig` in the release against the `pubkey` in `tauri.conf.json`,
so a mismatched keypair fails the gate and the release stays a draft instead of
shipping updates nobody can verify.

## Linux builds

`bundle.targets` in `tauri.conf.json` lists only `dmg`, `app`, `msi` and
`nsis`, so a plain `tauri build` on Linux produces none of the Linux bundles.
They exist because the release matrix passes `--bundles appimage deb rpm`. Use
the same argument locally or you will wonder where the AppImage went.

Linux builds run on `ubuntu-24.04`, not 22.04, because the ONNX Runtime binary
fastembed downloads is built against glibc 2.38. That is also the runtime floor
for what ships: Ubuntu 24.04, Debian 13, Fedora 39 or later. The deb declares
`libc6 (>= 2.38)` and the rpm declares `webkit2gtk4.1` and `gtk3`, so the rpm
uses Fedora's own WebKitGTK rather than bundling one.

Every PR builds those three bundles and then launches the AppImage and the rpm
on `fedora:44` under Xvfb. A build that starts and then dies, loses its WebKit
web process, or paints a window with 32 or fewer distinct colours fails the
job. That test exists because of #130, where the AppImage shipped Ubuntu's
`libwayland-client` and WebKit aborted on Fedora and Arch with "Could not
create default EGL display", leaving a white window. The fix is a pinned
linuxdeploy (`1-alpha-20251107-1`, checked by sha256) that leaves that library
to the host. The pin is duplicated in `ci.yml` and `release.yml`; change both
together or CI and the release stop testing the same thing.

CI's `tauri build` runs pass `--config src-tauri/tauri.ci.conf.json`, which
sets `createUpdaterArtifacts: false`, so PR builds need no signing key. Release
builds do not use that file.

## Versioning

Semantic versioning: bug-fix-only → patch; new user-facing feature →
minor; breaking change → major.

## Mac iCloud signing

Mac releases require a Developer ID Application provisioning profile for
`app.moldavite` with iCloud Documents enabled for `iCloud.app.moldavite`.
Download it from Apple Developer → Profiles and save it locally as
`src-tauri/Moldavite.provisionprofile` (ignored by Git). Run
`python3 scripts/check-mac-icloud-profile.py src-tauri/Moldavite.provisionprofile`
before a local signed build. CI decodes `APPLE_MAC_ICLOUD_PROFILE` and validates
it before signing; Tauri embeds it at `Contents/embedded.provisionprofile`.
Renew the profile before its expiration or after changing its capabilities or
signing certificate, and update the secret. Never commit signing profiles.

After each macOS build, `build-tauri` verifies the result: `codesign --verify
--deep --strict` on `Moldavite.app`, `check-mac-icloud-profile.py` again on the
embedded profile, and a comparison of the signed app's entitlements against
`src-tauri/Moldavite.entitlements`, failing on the first key that does not
match. An app that signs but loses iCloud never reaches a release asset.

One hazard is worth spelling out. The certificate is imported into the runner
keychain by `apple-actions/import-codesign-certs`, and it must stay that way.
Passing it to `tauri-action` as `APPLE_CERTIFICATE` as well, or replacing the
import with a hand-rolled `security create-keychain` script, leaves codesign
waiting on a keychain prompt that never comes in a headless runner
([tauri-action#941](https://github.com/tauri-apps/tauri-action/issues/941)).
That is what hung the aarch64 build of v1.6.0.

The app initializes the same native container as iOS when a user enables
Settings → General → Use synced Forge. No iPhone installation is required.
Local Forges are not moved. Once connected, “Open synced folder in Finder” opens
its Documents directory; Markdown files belong in `notes/`. Enable the synced
Forge on other Apple devices signed into the same iCloud account to open it there.
