# Start an iCloud Forge on Mac

Requires Moldavite 2.7.0 or later and iCloud Drive enabled on your Mac.
You can create and use the shared folder entirely on Mac, before installing
Moldavite on an iPhone or iPad. iOS availability will be announced separately.

## Create or open the folder

1. Update Moldavite from **Settings → About → Check for Updates**.
2. Open **Settings → General** and turn on **Use synced Forge**.
3. Wait for the switch to show **On**. Moldavite creates or opens the shared
   iCloud Forge and makes it the active Forge.
4. Write notes normally, or click **Open synced folder in Finder** to add files.

This is a separate Forge. Your existing local Forges stay in their current
location; the switch does not move or upload their notes. Turn the switch off
or choose a local Forge from the Forge switcher to return to local notes.
Turning it off does not delete the iCloud folder or its contents.

## Add existing notes

Copy ordinary Markdown (`.md`) notes into `notes/` inside the synced folder.
Subfolders belong under `notes/`; daily notes use `daily/YYYY-MM-DD.md`, and
weekly notes use `weekly/YYYY-Www.md`. Preserve relative attachment paths when
copying notes with images. Keep the original copies until you have checked the
notes and attachments in Moldavite.

Unlock locked notes in Moldavite before moving them between Forges or paths.
Encrypted notes depend on their paths. Back up important notes before a bulk
move, and leave the Forge's hidden and app-managed folders alone.

## Pick it up on another Apple device

Use the same Apple Account with iCloud Drive enabled. When Moldavite is
available on that device, turn on **Use synced Forge** there. It opens the same
shared Forge; no folder export, pairing code, or cable is needed.

Allow iCloud time to upload and download changes. A note waiting to download
must become available before you can edit it. iCloud sync also propagates
changes and deletions, so keep a separate backup of important notes.

## If the folder does not connect

Check that iCloud Drive is enabled, that the Mac is signed into the intended
Apple Account, and that iCloud has available storage. If Moldavite says iCloud
is still preparing the Forge, try again shortly. If an active Forge becomes
unavailable, use **Reconnect iCloud**, or switch to a local Forge while the
account or download issue is resolved. A failed connection keeps the previous
Forge selected; Moldavite does not substitute an unrelated local folder.

The built-in iCloud Forge is available on Apple devices. Windows and Linux
support is a later project.

## AI clients and the browser clipper

MCP and the browser clipper support local Forges in this release. Keep those
connections pointed at a local Forge. For an MCP client, pin it explicitly with
`moldavite --mcp --forge "Default"` (replace `Default` with your local Forge name).
An unpinned MCP client reports an error when the synced Forge is selected, so
it cannot silently write to a different local Forge. Choose a local Forge in
the browser clipper. Shared iCloud access for these integrations is not yet supported.

## Maintainer verification

The Mac-first setup was verified with a Developer ID signed native build on
September 6, 2026: it initialized a previously absent container, completed the
initial metadata query, created the Forge directories, and confirmed the folder
is managed by iCloud. The full Mac app bundle's signature, profile, and
entitlements were also verified. Cross-device delivery and offline concurrent
editing have not yet been exercised. Signing and release requirements are in
[RELEASING.md](RELEASING.md#mac-icloud-signing).
