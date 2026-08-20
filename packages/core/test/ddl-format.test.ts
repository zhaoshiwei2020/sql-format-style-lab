import { describe, expect, it } from "vitest";

import { formatSql } from "../src/format.js";

describe("CREATE TABLE LIKE / CTAS formatting", () => {
  it("keeps CREATE TABLE LIKE on one canonical line", () => {
    const outcome = formatSql(
      "CREATE TABLE IF NOT EXISTS style_lab.result_fd LIKE style_lab.source_fd;",
    );

    expect(outcome.state).toBe("VALID_SUPPORTED");
    expect(outcome.diagnostics).toEqual([]);
    expect(outcome.output).toBe(
      "create table if not exists style_lab.result_fd like style_lab.source_fd;\n",
    );
  });

  it("breaks before the SELECT body of CREATE TEMPORARY TABLE AS", () => {
    const outcome = formatSql(
      "CREATE TEMPORARY TABLE style_lab.result_tmp AS " +
        "SELECT a,b FROM style_lab.source_fm WHERE dt='2026-08-19';",
    );

    expect(outcome.state).toBe("VALID_SUPPORTED");
    expect(outcome.diagnostics).toEqual([]);
    expect(outcome.output).toBe(
      "create temporary table style_lab.result_tmp as\n" +
        "select\n" +
        "    a,\n" +
        "    b\n" +
        "from style_lab.source_fm\n" +
        "where dt = '2026-08-19';\n",
    );
  });

  it("formats a WITH query under CTAS without weakening query coverage", () => {
    const outcome = formatSql(
      "create table style_lab.result_fd as with s as " +
        "(select id from style_lab.source_fd) select id from s;",
    );

    expect(outcome.state).toBe("VALID_SUPPORTED");
    expect(outcome.diagnostics).toEqual([]);
    expect(outcome.output).toBe(
      "create table style_lab.result_fd as\n" +
        "with s as (\n" +
        "    select id\n" +
        "    from style_lab.source_fd\n" +
        ")\n" +
        "select id\n" +
        "from s;\n",
    );
  });
});
