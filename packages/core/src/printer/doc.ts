/**
 * Doc IR (ARCHITECTURE.md §7.3) and the layout renderer.
 *
 * Semantics:
 * - group: rendered flat if its flat form fits the remaining width and it
 *   contains no hard line; otherwise its soft lines become newlines.
 *   Nested groups are decided independently → outermost-first expansion
 *   falls out naturally (§7.4 innerBeforeOuterBreakPenalty).
 * - choice: ordered alternatives; the first whose FULL rendering stays within
 *   the line width wins, else the last one. Used where the broken layout is
 *   structurally different from the flat one (e.g. CASE WHEN arms).
 * - line soft: `flat` text (default " ") when flat, newline when broken.
 * - line hard: always a newline; forces every enclosing group to break.
 */

export type Doc =
  | { kind: "text"; value: string }
  | { kind: "concat"; parts: Doc[] }
  | { kind: "line"; mode: "soft" | "hard" | "fresh"; flat: string }
  | { kind: "indent"; by: number; content: Doc }
  | { kind: "group"; content: Doc }
  | { kind: "choice"; alternatives: Doc[] }
  | { kind: "ifBreak"; broken: Doc; flat: Doc }
  /**
   * Deferred end-of-line text: buffered and flushed immediately before the
   * next emitted newline (or at end of render). Zero-width for both the fit
   * test and column accounting — trailing `--` comments ride here so they can
   * neither force a break of the code they annotate nor be pushed off their
   * line by a synthesized separator (`,` lands before the comment).
   */
  | { kind: "lineSuffix"; content: string }
  /**
   * Zero-width, renders nothing, but counts as a hard line for the fit test
   * and for containsHardLine — forces every enclosing group to lay out
   * broken. Paired with lineSuffix for trailing line comments: the comment
   * must not swallow following same-line code, so the surrounding layout has
   * to provide a newline soon after.
   */
  | { kind: "breakParent" }
  /**
   * Renders its content forcibly flat (soft lines become their flat text) and
   * marks the layout unacceptable if a hard line occurs inside. Used for
   * choice alternatives that must be genuinely single-line (e.g. a compact
   * CASE WHEN arm), so an internally-broken rendering can't masquerade as
   * "flat".
   */
  | { kind: "flatOnly"; content: Doc };

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export const text = (value: string): Doc => ({ kind: "text", value });
export const concat = (...parts: (Doc | string)[]): Doc => ({
  kind: "concat",
  parts: parts.map((p) => (typeof p === "string" ? text(p) : p)),
});
export const softline = (flat = " "): Doc => ({ kind: "line", mode: "soft", flat });
/** Soft line that renders as nothing when flat (before closing parens). */
export const softline0 = (): Doc => softline("");
export const hardline = (): Doc => ({ kind: "line", mode: "hard", flat: "\n" });
/** Newline only if the current line already carries content (never blank). */
export const freshline = (): Doc => ({ kind: "line", mode: "fresh", flat: "\n" });
export const lineSuffix = (content: string): Doc => ({ kind: "lineSuffix", content });
export const breakParent = (): Doc => ({ kind: "breakParent" });
export const indent = (content: Doc, by = 1): Doc => ({ kind: "indent", by, content });
export const group = (content: Doc): Doc => ({ kind: "group", content });
export const choice = (...alternatives: Doc[]): Doc => ({ kind: "choice", alternatives });
export const ifBreak = (broken: Doc | string, flat: Doc | string = text("")): Doc => ({
  kind: "ifBreak",
  broken: typeof broken === "string" ? text(broken) : broken,
  flat: typeof flat === "string" ? text(flat) : flat,
});
export const flatOnly = (content: Doc): Doc => ({ kind: "flatOnly", content });

