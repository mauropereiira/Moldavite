# Changelog

All notable changes to Moldavite are documented here.

## [2.2.1] - 2026-08-16

### Fixed

- **The editor's footer controls disappeared whenever a note was pinned.** The pinned bar sat inside the editor column, above an editor that fills its height, so the column overflowed and pushed its own footer out of view. Colour, WordPress, Share, Format and More were all gone until you unpinned.
- **Long note names ran underneath the Options button in the index** instead of ending in an ellipsis before it.
- **The Index overlay's keyboard hint sat almost on top of its close button**, so on a narrower window the two read as one crowded object. It moves to the left, matching the Agenda overlay it had always disagreed with.
- **The footer controls sat too close together.** The labels are uppercase and letterspaced, so the gap between two controls was narrower than the gap inside a single word and the row scanned as one continuous run of text.

### Changed

- **Pinned notes behave like browser tabs.** The bar spans the whole app rather than only the editor, so a pinned note is one click away wherever you are. Four stay on the bar and the rest collapse behind a count — twelve pins used to wrap onto three lines and push the app down, which is the opposite of what the bar is for. Drag a pin to reorder it, or hold alt and press left or right when one is focused.
- **A note can be renamed from its own title.** Click the title and type. Enter saves, Escape abandons the edit, an empty name is refused, and a rename that fails puts the old name back so the page never shows a name the file does not have. Renaming from the menus still works. Daily and weekly notes stay read-only, because they are named by date.
- **Today is legible on the calendar at a glance.** It was a one-pixel rule under a number, in a grid of numbers, next to the two-pixel rule that marks your selection. It now carries the accent colour as well.
- **The marks under each date say what is on that day.** They used to count events, so a day with six back-to-back meetings and a day with one long meeting looked equally busy while telling you nothing about either. Each mark now stands for a kind of thing — open to-dos, events, a note — and a legend under the grid names the colours.

## [2.2.0] - 2026-08-16

### Fixed

- **Eight ways Moldavite could lose your writing.** An external change to a file could erase text typed while that file was being read. A failed save was reported as a success, so switching Forge afterwards reloaded over work that had never reached disk. Changing the Forges root left the editor writing into the wrong Forge. Installing an update relaunched without waiting for pending saves. Two saves of the same note could finish out of order and corrupt the record used to detect outside edits. A background scan quietly disabled that same protection. Deleting a note could race its own save and bring the file back. And opening a list that mixed tasks with plain items reordered them — every task above every plain line — which the next save then wrote to disk as your note.
- **⌘N and ⌘⇧L did nothing.** Both were wired to empty functions, so the keypress was consumed and discarded. The welcome screen advertises ⌘N under the wordmark, which is where it was most obvious, but it was dead everywhere.
- **The Format menu ran off the right of the window**, hiding its keyboard shortcuts. It was the only footer menu anchored to its own centre.
- **Footer labels could render as fragments** — COLOUR as "OLOU", WORDPRESS as "DPR" — when the row was short of space.
- **A brief calendar hiccup could unhide every calendar you had hidden.** When listing calendars failed, the failure was swallowed and your selection was pruned against the incomplete list — leaving it empty, which means "show everything".
- **Calendar events were sorted by comparing timestamps as text.** Apple reports times in UTC and Google in each calendar's own offset, so an event at 09:00+03:00 sorted after one at 07:00Z despite starting two hours earlier. Events crossing midnight appeared only on the day they started, and multi-day events never showed under Today.
- **The day grid assumed every day has 24 hours.** On the two days a year that is untrue, an hour-long event shrank to nothing and two events an hour apart drew on top of each other.
- **Every dialog could be tabbed out of.** Thirteen overlays had no focus trapping and no dialog role — and because the welcome screen restores your mouse pointer by looking for that role, the pointer stayed invisible over them. Escape inside a confirmation also closed Settings behind it.
- **Renaming a tag rewrote it inside code samples and link addresses**, silently corrupting notes that mentioned the tag in either.

### Changed

- **Notes can be pinned to a bar above the editor.** Pin from the note's More menu or by right-clicking it in the index. The bar appears only while something is pinned. Opening a pinned note returns you to the tab you already had it in rather than opening a second copy.
- **Publishing to WordPress.com is safer about which post it updates.** Renaming a published note used to strand its post, and a new note taking the freed name inherited it — so publishing that new note could overwrite the old note's post, including one already live. Sites now show their address as well as their name, because "Site Title" is the WordPress.com default and repeats across an account. Publishing twice in quick succession no longer leaves two drafts.
- **Moldavite no longer follows a symlink out of your Forge.** A Forge is often synced through iCloud, Dropbox or git, so a file that is secretly a link to somewhere else can arrive without you doing anything. Reading, writing, deleting, locking and exporting all now refuse to act outside the vault. Locking a note is also transactional — it could previously leave both the encrypted file and the plaintext on disk — and a locked note is now cryptographically tied to its own identity, so two notes locked with the same password can no longer be swapped for one another. Replacing a vault from a backup verifies the archive before deleting anything.
- **Plugins must now declare what they put in front of you.** Showing a prompt requires the `ui` permission and adding commands requires `commands`; both were free before. Prompts can contain password fields and commands sit in the palette looking exactly like built-in ones, so a plugin that declared nothing could ask for a vault password in a window you had no reason to doubt. Plugin code is also read and approved in a single step now, closing a window in which the file could change between the version you consented to and the version that ran. Installed plugins will ask for consent once more, because their permissions genuinely changed.

## [2.1.1] - 2026-08-15

### Changed

- **Connecting WordPress.com now covers every site on your account, so the site picker can switch between them.** The first release asked only for posts and media, which sounds careful but returns a token valid for one site — the picker had nothing to pick, and changing blogs meant disconnecting. Account-wide access is the only WordPress.com scope that spans sites. So the consent screen now lists nine permissions instead of two; Moldavite still calls only the posts and media endpoints. If you connected before this release, disconnect and connect again to see all your sites.

### Fixed

- **A WordPress.com sign-in arriving while the app was still starting could crash it.** macOS launches Moldavite to deliver the callback, so on a cold start it can arrive before setup finishes. Looking for the pending sign-in at that moment took the process down instead of finding nothing. The callback is now declined, as any unsolicited one is.
- **Removed 120 lines of unused constants.** `src/lib/constants.ts` was early scaffolding: 69 of its 70 exports had no callers. The one that did now lives beside the store that uses it.

## [2.1.0] - 2026-08-15

### Added

- **Publish a note to WordPress.com by signing in, not by minting a password.** A WordPress button appears in the editor footer. Connect once in your browser, pick a site, and publish — the first run creates a draft and later runs update it rather than scattering new ones. Publishing until now meant opening wp-admin, creating an Application Password and pasting it back, which also could not work at all for WordPress.com Simple sites. That path remains available as a plugin for self-hosted sites, which have no WordPress.com account to sign in with. Sites you can only read are left out of the picker: they look like a choice and fail on use.

