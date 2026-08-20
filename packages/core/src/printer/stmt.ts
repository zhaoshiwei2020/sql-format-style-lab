/**
 * Statement/query printer. Corpus-derived clause rules:
 * - select: 1 item inline, 2+ items one per line (trailing commas).
 * - where/having: boolean chains ALWAYS expand (keyword alone on its line),
 *   single predicates stay inline.
 * - join ON: first condition on the `on` line, further operands lead with
 *   and/or at the same indent as `on`; single condition inline.
 * - group by / order by (top level): 2+ items one per line, 1 item inline.
 * - sort/distribute/cluster by: inline while they fit.
 * - window specs and subqueries: always broken.
 * - set operators: blank line, operator alone, blank line.
 */

import type {
  ByClause,
  ColumnDef,
  ColumnList,
  CreateTableStatement,
  Cte,
  DropTableStatement,
  Expr,
  FromClause,
  GenericStatement,
  InsertStatement,
  JoinRelation,
  LateralView,
  MultiInsertStatement,
  OrderByClause,
  PartitionSpec,
  QueryExpr,
  QuerySpec,
  Relation,
  SelectStatement,
  SetStatement,
  SqlFile,
  StatementNode,
  TableRef,
  WithClause,
} from "../cst.js";
import type { Token } from "../tokens.js";
import { concat, flatOnly, group, hardline, indent, join, softline, softline0, text, type Doc } from "./doc.js";
import { smartJoinTokens, type Ctx } from "./context.js";
import { makeExprPrinter, type ExprPrinter } from "./expr.js";

export interface StmtPrinter {
  printFile(file: SqlFile, ctx: Ctx): Doc;
  printQueryExpr(q: QueryExpr, ctx: Ctx): Doc;
}

