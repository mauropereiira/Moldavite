# Releasing Moldavite

Moldavite ships signed and notarized macOS builds (Apple Silicon and Intel) and
unsigned Windows builds via GitHub Actions. Every platform's updater artifacts,
including Windows, are signed with `TAURI_SIGNING_PRIVATE_KEY` so the updater can
verify their integrity. Windows installers are not Authenticode-signed, so
Windows may show a SmartScreen warning. This is the end-to-end release process.

## 1. Prepare the release branch

1. Branch from `main`: `git checkout -b release/vX.Y.Z`.
2. Bump the version everywhere it lives (keeps all four files in sync):
   ```bash
   npm run release:version -- X.Y.Z
   ```
   This updates `package.json`, `src-tauri/tauri.conf.json`,
   `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock`.
3. Add a `## [X.Y.Z] - YYYY-MM-DD` section to `CHANGELOG.md` (Keep-a-Changelog
   format: `### Added` / `### Changed` / `### Fixed` / `### Removed`). This is
   the single source of truth — it becomes both the GitHub release body and the
   in-app "What's New" popup.
4. Commit and open a PR into `main`. Let CI (`ci.yml`) pass.

## 2. Tag and publish

1. Merge the PR.
2. From `main`, create and push the tag:
   ```bash
   git checkout main && git pull
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
3. The tag push triggers `.github/workflows/release.yml`, which:
   - creates a GitHub Release whose body is the extracted `CHANGELOG.md`
     section for this version,
   - builds macOS aarch64 + x86_64 and Windows installers, signs and notarizes
     the macOS builds, and signs updater artifacts for every platform,
   - uploads artifacts and generates `latest.json` (the updater manifest),
   - bumps `Casks/moldavite.rb` in
     [mauropereiira/homebrew-moldavite](https://github.com/mauropereiira/homebrew-moldavite)
     and pushes it to that repo's `main`.

**A published tag is immutable.** Never move or re-cut one. The Homebrew cask
pins a SHA-256 per DMG, so replacing a release's binaries under an existing tag
makes `brew install` fail with a checksum mismatch for everyone. Ship X.Y.Z+1
instead.

## 3. Verify

- Confirm the Release has the DMGs, the `.exe`/`.msi`, and `latest.json`.
- Open an older install → it should detect the update after about 15s (or via
  Settings → About → Check for Updates), download, install, and relaunch.
- On relaunch, the "What's New" popup shows this version's notes.
- Confirm the tap commit landed, then
  `brew update && brew info --cask mauropereiira/moldavite/moldavite` reports the
  new version.

### If the tap bump failed

Re-run it alone from the Actions tab: **Update Homebrew tap** →
**Run workflow**, with the version as input. No re-tag is needed, and the job is
idempotent, so running it against an already-current cask is a no-op.

Two failure modes worth recognising:

- `Version 'X' differs from 'Y' retrieved by livecheck` — the cask version and
  the newest GitHub release disagree. Usually means a later release landed while
  this job was running. Re-run with the newer version.
- A `403` on the push step — `HOMEBREW_TAP_DEPLOY_KEY` is missing or was
  rotated on the tap. Generate a new keypair and re-add it. Mint a new
  fine-grained PAT and update the secret.

## Required GitHub secrets

| Secret                                                            | Purpose                                                                                                                                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`                 | Developer ID signing cert (base64 .p12)                                                                                                                                   |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`                     | Apple notarization                                                                                                                                                        |
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Updater artifact signing on every platform (not Windows Authenticode code signing)                                                                                        |
| `HOMEBREW_TAP_DEPLOY_KEY`                                         | SSH private key of a deploy key with write access on `mauropereiira/homebrew-moldavite` only. Scoped to that one repository, and unlike a PAT it cannot be widened later. |

## Updater key rotation

The updater verifies downloads against the public key hardcoded in
`src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). It MUST correspond to
the private key in `TAURI_SIGNING_PRIVATE_KEY`. To rotate keys, generate a new
keypair with `npm run tauri signer generate`, update both the secret and the
`pubkey` in `tauri.conf.json` in the same release, and note that clients on the
old key cannot verify updates signed with the new key — plan a transition.

## Versioning

Semantic versioning: bug-fix-only → patch; new user-facing feature →
minor; breaking change → major.
