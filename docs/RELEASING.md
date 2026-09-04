# Releasing Moldavite

Moldavite ships signed and notarized macOS builds (Apple Silicon and Intel) and
unsigned Windows and Linux builds (an AppImage and a deb) via GitHub Actions. Every platform's updater artifacts,
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
   `src-tauri/Cargo.lock`. `node scripts/bump-version.mjs --check` verifies all
   five agree without changing anything; CI runs it, and the release workflow
   refuses to build a tag that disagrees with them.

   Use the Node version in `.nvmrc` (20; 22 also works). On newer Node, vitest
   fails to give jsdom's globals to the test context and a couple of hundred
   tests fail for reasons that have nothing to do with the code.

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
   - creates the GitHub Release **as a draft**, with a body extracted from the
     `CHANGELOG.md` section for this version,
   - builds macOS aarch64 + x86_64, Windows installers, and a Linux AppImage and
     deb, signs and notarizes the macOS builds, and signs updater artifacts for
     every platform,
   - uploads artifacts and generates `latest.json` (the updater manifest),
   - **publishes the draft only once every artifact and signature is present**,
     and triggers the Homebrew bump after that. The release used to be created
     public before the builds ran, so a signing failure left a broken "latest"
     that the updater and the cask would both follow,
   - bumps `Casks/moldavite.rb` in
     [mauropereiira/homebrew-moldavite](https://github.com/mauropereiira/homebrew-moldavite)
     and pushes it to that repo's `main`.

**A published tag is immutable.** Never move or re-cut one. The Homebrew cask
pins a SHA-256 per DMG, so replacing a release's binaries under an existing tag
makes `brew install` fail with a checksum mismatch for everyone. Ship X.Y.Z+1
instead.

## 2b. Sign and attach the Firefox clipper (manual)

CI builds and attaches `moldavite-clipper-chrome.zip` on its own. The Firefox
build cannot be automated here: release Firefox installs only signed add-ons, and
signing goes through a Mozilla account.

```bash
cd extension && npm run build
npx web-ext sign --source-dir=dist/firefox --channel=unlisted \
  --api-key="$AMO_JWT_ISSUER" --api-secret="$AMO_JWT_SECRET"
gh release upload "vX.Y.Z" web-ext-artifacts/*.xpi
```

`--channel=unlisted` means Mozilla signs the file without listing it on
addons.mozilla.org — there is no public listing and no review queue, and the
download still comes from the GitHub release. The API credentials come from the
Mozilla add-on developer hub; they are not GitHub secrets, because the signing
step is not run by CI.

Skipping this step is a valid release: Chrome users get the clipper, Firefox
users see no `.xpi` on that release.

## 3. Verify

- Confirm the Release has the DMGs, the `.exe`/`.msi`, `latest.json`, and
  `moldavite-clipper-chrome.zip`.
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

This is safe because the workflow itself is unchanged — reruns reuse the
workflow snapshot from when the run was created, so a rerun is the wrong tool
for a workflow _fix_ and the right one for a flake.

### If the tap bump failed

Re-run it alone from the Actions tab: **Update Homebrew tap** →
**Run workflow**, with the version as input. No re-tag is needed, and the job is
idempotent, so running it against an already-current cask is a no-op.

Two failure modes worth recognising:

- `Version 'X' differs from 'Y' retrieved by livecheck` — the cask version and
  the newest GitHub release disagree. Usually means a later release landed while
  this job was running. Re-run with the newer version.
- A `403` on the push step — `HOMEBREW_TAP_DEPLOY_KEY` is missing or was
  rotated on the tap. Generate a new ed25519 keypair, POST the public half to
  `repos/mauropereiira/homebrew-moldavite/keys` with `read_only=false`, and
  store the private half as that secret. (Do not reach for a PAT: a deploy key
  is bound to the tap repo alone, which no PAT can promise.) Verify it by
  pushing a throwaway ref and deleting it — `git push --dry-run` reports
  "Everything up-to-date" when there is nothing to push and proves nothing.

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
