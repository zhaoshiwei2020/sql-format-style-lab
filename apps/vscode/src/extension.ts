/**
 * VS Code extension shell (ARCHITECTURE.md §14). Wires the deterministic
 * `@sqlstyle/core` formatter into a standard DocumentFormattingEditProvider
 * plus the MVP commands. This layer never decides formatting policy itself:
 * any state other than VALID_SUPPORTED-with-output leaves the document
 * untouched and only writes diagnostics to the "SQL Style" output channel.
 */

import * as path from "node:path";

import * as vscode from "vscode";

import {
  DEFAULT_PROFILE,
  HIVE_110,
  analyzeCoverage,
  formatSql,
  lex,
  parse,
  type Diagnostic,
  type FormatOutcome,
} from "@sqlstyle/core";

// `config.ts` is intentionally NOT re-exported from `@sqlstyle/core`'s
// index.ts (that file is out of scope for this extension to touch), so it is
// imported by its concrete file path instead of through the package barrel.
import { findProfileFile, loadProfileForFile } from "../../../packages/core/src/config.js";

const OUTPUT_CHANNEL_NAME = "SQL Style";
const CONFIG_FILE_NAME = ".sqlstyle.jsonc";
const STATUS_BAR_TIMEOUT_MS = 5000;

type LoadedProfile = ReturnType<typeof loadProfileForFile>;

let outputChannel: vscode.OutputChannel;

/** Cache of resolved profiles, keyed by the directory of the SQL file. */
const profileCache = new Map<string, LoadedProfile>();

function clearProfileCache(): void {
  profileCache.clear();
}

function workspaceStopDir(uri: vscode.Uri): string | undefined {
  return vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath;
}

/**
 * Resolves (and caches) the style profile that applies to `document`.
 * Untitled/non-file documents fall back to the first workspace folder, or
 * DEFAULT_PROFILE with no source file when there is none.
 */
function getProfileForDocument(document: vscode.TextDocument): LoadedProfile {
  if (document.uri.scheme !== "file") {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return { profile: DEFAULT_PROFILE, diagnostics: [], sourcePath: null };
    }
    return loadProfileForFile(path.join(folder.uri.fsPath, "untitled.sql"), folder.uri.fsPath);
  }

  const filePath = document.uri.fsPath;
  const dir = path.dirname(filePath);
  const cached = profileCache.get(dir);
  if (cached) return cached;

  const result = loadProfileForFile(filePath, workspaceStopDir(document.uri));
  profileCache.set(dir, result);
  return result;
}

function runFormat(document: vscode.TextDocument): { outcome: FormatOutcome; loaded: LoadedProfile } {
  const loaded = getProfileForDocument(document);
  const outcome = formatSql(document.getText(), { profile: loaded.profile });
  return { outcome, loaded };
}

// ---------------------------------------------------------------------------
// Output channel logging
// ---------------------------------------------------------------------------

function locationSuffix(document: vscode.TextDocument, d: Diagnostic): string {
  if (d.start === undefined) return "";
  const startPos = document.positionAt(d.start);
  if (d.end !== undefined) {
    const endPos = document.positionAt(d.end);
    return ` [${startPos.line + 1}:${startPos.character + 1}-${endPos.line + 1}:${endPos.character + 1}]`;
  }
  return ` [${startPos.line + 1}:${startPos.character + 1}]`;
}

function logOutcome(document: vscode.TextDocument, label: string, outcome: FormatOutcome, loaded: LoadedProfile): void {
  outputChannel.appendLine(`[${label}] ${document.uri.fsPath || "(untitled)"}`);
  outputChannel.appendLine(`  profile: ${loaded.sourcePath ?? "(defaults, no .sqlstyle.jsonc found)"}`);
  outputChannel.appendLine(`  state: ${outcome.state}`);
  for (const d of loaded.diagnostics) {
    outputChannel.appendLine(`  ${d.code} (config): ${d.message}`);
  }
  for (const d of outcome.diagnostics) {
    const construct = d.construct ? ` (construct: ${d.construct})` : "";
    outputChannel.appendLine(`  ${d.code}${locationSuffix(document, d)}${construct}: ${d.message}`);
  }
}

