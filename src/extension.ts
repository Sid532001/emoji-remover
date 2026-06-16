import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Emoji regex
// Matches complete emoji sequences:
//   1. Flag sequences        — pairs of Regional Indicator symbols (🇺🇸, 🇬🇧)
//   2. Keycap sequences      — digit / # / * + \uFE0F + \u20E3  (1️⃣, #️⃣)
//   3. Extended pictographic — covers all visual emoji, including:
//        • Skin-tone variants    (👋🏽)
//        • Variation-selector-16 (❤️)
//        • ZWJ chains            (👨‍👩‍👧‍👦, 🏃‍♀️, ❤️‍🔥)
// Uses the `u` flag so \p{} Unicode property escapes work correctly.
// ---------------------------------------------------------------------------
const EMOJI_REGEX =
  /(?:\p{Regional_Indicator}\p{Regional_Indicator})|(?:[#*0-9]\uFE0F\u20E3)|(?:\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|\uFE0F\u20E3?)?(?:\u200D\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|\uFE0F\u20E3?)?)*)/gu;

// ---------------------------------------------------------------------------
// Well-known files without extensions that are treated as text
// ---------------------------------------------------------------------------
const EXTENSIONLESS_TEXT_FILES = new Set([
  'makefile', 'dockerfile', 'readme', 'license', 'licence',
  'changelog', 'contributing', 'gemfile', 'rakefile', 'procfile',
  'vagrantfile', 'jenkinsfile', 'cmakelists', 'authors', 'notice',
  'brewfile', 'guardfile', 'fastfile',
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Config {
  extensions: Set<string>;
  skipDirs: Set<string>;
  confirmBeforeProjectScan: boolean;
}

interface FileResult {
  modified: boolean;
  emojiCount: number;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
function getConfig(): Config {
  const cfg = vscode.workspace.getConfiguration('emojiRemover');
  return {
    extensions: new Set(
      cfg.get<string[]>('includedExtensions', []).map(e => e.toLowerCase()),
    ),
    skipDirs: new Set(cfg.get<string[]>('excludedDirectories', [])),
    confirmBeforeProjectScan: cfg.get<boolean>('confirmBeforeProjectScan', true),
  };
}

// ---------------------------------------------------------------------------
// Core emoji removal
// ---------------------------------------------------------------------------
function removeEmojis(text: string): { cleaned: string; count: number } {
  let count = 0;
  EMOJI_REGEX.lastIndex = 0; // reset state before each use
  const cleaned = text.replace(EMOJI_REGEX, () => {
    count++;
    return '';
  });
  return { cleaned, count };
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------
function isTextFile(filePath: string, config: Config): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (ext && config.extensions.has(ext)) {
    return true;
  }
  const basename = path.basename(filePath).toLowerCase();
  return EXTENSIONLESS_TEXT_FILES.has(basename);
}

function isBinaryBuffer(buffer: Buffer): boolean {
  // Heuristic: presence of a null byte in the first 8 KB signals binary content.
  const limit = Math.min(buffer.length, 8192);
  for (let i = 0; i < limit; i++) {
    if (buffer[i] === 0) {
      return true;
    }
  }
  return false;
}

/** Process a file that is NOT currently open in an editor — writes directly to disk. */
function processFileDisk(filePath: string): FileResult {
  try {
    const buffer = fs.readFileSync(filePath);
    if (isBinaryBuffer(buffer)) {
      return { modified: false, emojiCount: 0 };
    }

    const content = buffer.toString('utf8');
    const { cleaned, count } = removeEmojis(content);

    if (count > 0) {
      fs.writeFileSync(filePath, cleaned, 'utf8');
      return { modified: true, emojiCount: count };
    }
    return { modified: false, emojiCount: 0 };
  } catch {
    // Locked, read-only, or unreadable — skip silently.
    return { modified: false, emojiCount: 0 };
  }
}

/** Process a document that IS open in VS Code — applies an in-memory WorkspaceEdit
 *  so the change appears on the undo stack and the editor updates immediately. */
async function processOpenDocument(document: vscode.TextDocument): Promise<FileResult> {
  const text = document.getText();
  const { cleaned, count } = removeEmojis(text);

  if (count === 0) {
    return { modified: false, emojiCount: 0 };
  }

  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    document.uri,
    new vscode.Range(document.positionAt(0), document.positionAt(text.length)),
    cleaned,
  );

  const ok = await vscode.workspace.applyEdit(edit);
  return ok
    ? { modified: true, emojiCount: count }
    : { modified: false, emojiCount: 0 };
}

/** Decide whether to use in-memory edit (open doc) or disk write (closed file). */
async function processAnyFile(filePath: string): Promise<FileResult> {
  const openDoc = vscode.workspace.textDocuments.find(
    d => d.uri.scheme === 'file' && d.uri.fsPath === filePath,
  );
  return openDoc ? processOpenDocument(openDoc) : processFileDisk(filePath);
}

// ---------------------------------------------------------------------------
// Directory scanning
// ---------------------------------------------------------------------------
function collectTextFiles(dirPath: string, config: Config): string[] {
  const results: string[] = [];

  function recurse(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // permission denied or other error — skip
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!config.skipDirs.has(entry.name)) {
          recurse(fullPath);
        }
      } else if (entry.isFile() && isTextFile(fullPath, config)) {
        results.push(fullPath);
      }
    }
  }

  recurse(dirPath);
  return results;
}

// ---------------------------------------------------------------------------
// Shared multi-file scanner with progress UI
// ---------------------------------------------------------------------------
async function scanDirectory(dirPath: string, label: string): Promise<void> {
  const config = getConfig();
  const files = collectTextFiles(dirPath, config);

  if (files.length === 0) {
    vscode.window.showInformationMessage(
      `Emoji Remover: No text files found in ${label}.`,
    );
    return;
  }

  let totalEmojis = 0;
  let modifiedCount = 0;
  let processedCount = 0;
  let cancelled = false;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Emoji Remover — ${label}`,
      cancellable: true,
    },
    async (progress, token) => {
      token.onCancellationRequested(() => {
        cancelled = true;
      });

      for (const filePath of files) {
        if (cancelled) {
          break;
        }

        progress.report({
          message: `${path.basename(filePath)}  (${processedCount + 1} / ${files.length})`,
          increment: 100 / files.length,
        });

        const result = await processAnyFile(filePath);

        if (result.modified) {
          modifiedCount++;
          totalEmojis += result.emojiCount;
        }
        processedCount++;
      }
    },
  );

  // Summary notification
  if (cancelled) {
    vscode.window.showWarningMessage(
      `Emoji Remover: Cancelled after ${processedCount} / ${files.length} files. ` +
        `Removed ${totalEmojis} emoji${totalEmojis !== 1 ? 's' : ''} from ` +
        `${modifiedCount} file${modifiedCount !== 1 ? 's' : ''}.`,
    );
  } else if (totalEmojis === 0) {
    vscode.window.showInformationMessage(
      `Emoji Remover: No emojis found in ${label}. (${files.length} files scanned)`,
    );
  } else {
    vscode.window.showInformationMessage(
      `Emoji Remover: Removed ${totalEmojis} emoji${totalEmojis !== 1 ? 's' : ''} ` +
        `from ${modifiedCount} file${modifiedCount !== 1 ? 's' : ''} in ${label}. ` +
        `(${files.length} files scanned)`,
    );
  }
}

// ---------------------------------------------------------------------------
// Command: Remove Emojis from Current File
// Triggered via Command Palette or editor right-click menu.
// Uses an in-memory WorkspaceEdit so the change is undoable.
// ---------------------------------------------------------------------------
async function cmdRemoveFromCurrentFile(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Emoji Remover: No active file.');
    return;
  }

  const result = await processOpenDocument(editor.document);
  const name = path.basename(editor.document.fileName);

  if (result.modified) {
    vscode.window.showInformationMessage(
      `Emoji Remover: Removed ${result.emojiCount} emoji${result.emojiCount !== 1 ? 's' : ''} from "${name}".`,
    );
  } else {
    vscode.window.showInformationMessage(
      `Emoji Remover: No emojis found in "${name}".`,
    );
  }
}

// ---------------------------------------------------------------------------
// Command: Remove Emojis from This File
// Triggered via Explorer right-click on a single file.
// Falls back to the active editor if no URI is provided.
// ---------------------------------------------------------------------------
async function cmdRemoveFromFile(uri?: vscode.Uri): Promise<void> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!targetUri) {
    vscode.window.showWarningMessage('Emoji Remover: No file selected.');
    return;
  }

  const filePath = targetUri.fsPath;
  const config = getConfig();

  // Warn if the extension is not in the inclusion list, but still allow it.
  if (!isTextFile(filePath, config)) {
    const answer = await vscode.window.showWarningMessage(
      `"${path.basename(filePath)}" is not a recognised text file. Process it anyway?`,
      'Yes',
      'Cancel',
    );
    if (answer !== 'Yes') {
      return;
    }
  }

  const result = await processAnyFile(filePath);
  const name = path.basename(filePath);

  if (result.modified) {
    vscode.window.showInformationMessage(
      `Emoji Remover: Removed ${result.emojiCount} emoji${result.emojiCount !== 1 ? 's' : ''} from "${name}".`,
    );
  } else {
    vscode.window.showInformationMessage(
      `Emoji Remover: No emojis found in "${name}".`,
    );
  }
}

// ---------------------------------------------------------------------------
// Command: Remove Emojis from This Folder
// Triggered via Explorer right-click on a folder.
// ---------------------------------------------------------------------------
async function cmdRemoveFromFolder(uri?: vscode.Uri): Promise<void> {
  if (!uri) {
    vscode.window.showWarningMessage(
      'Emoji Remover: Right-click a folder in the Explorer to use this command.',
    );
    return;
  }

  await scanDirectory(uri.fsPath, `"${path.basename(uri.fsPath)}"`);
}

// ---------------------------------------------------------------------------
// Command: Remove Emojis from Entire Project
// Triggered via Command Palette.
// Scans every workspace folder; shows a confirmation modal first (configurable).
// ---------------------------------------------------------------------------
async function cmdRemoveFromProject(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders?.length) {
    vscode.window.showWarningMessage(
      'Emoji Remover: No workspace folder is open.',
    );
    return;
  }

  const config = getConfig();

  if (config.confirmBeforeProjectScan) {
    const answer = await vscode.window.showWarningMessage(
      'Emoji Remover will scan every text file in the project and permanently remove emojis. Continue?',
      { modal: true },
      'Remove Emojis',
    );
    if (answer !== 'Remove Emojis') {
      return;
    }
  }

  for (const folder of workspaceFolders) {
    await scanDirectory(folder.uri.fsPath, `project "${folder.name}"`);
  }
}

// ---------------------------------------------------------------------------
// Extension lifecycle
// ---------------------------------------------------------------------------
export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'emojiRemover.removeFromCurrentFile',
      cmdRemoveFromCurrentFile,
    ),
    vscode.commands.registerCommand(
      'emojiRemover.removeFromFile',
      cmdRemoveFromFile,
    ),
    vscode.commands.registerCommand(
      'emojiRemover.removeFromFolder',
      cmdRemoveFromFolder,
    ),
    vscode.commands.registerCommand(
      'emojiRemover.removeFromProject',
      cmdRemoveFromProject,
    ),
  );
}

export function deactivate(): void {}
