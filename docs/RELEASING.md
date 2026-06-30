# Releasing Moldavite

Moldavite ships signed + notarized macOS (Apple Silicon + Intel) and Windows
builds via GitHub Actions, and updates existing installs through the Tauri
updater. This is the end-to-end release process.

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
   - builds, signs, and notarizes macOS aarch64 + x86_64 and Windows,
   - uploads artifacts and generates `latest.json` (the updater manifest).

## 3. Verify

- Confirm the Release has the DMGs, the `.exe`/`.msi`, and `latest.json`.
- Open an older install → it should detect the update within ~5s (or via
  Settings → About → Check for Updates), download, install, and relaunch.
- On relaunch, the "What's New" popup shows this version's notes.

## Required GitHub secrets

| Secret | Purpose |
|---|---|
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD` | Developer ID signing cert (base64 .p12) |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | Apple notarization |
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Updater artifact signing |

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