export function join(separator: Doc, items: Doc[]): Doc {
  const parts: Doc[] = [];
  items.forEach((item, i) => {
    if (i > 0) parts.push(separator);
    parts.push(item);
  });
  return { kind: "concat", parts };
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export interface RenderOptions {
  lineWidth: number;
  indentSize: number;
}

interface Frame {
  doc: Doc;
  indentLevel: number;
  mode: "flat" | "break";
  /** Inside a flatOnly region: hard lines are layout violations. */
  strict?: boolean;
}

/** Does `first` (then the rest of the stack) fit flat in `remaining` columns? */
function fits(first: Frame, stack: Frame[], remaining: number): boolean {
  const work: Frame[] = [first];
  let stackIdx = stack.length;
  let rem = remaining;
  while (rem >= 0) {
    const frame = work.pop() ?? (stackIdx > 0 ? stack[--stackIdx] : undefined);
    if (!frame) return true;
    const { doc, indentLevel, mode } = frame;
    switch (doc.kind) {
      case "text":
        rem -= doc.value.length;
        break;
      case "concat":
        for (let i = doc.parts.length - 1; i >= 0; i--) {
          work.push({ doc: doc.parts[i]!, indentLevel, mode });
        }
        break;
      case "line":
        if (doc.mode === "hard" || doc.mode === "fresh") {
          // A hard line inside flat content forces the group to break;
          // in break-mode content that follows, the line ends → fits.
          return mode === "break";
        }
        if (mode === "break") return true; // reached a break point → line ends
        rem -= doc.flat.length;
        break;
      case "lineSuffix":
        break; // deferred text is width-exempt
      case "breakParent":
        return mode === "break"; // same as a hard line, minus the newline
      case "indent":
        work.push({ doc: doc.content, indentLevel: indentLevel + doc.by, mode });
        break;
      case "group":
        // Measure nested groups flat for the fit test.
        work.push({ doc: doc.content, indentLevel, mode: "flat" });
        break;
      case "choice":
        // Fit test measures the most compact alternative.
        work.push({ doc: doc.alternatives[0]!, indentLevel, mode: "flat" });
        break;
      case "ifBreak":
        work.push({ doc: mode === "break" ? doc.broken : doc.flat, indentLevel, mode });
        break;
      case "flatOnly":
        work.push({ doc: doc.content, indentLevel, mode: "flat" });
        break;
    }
  }
  return false;
}

interface RenderState {
  out: string[];
  col: number;
  maxColExceeded: boolean;
  /** Deferred lineSuffix texts, flushed just before the next newline. */
  suffix: string[];
  /** Non-whitespace has been emitted on the current line. */
  lineHasContent: boolean;
  /** Consecutive newlines since the last content (2 = one blank line). */
  newlineRun: number;
}

function pushText(state: RenderState, value: string, countWidth: boolean, opts: RenderOptions): void {
  state.out.push(value);
  if (countWidth) {
    state.col += value.length;
    if (state.col > opts.lineWidth) state.maxColExceeded = true;
  }
  if (/\S/.test(value)) {
    state.lineHasContent = true;
    state.newlineRun = 0;
  }
}

function flushSuffix(state: RenderState): void {
  for (const s of state.suffix) {
    state.out.push(s);
    if (/\S/.test(s)) {
      state.lineHasContent = true;
      state.newlineRun = 0;
    }
  }
  state.suffix = [];
}

function renderInto(root: Frame, opts: RenderOptions, state: RenderState): void {
  const stack: Frame[] = [root];
  while (stack.length > 0) {
    const frame = stack.pop()!;
    const { doc, indentLevel, mode, strict } = frame;
    switch (doc.kind) {
      case "text":
        pushText(state, doc.value, true, opts);
        break;
      case "lineSuffix":
        state.suffix.push(doc.content);
        break;
      case "breakParent":
        if (strict) state.maxColExceeded = true; // cannot stay flat
        break;
      case "concat":
        for (let i = doc.parts.length - 1; i >= 0; i--) {
          stack.push({ doc: doc.parts[i]!, indentLevel, mode, strict });
        }
        break;
      case "line":
        if (strict && (doc.mode === "hard" || doc.mode === "fresh")) {
          // A hard line inside a flat-only region: keep the line flat and
          // mark the layout unacceptable so the choice rejects it.
          state.maxColExceeded = true;
          state.out.push(" ");
          state.col += 1;
          break;
        }
        if (doc.mode === "hard" || doc.mode === "fresh" || mode === "break") {
          const ind = " ".repeat(indentLevel * opts.indentSize);
          if (!state.lineHasContent && (doc.mode === "fresh" || state.newlineRun >= 2)) {
            // fresh on an empty line is a no-op; a hard line that would open
            // a second consecutive blank line is capped. Either way, re-aim
            // the pending indent at this frame's level.
            const last = state.out.length - 1;
            if (last >= 0 && /^\n[ \t]*$/.test(state.out[last]!)) {
              state.out[last] = "\n" + ind;
              state.col = ind.length;
            }
            break;
          }
          flushSuffix(state);
          // Trim trailing spaces on the finished line.
          const last = state.out.length - 1;
          if (last >= 0) state.out[last] = state.out[last]!.replace(/[ \t]+$/, "");
          state.out.push("\n" + ind);
          state.col = ind.length;
          state.newlineRun += 1;
          state.lineHasContent = false;
        } else {
          pushText(state, doc.flat, true, opts);
        }
        break;
      case "indent":
        stack.push({ doc: doc.content, indentLevel: indentLevel + doc.by, mode, strict });
        break;
      case "group": {
        if (strict) {
          stack.push({ doc: doc.content, indentLevel, mode: "flat", strict });
          break;
        }
        const flatFrame: Frame = { doc: doc.content, indentLevel, mode: "flat" };
        const useFlat = fits(flatFrame, stack, opts.lineWidth - state.col);
        stack.push({ doc: doc.content, indentLevel, mode: useFlat ? "flat" : "break" });
        break;
      }
      case "choice": {
        let chosen = doc.alternatives[doc.alternatives.length - 1]!;
        for (let i = 0; i < doc.alternatives.length - 1; i++) {
          const alt = doc.alternatives[i]!;
          const trial: RenderState = {
            out: [],
            col: state.col,
            maxColExceeded: false,
            suffix: [],
            lineHasContent: state.lineHasContent,
            newlineRun: state.newlineRun,
          };
          renderInto({ doc: alt, indentLevel, mode: strict ? "flat" : "break", strict }, opts, trial);
          if (!trial.maxColExceeded) {
            chosen = alt;
            break;
          }
        }
        stack.push({ doc: chosen, indentLevel, mode: strict ? "flat" : "break", strict });
        break;
      }
      case "ifBreak":
        stack.push({ doc: mode === "break" ? doc.broken : doc.flat, indentLevel, mode, strict });
        break;
      case "flatOnly":
        stack.push({ doc: doc.content, indentLevel, mode: "flat", strict: true });
        break;
    }
  }
}

export function render(doc: Doc, opts: RenderOptions): string {
  const state: RenderState = {
    out: [],
    col: 0,
    maxColExceeded: false,
    suffix: [],
    lineHasContent: false,
    // Start "as if" a blank line was just emitted: leading hard lines
    // (e.g. blankLineBefore trivia on the first token) are capped away, so
    // output never opens with blank lines.
    newlineRun: 2,
  };
  renderInto({ doc, indentLevel: 0, mode: "break" }, opts, state);
  flushSuffix(state);
  // Normalize: no trailing spaces, single trailing newline.
  const textOut = state.out.join("");
  return (
    textOut
      .split("\n")
      .map((l) => l.replace(/[ \t]+$/, ""))
      .join("\n")
      .replace(/^\n+/, "")
      .replace(/\n+$/, "") + "\n"
  );
}

/** True if a doc contains a hard line (used to pre-force enclosing layouts). */
export function containsHardLine(doc: Doc): boolean {
  switch (doc.kind) {
    case "text":
      return false;
    case "lineSuffix":
      return false;
    case "breakParent":
      return true;
    case "line":
      return doc.mode === "hard" || doc.mode === "fresh";
    case "concat":
      return doc.parts.some(containsHardLine);
    case "indent":
      return containsHardLine(doc.content);
    case "group":
      return containsHardLine(doc.content);
    case "choice":
      // A choice's compact alternative decides whether it can stay flat.
      return containsHardLine(doc.alternatives[0]!);
    case "ifBreak":
      return containsHardLine(doc.flat);
    case "flatOnly":
      // Renders single-line when accepted; a violating layout is rejected by
      // the enclosing choice, so it never forces outer breaks.
      return false;
  }
}
