/**
 * Expression printer. Encodes the calibrated aesthetic rules derived from the
 * two corpus files (see fixtures/). Key rules:
 *
 * - Function calls: group; broken form = one arg per line, closing paren on
 *   its own line; outermost-first expansion falls out of nested groups.
 * - Boolean chains: flat when they fit; otherwise one operand per line with
 *   the operator leading the line at the same indent level.
 * - Parenthesized boolean sub-chains: stay flat when their flat width is
 *   ≤ booleanGroup.compactMaxWidth, judged independently at any nesting depth
 *   (calibration Q5, 2026-08-19: the old "structural echo" rule — force-break
 *   when inside an already broken paren — was dropped by user decision).
 * - Additive chains (+/-): broken form is operator-leading lines.
 * - Multiplicative chains (*, /, %): never move operators to a new line;
 *   their parenthesized operands break internally instead.
 * - Comparison operators: prefer keeping the operator inline (operands may
 *   break internally); fall back to operator-leading continuation, +1 indent.
 * - CASE: always multi-line; short WHEN arms stay on one line; chain
 *   conditions expand to `when` on its own line with `then` re-aligned.
 * - OVER window specs: always broken, one clause per line.
 * - Subqueries in expressions: always broken.
 */

import type {
  BetweenExpr,
  BinaryExpr,
  BooleanChain,
  CaseExpr,
  CastExpr,
  Expr,
  FunctionCall,
  InExpr,
  OverClause,
  QueryExpr,
  WindowSpec,
} from "../cst.js";
import type { Token } from "../tokens.js";
import {
  choice,
  concat,
  flatOnly,
  group,
  hardline,
  ifBreak,
  indent,
  join,
  render,
  softline,
  softline0,
  text,
  containsHardLine,
  type Doc,
} from "./doc.js";
import { smartJoinTokens, type Ctx } from "./context.js";

/** Provided by stmt.ts to break the circular dependency for subqueries. */
export interface QueryPrinter {
  printQueryExpr(q: QueryExpr, ctx: Ctx): Doc;
}

export interface ExprOpts {
  /** True when the nearest enclosing parenthesized group rendered broken. */
  insideBrokenParen?: boolean;
}

const MEASURE_WIDTH = 1_000_000;

export function flatWidth(doc: Doc, ctx: Ctx): number {
  if (containsHardLine(doc)) return Number.POSITIVE_INFINITY;
  const rendered = render(doc, { lineWidth: MEASURE_WIDTH, indentSize: ctx.p.indent.size });
  let max = 0;
  for (const line of rendered.split("\n")) max = Math.max(max, line.length);
  return max;
}

type ChainClass = "add" | "mul" | null;

function opClass(opTokens: Token[]): ChainClass {
  if (opTokens.length !== 1) return null;
  const t = opTokens[0]!.text;
  if (t === "+" || t === "-") return "add";
  if (t === "*" || t === "/" || t === "%") return "mul";
  return null;
}

interface FlatChain {
  cls: Exclude<ChainClass, null>;
  operands: Expr[];
  ops: Token[];
}

/** Flatten a left-assoc BinaryExpr spine of one arithmetic class. */
function flattenArith(e: BinaryExpr): FlatChain | null {
  const cls = opClass(e.opTokens);
  if (cls === null) return null;
  const operands: Expr[] = [];
  const ops: Token[] = [];
  let cur: Expr = e;
  while (cur.kind === "binary" && opClass(cur.opTokens) === cls) {
    ops.unshift(cur.opTokens[0]!);
    operands.unshift(cur.right);
    cur = cur.left;
  }
  operands.unshift(cur);
  return { cls, operands, ops };
}

