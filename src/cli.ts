#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { adapters } from "./adapters/reference.ts";
import { formatJson, formatList, formatRun } from "./format.ts";
import { runAll } from "./run.ts";
import { scenarios } from "./scenarios.ts";
import type { Scenario } from "./types.ts";

const USAGE =
  "usage: gauntlet list | gauntlet run --adapter <name> [--scenario <id>] [--json]\n";

type RunFlags = {
  adapter: string;
  scenario: string | undefined;
  json: boolean;
};

export async function runCli(
  argv: readonly string[],
  stdout: NodeJS.WritableStream,
  stderr: NodeJS.WritableStream,
): Promise<number> {
  const command = argv[0];
  if (command === "list") {
    stdout.write(formatList(scenarios));
    return 0;
  }
  if (command !== "run") {
    stderr.write(USAGE);
    return 2;
  }
  const flags = parseRunFlags(argv.slice(1));
  if ("error" in flags) {
    stderr.write(`${flags.error}\n`);
    return 2;
  }
  const adapter = adapters.find((item) => item.name === flags.adapter);
  if (!adapter) {
    stderr.write(`unknown adapter ${flags.adapter}\n`);
    return 2;
  }
  const selected = selectScenarios(flags.scenario);
  if ("error" in selected) {
    stderr.write(`${selected.error}\n`);
    return 2;
  }
  const results = await runAll(adapter, selected.scenarios);
  stdout.write(
    flags.json
      ? formatJson(adapter.name, results)
      : formatRun(adapter.name, results),
  );
  return results.every((result) => result.status === "pass") ? 0 : 1;
}

function parseRunFlags(argv: readonly string[]): RunFlags | { error: string } {
  let adapter: string | undefined;
  let scenario: string | undefined;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--adapter" || token === "--scenario") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return { error: `missing ${token} value` };
      }
      if (token === "--adapter") adapter = value;
      else scenario = value;
      index += 1;
      continue;
    }
    return { error: `unknown argument ${token}` };
  }
  if (adapter === undefined) return { error: "missing --adapter" };
  return { adapter, scenario, json };
}

function selectScenarios(
  id: string | undefined,
): { scenarios: readonly Scenario[] } | { error: string } {
  if (id === undefined) return { scenarios };
  const match = scenarios.find((scenario) => scenario.id === id);
  if (!match) return { error: `unknown scenario ${id}` };
  return { scenarios: [match] };
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (entry === undefined || entry.length === 0) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectRun()) {
  const code = await runCli(
    process.argv.slice(2),
    process.stdout,
    process.stderr,
  );
  process.exit(code);
}
