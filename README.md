# Notomattic

A privacy-first, native note-taking application with WYSIWYG editing, daily notes, calendar integration, and wiki-style linking.

Available for **macOS** and **Windows**.

![Notomattic Logo](public/logo.png)

## Download

**[Download Latest Release](https://github.com/mauropereiira/notomattic/releases)**

### macOS Installation

1. Download the DMG for your Mac:
   - **Apple Silicon** (M1/M2/M3): `Notomattic_x.x.x_aarch64.dmg`
   - **Intel**: `Notomattic_x.x.x_x64.dmg`
2. Open the DMG file
3. Drag **Notomattic** to your Applications folder
4. Launch Notomattic from Applications

**First Launch - Security Warning:**

macOS will show a security warning because the app is unsigned:

> "Notomattic can't be opened because it is from an unidentified developer"

**Method 1: System Settings (Recommended)**
1. Try to open the app (it will be blocked)
2. Go to **System Settings** → **Privacy & Security**
3. Scroll to **Security** section
4. Click **Open Anyway** next to the Notomattic message
5. Confirm by clicking **Open**

**Method 2: Terminal Command**
```bash
sudo xattr -rd com.apple.quarantine /Applications/Notomattic.app
```

You only need to do this once!

### Windows Installation

1. Download the installer:
   - **Recommended**: `Notomattic_x.x.x_x64-setup.exe` (NSIS installer)
   - **Alternative**: `Notomattic_x.x.x_x64-en-US.msi` (MSI installer)
2. Run the installer
3. Windows SmartScreen may show a warning (unsigned app):
   - Click **More info**
   - Click **Run anyway**
4. Follow the installation wizard

### System Requirements

**macOS:**
- macOS 10.15 (Catalina) or later
- Apple Silicon (M1/M2/M3) or Intel processor

**Windows:**
- Windows 10 or later
- 64-bit system
- WebView2 (automatically installed if missing)

## Features

- **WYSIWYG Editor**: Rich text editing powered by TipTap with full formatting support
- **Daily Notes**: Automatic daily note creation with calendar integration
- **Wiki-Style Links**: Create connections between notes with `[[Note Name]]` syntax
- **macOS Calendar Integration**: Native EventKit integration for seamless calendar access
- **Dark Mode**: Full dark mode support with system preference sync
- **Privacy First**: All notes stored locally with no cloud sync
- **Native Performance**: Built with Tauri for fast, native macOS experience

## Tech Stack

- **Frontend**: React 19 + TypeScript 5.9 + Vite 7
- **Backend**: Tauri 2.9 (Rust) with Swift integration
- **Editor**: TipTap 3.10 (ProseMirror-based)
- **State Management**: Zustand 5.0 with localStorage persistence
- **Styling**: Tailwind CSS 4.1 with PostCSS
- **Font**: Geist by Vercel

## Development

### Prerequisites

- Node.js 18+ and npm
- Rust 1.70+
- Xcode Command Line Tools (macOS)

### Setup

```bash
# Install dependencies
npm install

# Run development server
npm run tauri dev

# Build for production
npm run tauri build
```

### Available Scripts

- `npm run dev` - Start Vite dev server only
- `npm run tauri dev` - Start full Tauri development environment
- `npm run build` - Build frontend only
- `npm run tauri build` - Build complete macOS application
- `npm run tauri icon <path>` - Generate app icons from source image

## Project Structure

```
Notomattic/
├── src/                        # React frontend source
│   ├── components/             # React components
│   │   ├── editor/            # Editor-related components
│   │   ├── settings/          # Settings modal and components
│   │   ├── sidebar/           # Sidebar navigation
│   │   └── ui/                # Reusable UI components
│   ├── hooks/                 # Custom React hooks
│   ├── lib/                   # Utility functions and types
│   ├── store/                 # Zustand state management
│   ├── App.tsx                # Main application component
│   ├── main.tsx               # React entry point
│   └── index.css              # Global styles and Tailwind imports
├── src-tauri/                 # Tauri/Rust backend
│   ├── src/
│   │   └── lib.rs            # Rust commands and logic
│   ├── swift-lib/            # Swift bridge for macOS features
│   ├── capabilities/         # Tauri permission definitions
│   ├── icons/                # Generated app icons
│   └── tauri.conf.json       # Tauri configuration
├── public/                    # Static assets
├── CLAUDE.md                  # AI assistant context file
├── PROJECT_STATUS.md          # Development status tracking
└── package.json               # NPM dependencies and scripts
```

## Architecture

### Frontend (React + TypeScript)

- **State Management**: Zustand stores with localStorage persistence
- **Editor**: TipTap editor with custom extensions for wiki links
- **Routing**: Single-page application with note-based navigation
- **Styling**: Tailwind CSS with custom design tokens

### Backend (Tauri + Rust + Swift)

- **Tauri Commands**: Rust functions exposed to frontend via IPC
- **Swift Bridge**: Native macOS EventKit integration for calendar features
- **File System**: Note storage and management via Tauri FS API
- **Permissions**: Granular capability-based security model

## Key Features Implementation

### Wiki-Style Links

Notes support `[[Note Name]]` syntax for creating links between notes. The editor automatically detects and styles these links, making navigation seamless.

### Daily Notes

Daily notes are automatically created with a standardized naming format (YYYY-MM-DD). The app integrates with macOS Calendar to show events alongside your notes.

### Theme Support

Full dark mode implementation using Tailwind's dark mode with `class` strategy. Theme preference is persisted and syncs with system preferences.

## Contributing

See [CLAUDE.md](CLAUDE.md) for development guidelines and codebase context.

## License

Proprietary - All rights reserved

## Support

For issues or questions, please contact the development team.
