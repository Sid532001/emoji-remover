# Emoji Remover

A VS Code extension that strips AI-generated emojis from code, markdown, and documentation — one file at a time or across your entire project.

## Why

AI coding tools love emojis. They end up in commit messages, docstrings, README files, comments, and config files. This extension gives you a one-click way to clean them all out.

## Features

| Action | How to trigger |
|---|---|
| Remove from **current file** | Right-click in editor → *Remove Emojis from Current File* |
| Remove from **any file** | Right-click file in Explorer → *Remove Emojis from This File* |
| Remove from **a folder** | Right-click folder in Explorer → *Remove Emojis from This Folder* |
| Remove from **entire project** | `Ctrl+Shift+P` → *Remove Emojis from Entire Project* |

All four commands are also available via the Command Palette (`Ctrl+Shift+P` → type `Emoji Remover`).

## Demo

**Before**
```
## 🚀 Getting Started

Run the following command to install dependencies: ✅

> npm install 📦
```

**After**
```
## Getting Started

Run the following command to install dependencies: 

> npm install 
```

## Installation

### From VSIX (local build)

```bash
git clone https://github.com/Sid532001/emoji-remover
cd emoji-remover
npm install
npx @vscode/vsce package --no-dependencies
code --install-extension emoji-remover-0.1.0.vsix
```

Then reload VS Code (`Ctrl+Shift+P` → *Developer: Reload Window*).

### From the Marketplace

> Coming soon.

## Configuration

All settings are under **Settings → Emoji Remover** (`emojiRemover.*`).

| Setting | Default | Description |
|---|---|---|
| `emojiRemover.includedExtensions` | `.ts`, `.js`, `.md`, `.py`, `.go`, and [40+ more](package.json) | File extensions to scan. Each entry must start with `.`. |
| `emojiRemover.excludedDirectories` | `node_modules`, `.git`, `dist`, `build`, and others | Directory names to skip during folder/project scans. |
| `emojiRemover.confirmBeforeProjectScan` | `true` | Show a confirmation dialog before scanning the whole project. |

### Supported file types (built-in)

The extension ships with defaults covering:

- **Documentation** — `.md`, `.mdx`, `.rst`, `.adoc`, `.txt`
- **Web** — `.html`, `.htm`, `.css`, `.scss`, `.svg`
- **JavaScript / TypeScript** — `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.vue`, `.svelte`
- **Python, Ruby, Go, Rust, Java, Kotlin, C/C++, C#, Swift, Scala, PHP, Perl**
- **Shell** — `.sh`, `.bash`, `.zsh`, `.ps1`
- **Data / Config** — `.json`, `.yaml`, `.toml`, `.ini`, `.env`, `.tf`, `.hcl`
- **Database / API** — `.sql`, `.graphql`, `.proto`
- **Extensionless text files** — `Makefile`, `Dockerfile`, `README`, `LICENSE`, `Procfile`, etc.

Add any extension you need via the setting — no restart required.

## How it works

- **Emoji matching** uses the `\p{Extended_Pictographic}` Unicode property escape (ES2020, `u` flag). It correctly handles complete emoji sequences including skin-tone modifiers (👋🏽), ZWJ chains (👨‍👩‍👧‍👦), flag pairs (🇺🇸), keycaps (1️⃣), and variation selectors (❤️) — removing the full sequence, never leaving orphan characters behind.
- **Open files** are edited via VS Code's `WorkspaceEdit` API, so changes appear on the undo stack and the editor updates immediately.
- **Closed files** are written directly to disk. A null-byte heuristic guards against accidentally modifying binary files.
- **Project scan** runs with a cancellable progress bar and shows a summary notification when done.

## Contributing

Contributions are welcome. Please open an issue before submitting a large pull request.

```bash
git clone https://github.com/your-username/emoji-remover
cd emoji-remover
npm install
# compile and watch
npm run watch
# press F5 in VS Code to launch the Extension Development Host
```

## License

MIT — see [LICENSE](LICENSE).
