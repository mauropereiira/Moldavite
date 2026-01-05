# Contributing to Notomattic

Thank you for your interest in contributing to Notomattic! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Code Style](#code-style)
- [Making Changes](#making-changes)
- [Pull Request Process](#pull-request-process)
- [Reporting Issues](#reporting-issues)

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [Rust](https://rustup.rs/) (latest stable)
- [pnpm](https://pnpm.io/) (v8 or higher)

### Getting Started

1. **Clone the repository**
   ```bash
   git clone https://github.com/mauropereira/notomattic.git
   cd notomattic
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Run in development mode**
   ```bash
   pnpm tauri dev
   ```

4. **Build for production**
   ```bash
   pnpm tauri build
   ```

## Project Structure

```
notomattic/
├── src/                    # React/TypeScript frontend
│   ├── components/         # React components
│   ├── hooks/              # Custom React hooks
│   ├── stores/             # Zustand state stores
│   ├── lib/                # Utility functions
│   └── types/              # TypeScript type definitions
├── src-tauri/              # Rust/Tauri backend
│   ├── src/
│   │   ├── commands/       # Tauri command modules
│   │   ├── lib.rs          # Main library entry
│   │   ├── encryption.rs   # Encryption utilities
│   │   └── security.rs     # Security utilities
│   └── Cargo.toml          # Rust dependencies
├── public/                 # Static assets
└── docs/                   # Documentation
```

## Code Style

### TypeScript/React

- Use functional components with hooks
- Prefer named exports over default exports
- Add JSDoc comments to all exported functions and components
- Use TypeScript strict mode
- Follow existing patterns in the codebase

### Rust

- Follow standard Rust conventions
- Add documentation comments (`///`) to public functions
- Use `#[tauri::command]` for all Tauri commands
- Handle errors gracefully with proper error messages

### General

- Keep files under 500 lines when possible
- Extract reusable logic into separate modules
- Use meaningful variable and function names
- Write self-documenting code with comments for complex logic

## Making Changes

1. **Create a branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Follow the code style guidelines
   - Add tests if applicable
   - Update documentation if needed

3. **Test your changes**
   ```bash
   pnpm tauri dev
   ```

4. **Commit your changes**
   ```bash
   git commit -m "feat: add your feature description"
   ```

   Follow [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:` - New features
   - `fix:` - Bug fixes
   - `docs:` - Documentation changes
   - `refactor:` - Code refactoring
   - `chore:` - Maintenance tasks

## Pull Request Process

1. **Push your branch**
   ```bash
   git push origin feature/your-feature-name
   ```

2. **Open a Pull Request**
   - Provide a clear description of your changes
   - Reference any related issues
   - Include screenshots for UI changes

3. **Review Process**
   - Address any feedback from reviewers
   - Keep your branch up to date with main
   - Ensure all checks pass

## Reporting Issues

When reporting issues, please include:

- **Description**: Clear description of the problem
- **Steps to Reproduce**: How to reproduce the issue
- **Expected Behavior**: What you expected to happen
- **Actual Behavior**: What actually happened
- **Environment**: OS, app version, etc.
- **Screenshots**: If applicable

## Questions?

If you have questions, feel free to open an issue or discussion on GitHub.

---

Thank you for contributing to Notomattic!