function showUnformattedStatusBar(outcome: FormatOutcome): void {
  const withConstruct = outcome.diagnostics.find((d) => d.construct);
  const detail = withConstruct ? `${outcome.state}: ${withConstruct.construct}` : outcome.state;
  vscode.window.setStatusBarMessage(`SQL Style: 未格式化 (${detail})`, STATUS_BAR_TIMEOUT_MS);
}

// ---------------------------------------------------------------------------
// DocumentFormattingEditProvider
// ---------------------------------------------------------------------------

class SqlStyleFormattingProvider implements vscode.DocumentFormattingEditProvider {
  provideDocumentFormattingEdits(document: vscode.TextDocument): vscode.TextEdit[] {
    const { outcome, loaded } = runFormat(document);

    if (outcome.state === "VALID_SUPPORTED" && outcome.output !== undefined) {
      const currentText = document.getText();
      if (outcome.output === currentText) return [];
      const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(currentText.length));
      return [vscode.TextEdit.replace(fullRange, outcome.output)];
    }

    logOutcome(document, "Format Document", outcome, loaded);
    showUnformattedStatusBar(outcome);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Preview Formatting (diff, read-only)
// ---------------------------------------------------------------------------

const PREVIEW_SCHEME = "sqlstyle-preview";

class PreviewContentProvider implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>();
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changeEmitter.event;

  set(uri: vscode.Uri, content: string): void {
    this.contents.set(uri.toString(), content);
    this.changeEmitter.fire(uri);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? "";
  }
}

async function previewFormatting(previewProvider: PreviewContentProvider): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("SQL Style: open a SQL file first.");
    return;
  }
  const document = editor.document;
  const { outcome, loaded } = runFormat(document);

  if (outcome.state === "VALID_SUPPORTED" && outcome.output !== undefined) {
    const name = path.basename(document.fileName || "untitled.sql");
    const previewUri = vscode.Uri.parse(`${PREVIEW_SCHEME}:${name}?t=${Date.now()}`);
    previewProvider.set(previewUri, outcome.output);
    await vscode.commands.executeCommand(
      "vscode.diff",
      document.uri,
      previewUri,
      `SQL Style Preview: ${name}`,
    );
    return;
  }

  logOutcome(document, "Preview Formatting", outcome, loaded);
  outputChannel.show(true);
  vscode.window.showWarningMessage(
    `SQL Style: cannot preview formatting (${outcome.state}). See the "SQL Style" output channel for details.`,
  );
}

// ---------------------------------------------------------------------------
// Show Unsupported Syntax
// ---------------------------------------------------------------------------