### Fixed

- **Links inside a note are visible without hovering them.** A link in a paragraph was the same colour as the text around it and only drew its underline when the pointer arrived, so there was nothing to tell you it was there. Links now carry the hue each theme already defined for them, and keep a quiet underline at rest that comes up on hover. Colour alone was not enough — in several themes the link hue sits very close to the body text, so anyone who cannot separate those two would still have had no signal.
- **The editor footer no longer clips its own labels.** The row's line height was set to exactly the font size, leaving the tops of letters outside the line box.

## [2.0.2] - 2026-08-15

### Fixed

- **The graph's heading was cut in half by the icon rail.** The graph opened as a full-window surface starting at the very left edge, underneath the rail, so its title rendered as ".ph" instead of "Graph". It now begins where the rail ends — and reclaims that space when the rail is switched off or hidden by focus mode. Leaving the rail uncovered also keeps it clickable, which is how you get out of the graph.
- **The Windows installer showed a stock icon.** Downloading the setup `.exe` gave you a generic globe rather than Moldavite's mark. The installed app's icon was always correct; this is the installer's own.

## [2.0.1] - 2026-08-15

### Fixed

- **The pointer went missing over the release notes.** On the welcome screen the asteroid stands in for your cursor, and the real one is hidden to make room for it. Anything opening above that screen — the What's New notes, a confirmation, Settings — left the cursor hidden while the asteroid was the wrong thing to be pointing at a dialog with. The real pointer now comes back whenever a dialog is open, and the asteroid steps aside until it closes.

## [2.0.0] - 2026-08-15

Moldavite has been redesigned. Not restyled — rebuilt around one idea: your
writing is the only ink on the page, and everything else has to earn its place
beside it.

### Changed