export function makeStmtPrinter(): StmtPrinter {
  // Break the printer↔expr cycle with a late-bound reference.
  const self: StmtPrinter = {
    printFile,
    printQueryExpr,
  };
  const ep: ExprPrinter = makeExprPrinter({ printQueryExpr: (q, ctx) => printQueryExpr(q, ctx) });

  function kwRun(tokens: Token[], ctx: Ctx): Doc {
    return join(
      text(" "),
      tokens.map((t) => (t.kind === "keyword" ? ctx.kw(t) : ctx.raw(t))),
    );
  }

  function tableRefDoc(t: TableRef, ctx: Ctx): Doc {
    const parts: Doc[] = [ep.nameDoc(t.nameTokens, ctx)];
    if (t.sampleTokens && t.sampleTokens.length > 0) parts.push(text(" "), smartJoinTokens(t.sampleTokens, ctx));
    if (t.asToken) parts.push(text(" "), ctx.kw(t.asToken));
    if (t.alias) parts.push(text(" "), ctx.raw(t.alias));
    return concat(...parts);
  }

  function relationDoc(r: Relation, ctx: Ctx): Doc {
    switch (r.kind) {
      case "tableRef":
        return tableRefDoc(r, ctx);
      case "subqueryRelation": {
        const parts: Doc[] = [
          text("("),
          indent(concat(hardline(), printQueryExpr(r.query, ctx))),
          hardline(),
          text(")"),
        ];
        if (r.asToken) parts.push(text(" "), ctx.kw(r.asToken));
        if (r.alias) parts.push(text(" "), ctx.raw(r.alias));
        return concat(...parts);
      }
      case "joinRelation":
        return joinRelationDoc(r, ctx);
    }
  }

  function joinRelationDoc(r: JoinRelation, ctx: Ctx): Doc {
    const parts: Doc[] = [relationDoc(r.first, ctx)];
    for (const jp of r.joins) {
      parts.push(hardline(), kwRun(jp.joinTokens, ctx), text(" "), relationDoc(jp.relation, ctx));
      if (jp.on) {
        const cond = jp.on.condition;
        if (cond.kind === "booleanChain") {
          parts.push(
            indent(concat(hardline(), ctx.kw(jp.on.onToken), text(" "), ep.booleanChainBroken(cond, ctx, {}))),
          );
        } else {
          parts.push(indent(concat(hardline(), ctx.kw(jp.on.onToken), text(" "), group(ep.printExpr(cond, ctx)))));
        }
      } else if (jp.using) {
        const cols = join(text(", "), jp.using.columns.map((c) => ctx.raw(c)));
        parts.push(indent(concat(hardline(), ctx.kw(jp.using.usingToken), text(" ("), cols, text(")"))));
      }
    }
    return concat(...parts);
  }

  function lateralViewDoc(lv: LateralView, ctx: Ctx): Doc {
    // Corpus keeps lateral view clauses on one line even slightly past the
    // line width; flatOnly outside any choice renders forcibly flat.
    const parts: Doc[] = [kwRun(lv.introTokens, ctx), text(" "), ep.printExpr(lv.fn, ctx)];
    if (lv.tableAlias) parts.push(text(" "), ctx.raw(lv.tableAlias));
    if (lv.asToken) parts.push(text(" "), ctx.kw(lv.asToken));
    if (lv.columnAliases.length > 0) {
      parts.push(text(" "), join(text(", "), lv.columnAliases.map((c) => ctx.raw(c))));
    }
    return flatOnly(concat(...parts));
  }

  /** Earliest token under a CST node (stream order). */
  function earliestToken(s: unknown): Token | undefined {
    let best: Token | undefined;
    const visit = (node: unknown): void => {
      if (node === null || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const x of node) visit(x);
        return;
      }
      const rec = node as Record<string, unknown>;
      if (typeof rec["text"] === "string" && typeof rec["upper"] === "string" && typeof rec["start"] === "number") {
        const t = node as Token;
        if (!best || t.start < best.start) best = t;
        return;
      }
      for (const k of Object.keys(rec)) visit(rec[k]);
    };
    visit(s);
    return best;
  }

  /** where/having/qualify: chains always expand under a lone keyword. */
  function conditionClauseDoc(kw: Doc, cond: Expr, ctx: Ctx): Doc {
    if (cond.kind === "booleanChain") {
      return concat(kw, indent(concat(hardline(), ep.booleanChainBroken(cond, ctx, {}))));
    }
    // Own-line comments ahead of the condition can't share the keyword line;
    // the indented broken form keeps comment and condition under the keyword.
    const first = earliestToken(cond);
    if (first && first.leadingComments.some((c) => c.ownLine)) {
      return concat(kw, indent(concat(hardline(), group(ep.printExpr(cond, ctx)))));
    }
    return concat(kw, text(" "), group(ep.printExpr(cond, ctx)));
  }

  function exprListClauseDoc(intro: Doc, items: Doc[], alwaysBreakWhenMultiple: boolean): Doc {
    if (items.length === 1) return concat(intro, text(" "), items[0]!);
    if (alwaysBreakWhenMultiple) {
      return concat(intro, indent(concat(hardline(), join(concat(text(","), hardline()), items))));
    }
    return group(concat(intro, text(" "), indent(join(concat(text(","), softline()), items))));
  }

  function orderItemsDocs(clause: OrderByClause, ctx: Ctx): Doc[] {
    return clause.items.map((it) => {
      const parts: Doc[] = [ep.printExpr(it.expr, ctx)];
      if (it.direction) parts.push(text(" "), ctx.kw(it.direction));
      if (it.nulls) for (const t of it.nulls) parts.push(text(" "), ctx.kw(t));
      return concat(...parts);
    });
  }

  function byClauseDoc(clause: ByClause, ctx: Ctx): Doc {
    const intro = kwRun(clause.introTokens, ctx);
    const items = clause.items.map((e) => ep.printExpr(e, ctx));
    return exprListClauseDoc(intro, items, false);
  }

  function querySpecDoc(q: QuerySpec, ctx: Ctx): Doc {
    const lines: Doc[] = [];

    // SELECT
    {
      const head: Doc[] = [ctx.kw(q.selectToken)];
      if (q.distinct) head.push(text(" "), ctx.kw(q.distinct));
      const items = q.items.map((item) => {
        const parts: Doc[] = [group(ep.printExpr(item.expr, ctx))];
        if (item.asToken) parts.push(text(" "), ctx.kw(item.asToken));
        if (item.alias) parts.push(text(" "), ctx.raw(item.alias));
        return concat(...parts);
      });
      if (items.length === 1) {
        lines.push(concat(...head, text(" "), items[0]!));
      } else {
        // Blank lines between select items are preserved (logical grouping).
        const itemParts: Doc[] = [];
        items.forEach((it, i) => {
          if (i > 0) {
            itemParts.push(text(","), hardline());
            if (firstThingBlankLine(q.items[i]!.expr)) itemParts.push(hardline());
          }
          itemParts.push(it);
        });
        lines.push(concat(...head, indent(concat(hardline(), ...itemParts))));
      }
    }

    if (q.from) {
      lines.push(concat(ctx.kw(q.from.fromToken), text(" "), relationDoc(q.from.relation, ctx)));
    }
    for (const lv of q.lateralViews) lines.push(lateralViewDoc(lv, ctx));
    if (q.where) lines.push(conditionClauseDoc(ctx.kw(q.where.whereToken), q.where.condition, ctx));
    if (q.groupBy) {
      const intro = concat(ctx.kw(q.groupBy.groupToken), text(" "), ctx.kw(q.groupBy.byToken));
      const items = q.groupBy.items.map((e) => ep.printExpr(e, ctx));
      lines.push(exprListClauseDoc(intro, items, true));
    }
    if (q.having) lines.push(conditionClauseDoc(ctx.kw(q.having.havingToken), q.having.condition, ctx));
    if (q.windowClause) {
      const defs = q.windowClause.definitions.map((d) =>
        concat(ctx.raw(d.name), text(" "), ctx.kw(d.asToken), text(" "), ep.windowSpecDoc(d.spec, ctx)),
      );
      lines.push(concat(ctx.kw(q.windowClause.windowToken), text(" "), join(concat(text(","), hardline()), defs)));
    }
    if (q.qualify) lines.push(conditionClauseDoc(ctx.kw(q.qualify.qualifyToken), q.qualify.condition, ctx));
    if (q.orderBy) {
      const intro = kwRun(q.orderBy.introTokens, ctx);
      lines.push(exprListClauseDoc(intro, orderItemsDocs(q.orderBy, ctx), true));
    }
    if (q.clusterBy) lines.push(byClauseDoc(q.clusterBy, ctx));
    if (q.distributeBy) lines.push(byClauseDoc(q.distributeBy, ctx));
    if (q.sortBy) {
      const intro = kwRun(q.sortBy.introTokens, ctx);
      lines.push(exprListClauseDoc(intro, orderItemsDocs(q.sortBy, ctx), false));
    }
    if (q.limit) lines.push(concat(ctx.kw(q.limit.limitToken), text(" "), ctx.raw(q.limit.countToken)));

    return join(hardline(), lines);
  }

  function cteDoc(c: Cte, ctx: Ctx): Doc {
    return concat(
      ctx.raw(c.name),
      text(" "),
      ctx.kw(c.asToken),
      text(" ("),
      indent(concat(hardline(), printQueryExpr(c.query, ctx))),
      hardline(),
      text(")"),
    );
  }

  function withClauseDoc(w: WithClause, ctx: Ctx): Doc {
    const ctes = w.ctes.map((c) => cteDoc(c, ctx));
    return concat(ctx.kw(w.withToken), text(" "), join(concat(text(","), hardline()), ctes));
  }

  function printQueryExpr(q: QueryExpr, ctx: Ctx): Doc {
    switch (q.kind) {
      case "querySpec":
        return querySpecDoc(q, ctx);
      case "setOperation": {
        const parts: Doc[] = [printQueryExpr(q.first, ctx)];
        for (const part of q.rest) {
          parts.push(hardline(), hardline(), kwRun(part.opTokens, ctx), hardline(), hardline());
          parts.push(printQueryExpr(part.query, ctx));
        }
        return concat(...parts);
      }
      case "parenQuery":
        return concat(text("("), indent(concat(hardline(), printQueryExpr(q.query, ctx))), hardline(), text(")"));
    }
  }

  function selectStatementDoc(s: SelectStatement, ctx: Ctx): Doc {
    const parts: Doc[] = [];
    if (s.with) parts.push(withClauseDoc(s.with, ctx), hardline());
    parts.push(printQueryExpr(s.body, ctx));
    return concat(...parts);
  }

  function partitionDoc(p: PartitionSpec, ctx: Ctx): Doc {
    const entries = p.entries.map((run) => smartJoinTokens(run, ctx));
    return concat(ctx.kw(p.partitionToken), text(" ("), join(text(", "), entries), text(")"));
  }

  function insertDoc(s: InsertStatement, ctx: Ctx): Doc {
    const parts: Doc[] = [];
    if (s.with) parts.push(withClauseDoc(s.with, ctx), hardline());
    parts.push(kwRun(s.introTokens, ctx), text(" "), tableRefDoc(s.table, ctx));
    if (s.partition) parts.push(hardline(), partitionDoc(s.partition, ctx));
    if (s.ifNotExists && s.ifNotExists.length > 0) parts.push(text(" "), kwRun(s.ifNotExists, ctx));
    parts.push(hardline(), selectStatementDoc(s.source, ctx));
    return concat(...parts);
  }

  function multiInsertDoc(s: MultiInsertStatement, ctx: Ctx): Doc {
    const parts: Doc[] = [ctx.kw(s.fromToken), text(" "), relationDoc(s.relation, ctx)];
    for (const b of s.inserts) {
      parts.push(hardline(), kwRun(b.introTokens, ctx), text(" "), tableRefDoc(b.table, ctx));
      if (b.partition) parts.push(hardline(), partitionDoc(b.partition, ctx));
      parts.push(hardline(), querySpecDoc(b.body, ctx));
    }
    return concat(...parts);
  }

  function setStatementDoc(s: SetStatement, ctx: Ctx): Doc {
    const parts: Doc[] = [ctx.kw(s.setToken)];
    if (s.keyTokens.length > 0) parts.push(text(" "), smartJoinTokens(s.keyTokens, ctx));
    if (s.eq) parts.push(text(" "), ctx.raw(s.eq));
    if (s.valueTokens.length > 0) parts.push(text(" "), smartJoinTokens(s.valueTokens, ctx));
    return concat(...parts);
  }

  function genericDoc(s: GenericStatement, ctx: Ctx): Doc {
    return smartJoinTokens(s.tokens, ctx);
  }

  // --- DDL (create table / drop table) ------------------------------------
  //
  // Style derived from the hand-written DDL corpus (49 files surveyed):
  // one column per line, single space between name/type/comment (49-file
  // majority — only 1 file pads for alignment, so canonical does NOT align),
  // `) comment '...'` shares the closing-paren line, every tail clause on its
  // own line with `outputformat` split onto a continuation line. Column lines
  // are exempt from lineWidth: comment strings are atomic and the corpus
  // keeps 200+ char comment lines intact. Indent unit follows the profile
  // (calibration question: hand DDL corpus uses 2 spaces, profile is 4).

  /** Type token run: `decimal(18, 2)`, `array<struct<a:string>>`. Wordy
   *  tokens get the dataTypeCase policy; space only between two wordy
   *  tokens and after commas — everything else glues tight. */
  function typeRunDoc(tokens: Token[], ctx: Ctx): Doc {
    const parts: Doc[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!;
      const prev = tokens[i - 1];
      if (prev) {
        const wordy = (x: Token): boolean => x.kind === "keyword" || x.kind === "identifier";
        if (prev.kind === "comma" || (wordy(prev) && wordy(t))) parts.push(text(" "));
      }
      const isWordy = t.kind === "keyword" || t.kind === "identifier";
      parts.push(isWordy ? ctx.typeTok(t) : ctx.raw(t));
    }
    return concat(...parts);
  }

  function columnDefDoc(c: ColumnDef, ctx: Ctx): Doc {
    const parts: Doc[] = [ctx.raw(c.nameToken), text(" "), typeRunDoc(c.typeTokens, ctx)];
    if (c.comment) {
      parts.push(text(" "), ctx.kw(c.comment.commentToken), text(" "), ctx.raw(c.comment.valueToken));
    }
    return concat(...parts);
  }

  /** `(a string comment 'x', b string)` — inline; used for partitioned by. */
  function columnListInlineDoc(l: ColumnList, ctx: Ctx): Doc {
    return concat(
      text("("),
      join(
        text(", "),
        l.columns.map((c) => columnDefDoc(c, ctx)),
      ),
      text(")"),
    );
  }

  function createTableDoc(s: CreateTableStatement, ctx: Ctx): Doc {
    const parts: Doc[] = [kwRun(s.introTokens, ctx), text(" "), ep.nameDoc(s.nameTokens, ctx)];

    if (s.like) {
      parts.push(
        text(" "),
        ctx.kw(s.like.likeToken),
        text(" "),
        ep.nameDoc(s.like.sourceNameTokens, ctx),
      );
      return concat(...parts);
    }

    if (s.asQuery) {
      parts.push(
        text(" "),
        ctx.kw(s.asQuery.asToken),
        hardline(),
        selectStatementDoc(s.asQuery.source, ctx),
      );
      return concat(...parts);
    }

    if (!s.columnList) throw new Error("CREATE TABLE has no modeled definition");
    const columnList = s.columnList;
    parts.push(text(" ("));
    const cols = columnList.columns.map((c, i) =>
      i < columnList.columns.length - 1 ? concat(columnDefDoc(c, ctx), text(",")) : columnDefDoc(c, ctx),
    );
    parts.push(indent(concat(hardline(), join(hardline(), cols))), hardline(), text(")"));
    if (s.tableComment) {
      parts.push(text(" "), ctx.kw(s.tableComment.commentToken), text(" "), ctx.raw(s.tableComment.valueToken));
    }
    if (s.partitionedBy) {
      parts.push(hardline(), kwRun(s.partitionedBy.introTokens, ctx), text(" "), columnListInlineDoc(s.partitionedBy.columnList, ctx));
    }
    if (s.rowFormat) parts.push(hardline(), smartJoinTokens(s.rowFormat, ctx));
    if (s.storedAs) {
      const splitAt = s.storedAs.findIndex((t) => t.upper === "OUTPUTFORMAT");
      if (splitAt > 0) {
        parts.push(hardline(), smartJoinTokens(s.storedAs.slice(0, splitAt), ctx));
        parts.push(hardline(), smartJoinTokens(s.storedAs.slice(splitAt), ctx));
      } else {
        parts.push(hardline(), smartJoinTokens(s.storedAs, ctx));
      }
    }
    if (s.location) parts.push(hardline(), smartJoinTokens(s.location, ctx));
    if (s.tblProperties) parts.push(hardline(), smartJoinTokens(s.tblProperties, ctx));
    return concat(...parts);
  }

  function dropTableDoc(s: DropTableStatement, ctx: Ctx): Doc {
    const parts: Doc[] = [kwRun(s.introTokens, ctx), text(" "), ep.nameDoc(s.nameTokens, ctx)];
    if (s.purgeToken) parts.push(text(" "), ctx.kw(s.purgeToken));
    return concat(...parts);
  }

  function statementDoc(s: StatementNode, ctx: Ctx): Doc {
    let body: Doc;
    switch (s.kind) {
      case "selectStatement":
        body = selectStatementDoc(s, ctx);
        break;
      case "insertStatement":
        body = insertDoc(s, ctx);
        break;
      case "multiInsertStatement":
        body = multiInsertDoc(s, ctx);
        break;
      case "setStatement":
        body = setStatementDoc(s, ctx);
        break;
      case "genericStatement":
        body = genericDoc(s, ctx);
        break;
      case "createTableStatement":
        body = createTableDoc(s, ctx);
        break;
      case "dropTableStatement":
        body = dropTableDoc(s, ctx);
        break;
      case "unsupportedStatement":
      case "unknownStatement":
        // Coverage gate prevents reaching here; defensive raw join.
        body = smartJoinTokens(s.tokens, ctx);
        break;
    }
    if (s.semicolon) body = concat(body, ctx.raw(s.semicolon));
    return body;
  }

  /** Earliest token of a statement, for blank-line preservation. */
  function firstThingBlankLine(s: unknown): boolean {
    const best = earliestToken(s);
    if (!best) return false;
    // When leading comments exist, the token emitter already renders their
    // blankLineBefore; adding another here would double the blank line.
    if (best.leadingComments.length > 0) return false;
    return best.blankLineBefore;
  }

  function printFile(file: SqlFile, ctx: Ctx): Doc {
    const parts: Doc[] = [];
    file.statements.forEach((s, i) => {
      if (i > 0) {
        parts.push(hardline());
        if (firstThingBlankLine(s)) parts.push(hardline());
      }
      parts.push(statementDoc(s, ctx));
    });
    for (const c of file.eof.leadingComments) {
      if (parts.length > 0) parts.push(hardline());
      if (c.blankLineBefore) parts.push(hardline());
      parts.push(text(c.text));
    }
    return concat(...parts);
  }

  void self;
  return { printFile, printQueryExpr };
}
