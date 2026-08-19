/**
 * Print context: token → Doc emission with case policy and comment trivia.
 */

import type { Token, Comment } from "../tokens.js";
import type { StyleProfile } from "../profile.js";
import { concat, hardline, text, type Doc } from "./doc.js";

export interface Ctx {
  p: StyleProfile;
  /** keyword token */
  kw(t: Token): Doc;
  /** identifier & other tokens, verbatim text */
  raw(t: Token): Doc;
  /** function-name token (functionCase policy) */
  fnName(t: Token): Doc;
  /** type tokens inside cast(... as TYPE) (dataTypeCase policy) */
  typeTok(t: Token): Doc;
  /** keyword text without trivia (for synthesized words like "on") */
  word(t: Token): string;
}

function applyCase(textValue: string, policy: "lower" | "upper" | "preserve"): string {
  if (policy === "lower") return textValue.toLowerCase();
  if (policy === "upper") return textValue.toUpperCase();
  return textValue;
}

function commentDoc(c: Comment): Doc {
  return text(c.text);
}

/** Emit a token with its trivia. Line comments force breaks via hardline. */
function emit(t: Token, body: string): Doc {
  const parts: Doc[] = [];
  for (const c of t.leadingComments) {
    if (c.blankLineBefore) parts.push(hardline());
    parts.push(commentDoc(c), hardline());
  }
  parts.push(text(body));
  const tc = t.trailingComment;
  if (tc) {
    parts.push(text(" "), commentDoc(tc));
    if (tc.kind === "line") parts.push(hardline());
  }
  return parts.length === 1 ? parts[0]! : concat(...parts);
}

export function makeCtx(p: StyleProfile): Ctx {
  return {
    p,
    kw: (t) => emit(t, applyCase(t.text, p.keywordCase)),
    raw: (t) => emit(t, t.text),
    fnName: (t) => emit(t, applyCase(t.text, p.functionCase)),
    typeTok: (t) =>
      emit(t, t.kind === "keyword" || t.kind === "identifier" ? applyCase(t.text, p.dataTypeCase) : t.text),
    word: (t) => applyCase(t.text, p.keywordCase),
  };
}

/**
 * Smart single-line join for raw token runs (SET statements, generic
 * statements, partition entries, frame clauses, type token runs).
 * Spacing: no space after lparen/dot; none before rparen/comma/semicolon/dot;
 * none between a name and its call lparen; space after comma.
 */
export function smartJoinTokens(tokens: Token[], ctx: Ctx, kindHint?: "type"): Doc {
  const parts: Doc[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const prev = tokens[i - 1];
    if (prev) {
      const noSpaceAfterPrev =
        prev.kind === "lparen" || prev.kind === "dot" || (prev.text === "-" && prev.kind === "operator" && i === 1);
      const noSpaceBefore =
        t.kind === "rparen" ||
        t.kind === "comma" ||
        t.kind === "semicolon" ||
        t.kind === "dot" ||
        // Call-style glue: identifiers always (`substr(`), keywords only in
        // type context (`decimal(18, 2)`); clause keywords keep the space
        // (`filter (where ...)`, `tablesample (10 percent)`).
        (t.kind === "lparen" &&
          (prev.kind === "identifier" || (kindHint === "type" && prev.kind === "keyword")));
      if (!noSpaceAfterPrev && !noSpaceBefore) parts.push(text(" "));
    }
    const isWordy = t.kind === "keyword" || t.kind === "identifier";
    parts.push(kindHint === "type" && isWordy ? ctx.typeTok(t) : t.kind === "keyword" ? ctx.kw(t) : ctx.raw(t));
  }
  return concat(...parts);
}
