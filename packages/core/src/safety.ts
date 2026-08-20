/**
 * Safety gates (ARCHITECTURE.md §12). OWNER: safety/harness task.
 * Do not change exported signatures.
 */

import { lex } from "./lexer.js";
import { parse } from "./parser.js";
import { codeTokens, type Dialect, type Token } from "./tokens.js";
import type { StyleProfile } from "./profile.js";
import type { Diagnostic } from "./result.js";
import type { ParseResult } from "./cst.js";

function truncate(text: string): string {
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

/** Text used for equality comparison, per-kind case rules (ARCHITECTURE.md §12.1). */
function comparableText(token: Token, profile: StyleProfile): string {
  if (token.kind === "keyword") {
    return profile.keywordCase === "preserve" ? token.text : token.upper;
  }
  if (token.kind === "identifier") {
    // Hive identifiers are case-insensitive; function/type case policy may
    // also change an identifier's case, so identifiers always compare
    // case-insensitively regardless of profile.
    return token.upper;
  }
  // string, quotedIdentifier, template, number, operator, comma, dot,
  // semicolon, lparen, rparen, unknown: verbatim.
  return token.text;
}

interface OrderedComment {
  kind: string;
  text: string;
}

/** Ordered comment stream: walk tokens (including eof) collecting leading + trailing comments. */
function collectComments(tokens: Token[]): OrderedComment[] {
  const out: OrderedComment[] = [];
  // Trailing whitespace inside a line comment is not semantic and the
  // renderer's end-of-line trim removes it; compare line comments rstripped
  // so a source `-- note\t` still counts as preserved.
  const norm = (c: { kind: string; text: string }): OrderedComment =>
    c.kind === "line" ? { kind: c.kind, text: c.text.replace(/[ \t]+$/, "") } : { kind: c.kind, text: c.text };
  for (const t of tokens) {
    for (const c of t.leadingComments) out.push(norm(c));
    if (t.trailingComment) out.push(norm(t.trailingComment));
  }
  return out;
}

/**
 * Re-tokenizes input and output and compares the non-whitespace token
 * sequences. Case changes are permitted only for keyword tokens (and function
 * name identifiers / type names) when the profile allows them; strings,
 * comments, templates, quoted identifiers must match verbatim.
 * Returns [] when equivalent.
 */
export function checkTokenPreservation(
  input: string,
  output: string,
  profile: StyleProfile,
  dialect: Dialect,
): Diagnostic[] {
  const inLexed = lex(input, dialect);
  const outLexed = lex(output, dialect);

  if (inLexed.errors.length > 0 || outLexed.errors.length > 0) {
    return [
      {
        code: "SAFE001",
        message:
          "Token preservation check aborted: input or output could not be re-lexed cleanly.",
      },
    ];
  }

  const inTokens = codeTokens(inLexed.tokens);
  const outTokens = codeTokens(outLexed.tokens);

  if (inTokens.length !== outTokens.length) {
    return [
      {
        code: "SAFE001",
        message: `Token count changed: input has ${inTokens.length} tokens, output has ${outTokens.length} tokens.`,
      },
    ];
  }

  for (let i = 0; i < inTokens.length; i++) {
    const a = inTokens[i]!;
    const b = outTokens[i]!;

    if (a.kind !== b.kind) {
      return [
        {
          code: "SAFE001",
          message: `Token kind changed at index ${i} (offset ${a.start}): ${a.kind} "${truncate(
            a.text,
          )}" -> ${b.kind} "${truncate(b.text)}"`,
          start: a.start,
          end: a.end,
        },
      ];
    }

    const aText = comparableText(a, profile);
    const bText = comparableText(b, profile);
    if (aText !== bText) {
      return [
        {
          code: "SAFE001",
          message: `Token text changed at index ${i} (offset ${a.start}, kind ${a.kind}): "${truncate(
            a.text,
          )}" -> "${truncate(b.text)}"`,
          start: a.start,
          end: a.end,
        },
      ];
    }
  }

  const inComments = collectComments(inLexed.tokens);
  const outComments = collectComments(outLexed.tokens);

  if (inComments.length !== outComments.length) {
    return [
      {
        code: "SAFE001",
        message: `Comment count changed: input has ${inComments.length} comments, output has ${outComments.length} comments.`,
      },
    ];
  }

  for (let i = 0; i < inComments.length; i++) {
    const a = inComments[i]!;
    const b = outComments[i]!;
    if (a.kind !== b.kind || a.text !== b.text) {
      return [
        {
          code: "SAFE001",
          message: `Comment changed at index ${i}: [${a.kind}] "${truncate(a.text)}" -> [${b.kind}] "${truncate(
            b.text,
          )}"`,
        },
      ];
    }
  }

  return [];
}

const SKIP_KEYS = new Set([
  "start",
  "end",
  "leadingComments",
  "trailingComment",
  "blankLineBefore",
  "ownLine",
]);

/** Duck-types a CST leaf as a Token: only Token carries both `text` and `upper`. */
function isToken(value: unknown): value is Token {
  if (!value || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec["kind"] === "string" &&
    typeof rec["text"] === "string" &&
    typeof rec["upper"] === "string" &&
    typeof rec["start"] === "number" &&
    typeof rec["end"] === "number"
  );
}

/**
 * Generic recursive walk producing a stable, trivia-insensitive serialization
 * of a CST subtree. Objects emit `kind` (if present) followed by their
 * remaining properties in sorted key order; Tokens emit kind + upper text
 * (keyword/identifier) or kind + verbatim text (everything else); the
 * properties in SKIP_KEYS are never visited.
 */
function serializeNode(node: unknown): string {
  if (node === null || node === undefined) return "null";

  if (isToken(node)) {
    const value = node.kind === "keyword" || node.kind === "identifier" ? node.upper : node.text;
    return `T(${node.kind}:${value})`;
  }

  if (Array.isArray(node)) {
    return `[${node.map(serializeNode).join(",")}]`;
  }

  if (typeof node === "object") {
    const rec = node as Record<string, unknown>;
    const parts: string[] = [];

    const kind = rec["kind"];
    if (typeof kind === "string") parts.push(`kind=${kind}`);

    const keys = Object.keys(rec)
      .filter((k) => k !== "kind" && !SKIP_KEYS.has(k))
      .sort();
    for (const key of keys) {
      const value = rec[key];
      if (value === undefined) continue;
      parts.push(`${key}=${serializeNode(value)}`);
    }

    return `{${parts.join(";")}}`;
  }

  // primitive: string | number | boolean
  return `P(${String(node)})`;
}

/**
 * Trivia-insensitive structural fingerprint of a parsed file, used to verify
 * the output re-parses to the same structure as the input.
 */
export function structuralFingerprint(sql: string, dialect: Dialect): string | null {
  const lexed = lex(sql, dialect);
  if (lexed.errors.length > 0) return null;

  let parsed: ParseResult;
  try {
    parsed = parse(lexed.tokens, dialect);
  } catch {
    return null;
  }

  for (const stmt of parsed.file.statements) {
    if (stmt.kind === "unknownStatement") return null;
  }

  return serializeNode(parsed.file);
}