export function makeExprPrinter(qp: QueryPrinter) {
  function subqueryDoc(q: QueryExpr, ctx: Ctx): Doc {
    // Subqueries inside expressions are always broken.
    return concat(text("("), indent(concat(hardline(), qp.printQueryExpr(q, ctx))), hardline(), text(")"));
  }

  function nameDoc(tokens: Token[], ctx: Ctx, asFunction = false): Doc {
    const parts: Doc[] = [];
    tokens.forEach((t, i) => {
      void i;
      if (t.kind === "dot") parts.push(text("."));
      else if (asFunction) parts.push(ctx.fnName(t));
      else if (t.kind === "keyword") parts.push(ctx.kw(t));
      else parts.push(ctx.raw(t));
    });
    return concat(...parts);
  }

  function argListDoc(fn: FunctionCall, ctx: Ctx): Doc {
    if (fn.args.length === 0) return concat(text("("), text(")"));
    // Corpus rule: when an argument list expands, additive-chain arguments
    // expand with it (operator-leading lines), even if they would fit flat.
    const args = fn.args.map((a) => {
      if (a.kind === "binary") {
        const chain = flattenArith(a);
        if (chain && chain.cls === "add") {
          return ifBreak(additiveChainBrokenDoc(chain, ctx), flatOnly(additiveChainFlatDoc(chain, ctx)));
        }
      }
      return group(printExpr(a, ctx));
    });
    const head: Doc[] = [text("(")];
    if (fn.distinct) head.push(ctx.kw(fn.distinct), text(" "));
    // Corpus rule: a windowed call (inline OVER spec) whose arguments contain
    // nested calls always expands its argument list, even when it would fit.
    const windowedComplex =
      fn.over?.spec !== undefined &&
      fn.args.some((a) => a.kind === "functionCall" || a.kind === "cast" || a.kind === "case");
    if (windowedComplex) {
      const inner = join(concat(text(","), hardline()), args);
      return concat(...head, indent(concat(hardline(), inner)), hardline(), text(")"));
    }
    // Map-like functions break their arguments in key/value PAIRS.
    const fnName = fn.nameTokens[fn.nameTokens.length - 1]?.upper;
    if ((fnName === "NAMED_STRUCT" || fnName === "MAP" || fnName === "STR_TO_MAP") && args.length % 2 === 0 && args.length > 2) {
      const pairs: Doc[] = [];
      for (let i = 0; i < args.length; i += 2) {
        pairs.push(concat(args[i]!, text(", "), args[i + 1]!));
      }
      const flat = join(text(", "), args);
      const brokenPairs = concat(
        ...head,
        indent(concat(hardline(), join(concat(text(","), hardline()), pairs))),
        hardline(),
        text(")"),
      );
      return choice(flatOnly(concat(...head, flat, text(")"))), brokenPairs);
    }
    const inner = join(concat(text(","), softline()), args);
    return group(concat(...head, indent(concat(softline0(), inner)), softline0(), text(")")));
  }

  function windowSpecDoc(spec: WindowSpec, ctx: Ctx): Doc {
    const lines: Doc[] = [];
    if (spec.partitionBy) {
      const kws = spec.partitionBy.introTokens.map((t) => ctx.kw(t));
      lines.push(
        concat(join(text(" "), kws), text(" "), join(text(", "), spec.partitionBy.items.map((e) => printExpr(e, ctx)))),
      );
    }
    if (spec.orderBy) {
      const kws = spec.orderBy.introTokens.map((t) => ctx.kw(t));
      const items = spec.orderBy.items.map((it) => {
        const parts: Doc[] = [printExpr(it.expr, ctx)];
        if (it.direction) parts.push(text(" "), ctx.kw(it.direction));
        if (it.nulls) for (const t of it.nulls) parts.push(text(" "), ctx.kw(t));
        return concat(...parts);
      });
      lines.push(concat(join(text(" "), kws), text(" "), join(text(", "), items)));
    }
    if (spec.frameTokens && spec.frameTokens.length > 0) {
      lines.push(smartJoinTokens(spec.frameTokens, ctx));
    }
    if (lines.length === 0) return concat(text("("), text(")"));
    // Always broken.
    return concat(text("("), indent(concat(hardline(), join(hardline(), lines))), hardline(), text(")"));
  }

  function overDoc(over: OverClause, ctx: Ctx): Doc {
    const parts: Doc[] = [text(" "), ctx.kw(over.overToken), text(" ")];
    if (over.windowName) parts.push(ctx.raw(over.windowName));
    else if (over.spec) parts.push(windowSpecDoc(over.spec, ctx));
    return concat(...parts);
  }

  function functionCallDoc(fn: FunctionCall, ctx: Ctx): Doc {
    const parts: Doc[] = [nameDoc(fn.nameTokens, ctx, true), argListDoc(fn, ctx)];
    if (fn.filterTokens && fn.filterTokens.length > 0) {
      parts.push(text(" "), smartJoinTokens(fn.filterTokens, ctx));
    }
    if (fn.over) parts.push(overDoc(fn.over, ctx));
    return concat(...parts);
  }

  function booleanChainFlat(chain: BooleanChain, ctx: Ctx): Doc {
    const parts: Doc[] = [];
    chain.operands.forEach((op, i) => {
      if (i > 0) parts.push(text(" "), ctx.kw(chain.opTokens[i - 1]!), text(" "));
      parts.push(printExpr(op, ctx, { insideBrokenParen: false }));
    });
    return concat(...parts);
  }

  function booleanChainBroken(chain: BooleanChain, ctx: Ctx, opts: ExprOpts): Doc {
    const parts: Doc[] = [];
    chain.operands.forEach((op, i) => {
      if (i > 0) parts.push(hardline(), ctx.kw(chain.opTokens[i - 1]!), text(" "));
      parts.push(group(printExpr(op, ctx, opts)));
    });
    return concat(...parts);
  }

  /** choice(flat, one-operand-per-line). Exposed for clause printers. */
  function booleanChainDoc(chain: BooleanChain, ctx: Ctx, opts: ExprOpts = {}): Doc {
    return choice(flatOnly(booleanChainFlat(chain, ctx)), booleanChainBroken(chain, ctx, opts));
  }

  function parenDoc(inner: Expr, ctx: Ctx, opts: ExprOpts): Doc {
    const isChainInner =
      inner.kind === "booleanChain" || (inner.kind === "binary" && flattenArith(inner) !== null);
    const flatInner = printExpr(inner, ctx, { insideBrokenParen: false });
    const flatDoc = flatOnly(concat(text("("), flatInner, text(")")));
    const brokenInner =
      inner.kind === "booleanChain"
        ? booleanChainBroken(inner, ctx, { insideBrokenParen: true })
        : group(printExpr(inner, ctx, { insideBrokenParen: true }));
    const brokenDoc = concat(text("("), indent(concat(hardline(), brokenInner)), hardline(), text(")"));

    if (isChainInner) {
      const w = flatWidth(flatDoc, ctx);
      const mustBreak = w > ctx.p.booleanGroup.compactMaxWidth;
      if (mustBreak) return brokenDoc;
      return choice(flatDoc, brokenDoc);
    }
    return choice(flatDoc, brokenDoc);
  }

  function additiveChainFlatDoc(chain: FlatChain, ctx: Ctx): Doc {
    const parts: Doc[] = [];
    chain.operands.forEach((op, i) => {
      if (i > 0) parts.push(text(" "), ctx.raw(chain.ops[i - 1]!), text(" "));
      parts.push(printExpr(op, ctx, { insideBrokenParen: false }));
    });
    return concat(...parts);
  }

  function additiveChainBrokenDoc(chain: FlatChain, ctx: Ctx): Doc {
    const parts: Doc[] = [];
    chain.operands.forEach((op, i) => {
      const brokenOperand =
        op.kind === "paren"
          ? concat(
              text("("),
              indent(concat(hardline(), group(printExpr(op.inner, ctx, { insideBrokenParen: true })))),
              hardline(),
              text(")"),
            )
          : group(printExpr(op, ctx));
      if (i > 0) parts.push(hardline(), ctx.raw(chain.ops[i - 1]!), text(" "));
      parts.push(brokenOperand);
    });
    return concat(...parts);
  }

  function additiveChainDoc(chain: FlatChain, ctx: Ctx): Doc {
    return choice(flatOnly(additiveChainFlatDoc(chain, ctx)), additiveChainBrokenDoc(chain, ctx));
  }

  function multiplicativeChainDoc(chain: FlatChain, ctx: Ctx): Doc {
    const flatParts: Doc[] = [];
    const gluedParts: Doc[] = [];
    chain.operands.forEach((op, i) => {
      if (i > 0) {
        flatParts.push(text(" "), ctx.raw(chain.ops[i - 1]!), text(" "));
        gluedParts.push(text(" "), ctx.raw(chain.ops[i - 1]!), text(" "));
      }
      flatParts.push(printExpr(op, ctx, { insideBrokenParen: false }));
      // Glued mode: operators stay on the line; paren operands break instead.
      if (op.kind === "paren") {
        gluedParts.push(
          concat(
            text("("),
            indent(concat(hardline(), group(printExpr(op.inner, ctx, { insideBrokenParen: true })))),
            hardline(),
            text(")"),
          ),
        );
      } else {
        gluedParts.push(group(printExpr(op, ctx)));
      }
    });
    return choice(flatOnly(concat(...flatParts)), concat(...gluedParts));
  }

  function binaryDoc(e: BinaryExpr, ctx: Ctx, opts: ExprOpts): Doc {
    // Member access on a call result (parser models `f(...).a.b` as dot-op
    // BinaryExpr): tight postfix, glued to the (possibly multi-line) left.
    if (e.opTokens.length === 1 && e.opTokens[0]!.kind === "dot") {
      return concat(group(printExpr(e.left, ctx)), ctx.raw(e.opTokens[0]!), printExpr(e.right, ctx));
    }
    const arith = flattenArith(e);
    if (arith) {
      return arith.cls === "add" ? additiveChainDoc(arith, ctx) : multiplicativeChainDoc(arith, ctx);
    }
    const opDoc = join(
      text(" "),
      e.opTokens.map((t) => (t.kind === "keyword" ? ctx.kw(t) : ctx.raw(t))),
    );
    const left = printExpr(e.left, ctx);
    // Alternatives, most→least preferred (corpus-derived; see report notes):
    //   allFlat:   a <op> b                       (single line)
    //   sideBreak: left flat, right breaks inside (`> concat(\n ...`)
    //   opNewline: operator-leading continuation, both sides flat, +1 indent
    //   free:      greedy — either side may break
    const allFlat = flatOnly(concat(left, text(" "), opDoc, text(" "), printExpr(e.right, ctx)));
    const sideBreak = concat(flatOnly(left), text(" "), opDoc, text(" "), group(printExpr(e.right, ctx)));
    const opNewline = concat(
      flatOnly(left),
      indent(concat(hardline(), opDoc, text(" "), flatOnly(printExpr(e.right, ctx)))),
    );
    const free = concat(group(left), text(" "), opDoc, text(" "), group(printExpr(e.right, ctx)));
    // Inside an expanded parenthesized group the corpus prefers the aligned
    // operator-continuation (§12); at when/where level it prefers keeping the
    // operator inline and expanding the operand (§05).
    return opts.insideBrokenParen
      ? choice(allFlat, opNewline, sideBreak, free)
      : choice(allFlat, sideBreak, opNewline, free);
  }

  function caseDoc(e: CaseExpr, ctx: Ctx): Doc {
    const resultAttach = (result: Expr): Doc => {
      if (result.kind === "case") {
        return indent(concat(hardline(), printExpr(result, ctx)));
      }
      return concat(text(" "), group(printExpr(result, ctx)));
    };

    const arms: Doc[] = [];
    for (const arm of e.whens) {
      const condIsChain = arm.condition.kind === "booleanChain";
      let armDoc: Doc;
      if (condIsChain) {
        const chain = arm.condition as BooleanChain;
        const flatArm = flatOnly(concat(
          ctx.kw(arm.whenToken),
          text(" "),
          booleanChainFlat(chain, ctx),
          text(" "),
          ctx.kw(arm.thenToken),
          resultAttach(arm.result),
        ));
        const expandedArm = concat(
          ctx.kw(arm.whenToken),
          indent(concat(hardline(), booleanChainBroken(chain, ctx, {}))),
          hardline(),
          ctx.kw(arm.thenToken),
          resultAttach(arm.result),
        );
        armDoc = choice(flatArm, expandedArm);
      } else {
        armDoc = concat(
          ctx.kw(arm.whenToken),
          text(" "),
          group(printExpr(arm.condition, ctx)),
          text(" "),
          ctx.kw(arm.thenToken),
          resultAttach(arm.result),
        );
      }
      arms.push(armDoc);
    }
    if (e.elseArm) {
      arms.push(concat(ctx.kw(e.elseArm.elseToken), resultAttach(e.elseArm.result)));
    }

    const head: Doc[] = [ctx.kw(e.caseToken)];
    if (e.operand) head.push(text(" "), printExpr(e.operand, ctx));
    return concat(
      ...head,
      indent(concat(hardline(), join(hardline(), arms))),
      hardline(),
      ctx.kw(e.endToken),
    );
  }

  function castDoc(e: CastExpr, ctx: Ctx): Doc {
    const inner = concat(
      group(printExpr(e.expr, ctx)),
      text(" "),
      ctx.kw(e.asToken),
      text(" "),
      smartJoinTokens(e.typeTokens, ctx, "type"),
    );
    return group(
      concat(ctx.fnName(e.nameToken), text("("), indent(concat(softline0(), inner)), softline0(), text(")")),
    );
  }

  function betweenDoc(e: BetweenExpr, ctx: Ctx): Doc {
    const head: Doc[] = [printExpr(e.expr, ctx), text(" ")];
    if (e.notToken) head.push(ctx.kw(e.notToken), text(" "));
    head.push(ctx.kw(e.betweenToken));
    const flat = flatOnly(
      concat(
        ...head,
        text(" "),
        printExpr(e.low, ctx),
        text(" "),
        ctx.kw(e.andToken),
        text(" "),
        printExpr(e.high, ctx),
      ),
    );
    const broken = concat(
      ...head,
      indent(
        concat(
          hardline(),
          group(printExpr(e.low, ctx)),
          hardline(),
          ctx.kw(e.andToken),
          text(" "),
          group(printExpr(e.high, ctx)),
        ),
      ),
    );
    return choice(flat, broken);
  }

  function inDoc(e: InExpr, ctx: Ctx): Doc {
    const head: Doc[] = [printExpr(e.expr, ctx), text(" ")];
    if (e.notToken) head.push(ctx.kw(e.notToken), text(" "));
    head.push(ctx.kw(e.inToken), text(" "));
    if (e.subquery) {
      return concat(...head, subqueryDoc(e.subquery, ctx));
    }
    const items = e.items ? e.items.exprs.map((x) => group(printExpr(x, ctx))) : [];
    const list = group(
      concat(
        text("("),
        indent(concat(softline0(), join(concat(text(","), softline()), items))),
        softline0(),
        text(")"),
      ),
    );
    return concat(...head, list);
  }

  function printExpr(e: Expr, ctx: Ctx, opts: ExprOpts = {}): Doc {
    switch (e.kind) {
      case "literal":
        return join(
          text(" "),
          e.tokens.map((t) => (t.kind === "keyword" ? ctx.kw(t) : ctx.raw(t))),
        );
      case "name":
        return nameDoc(e.tokens, ctx);
      case "templateExpr":
        return ctx.raw(e.token);
      case "star": {
        const parts: Doc[] = [];
        for (const t of e.tokens) parts.push(t.kind === "dot" ? text(".") : ctx.raw(t));
        return concat(...parts);
      }
      case "unary":
        return concat(ctx.raw(e.opToken), printExpr(e.operand, ctx));
      case "binary":
        return binaryDoc(e, ctx, opts);
      case "booleanChain":
        return booleanChainDoc(e, ctx, opts);
      case "not":
        return concat(ctx.kw(e.notToken), text(" "), printExpr(e.operand, ctx, opts));
      case "paren":
        return parenDoc(e.inner, ctx, opts);
      case "functionCall":
        return functionCallDoc(e, ctx);
      case "case":
        return caseDoc(e, ctx);
      case "cast":
        return castDoc(e, ctx);
      case "between":
        return betweenDoc(e, ctx);
      case "in":
        return inDoc(e, ctx);
      case "exists": {
        const parts: Doc[] = [];
        if (e.notToken) parts.push(ctx.kw(e.notToken), text(" "));
        parts.push(ctx.kw(e.existsToken), text(" "), subqueryDoc(e.query, ctx));
        return concat(...parts);
      }
      case "is": {
        const parts: Doc[] = [printExpr(e.expr, ctx)];
        for (const t of e.opTokens) parts.push(text(" "), ctx.kw(t));
        return concat(...parts);
      }
      case "subqueryExpr":
        return subqueryDoc(e.query, ctx);
      case "interval":
        return smartJoinTokens(e.tokens, ctx);
      case "lambda":
        return concat(
          smartJoinTokens(e.paramTokens, ctx),
          text(" "),
          ctx.raw(e.arrowToken),
          text(" "),
          group(printExpr(e.body, ctx)),
        );
      case "unsupportedExpr":
        // Coverage analysis prevents reaching the printer; defensive fallback.
        return smartJoinTokens(e.tokens, ctx);
    }
  }

  return { printExpr, booleanChainDoc, booleanChainFlat, booleanChainBroken, subqueryDoc, windowSpecDoc, nameDoc };
}

export type ExprPrinter = ReturnType<typeof makeExprPrinter>;
