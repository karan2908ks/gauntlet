import type { Result } from "./types.ts";

type ListRow = {
  id: string;
  category: string;
  summary: string;
};

export function formatList(scenarios: readonly ListRow[]): string {
  const rows = scenarios.map((scenario) => [
    scenario.id,
    scenario.category,
    scenario.summary,
  ]);
  return `${renderTable(rows, ["id", "category", "summary"])}\n`;
}

export function formatRun(
  adapterName: string,
  results: readonly Result[],
): string {
  const rows = results.map((result) => [
    result.id,
    result.category,
    result.status,
    result.reason,
  ]);
  const table = renderTable(rows, ["scenario", "category", "status", "reason"]);
  return `adapter: ${adapterName}\n\n${table}\n\n${summaryLine(results)}\n`;
}

export function formatJson(
  adapterName: string,
  results: readonly Result[],
): string {
  const report = {
    adapter: adapterName,
    results: results.map((result) => ({
      id: result.id,
      title: result.title,
      category: result.category,
      status: result.status,
      reason: result.reason,
    })),
    summary: count(results),
  };
  return `${JSON.stringify(report, null, 2)}\n`;
}

function summaryLine(results: readonly Result[]): string {
  const totals = count(results);
  return `${totals.pass} passed, ${totals.fail} failed, ${totals.error} errors`;
}

function count(results: readonly Result[]): {
  pass: number;
  fail: number;
  error: number;
} {
  let pass = 0;
  let fail = 0;
  let error = 0;
  for (const result of results) {
    if (result.status === "pass") pass += 1;
    else if (result.status === "fail") fail += 1;
    else error += 1;
  }
  return { pass, fail, error };
}

function renderTable(
  rows: readonly (readonly string[])[],
  headers: readonly string[],
): string {
  const widths = headers.map((header, index) => {
    let width = header.length;
    for (const row of rows) {
      const cell = row[index] ?? "";
      if (cell.length > width) width = cell.length;
    }
    return width;
  });
  const render = (row: readonly string[]) =>
    row
      .map((cell, index) => cell.padEnd(widths[index] ?? cell.length))
      .join("  ")
      .trimEnd();
  return [render(headers), ...rows.map((row) => render(row))].join("\n");
}