- **The app is cream and ink now.** Two colours do nearly all the work: a warm cream ground and near-black type, with a single moss green held back for one thing at a time. Borders are hairlines, elevation is a rule rather than a shadow, and nothing has a corner radius. The type is Geist Mono for anything structural — headings, labels, dates, counts — and Geist for prose. Dark mode is the same two colours inverted, so it reads as the same app after dark rather than a different one. If you had chosen a theme, Moldavite keeps it; only new installs open in cream by default.
- **The note is the app now, and navigation is summoned rather than parked.** The Index and the Agenda are no longer columns permanently taking up room beside your writing. Press `⌘\` or `⌘⌥\` and the one you want arrives over the whole window; press it again and it goes. If you preferred the columns, Settings → Layout pins them back exactly as before. Everyone upgrading starts with both summoned, so the two halves of the frame behave the same way rather than one being parked and the other hidden.
- **The icon is the monogram.** A cream M on an ink tile, replacing the faceted green stone. It is drawn as outlines rather than set in a typeface, so it renders identically everywhere and depends on no font being installed.
- **The website is a different thing entirely.** The landing page is the wordmark under a drifting field of stars, with the constellations your eye can actually find in it, and a small asteroid that follows your cursor. The screenshots and the autoplaying videos are gone. In their place, at /demo.html, is a real editor: write a note in your browser, download it, drop the file into your Forge, and open it in Moldavite. There is no import step because there never needed to be one.

### Added

- **The graph is a star map, and it finally lets you roam.** Notes are stars whose size and brightness follow how many links they carry, and links are the hairlines drawn between them — the same night sky the welcome screen already shows. Opening it now plays that sky into focus: the field starts scattered and unwinds inward over about a second, centre first, with the links fading in once the stars have landed. The view no longer fights you. Panning is free in every direction, so you can scroll away from the graph entirely, and it no longer snaps back to centre every time you hover a note or change theme — it is framed once when you first open it and then left alone, remembering where you left it for the rest of the session. Fit view is still there when you want to start over, and double-clicking empty sky does the same thing. The note you have open is marked with a thin ring, hovering a star dims everything except its immediate neighbours, and `prefers-reduced-motion` skips the entrance entirely.
- **The welcome screen has an optional asteroid cursor.** A small tumbling fragment trails fine-pointer movement through the night sky, grows slightly over links and controls, and leaves one quiet impact ring when you click. Settings → Layout can turn it off, and reduced-motion or touch/coarse-pointer devices always keep the native cursor.
- **Agents now ask before replacing unsaved edits in an open note.** When Claude Code or another MCP client changes the note you are editing, Moldavite names the agent when the client reports its name and preserves whichever version you do not choose as a conflict copy. Notes without unsaved edits still update immediately and only show a small notification.
- **The calendar says what it is doing on Windows.** Apple Calendar is macOS-only and Windows builds ship without Google credentials, so the calendar there had nothing you could connect and a Settings page that led nowhere. The month grid still works — dates, today, and your daily-note markers never needed a calendar account — and the places events would appear now say so plainly instead of implying you had configured something wrong.
- **An update tells you it has arrived.** A quiet marker appears when a new version is ready, and the release notes you are reading now open in a window that fits the app rather than a wall of text.

### Fixed

- **Switching Forge stopped Moldavite noticing file changes at all.** Changing Forge shut down the watcher and started a replacement, but the replacement was discarded the instant it was created, leaving nothing watching until you restarted the app. Everything that arrives from outside went quiet: an edit from another editor, a sync client, or a note written by Claude Code through MCP. Both halves of that are fixed, with tests holding the swap in place.
- **"Change Forge Directory" could delete notes.** It offered to move your Forge and instead copied only the loose files from three of its folders — never `weekly/`, never images, never anything inside a subfolder — deleted the originals, and then recorded the move somewhere Moldavite no longer reads, so the app reopened the same Forge with those notes missing. The button is gone. The Forge location control now points Moldavite at a different folder without touching a single file, and says so.
- **Windows had another app's icon.** `icon.ico` was placeholder clipart — a blue letter N with a book and a fountain pen — and it survived every icon update because macOS never opens that file. Every icon now comes from one source, so this cannot happen again quietly.
- **The Index and Agenda overlays now open reliably.** Invalid note, folder, or trash responses can no longer poison the shared sidebar state and crash either overlay, and opening no longer depends on an animation frame that may be delayed in a backgrounded window.
- **The graph no longer traps you, and every navigation button now closes what it opened.** Index, Agenda, Graph, Timeline and Search each tracked their own open state, so opening the graph and then picking anything else left the graph on top of it, and the buttons disagreed about what a second click meant: Agenda closed, Search re-opened. Exactly one of the five is open at a time now. Clicking the button for the one you are looking at closes it, opening another switches to it, Escape closes whichever is up, and ⌘\, ⌘⌥\, ⌘⇧G and ⌘P behave the same way as the buttons — including while the Timeline has the window. The monogram at the top of the rail is now Home: it saves the pending edit, dismisses the active navigation surface, and returns to the welcome screen without closing any tabs.
- **Sidebar browsing no longer leaves hidden tabs piling up.** Returning to a pinned note and then opening another note now reuses the existing preview tab instead of creating another one. When multiple tabs are intentionally open, the tab bar exposes close controls for every tab plus Close others and Close all.
- **Calendar events show their duration at a glance again.** Timed and all-day events now use a full-height source-colour bar, a faint source tint, and clear start and end hairlines instead of collapsing visually into unfilled rows.
- **Settings now belongs to the same app as the editor.** Its modal, tabs, groups, segmented choices, inputs, toggles, preset swatches, and nested dialogs now use the cream-and-ink hairline system instead of green fills, rounded cards, and shadows.
- **Changing a setting no longer scrolls the note you are reading back to the top.** Toggling anything the editor is built from, such as tags, rebuilt the editor and Moldavite treated that as opening a different note. Your place is now kept for anything that is not actually a switch to another note.
- **A wider note.** The editor column was fixed at a width that looked starved on a large window. It is now yours to set in Settings → Appearance, defaults to wide, and always keeps its margins on a narrow one.

### Removed

- **Three settings that did nothing.** Slash commands, wiki links, and the quick switcher each had a switch in Settings that no code ever read — the features were always on regardless. The switches are gone; the features are not.

## [1.9.0] - 2026-08-14

### Added

- **Windows support is in beta.** It shipped as experimental in December 2025 and was never promoted, because nothing verified it: no job compiled Moldavite for Windows until a release had already been tagged. Every change now runs the full Rust test suite and a linter with warnings denied on Windows before it can merge, and the round of fixes below came out of turning that on. It is beta rather than supported for one honest reason: those checks prove the code compiles and passes its tests on Windows, and nobody has yet sat in front of the app running there. Installers are also unsigned, so Windows may warn you once when you run one.
- **Pasted Markdown keeps its formatting.** Pasting recognizable raw Markdown into the editor now inserts formatted note content through Moldavite's existing conversion pipeline, while ordinary text, rich text, and image paste keep their existing behavior.
- **Install with Homebrew.** `brew install --cask mauropereiira/moldavite/moldavite` fetches the signed, notarized DMG for your architecture and verifies its checksum. It also links the app binary onto your `PATH`, so connecting an AI tool is now `claude mcp add moldavite -- moldavite --mcp` instead of the full bundle path. The cask is marked as self-updating, so Homebrew stays out of the way of Moldavite's own updater.

### Fixed

- **Copied note URLs now open their note.** Note links were accepted by the clipboard but ignored when Moldavite received them. They now open root notes, foldered notes, daily notes, and weekly notes in the existing editor tab flow, while missing or locked notes produce a visible error.
- **Tag, wiki-link, and slash-command suggestions no longer get stuck after the editor loses focus.** Once a suggestion menu had opened, clicking elsewhere or switching notes could leave it floating above the app, and Escape only hid it without closing its editor state. Suggestion menus now close completely on blur or Escape, while mouse selection keeps the editor focused until the chosen item is inserted.
- **Inter and Merriweather now work as editor fonts.** Both typefaces were blocked and silently fell back to the default. They now ship with the app, so both work offline and neither fetches anything from a third party.
- **Keyboard shortcut labels now match your operating system.** Moldavite keeps the familiar Command, Option, Control, and Shift notation on macOS, while Windows and Linux now show Ctrl, Alt, and Shift shortcuts joined with plus signs.
- **Notes inside folders can be renamed.** Moldavite validated their folder-relative addresses as bare filenames, so every rename stopped at "Invalid filename" as soon as the note lived below `notes/`. Foldered notes now keep their relative path during the rename, and inbound `[[wiki links]]` follow the new note name.
- **An external edit can no longer disappear just after Moldavite saves the same note.** The watcher used a fixed half-second silence period after each app write, so an editor, sync client, or agent writing during what remained of that period could have its real change mistaken for Moldavite's own echo. The watcher now suppresses an event only when the file body still matches the content Moldavite wrote.
- **Forge folders now open in Windows Explorer.** The Settings button did nothing on Windows and used a Finder label. It now opens Explorer safely, uses the platform's label, and surfaces unsupported-platform errors.
- **Forges can now live on safe Windows drives and network shares.** A macOS-only policy rejected secondary drives, mapped drives, and UNC shares while leaving system folders unprotected. Windows now accepts those locations, blocks its environment-defined Windows and Program Files directories, and removes `\\?\` from displayed paths.
- **Windows could silently discard a note or make a folder's contents vanish.** Reserved device names such as `NUL.md`, Windows-illegal folder characters, trailing dots, and drive-letter relative paths were accepted. New names are now portable on every platform, while notes and folders already carrying a macOS-only name remain usable. Obsidian imports now call reserved note and attachment stems `Untitled` or `Attachment` instead of attempting to create a Windows device file. Exports also avoid Windows system, Program Files, and Startup directories, and bulk export uses the platform's path separator.
- **Saves are more resilient when another app briefly holds a file on Windows.** Sync clients, antivirus scanners, and other editors can briefly prevent Windows from replacing a note, which could make an autosave fail. Moldavite now retries these temporary blocks for a short, bounded period and leaves the previous file untouched if the block does not clear.
- **Agents had no way to notice that a note changed between reading and writing it.** The MCP read tool returned no version hash, so a second agent or the open app could update the same note and then have its work silently replaced by an older agent's write. Reads now return a content hash that an agent can send back with its next write. If the note body has changed by then, Moldavite preserves that disk version as a sibling conflict copy before saving the agent's version. Existing integrations can omit the hash and keep their previous behavior.
- **New Forges appear while the Forge switcher is open.** A Forge created outside Moldavite, whether by an agent, the Obsidian importer, or anything else writing to your Forges folder, only joined the list the next time you opened it. The list now refreshes when Moldavite sees the new Forge on disk.
- **The app could abort while building a note's backlinks.** The snippet shown under a backlink was cut out using byte positions, so a note containing an accented letter, an arrow, an emoji, or any other multi-byte character within about fifty characters of a `[[wiki link]]` would kill the process outright with no error and no warning. Vaults written in plain ASCII never saw it. The context window now snaps to character boundaries.
- **Plugins load on Windows.** Moldavite always asked for plugin files using the macOS and Linux form of its internal address, which Windows does not serve, so every enabled plugin failed before it could start. Plugin file addresses now follow the platform form Tauri provides.
- **Plugin install links reuse the open app on Windows.** Following a `moldavite://` link used to start another copy of Moldavite while the window already in use never received the request. Windows now passes the link to the running app and closes the second launch before it sets anything else up.
- **Malformed trash metadata no longer breaks trash operations on Windows.** A persisted record containing an absolute Windows path left backslashes and a drive-letter colon in Moldavite's internal trash filename, which NTFS rejects before the app can validate the restore destination. Trash storage names are now made NTFS-safe, while existing valid trashed items keep their filenames.

