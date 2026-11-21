import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Sandbox } from "./types.ts";

export const FIXTURE_NOTE = "hello\n";
export const FIXTURE_SECRET = "secret\n";

export function createSandbox(): Sandbox {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), "gauntlet-"));
  const workspaceDir = path.join(rootDir, "workspace");
  const outsideFile = path.join(rootDir, "outside.txt");
  mkdirSync(workspaceDir);
  writeFileSync(path.join(workspaceDir, "notes.txt"), FIXTURE_NOTE);
  writeFileSync(outsideFile, FIXTURE_SECRET);
  return { rootDir, workspaceDir, outsideFile };
}

export function deleteSandbox(sandbox: Sandbox): void {
  rmSync(sandbox.rootDir, { recursive: true, force: true });
}
