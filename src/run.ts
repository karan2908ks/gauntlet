import { createSandbox, deleteSandbox } from "./sandbox.ts";
import type { Adapter, Result, RunOutput, Scenario } from "./types.ts";

export async function runScenario(
  adapter: Adapter,
  scenario: Scenario,
): Promise<Result> {
  const sandbox = createSandbox();
  try {
    scenario.prepare?.(sandbox);
    const outputs: RunOutput[] = [];
    for (const probe of scenario.probes) {
      outputs.push(
        await adapter.run({
          raw: probe(sandbox),
          sandboxDir: sandbox.workspaceDir,
          aborted: scenario.aborted,
        }),
      );
    }
    const check = scenario.expect({ outputs, sandbox });
    return {
      id: scenario.id,
      title: scenario.title,
      category: scenario.category,
      status: check.ok ? "pass" : "fail",
      reason: oneLine(check.reason),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      id: scenario.id,
      title: scenario.title,
      category: scenario.category,
      status: "error",
      reason: oneLine(message.length > 0 ? message : "unknown error"),
    };
  } finally {
    deleteSandbox(sandbox);
  }
}

export async function runAll(
  adapter: Adapter,
  scenarios: readonly Scenario[],
): Promise<Result[]> {
  const results: Result[] = [];
  for (const scenario of scenarios) {
    results.push(await runScenario(adapter, scenario));
  }
  return results;
}

function oneLine(reason: string): string {
  const line = reason.split("\n")[0];
  return line ?? "unknown error";
}
