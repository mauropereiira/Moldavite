<p align="center">
  <img src="src-tauri/icons/icon.png" alt="Moldavite" width="128" height="128">
</p>

<h1 align="center">Moldavite</h1>

<p align="center">
  <strong>Your thoughts, forged from cosmic impact.</strong><br>
  A beautiful, privacy-first note-taking app for macOS.
</p>

<p align="center">
  <a href="#download">Download</a> •
  <a href="#features">Features</a> •
  <a href="#screenshots">Screenshots</a> •
  <a href="#development">Development</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS-2d5a3d?style=flat-square&logo=apple&logoColor=white" alt="Platform">
  <img src="https://img.shields.io/badge/built_with-Tauri_2-24C8D8?style=flat-square" alt="Built with Tauri">
  <img src="https://img.shields.io/badge/license-MIT-c9a227?style=flat-square" alt="License">
</p>

---

## Download

**[Download Latest Release](../../releases/latest)**

| Chip | Download |
|------|----------|
| Apple Silicon (M1/M2/M3/M4) | `Moldavite_x.x.x_aarch64.dmg` |
| Intel | `Moldavite_x.x.x_x64.dmg` |

1. Open the DMG and drag **Moldavite** to Applications
2. Launch and start writing

> The app is signed and notarized by Apple - opens without security warnings.

---

## Features

### Privacy-First
All notes stored locally in `~/Documents/Moldavite/`. No cloud, no accounts, no tracking. Your thoughts stay yours.

### Rich Editor
- Full WYSIWYG editing with markdown shortcuts
- Wiki-style `[[links]]` to connect your thoughts
- Images, code blocks, task lists, highlights
- Beautiful forest-green theme with dark mode

### Daily & Weekly Notes
- One-click daily note creation
- ISO week-based weekly notes for planning
- Native Apple Calendar integration
- Custom templates for quick starts

### Organized
- Folders to structure your notes
- Backlinks panel to explore connections
- Full-text search across everything
- Note colors for visual organization

---

## Screenshots

<p align="center">
  <em>Screenshots coming soon</em>
</p>

<!--
![Editor](screenshots/editor.png)
![Dark Mode](screenshots/dark-mode.png)
-->

---

## Development

### Prerequisites

- Node.js 18+
- Rust 1.70+
- Xcode Command Line Tools

### Quick Start

```bash
# Clone
git clone https://github.com/mauropereiira/moldavite.git
cd moldavite

# Install & run
npm install
npm run tauri dev
```

### Build

```bash
npm run tauri build
```

### Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19 + TypeScript + Vite |
| Editor | TipTap (ProseMirror) |
| Backend | Tauri 2 (Rust) |
| Native | Swift bridge for EventKit |
| State | Zustand |
| Styling | Tailwind CSS |

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

<p align="center">
  Made with 💚 by <a href="https://github.com/mauropereiira">Mauro Pereira</a>
</p>
