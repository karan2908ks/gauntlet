import { spawnSync } from "node:child_process";
import path from "node:path";
import { Writable } from "node:stream";
import { expect, test } from "vitest";
import { runCli } from "../src/cli.ts";
import { scenarios } from "../src/scenarios.ts";

test("list prints every scenario id", async () => {
  const stdout = memoryStream();
  const stderr = memoryStream();
  const code = await runCli(["list"], stdout.stream, stderr.stream);
  expect(code).toBe(0);
  for (const scenario of scenarios) {
    expect(stdout.text()).toContain(scenario.id);
  }
  expect(stderr.text()).toBe("");
});

test("hardened json run passes", async () => {
  const stdout = memoryStream();
  const stderr = memoryStream();
  const code = await runCli(
    ["run", "--adapter", "reference-hardened", "--json"],
    stdout.stream,
    stderr.stream,
  );
  expect(code).toBe(0);
  const report = readReport(stdout.text());
  expect(report.summary).toEqual({ pass: scenarios.length, fail: 0, error: 0 });
  expect(stderr.text()).toBe("");
});

test("naive truncated-json run fails", async () => {
  const stdout = memoryStream();
  const stderr = memoryStream();
  const code = await runCli(
    [
      "run",
      "--adapter",
      "reference-naive",
      "--scenario",
      "truncated-json",
      "--json",
    ],
    stdout.stream,
    stderr.stream,
  );
  expect(code).toBe(1);
  const report = readReport(stdout.text());
  expect(report.results).toHaveLength(1);
  expect(report.results[0]?.status).toBe("fail");
});

test("unknown adapter exits 2", async () => {
  const stdout = memoryStream();
  const stderr = memoryStream();
  const code = await runCli(
    ["run", "--adapter", "nope"],
    stdout.stream,
    stderr.stream,
  );
  expect(code).toBe(2);
  expect(stderr.text()).toContain("unknown adapter nope");
  expect(stdout.text()).toBe("");
});

test("tsx cli list smoke", () => {
  const tsx = path.join(process.cwd(), "node_modules", ".bin", "tsx");
  const result = spawnSync(tsx, ["src/cli.ts", "list"], {
    encoding: "utf8",
    cwd: process.cwd(),
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("whitespace-padded-args");
});

function readReport(text: string): {
  summary: { pass: number; fail: number; error: number };
  results: { status: string }[];
} {
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null)
    throw new Error("report was not an object");
  if (!("summary" in value) || !("results" in value))
    throw new Error("report missing fields");
  const summary = value.summary;
  const results = value.results;
  if (
    typeof summary !== "object" ||
    summary === null ||
    !Array.isArray(results)
  ) {
    throw new Error("report had the wrong shape");
  }
  if (!("pass" in summary) || !("fail" in summary) || !("error" in summary)) {
    throw new Error("summary missing counts");
  }
  const { pass, fail, error } = summary;
  if (
    typeof pass !== "number" ||
    typeof fail !== "number" ||
    typeof error !== "number"
  ) {
    throw new Error("summary counts were not numbers");
  }
  const parsed: { status: string }[] = [];
  for (const result of results) {
    if (
      typeof result !== "object" ||
      result === null ||
      !("status" in result)
    ) {
      throw new Error("result missing status");
    }
    if (typeof result.status !== "string")
      throw new Error("status was not a string");
    parsed.push({ status: result.status });
  }
  return { summary: { pass, fail, error }, results: parsed };
}

function memoryStream(): { stream: Writable; text: () => string } {
  let body = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      body += String(chunk);
      callback();
    },
  });
  return { stream, text: () => body };
}
