/**
 * Printer: CST → Doc IR → layout solver → canonical text.
 * OWNER: main session (Fable). Agents must not modify this directory.
 */

import type { SqlFile } from "../cst.js";
import type { StyleProfile } from "../profile.js";
import type { Token, Comment } from "../tokens.js";
import { render } from "./doc.js";
import { makeCtx } from "./context.js";
import { makeStmtPrinter } from "./stmt.js";

/**
 * The printer synthesizes most punctuation text (commas, parens), so trivia
 * attached to those tokens would be silently dropped — which the token
 * preservation gate rejects. This pass migrates comments from punctuation
 * tokens onto the next non-punctuation token (stream order preserved, so the
 * safety gate's ordered comment comparison still matches).
 */
function normalizeTrivia(file: SqlFile): void {
  const tokens: Token[] = [];
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const x of node) visit(x);
      return;
    }
    const rec = node as Record<string, unknown>;
    if (typeof rec["text"] === "string" && typeof rec["upper"] === "string" && typeof rec["start"] === "number") {
      tokens.push(node as Token);
      return;
    }
    for (const k of Object.keys(rec)) visit(rec[k]);
  };
  visit(file);
  tokens.sort((a, b) => a.start - b.start);

  const isPunct = (t: Token) => t.kind === "comma" || t.kind === "lparen" || t.kind === "rparen";
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (!isPunct(t)) continue;
    const moved: Comment[] = [];
    if (t.leadingComments.length > 0) {
      moved.push(...t.leadingComments);
      t.leadingComments = [];
    }
    if (t.trailingComment) {
      moved.push(t.trailingComment);
      delete (t as { trailingComment?: Comment }).trailingComment;
    }
    if (moved.length === 0) continue;
    let target: Token | undefined;
    for (let j = i + 1; j < tokens.length; j++) {
      if (!isPunct(tokens[j]!)) {
        target = tokens[j]!;
        break;
      }
    }
    (target ?? file.eof).leadingComments.unshift(...moved);
  }
}

export function printFile(file: SqlFile, profile: StyleProfile): string {
  normalizeTrivia(file);
  const ctx = makeCtx(profile);
  const printer = makeStmtPrinter();
  const doc = printer.printFile(file, ctx);
  return render(doc, { lineWidth: profile.lineWidth, indentSize: profile.indent.size });
}