## [1.8.1] - 2026-08-08

### Fixed

- **The "update available" dot sits on the Settings gear and is always red.** It used to float in the corner of the whole Settings button, far from the icon it was flagging, and it took its colour from the active theme's accent, so in some themes the alert dot was the same green, purple, or blue as everything else. It now hangs off the gear like a notification badge and stays alert red in every theme.

## [1.8.0] - 2026-08-07

### Added

- **Google Calendar, alongside Apple Calendar.** Connect a Google account in Settings → Calendar and its events appear in the timeline next to your notes. Access is read-only and asks for the narrowest scope Google offers; Moldavite never creates or changes an event. Consent happens in your browser and the token is kept in your system keychain, never in a note or a settings file, and **Disconnect** removes it.
- **Pick exactly which calendars you see.** The single calendar dropdown is now a checkbox list covering every connected account, with a refresh interval you control. If one account fails, the timeline still shows the other and says what went wrong instead of going blank.
- **The calendar works beyond macOS.** Google Calendar brings the timeline and calendar settings to Windows and Linux, which previously had no calendar at all.
- **A privacy policy on the website**, listing every network connection the app can make.

### Fixed

- **Folder and note counts come back after you hover a row.** Hovering a sidebar row once left its `⋯` options button stuck on screen, and since that button sits on top of the count badge, the count stayed hidden for the rest of the session.

## [1.7.4] - 2026-08-07

### Fixed

- **Notes an agent writes to no longer ask which version to keep.** A note you had merely opened, without typing a word, could show the "changed on disk" banner on every external write. Moldavite compared the editor's copy against the raw file in a way that made ordinary Markdown — a `_word_` here, a list marker there — look like an unsaved edit forever. Untouched notes now reload quietly, and the banner is back to meaning what it says: you have edits of your own that would conflict.
- **An external edit no longer throws away your place in the note.** Reloading a note someone else changed jumped you to the top and dropped the cursor. Your scroll position and cursor now survive the update.

## [1.7.3] - 2026-07-31

### Fixed

- **Fresh installs always have a usable Default Forge.** Startup now scaffolds a missing active Forge, adopts note folders accidentally created at the Forges root, and lets an unpinned MCP session repair a missing active Forge without weakening strict `--forge` selection.
- **Agent and external edits can no longer disappear behind an open buffer.** Clean notes reload automatically; dirty notes keep their buffer and show choices that preserve either the disk or buffer version as a conflict copy. Virtual notes establish a conflict base before editing, implicit empty-note deletion refuses changed disk content, and MCP whole-note replacement preserves frontmatter.

## [1.7.2] - 2026-07-27

### Fixed

- **Wiki-link autocomplete works again.** Typing `[[` now lists your notes and filters as you type. It had never worked: the suggestion was matching on a single `[`, so the search text always kept the second bracket and could never match a note name.
- **Edits are no longer lost when you leave a note.** Switching tabs, closing a tab, or switching Forge cancelled a save that hadn't happened yet, and reopening the note showed the older copy from disk. Whatever is still unsaved is now written out before you move.
- **Deleting the open note closes its tab.** The tab used to stay behind holding the deleted note, and typing in it wrote the file back to disk while a copy sat in the trash. Bulk delete now closes every affected tab, not just the active one.
- **Opening a note no longer rewrites it.** Simply opening a note triggered a save that re-wrote the file with only what the editor can represent, quietly flattening things like Markdown tables — with no edit from you.
- **A note that starts with an image is no longer mangled.** Such notes were mistaken for old-format HTML, so every heading and list below the image turned into plain text and the next save made it permanent.
- **Locking a note inside a folder locks that note.** Lock, unlock, and permanent unlock addressed notes by filename only, so a note in a folder resolved to the vault root — which could encrypt a different note of the same name.
- **Renaming a tag and bulk export now cover notes inside folders.** Both addressed notes by filename alone, so they skipped folder notes or acted on a same-named note at the root.
- **New Forges appear when you open the Forge switcher.** A Forge created outside the window, whether by an agent, the Obsidian importer, or anything writing to your Forges folder, now appears the next time you open the switcher instead of staying invisible until relaunch.
- **Agents follow the Forge you switch to.** An MCP session pinned the Forge at startup, so after switching in the app, agent writes silently went to the previous vault and still reported success.
- **Locking a note removes it from backlinks immediately.** A locked note's title and a line from its body stayed visible in the backlinks panel until restart. Permanently unlocking a note now restores its links right away.
- **"Delete all notes" deletes all of them.** It skipped weekly notes, every note inside a folder, and locked notes, while still emptying the sidebar — so the app looked empty over notes that were still on disk.
- **The Geist typeface loads.** It pointed at a file path that does not exist, so it had never loaded in a released build.
- **Plugin settings and pinned tabs stay with their own Forge.** After switching Forge, both were read and written under the previous Forge's name for the rest of the session.
- **Suggestion popups behave.** A note ending in a tag opened a popup by itself that nothing would dismiss, and an empty popup swallowed Enter so you could not start a new line.

### Security

- **Plugin sandbox actually removes what it claimed to.** The network globals were being deleted in a way that had no effect, leaving `fetch` and friends reachable inside plugin workers regardless of the permissions a plugin declared. Replaced with an allowlist so anything not explicitly needed — including nested workers, caches, and storage — is unavailable by default.
- **Plugins can only read their own files.** The internal `plugin://` channel let any plugin read every installed plugin's source, and followed symbolic links out of the folder.
- **Hardened every command that takes a path.** File and folder operations, templates, exports, and note colours accepted paths pointing outside your vault. Exported archives, which contain your notes in the clear, are now written owner-only.
- **Consent dialogs cannot be dressed up.** A plugin could invent capability lines and have them rendered verbatim among the real ones.
- **Release pipeline.** Builds now install exactly the reviewed dependency set, and the third-party steps in the signing job are pinned to fixed revisions.

### Removed

- The `geist` package, which pulled Next.js and an image library into the app for two font files. The fonts now ship directly.

### Note

- Pinned tabs were previously shared across Forges; that list is reset once on upgrade.

## [1.7.1] - 2026-07-16

### Added

- **Unobtrusive automatic update checks.** Moldavite checks about 15 seconds after launch, every 24 hours while running, and when a stale app window regains focus. Automatic network and mid-release 404 failures retry silently, while a pending version appears as an accent dot on Settings and its About tab with the existing install action; manual checks continue to show explicit errors.

## [1.7.0] - 2026-07-15

### Changed

- **Clearer sidebar hierarchy.** Items inside each sidebar section (Notes, Folders, Daily, Tags, Backlinks) are now indented beneath their section header with a subtle tree guide line, so sections read as collapsible groups at a glance.

### Added