async function showUnsupportedSyntax(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("SQL Style: open a SQL file first.");
    return;
  }
  const document = editor.document;
  const { outcome, loaded } = runFormat(document);
  logOutcome(document, "Show Unsupported Syntax", outcome, loaded);
  outputChannel.show(true);

  const target = outcome.diagnostics.find(
    (d) => (d.code === "PAR002" || d.code === "PAR003") && d.start !== undefined,
  );
  if (target && target.start !== undefined) {
    const pos = document.positionAt(target.start);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    return;
  }

  if (outcome.state === "VALID_SUPPORTED") {
    vscode.window.showInformationMessage("SQL Style: no unsupported syntax found in this document.");
  } else {
    vscode.window.showInformationMessage(
      `SQL Style: state is ${outcome.state}; see the "SQL Style" output channel for diagnostics.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Debug Parse
// ---------------------------------------------------------------------------

/** Never prints more than 40 raw characters of the document per diagnostic. */
function boundedSnippet(document: vscode.TextDocument, d: Diagnostic): string {
  if (d.start === undefined) return "";
  const text = document.getText();
  const end = Math.max(d.start + 1, Math.min(text.length, d.end ?? d.start + 1));
  const raw = text.slice(d.start, end);
  const snippet = raw.length > 40 ? `${raw.slice(0, 40)}…` : raw;
  return ` snippet=${JSON.stringify(snippet)}`;
}

function debugParse(): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("SQL Style: open a SQL file first.");
    return;
  }
  const document = editor.document;
  const sql = document.getText();

  outputChannel.appendLine(`[Debug Parse] ${document.uri.fsPath || "(untitled)"}`);
  try {
    const lexed = lex(sql, HIVE_110);
    outputChannel.appendLine(`  tokens: ${lexed.tokens.length}`);
    if (lexed.errors.length > 0) {
      outputChannel.appendLine(`  lex errors: ${lexed.errors.length}`);
      for (const e of lexed.errors) {
        outputChannel.appendLine(`    LEX001 [${e.start}-${e.end}]: ${e.message}`);
      }
      outputChannel.show(true);
      return;
    }

    const parsed = parse(lexed.tokens, HIVE_110);
    const kinds = parsed.file.statements.map((s) => s.kind);
    outputChannel.appendLine(`  statement kinds: ${kinds.length > 0 ? kinds.join(", ") : "(none)"}`);

    const coverage = analyzeCoverage(parsed);
    outputChannel.appendLine(`  coverage state: ${coverage.state}`);
    for (const d of coverage.diagnostics) {
      const construct = d.construct ? ` construct=${d.construct}` : "";
      outputChannel.appendLine(`    ${d.code}${locationSuffix(document, d)}${construct}${boundedSnippet(document, d)}`);
    }
  } catch (err) {
    outputChannel.appendLine(`  error: ${err instanceof Error ? err.message : String(err)}`);
  }
  outputChannel.show(true);
}

// ---------------------------------------------------------------------------
// Open Style Profile
// ---------------------------------------------------------------------------

async function openProfile(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const document = editor?.document;

  let startDir: string | undefined;
  let stopDir: string | undefined;

  if (document && document.uri.scheme === "file") {
    startDir = path.dirname(document.uri.fsPath);
    stopDir = workspaceStopDir(document.uri);
  } else {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder) {
      startDir = folder.uri.fsPath;
      stopDir = folder.uri.fsPath;
    }
  }

  if (startDir) {
    const found = findProfileFile(startDir, stopDir);
    if (found) {
      const doc = await vscode.workspace.openTextDocument(found);
      await vscode.window.showTextDocument(doc);
      return;
    }
  }

  const targetFolder = vscode.workspace.workspaceFolders?.[0];
  if (!targetFolder) {
    vscode.window.showWarningMessage(
      `SQL Style: no ${CONFIG_FILE_NAME} found, and no workspace folder open to create one in.`,
    );
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    `SQL Style: no ${CONFIG_FILE_NAME} found. Create a starter file at the workspace root?`,
    "Create",
    "Cancel",
  );
  if (choice !== "Create") return;

  const targetUri = vscode.Uri.joinPath(targetFolder.uri, CONFIG_FILE_NAME);
  const starter = `{
  // SQL Style Calibrator — see docs/style-schema.md for every option.
  "$schema": "./node_modules/@sqlstyle/core/schema/sqlstyle.schema.json",
  "version": ${DEFAULT_PROFILE.version},
  "dialect": "${DEFAULT_PROFILE.dialect}",
  "dialectVersion": "${DEFAULT_PROFILE.dialectVersion}",
  "lineWidth": ${DEFAULT_PROFILE.lineWidth}
}
`;
  await vscode.workspace.fs.writeFile(targetUri, Buffer.from(starter, "utf8"));
  clearProfileCache();
  const doc = await vscode.workspace.openTextDocument(targetUri);
  await vscode.window.showTextDocument(doc);
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  context.subscriptions.push(outputChannel);

  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider("sql", new SqlStyleFormattingProvider()),
  );

  const previewProvider = new PreviewContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(PREVIEW_SCHEME, previewProvider),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sqlstyle.previewFormatting", () => previewFormatting(previewProvider)),
    vscode.commands.registerCommand("sqlstyle.showUnsupported", () => showUnsupportedSyntax()),
    vscode.commands.registerCommand("sqlstyle.debugParse", () => debugParse()),
    vscode.commands.registerCommand("sqlstyle.openProfile", () => openProfile()),
  );

  const watcher = vscode.workspace.createFileSystemWatcher(`**/${CONFIG_FILE_NAME}`);
  watcher.onDidChange(clearProfileCache);
  watcher.onDidCreate(clearProfileCache);
  watcher.onDidDelete(clearProfileCache);
  context.subscriptions.push(watcher);
}

export function deactivate(): void {
  clearProfileCache();
}
