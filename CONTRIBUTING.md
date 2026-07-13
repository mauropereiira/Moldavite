# Contributing to Moldavite

Thanks for helping improve Moldavite. The project is a local-first macOS app, so
changes that touch notes, paths, encryption, plugins, or agent access should be
reviewed as changes to user data or a trust boundary.

## Development setup

Prerequisites:

- Node.js 18 or newer
- Rust 1.77 or newer
- Xcode Command Line Tools on macOS

Clone the repository, install dependencies, and start Tauri with frontend hot
reload:

```bash
git clone https://github.com/mauropereiira/Moldavite.git
cd Moldavite
npm install
npm run tauri dev
```

Useful commands:

```bash
npm test                                  # Frontend tests (Vitest)
(cd src-tauri && cargo test)              # Rust tests, including stress tests
npm run lint                              # TypeScript/React ESLint checks
npm run format:check                      # Prettier check
(cd src-tauri && cargo clippy --all-targets -- -D warnings)
npm run build                             # Frontend production build
npm run tauri build                       # Packaged macOS application
```

Run the checks relevant to your change while iterating. Before requesting review,
run both test suites and the lint/format checks. Changes to Rust should also pass
Clippy with warnings denied.

## Where things live

The current architecture, file-storage model, command map, and feature-specific
patterns are documented in [CLAUDE.md](CLAUDE.md). Keep that document accurate
when architecture or commands change.

- `src/components/` contains React UI grouped by feature.
- `src/hooks/` owns component-facing effects and workflow orchestration.
- `src/stores/` contains Zustand state; persistent state is Forge-namespaced where
  appropriate.
- `src/lib/fileSystem.ts` is the frontend HTML/Markdown and Tauri IPC boundary.
- `src/lib/plugins/` contains the sandboxed Worker host, wire protocol, validation,
  and permission-enforced plugin API.
- `src-tauri/src/commands/` contains backend commands grouped by domain.
- `src-tauri/src/persist.rs`, `validation.rs`, and `paths.rs` contain shared
  filesystem invariants.
- `src-tauri/src/mcp/` contains the headless, stdio MCP server.
- `docs/` contains design, plugin, release, project-status, and website docs.

## Code conventions

Follow the patterns already present in the file you are changing. In particular:

- Treat note display titles and disk addresses as different values. Daily and
  weekly notes use bare filenames; standalone notes use paths relative to `notes/`.
- Use the safe IPC wrapper on the frontend and validate every path-shaped argument
  again in Rust.
- Write user data through `persist::write_atomic`; do not use a bare file write.
- Preserve unknown YAML frontmatter when editing a note.
- Keep `slugifyNoteName` in `src/lib/fileSystem.ts` synchronized with
  `note_name_to_filename` in `src-tauri/src/wiki.rs`, including both mirror suites.
- Treat plugin source, manifests, Worker messages, network data, and MCP requests as
  untrusted. Do not expose raw Tauri IPC to plugins.
- Add factual module/file headers that state ownership and important invariants.
  Add contract comments where a function's safety, lifecycle, or addressing rules
  are not evident from its signature; avoid comments that merely narrate code.
- Use `rustfmt` and Prettier rather than hand-formatting around their output.

## Tests and documentation

Add or update regression coverage with behavior changes. Preserve mirrored tests
when a contract exists in both Rust and TypeScript.

Follow the documentation-maintenance rules in [CLAUDE.md](CLAUDE.md):

- User-visible changes need an entry under the upcoming version in `CHANGELOG.md`.
- Feature changes need corresponding updates in `README.md` and
  `docs/PROJECT_STATUS.md`.
- Plugin API or permission changes must update both `docs/PLUGINS.md` and
  `docs/plugins.html`.
- Architecture or command changes must update `CLAUDE.md`.
- Website claims must stay aligned with shipped behavior.

Before opening a pull request, ask whether any documentation now describes behavior
that is no longer true. Fix it in the same pull request.

## Pull requests

Keep each pull request focused and explain the user impact, implementation, and
verification. Include:

- A clear problem statement and summary of the approach
- Linked issues where applicable
- Tests for new or corrected behavior
- Documentation updates required by the maintenance rules above
- Screenshots or a short recording for visible UI changes
- Any security, migration, compatibility, or user-data implications

Do not include unrelated formatting or refactors. Make sure tests, lint, formatting,
and relevant Rust checks are green before requesting review.

## Good first areas

- Improve focused documentation or examples where an invariant is already tested.
- Add regression tests for pure helpers in `src/lib/` or small Zustand stores.
- Improve accessibility labels, keyboard behavior, or focus tests in existing UI.
- Reproduce and document a well-scoped issue before proposing a behavioral fix.
- Keep website or contributor documentation synchronized with existing features.

For larger features, plugin permissions, migrations, encryption, or filesystem
changes, open an issue first so the design and compatibility constraints can be
agreed before implementation.