- **One-time Obsidian vault importer.** Settings → Import analyzes a user-selected Obsidian vault, previews notes, attachments, folders, Canvas skips, daily-note settings, and estimated naming collisions, then copies it into a brand-new Forge without modifying the source. Supported daily-note names are normalized to `daily/YYYY-MM-DD.md`; other notes keep a sanitized, collision-safe folder structure. Obsidian alias links are converted to Moldavite's `[[Display|target]]` order, heading and block suffixes are removed from targets, referenced attachments are copied atomically into `images/`, and the progress/summary flow reports skipped hidden, trash, Canvas, symlink, unreferenced, and unresolved items.

## [1.6.0] - 2026-07-13

### Added

- **Searchable plugin directory and safe install links.** The website filters live or bundled registry cards by name, description, author, and permissions, reports result counts, and keeps its offline/no-JavaScript fallback. Each card can open `moldavite://plugin/<id>` in Moldavite; strict backend routing accepts only validated plugin ids, cold-start and running-instance delivery both open Settings → Plugins, and the requested registry entry is highlighted with a permission-visible confirmation. Nothing installs silently: file downloads remain pinned and hash-verified, and enablement still requires the existing consent flow.
- **Community plugin browser.** **Settings → Plugins → Browse community plugins** fetches the public GitHub registry only after an explicit click, shows authors, versions, permissions, exact hosts, and installed/update state, and handles offline or malformed responses without disrupting Settings. Downloads are constructed only under Moldavite's pinned registry repository; Rust validates the plugin id and manifest identity, verifies both registry SHA-256 hashes before touching disk, and reuses the staged atomic installer. Updates require confirmation, changed content requires fresh consent, and successful installs open the existing **About this plugin** setup guide.
- **Livelier v1.6 website and plugin directory.** All three self-contained GitHub Pages documents gain reduced-motion-safe staggered entrances, title shimmer, section transitions, and a low-density mineral-shard canvas that stops while the tab is hidden. The plugin guide fetches the public registry at view time—the site's only external data request—and keeps a two-plugin static fallback for no-JavaScript or offline visits.
- **Plugin install guides.** Every successful install now opens a themed, reopenable **About this plugin** dialog with the plugin's purpose, commands, setup steps, and permission summary. Installed cards keep an ⓘ action, manifests can declare bounded markdown-lite `instructions` and command metadata, and older plugins receive an automatic guide from the metadata available to the host.
- **Plugin API v2.** Sandboxed plugins can request `notes.read` to list note metadata and read unlocked Markdown, `net.fetch` to make host-performed HTTPS requests only to exact manifest `allowedHosts` (manual redirect re-validation, 30-second timeout, 10 MiB cap), and `secrets` for plugin-namespaced credentials in macOS Keychain. The permission sheet explains each capability and shows every approved host. API v1 plugins remain compatible, and the existing manifest+code SHA-256 consent pin means permission or allowlist edits always re-prompt.
- **Trusted plugin prompts and runtime host consent.** API v2 plugins can open one app-rendered `ui.prompt` form at a time; Moldavite's trusted header always identifies the requesting plugin. `net.requestHostAccess` applies the same public-DNS validation as manifest hosts, asks the user before adding an app-side per-Forge grant, and feeds the individually revocable host into fetch and redirect enforcement without changing the manifest consent hash.
- **Publish to WordPress plugin.** Install Moldavite's first-party reference plugin from Settings, verify a self-hosted or WordPress.com Jetpack/Atomic site with an Application Password, and publish the active note as a draft. Re-publishing updates the path-mapped WordPress post instead of duplicating it. WordPress.com Simple sites remain unsupported because they require a separately registered OAuth client ID.
- **Note rename UI.** Rename standalone notes from the sidebar context menu or the editor's More menu. Open tabs, recents, colors, selection, and backlinks stay in sync while inbound `[[wiki-links]]` are updated automatically.
- **Built-in MCP server.** Run the normal Moldavite app binary with `--mcp` to expose the active Forge to MCP clients over stdio, or add `--forge <name>` to select another Forge. Agents can search (semantic when the local index is ready, keyword otherwise), read and list notes, and inspect backlinks. Note creation, full replacement, and daily-note appends are omitted unless explicitly enabled under **Settings → AI & Agents → Allow agents to write**; locked notes remain inaccessible and every client path is validated.
- **Local semantic search.** Opt-in, fully-local "search by meaning" for your notes (requires Apple Silicon on macOS; Intel Macs get keyword search). Enable it in **Settings → AI & Agents** and choose between three transparent local embedding models: all-MiniLM-L6-v2 (the fast, English-focused default), BGE small English v1.5, or Multilingual E5 small. The consent dialog names the selected model and download size before HuggingFace is contacted; models are cached in the app data dir, never inside a vault. Changing models re-indexes the Forge with live progress. From then on everything runs fully offline; your notes never leave your Mac (locked notes are never read or indexed). Once the index is ready: the sidebar search gains a **Keyword / Semantic** mode chip that finds notes by meaning rather than exact words, and a **Related** section below the editor (next to Linked mentions) lists the 5 most similar notes to the one you're reading. Notes are re-embedded incrementally on save/delete/rename/trash/restore, and a "Rebuild index" button in Settings re-embeds everything from scratch.
- **Agent-ready Forge** — new **Settings → AI & Agents** section. One click writes an `AGENTS.md` to your Forge root describing the vault to AI agents (directory layout, daily/weekly/standalone note naming, frontmatter schema, wiki-link and tag syntax, and rules like "don't touch `.trash/`"), plus a `.gitignore` covering app-managed folders. If either file already exists you're asked before it's overwritten, and the section shows whether `AGENTS.md` is present. Your notes are plain Markdown, so agents like Claude Code can read and write them directly — no export needed.
- **AI & Agents onboarding.** First-run onboarding gains two pages introducing the agent-ready Forge, the MCP server, and local semantic search — including the privacy model (everything stays on your Mac; writes are opt-in). Users who already completed onboarding see just the new pages once on their next launch.
- **External-edit conflict safety.** If a note changes on disk (iCloud Drive, Dropbox, Syncthing, git, another editor…) while you have unsaved edits in Moldavite, saving no longer silently overwrites the external version: the disk version is preserved as a sibling `<name> (conflict YYYY-MM-DD HHMM).md` note, your edits are then saved, and a warning toast names the conflict copy.

### Fixed

