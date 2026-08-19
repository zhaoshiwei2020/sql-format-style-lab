import { describe, expect, it } from "vitest";
import {
  choice,
  concat,
  group,
  hardline,
  indent,
  join,
  render,
  softline,
  softline0,
  text,
} from "../src/printer/doc.js";

const opts = { lineWidth: 20, indentSize: 4 };

describe("doc renderer", () => {
  it("keeps a fitting group flat", () => {
    const doc = group(concat(text("f("), indent(concat(softline0(), text("a,"), softline(), text("b"))), softline0(), text(")")));
    expect(render(doc, opts)).toBe("f(a, b)\n");
  });

  it("breaks a group that does not fit, args one per line", () => {
    const doc = group(
      concat(
        text("function_name("),
        indent(concat(softline0(), text("argument_one,"), softline(), text("argument_two"))),
        softline0(),
        text(")"),
      ),
    );
    expect(render(doc, opts)).toBe("function_name(\n    argument_one,\n    argument_two\n)\n");
  });

  it("outermost-first: inner group stays flat when it fits after outer breaks", () => {
    const inner = group(concat(text("g("), indent(concat(softline0(), text("x,"), softline(), text("y"))), softline0(), text(")")));
    const outer = group(
      concat(
        text("outer_function("),
        indent(concat(softline0(), inner, text(","), softline(), text("zzz"))),
        softline0(),
        text(")"),
      ),
    );
    expect(render(outer, opts)).toBe("outer_function(\n    g(x, y),\n    zzz\n)\n");
  });

  it("hard line forces enclosing group to break", () => {
    const doc = group(concat(text("a("), indent(concat(softline0(), text("-- c"), hardline(), text("b"))), softline0(), text(")")));
    const out = render(doc, opts);
    expect(out).toContain("\n");
    expect(out).toBe("a(\n    -- c\n    b\n)\n");
  });

  it("choice picks the first alternative that causes no overflow", () => {
    const flat = text("when a then b");
    const broken = concat(text("when"), indent(concat(hardline(), text("a"))), hardline(), text("then b"));
    expect(render(choice(flat, broken), opts)).toBe("when a then b\n");
    const wideFlat = text("when aaaaaaaaaaaaaaaaaaaaaaa then b");
    expect(render(choice(wideFlat, broken), opts)).toBe("when\n    a\nthen b\n");
  });

  it("choice trial respects current column", () => {
    const flat = text("0123456789");
    const broken = text("x");
    // 15 cols consumed + 10 > 20 → falls to the last alternative.
    const doc = concat(text("123456789012345"), choice(flat, broken));
    expect(render(doc, opts)).toBe("123456789012345x\n");
  });

  it("join + trailing space trimming", () => {
    const doc = concat(text("a "), hardline(), text("b"));
    expect(render(doc, opts)).toBe("a\nb\n");
  });
});
