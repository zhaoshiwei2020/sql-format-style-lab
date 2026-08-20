/**
 * VS Code extension: sql-formatter with Hive session-statement passthrough.
 *
 * The formatting engine is the stock `sql-formatter` library (unchanged
 * output style). The only fork behavior lives in hiveFormat.ts:
 * `set` / `use` / `add jar` / ... statements keep their exact hand-written
 * shape, and legacy `/* sql-formatter-disable *​/` markers are honored and
 * then stripped.
 *
 * Configuration reuses the `SQL-Formatter-VSCode.*` settings namespace the
 * previous extension contributed, so existing user settings keep working
 * unchanged. Unregistered keys still read fine — only editor completion is
 * lost, which this extension re-declares below.
 */

import * as vscode from "vscode";
import type { FormatOptions } from "sql-formatter";
import { formatDocument } from "./hiveFormat";

const HIVECONF_TEMPLATE = String.raw`\$\{[^}]*\}`;

function buildOptions(): FormatOptions {
  const cfg = vscode.workspace.getConfiguration("SQL-Formatter-VSCode");
  const userParams = (cfg.get<Record<string, unknown>>("paramTypes") ?? {}) as Record<string, unknown>;
  const custom = Array.isArray(userParams.custom)
    ? [...(userParams.custom as unknown[])]
    : [];
  custom.push({ regex: HIVECONF_TEMPLATE });
  return {
    dialect: cfg.get("dialect", "spark"),
    tabWidth: cfg.get("tabSizeOverride", 2),
    useTabs: !cfg.get("insertSpacesOverride", true),
    keywordCase: cfg.get("keywordCase", "lower"),
    dataTypeCase: cfg.get("dataTypeCase", "lower"),
    functionCase: cfg.get("functionCase", "lower"),
    identifierCase: cfg.get("identifierCase", "lower"),
    denseOperators: cfg.get("denseOperators", false),
    newlineBeforeSemicolon: cfg.get("newlineBeforeSemicolon", true),
    linesBetweenQueries: cfg.get("linesBetweenQueries", 2),
    expressionWidth: cfg.get("expressionWidth", 88),
    paramTypes: { ...userParams, custom },
  };
}

export function activate(_context: vscode.ExtensionContext): void {
  const provider: vscode.DocumentFormattingEditProvider = {
    provideDocumentFormattingEdits(document) {
      const source = document.getText();
      let output: string;
      try {
        output = formatDocument(source, buildOptions()).output;
      } catch {
        // sql-formatter could not parse the document — leave it untouched.
        return [];
      }
      if (output === source) return [];
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(source.length),
      );
      return [vscode.TextEdit.replace(fullRange, output)];
    },
  };
  vscode.languages.registerDocumentFormattingEditProvider("sql", provider);
}

export function deactivate(): void {}