- **Opening the Timeline no longer traps the editor.** Clicking any sidebar, search, or quick-switcher note now closes the Timeline and reveals the loaded note; the same centralized navigation rule also closes a graph overlay opened before external note navigation.
- **Bundled plugins install reliably in development and release builds.** Publish to WordPress and the example plugin are explicitly bundled, development installs recover from stale staged resources, and a missing or failed source copy can no longer leave an empty `Invalid — no manifest.json` plugin behind. Uninstalling and reinstalling works normally.
- **Locking an open note no longer blacks out the app.** Closing the encrypted note now preserves the Zustand store instead of replacing it with `undefined`, and a top-level themed recovery screen offers **Reload** if any future uncaught render error reaches the React root.
- **Vault backups now preserve complete folder trees.** ZIP and encrypted exports include nested notes and weekly notes, replace-import removes stale nested files, and unsafe archives are fully validated before any existing note is changed.
- **Plugin failures no longer leave commands hanging.** A crashed, malformed-message, or non-responsive plugin worker now rejects pending command invocations, removes its registered commands, and applies a 30-second host timeout; malformed manifests with unknown or incorrectly typed fields are rejected cleanly.
- **Rapid trash and conflict operations no longer collide.** Trash IDs remain unique even when many notes are deleted in the same millisecond, and simultaneous same-minute conflict copies cannot overwrite one another.
- **Running MCP sessions honor write revocation immediately.** Turning off agent writes now removes and blocks write tools for already-connected clients, and oversized requests are rejected without destabilizing subsequent calls.
- **Graph view is stable, path-correct, and scalable.** Notes in folders, daily notes, and weekly notes now keep distinct path-based identities and open the right file; broken links remain visible without colliding with real notes. Deterministic bounded physics settles quickly without perpetual O(n²) work, label collisions are reduced, neighbor hover highlighting and node dragging work reliably, and zoom/pan can always be recovered with **Fit view**. The canvas also refits on resize and redraws with the active theme.
- **Feature-update onboarding now waits for saved settings to load.** Existing users reliably see the new AI & Agents pages once instead of having the flow chosen from pre-hydration defaults.
- **Password and template dialogs now follow the active theme.** Unlocking or locking a note and editing templates use Moldavite's background, text, border, focus, status, and accent tokens instead of fixed blue/gray palettes.
- **Locking a note no longer creates a duplicate plaintext note.** Pending saves are drained or cancelled before encryption, locked-note hashes are invalidated, and the backend refuses stale writes while the encrypted `.locked` file exists.
- **Temporarily unlocked notes display their decrypted content immediately.** Decrypted Markdown is converted to editor HTML before opening the note, without requiring a tab switch and return.

### Changed

- **Linked notes now form visible graph clusters.** The deterministic layout uses short edge springs, efficient local repulsion, per-component gravity, and peripheral orphan rings; it remains bounded, cools to a full stop, and keeps springs active while a dragged note tugs its neighbors.
- **MCP install path is tucked into a disclosure.** Settings → AI & Agents now reveals the resolved Moldavite binary path, development-build hint, and copy action only when **Path to your Moldavite install** is expanded; client snippets still embed the path automatically.
- **MCP setup is client-aware and machine-specific.** Settings now explains that the Moldavite binary path is resolved automatically, identifies development paths, and provides copy-ready setup for Claude Code, Claude Desktop, Cursor, or a generic MCP client.

## [1.5.1] - 2026-07-12

### Fixed

- **Editing or creating a template from Settings → Templates works again.** The template editor opened behind the Settings window (only the backdrop darkened); it now stacks above Settings.

## [1.5.0] - 2026-07-02

### Fixed

- **Notes inside folders now load and save correctly.** Opening a note in a folder previously showed empty content, and typing created a duplicate at the vault root. All note commands now address standalone notes by their folder-relative path.
- **Crash-safe saves** — every note, config, template, backup, and lock/unlock write is now atomic (temp file + flush + rename). A crash or full disk mid-save can no longer truncate a note. File permissions (owner-only) are applied before the file becomes visible.
- **Image-only daily notes are no longer deleted.** The auto-save "empty note" check now counts embedded media as content.
- **Renaming a note no longer breaks links to it** — inbound `[[wiki-links]]` across the whole vault are rewritten on rename (display text in `[[Display|target]]` links is preserved).
- **Accented and non-Latin note names resolve correctly.** Wiki-link slugs are Unicode-aware and NFC-normalized on both frontend and backend: "Café" no longer collides with "Cafe", and a Japanese-titled note no longer slugs to an empty filename.
- **Weekly notes created from templates** landed in the standalone notes folder; they now go to `weekly/`.
- **Calendar events containing the word "error"** no longer fail the whole event fetch (the Swift bridge response is now parsed properly).
- Failed note loads/creates now show an error toast instead of silently logging to the console.

### Changed

- **Plugins now run in a sandboxed Web Worker** with no DOM, no Zustand stores, no Tauri IPC, and no network globals (`fetch`, `XMLHttpRequest`, `WebSocket`, etc. are removed from the worker's global scope). The curated `PluginAPI` is now a `postMessage` bridge to the main thread, and permissions are enforced _host-side_ — a plugin can't reach a method its manifest didn't declare, even by trying to bypass the API object it was handed. Every `editor` and `ui` method is now async; command handlers should `await` them. Existing plugins need to add `await` — see docs/PLUGINS.md.
- **Plugin consent is pinned to the plugin's code.** Enabling a plugin records a SHA-256 hash of its `manifest.json` + `plugin.js`; if the code on disk changes in any way, Moldavite asks for consent again before running it (previously only a version bump re-prompted).
- **Plugins can no longer reach the raw Tauri IPC bridge** — the `window.__TAURI__` global has been removed (the app itself never needed it).
- The system opener (`shell:open`) is now restricted to `https://` URLs.
- The delete-note and uninstall-plugin confirmations (and the "create note from wiki-link" prompt) use accessible in-app dialogs (focus-trapped, Escape to cancel) instead of browser popups.
- Startup scan of daily notes for task-status badges is now capped at 8 concurrent reads, improving cold start on large vaults.

### Added

- Backend stress-test suite: 1,000-note vault search, concurrent atomic-write contention (torn-file detection), and bulk link rewriting.

## [1.4.0] - 2026-07-01

### Added

- **Plugin system (v1)** — third-party plugins can add commands to the command palette and editor slash menu. Plugins live in your Forge under `.plugins/<id>/` (`manifest.json` + `plugin.js`), load over a dedicated `plugin://` scheme (no `eval`), and run behind a per-plugin, per-Forge permission sheet. A curated, permission-enforced `PluginAPI` exposes commands + minimal editor + toasts. Manage them in **Settings → Plugins** (enable/disable, view permissions, uninstall, install the bundled example). Author guide in `docs/PLUGINS.md`. Permissioned-open by design: a granted plugin runs with real access to the Forge — enable only trusted plugins.
- **"What's New" popup** — after the app updates, a dialog shows the release notes for the new version (sourced from this changelog). Re-openable any time from Settings → About → "What's new in this version". Never shown on a first install.
- **Release runbook** — `docs/RELEASING.md` documents the full signed/notarized release + self-update process, required secrets, and updater-key rotation.
- **Version-sync tooling** — `npm run release:version -- X.Y.Z` keeps the version aligned across `package.json`, `tauri.conf.json`, `Cargo.toml`, and `Cargo.lock`.

### Fixed

- **Settings info tooltips** — the (i) popovers are now rendered through a portal with viewport-aware positioning, so they no longer get clipped off-screen, collapse into a narrow column, or snap the settings panel back to the top of the section when you scroll.
- **Update UI accent color** — the "Install Update" button, update banner, download progress bar, and selected template cards referenced an undefined CSS variable (`--accent-color`) and rendered without their accent color. They now use the real `--accent-primary` token.

### Changed

- **Settings modal accessibility** — focus is trapped inside the modal while open (initial focus, Tab cycling, focus restore on close), and the sidebar-width range sliders are now associated with their labels.
- **Release notes in GitHub Releases** — the release body is now the matching `CHANGELOG.md` section instead of a generic link, matching the in-app "What's New" content.

## [1.3.1] - 2026-05-02

### Fixed

- **Pinned tabs survive sidebar navigation** — clicking another note in the sidebar while a pinned tab is active now opens the new note in a fresh tab instead of replacing the pinned one.

### Added

- **Settings → Plugins tab** — informational surface promoting community-built integrations. Status banner ("design phase"), starter ideas (Zoom / Meet / Web Clipper / custom exports), and CTAs linking to `docs/PLUGINS_DESIGN.md` + the issues tracker. No loader yet — sets expectations and invites contributions.

## [1.3.0] - 2026-05-02

### Added

- **Multiple Forges** — sibling vault directories you can switch between (Obsidian-style). New sidebar dropdown above the search bar lists all Forges; "Manage Forges…" lets you create/rename/delete. Each Forge has its own pinned/recent state (localStorage namespaced per-Forge). Existing single-Forge users auto-migrate on first launch — content wraps into a `Default/` Forge in place. New IPC: `list_forges`, `create_forge`, `set_active_forge`, `rename_forge`, `delete_forge`, `set_forges_root`, `get_forges_root_path`. QuickSwitcher gains a "Switch Forge…" action.
- **Settings tab navigation** — the modal now has a left tab list instead of a long vertical scroll. Up/Down/Home/End keyboard nav, full ARIA tablist semantics.
- **Plugins design doc** — `docs/PLUGINS_DESIGN.md` records the intended shape for an Obsidian-style plugin system (no implementation yet — design only).

### Fixed

- **Right sidebar resizing** — calendar grid now shrinks gracefully instead of clipping when the sidebar narrows; timeline + month-switch buttons remain visible at minimum width.
- **Theme preset / dark base mode mismatch** — picking a light-only preset (Sepia) while in dark mode no longer leaves the editor with a black background and Sepia chrome. The applied preset auto-falls back to default when the picked preset doesn't cover the active base mode; the user's preference stays stored.
- **Settings → Templates** — section was rendering see-through under non-default presets due to hardcoded Tailwind grays. Now uses theme tokens (`var(--bg-*)`, `var(--text-*)`).

### Changed

- File watcher restarts cleanly on Forge switch (drops old watcher, spawns a new one rooted at the new active Forge, clears the self-write ignore-list).

## [1.2.0] - 2026-05-01

### Added

- **Forge** — Moldavite's note storage is now first-class for external tools.
  - YAML frontmatter on every note (currently `color`; schema is extensible — unknown keys round-trip cleanly).
  - One-shot, idempotent migration moves the legacy `.note-metadata.json` sidecar into per-file frontmatter.
  - Live file watcher (`notify` v6 + 300 ms debounce) emits a `forge:changed` event so external edits show up live; self-write echoes are suppressed.
  - New `rescan_forge` command (Settings → General button) re-runs the directory scan and rebuilds the in-memory backlinks index.
  - New `open_forge_in_finder` command and Settings button.
  - Public docs at `docs/FORGE.md` describing directory layout, frontmatter schema, wiki-link syntax, locked-file caveat.
- **Theme presets** — Solarized, Dracula, Nord, Sepia, Gruvbox alongside the default Moldavite palette. `<html>` carries a `data-theme` attribute beside the existing `dark` class so Tailwind `dark:` selectors keep working. Settings → Appearance picker shows preset cards with swatches.
- **QuickSwitcher upgrades** — action commands (Open Settings, Toggle Timeline, Toggle Theme, Open Graph, etc.), recent searches (last 5, persisted), pinned notes (hover star), section headers, refreshed keyboard footer.
- **First-run onboarding modal** — 3 steps (Welcome → pick your Forge → quick tour). Re-trigger from Settings → About.
- **PDF export options** — page size (Letter / A4 / Legal) and margins (Narrow / Normal / Wide), persisted last-used choice.
- **Plaintext export** — markdown-stripped `.txt` output from editor overflow menu and sidebar context menu.
- **Bulk export** — Export… button on the bulk-action bar; select Markdown / Plaintext / PDF + a destination folder, one file per note.
- **Empty-state polish** — `NoBacklinks`, `EmptyTrash`, `EmptyGraph` variants; consistent empty UI across the sidebar, graph view, and trash popover.

### Changed

- App-level a11y pass on Graph view, BulkActionBar, SidebarFooter, and Settings sections (dialog roles, focus management, `aria-label`s, `aria-hidden` on decorative icons, `role="switch"` on toggles).
- Bundle raw budget raised to 460 KB to accommodate v1.2 features (gzip cap unchanged at 120 KB; gzipped size ≈ 111 KB).

### Removed

- Sidecar `.note-metadata.json` is replaced by frontmatter; the file is renamed to `.note-metadata.json.migrated` after migration so it can be inspected/reverted manually if needed.

## [1.1.0] - 2026-04-23

### Added

- **Full-text search** across notes with ranked content matches and snippets
  (new `search_notes_content` Tauri command, powered by `walkdir` + regex).
  Locked notes and trashed notes are excluded from results.
- **Sidebar redesign**: dedicated sections for Search, Notes (standalone),
  Folders, Daily, and Tags, with a footer containing [Today / New] and
  [Settings / Trash] actions.
- **Trash popover** with read-only preview of deleted notes (Tiptap editor in
  `editable: false` mode, markdown rendered through `markdown-it` + DOMPurify).
  Restore sends a note back to the live list; permanent delete is one click.
- **Folder tree with drag-and-drop**: move notes between folders and reorganise
  the hierarchy from the sidebar.
- **Timeline view**: chronological feed of all notes bucketed by Today /
  Yesterday / This Week / This Month / Earlier, with macOS EventKit
  integration surfacing calendar events alongside notes.
- **Backlinks panel** below the editor showing every note that links to the
  current one.
- **PDF export** from the editor overflow menu (hardened via the existing
  `write_binary_file` command).
- **Shortcut help modal** (`⌘/Ctrl + ?`) listing every keyboard shortcut,
  driven by a new central `shortcuts.ts` registry.
- **Custom template editor** under Settings → Templates.
- **Settings JSON export / import**: back up and restore your preferences,
  theme, folders and pinned tabs as a JSON file (new `export_settings_json` /
  `import_settings_json` Tauri commands, scoped to the `moldavite-*`
  `localStorage` keys — notes are not included).
- **NoteFile.modified_at** is now exposed to the frontend so non-daily notes
  can be bucketed by actual filesystem mtime in the timeline view.

### Fixed

- Empty-note template suggestion buttons no longer overlap the Settings / Trash
  popovers (z-index regression).

### Changed

- Added `walkdir = "2.5"` to the Rust dependency set for recursive content
  search.
- Added 7 new Rust unit tests covering the content-search command (case
  handling, ranking, trash/locked exclusion, `max_results`, folder path
  reporting).

## [1.0.3] - 2026-04-22

### Security

- **Path traversal hardening**: replaced weak `..` string checks with a strict
  `is_safe_filename` validator across every filesystem-touching Tauri command.
- **Symlink redirect protection**: `validate_path_within_base` now rejects any
  symlink component along the destination parent chain, preventing pre-placed
  symlinks from redirecting writes outside the notes directory.
- **Password zeroization**: unlock / lock / export / import paths now wrap
  plaintext passwords in `Zeroizing` so they are scrubbed from memory after use.
- **XSS sink removal**: eliminated `dangerouslySetInnerHTML` in search previews,
  hardened PDF export (DOMPurify + remote-image strip), and restricted Tiptap
  link protocols to `http`/`https`/`mailto` with `rel="noopener noreferrer nofollow"`.
- **Tighter CSP**: dropped wildcard `img-src https:`, removed third-party host
  allowances, added `form-action 'none'`.
- **Self-hosted fonts**: replaced Google Fonts CDN with `@fontsource/*` packages
  — no more third-party font requests at runtime.
- **PDF export hardening**: `write_binary_file` now canonicalizes, enforces the
  `.pdf` extension, and rejects dotfile directories.
- **Notes directory scope**: `set_notes_directory` canonicalizes before the
  forbidden-prefix check and restricts the destination to the current user's home.
- Added 11 Rust unit tests covering `is_safe_filename` and
  `validate_path_within_base` (including symlink redirect rejection).

### Changed

- Removed ~1000 lines of dead scaffolding (`src-tauri/src/commands/*`) that was
  never wired into the Tauri handler.
- Bumped Vite build target to `es2022` / `chrome110` / `safari15` for newer jspdf.
- Added CI workflow running ESLint + Vite build + `cargo clippy -D warnings`
  - `cargo test` on every PR.

### Fixed

- `useAutoLock` no longer violates React's purity rule — the last-activity
  timestamp is initialized inside the mount effect instead of during render.
- Corrected `mauropereiira/Moldavite` repository URL in `Cargo.toml` and
  `package.json` (was `mauropereira/moldavite`).

## [1.0.0] - 2025-01-21

### Changed

- **Rebranded to Moldavite** - Complete visual identity refresh
  - New name: Moldavite (from Notomattic)
  - New color palette inspired by Moldavite crystal
  - New icon and logo
  - Updated typography: DM Sans, Instrument Serif, Space Mono
  - Dark mode with cosmic space black theme
- **Open Source Release** - Now available at github.com/mauropereira/moldavite
- Data folder moved to `~/Documents/Moldavite/`

## [0.6.0] - 2025-01-20

### Added

- **PDF Export**: Right-click any note to export as PDF with styled formatting
- **Tag Management**: Right-click tags in sidebar to rename them across all notes
- **Template Picker Customization**: Pin up to 6 templates for quick access in "Start with a template"
- **Sort Options**: Toggle A-Z/Z-A sorting for notes in sidebar

### Fixed

- Search results now persist after selecting a note (no longer clears search)

## [0.5.0] - 2025-01-04

### Added

- **Open Source**: Now available under MIT license
- **Security Hardening**:
  - HTML sanitization to prevent XSS attacks
  - Brute-force protection with rate limiting for locked notes
  - Password strength requirements (8+ chars, uppercase, lowercase, number)
  - Secure memory handling with zeroization for sensitive data
  - Encrypted backup exports with password protection
  - Session auto-lock timeout (configurable 1-60 minutes)
- **Contributing Guidelines**: Added CONTRIBUTING.md for contributors
- **Code Documentation**: Added JSDoc comments throughout codebase

### Changed

- **Codebase Restructure**: Improved module organization for maintainability
  - Backend split into focused command modules
  - Added utility modules for shared functionality
  - Standardized barrel exports across frontend
- **Settings UI**: Cleaned up About section

### Fixed

- Repository URL typo in Cargo.toml

## [0.4.0] - 2025-01-04

### Added

- **Weekly Notes**: Click week numbers in the calendar to create/open weekly notes
  - Week numbers displayed on left side of calendar (ISO week numbering)
  - Weekly notes stored in `weekly/` directory with `YYYY-Www.md` format
  - Virtual until content added, auto-deleted if emptied
- **Editor Tabs**: Multiple notes can be open in tabs
  - Pin tabs (up to 5)
  - Drag to reorder tabs
- **Folder System**: Organize notes into folders
  - Create, rename, delete folders
  - Drag notes into folders
  - Move to folder modal
- **Trash System**: 7-day recovery for deleted notes
  - Restore notes from trash
  - Permanent delete option
  - Auto-cleanup after 7 days
- **Selection Toolbar**: Quick formatting toolbar appears on text selection
- **Editor Error Boundary**: Prevents app crashes from editor errors

### Fixed

- Editor Cmd+A crash bug resolved
- Selection state no longer persists across notes
- Line spacing preserved when switching notes

## [0.3.9] - 2025-12-19

### Fixed

- Template application now visually updates the editor immediately
- Added editor to useCallback dependencies for proper reactivity

## [0.3.2] - 2025-12-13

### Fixed

- Use Tauri shell plugin to open GitHub releases URL
- Replace auto-update with manual GitHub releases link (auto-updates were problematic)
- Show dynamic app version in sidebar
- Add GitHub to CSP for auto-updates

## [0.3.1] - 2025-12-11

### Added

- UI polish with boxy aesthetic and per-note colors
- Directory change feature - store notes wherever you want
- Export/import functionality for notes
- Auto-updates support (later replaced with manual updates)
- Note locking feature
- Privacy improvements

### Fixed

- Template modal fixes
- Calendar permissions handling
- Wiki link copy behavior - now copies partial wiki link to trigger autocomplete on paste
- Use single bracket for wiki link copy

## [0.1.1] - 2025-12-06

### Added

- Windows support (experimental)
- Automated multi-platform builds
- Apple code signing and notarization for macOS

### Fixed

- Cross-platform build errors
- Calendar features now macOS-only for compatibility

## [0.1.0] - 2025-12-05

### Added

- Initial release
- WYSIWYG rich text editor with TipTap
- Daily notes with automatic creation
- Wiki-style linking with `[[Note Name]]` syntax
- Native macOS calendar integration
- Dark mode with system preference sync
- Local-first storage - all notes stored privately on your device
