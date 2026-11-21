import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { Adapter, RunOutput, ToolCall } from "../types.ts";

const MAX_RAW_BYTES = 65536;

const INVISIBLE = new Set([
  0x200b, 0x200c, 0x200d, 0xfeff, 0x2060, 0x202a, 0x202b, 0x202c, 0x202d,
  0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
]);

type Policy = {
  trimIdentifiers: boolean;
  repairTrailingCommas: boolean;
  rejectDuplicateKeys: boolean;
  executeTruncatedJson: boolean;
  jailPaths: boolean;
  honorAbort: boolean;
  executeToolCallFoundInResult: boolean;
  maxRawBytes: number | null;
};

type Parsed = { ok: true; call: ToolCall } | { ok: false; reason: string };

const naivePolicy: Policy = {
  trimIdentifiers: false,
  repairTrailingCommas: false,
  rejectDuplicateKeys: false,
  executeTruncatedJson: true,
  jailPaths: false,
  honorAbort: false,
  executeToolCallFoundInResult: true,
  maxRawBytes: null,
};

const hardenedPolicy: Policy = {
  trimIdentifiers: true,
  repairTrailingCommas: true,
  rejectDuplicateKeys: true,
  executeTruncatedJson: false,
  jailPaths: true,
  honorAbort: true,
  executeToolCallFoundInResult: false,
  maxRawBytes: MAX_RAW_BYTES,
};

export const referenceNaive: Adapter = {
  name: "reference-naive",
  run(input) {
    return Promise.resolve(
      executePayload(input.raw, input.sandboxDir, input.aborted, naivePolicy),
    );
  },
};

export const referenceHardened: Adapter = {
  name: "reference-hardened",
  run(input) {
    return Promise.resolve(
      executePayload(
        input.raw,
        input.sandboxDir,
        input.aborted,
        hardenedPolicy,
      ),
    );
  },
};

export const adapters: readonly Adapter[] = [referenceNaive, referenceHardened];

function executePayload(
  raw: string,
  sandboxDir: string,
  aborted: boolean,
  policy: Policy,
): RunOutput {
  if (policy.honorAbort && aborted) {
    return {
      status: "refused",
      reason: "stream aborted before the tool call finished",
    };
  }
  if (
    policy.maxRawBytes !== null &&
    Buffer.byteLength(raw) > policy.maxRawBytes
  ) {
    return {
      status: "refused",
      reason: `argument exceeds ${policy.maxRawBytes} bytes`,
    };
  }
  const parsed = raw.trimStart().startsWith("<")
    ? parseXml(raw)
    : parseJson(raw, policy);
  if (!parsed.ok) return { status: "refused", reason: parsed.reason };
  const call = applyTrim(parsed.call, policy);
  const executed = executeCall(call, sandboxDir, policy.jailPaths);
  if (
    executed.status === "executed" &&
    policy.executeToolCallFoundInResult &&
    executed.call.name === "read_file"
  ) {
    const followUp = toolCallInText(executed.result);
    if (followUp) return executeCall(followUp, sandboxDir, policy.jailPaths);
  }
  return executed;
}

function applyTrim(call: ToolCall, policy: Policy): ToolCall {
  if (!policy.trimIdentifiers) return call;
  const args: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(call.arguments)) {
    const identifier = key === "path" || key === "encoding" || key === "mode";
    args[key] = identifier && typeof value === "string" ? value.trim() : value;
  }
  return { name: call.name, arguments: args };
}

function parseXml(raw: string): Parsed {
  const root = /^<([a-z0-9_]+)>\n?([\s\S]*)<\/\1>\s*$/.exec(raw.trim());
  const name = root?.[1];
  const body = root?.[2];
  if (!name || body === undefined) return { ok: false, reason: "invalid XML" };
  const args: Record<string, unknown> = {};
  const child = /<([a-z0-9_]+)>([\s\S]*?)<\/\1>/g;
  for (const match of body.matchAll(child)) {
    const key = match[1];
    const value = match[2];
    if (!key || value === undefined) continue;
    args[key] = value;
  }
  return { ok: true, call: { name, arguments: args } };
}

function parseJson(raw: string, policy: Policy): Parsed {
  if (policy.rejectDuplicateKeys && duplicateArgumentKey(raw)) {
    return { ok: false, reason: "duplicate key" };
  }
  const direct = tryParseCall(raw);
  if (direct.ok) return direct;
  if (policy.repairTrailingCommas) {
    const repaired = tryParseCall(raw.replace(/,\s*([}\]])/g, "$1"));
    if (repaired.ok) return repaired;
    return { ok: false, reason: "truncated or invalid JSON" };
  }
  if (policy.executeTruncatedJson && !raw.trimEnd().endsWith("}")) {
    return parseTruncated(raw);
  }
  return { ok: false, reason: "invalid JSON" };
}

function parseTruncated(raw: string): Parsed {
  const name = /"name"\s*:\s*"([^"]+)"/.exec(raw)?.[1];
  const pathValue = /"path"\s*:\s*"([^"]*)"/.exec(raw)?.[1];
  if (!name || pathValue === undefined)
    return { ok: false, reason: "truncated or invalid JSON" };
  const args: Record<string, unknown> = { path: pathValue };
  const content = /"content"\s*:\s*"([^"]*)"/.exec(raw)?.[1];
  if (content !== undefined) args.content = content;
  return { ok: true, call: { name, arguments: args } };
}

function tryParseCall(raw: string): Parsed {
  try {
    return callFromValue(parseUnknown(raw));
  } catch {
    return { ok: false, reason: "invalid JSON" };
  }
}

function parseUnknown(raw: string): unknown {
  return JSON.parse(raw);
}

function callFromValue(value: unknown): Parsed {
  if (typeof value !== "object" || value === null) {
    return { ok: false, reason: "truncated or invalid JSON" };
  }
  if (!("name" in value) || !("arguments" in value)) {
    return { ok: false, reason: "truncated or invalid JSON" };
  }
  const name = value.name;
  const args = value.arguments;
  if (
    typeof name !== "string" ||
    typeof args !== "object" ||
    args === null ||
    Array.isArray(args)
  ) {
    return { ok: false, reason: "truncated or invalid JSON" };
  }
  const argumentsRecord: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(args)) {
    argumentsRecord[key] = entry;
  }
  return { ok: true, call: { name, arguments: argumentsRecord } };
}

function duplicateArgumentKey(json: string): boolean {
  const marker = '"arguments"';
  const argsAt = json.indexOf(marker);
  if (argsAt < 0) return false;
  const start = json.indexOf("{", argsAt + marker.length);
  if (start < 0) return false;
  const keys: string[] = [];
  let depth = 0;
  let index = start;
  while (index < json.length) {
    const char = json[index];
    if (char === '"') {
      const text = readString(json, index);
      if (!text) return false;
      let cursor = text.next;
      while (cursor < json.length && isSpace(json[cursor])) cursor += 1;
      if (depth === 1 && json[cursor] === ":") keys.push(text.value);
      index = text.next;
      continue;
    }
    if (char === "{") {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) break;
      index += 1;
      continue;
    }
    index += 1;
  }
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

function toolCallInText(text: string): ToolCall | null {
  const start = text.indexOf('{"name":');
  if (start < 0) return null;
  const slice = matchObject(text, start);
  if (!slice) return null;
  const parsed = tryParseCall(slice);
  return parsed.ok ? parsed.call : null;
}

function matchObject(text: string, start: number): string | null {
  if (text[start] !== "{") return null;
  let depth = 0;
  let index = start;
  while (index < text.length) {
    const char = text[index];
    if (char === '"') {
      const token = readString(text, index);
      if (!token) return null;
      index = token.next;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
    index += 1;
  }
  return null;
}

function readString(
  json: string,
  start: number,
): { value: string; next: number } | null {
  if (json[start] !== '"') return null;
  let value = "";
  let index = start + 1;
  while (index < json.length) {
    const char = json[index];
    if (char === "\\") {
      const escaped = json[index + 1];
      if (escaped === undefined) return null;
      if (escaped === "u") {
        const hex = json.slice(index + 2, index + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;
        value += String.fromCharCode(Number.parseInt(hex, 16));
        index += 6;
        continue;
      }
      const mapped = escapedChar(escaped);
      if (mapped === null) return null;
      value += mapped;
      index += 2;
      continue;
    }
    if (char === '"') return { value, next: index + 1 };
    if (char === undefined) return null;
    value += char;
    index += 1;
  }
  return null;
}

function escapedChar(escaped: string): string | null {
  if (escaped === '"') return '"';
  if (escaped === "\\") return "\\";
  if (escaped === "/") return "/";
  if (escaped === "b") return "\b";
  if (escaped === "f") return "\f";
  if (escaped === "n") return "\n";
  if (escaped === "r") return "\r";
  if (escaped === "t") return "\t";
  return null;
}

function hasInvisible(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code !== undefined && INVISIBLE.has(code)) return true;
  }
  return false;
}

function isSpace(char: string | undefined): boolean {
  return char === " " || char === "\n" || char === "\r" || char === "\t";
}

function executeCall(
  call: ToolCall,
  sandboxDir: string,
  jail: boolean,
): RunOutput {
  if (call.name !== "read_file" && call.name !== "write_file") {
    return { status: "refused", reason: "unknown tool" };
  }
  const userPath = call.arguments.path;
  if (typeof userPath !== "string")
    return { status: "refused", reason: "missing argument" };
  if (
    call.name === "write_file" &&
    typeof call.arguments.content !== "string"
  ) {
    return { status: "refused", reason: "missing argument" };
  }
  const encoding = call.arguments.encoding;
  if (
    encoding !== undefined &&
    (typeof encoding !== "string" || encoding.trim() !== "utf-8")
  ) {
    return { status: "refused", reason: "encoding not allowed" };
  }
  const resolved = resolveUserPath(sandboxDir, userPath, jail);
  if (typeof resolved !== "string") return resolved;
  if (call.name === "read_file") {
    if (!existsSync(resolved) || !statSync(resolved).isFile()) {
      return { status: "executed", call, result: "error: not found" };
    }
    return { status: "executed", call, result: readFileSync(resolved, "utf8") };
  }
  const content = call.arguments.content;
  if (typeof content !== "string")
    return { status: "refused", reason: "missing argument" };
  writeFileSync(resolved, content, "utf8");
  return { status: "executed", call, result: "wrote" };
}

function isOutside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  if (path.isAbsolute(relative)) return true;
  return relative === ".." || relative.startsWith(`..${path.sep}`);
}

function resolveUserPath(
  workspace: string,
  userPath: string,
  jail: boolean,
): string | RunOutput {
  if (!jail) return path.resolve(workspace, userPath);
  if (hasInvisible(userPath)) {
    return { status: "refused", reason: "path contains invisible characters" };
  }
  if (path.isAbsolute(userPath))
    return { status: "refused", reason: "absolute path rejected" };
  if (userPath.split(/[\\/]/).includes("..")) {
    return { status: "refused", reason: "parent segment rejected" };
  }
  const resolved = path.resolve(workspace, userPath);
  if (isOutside(workspace, resolved)) {
    return { status: "refused", reason: "path escapes workspace" };
  }
  const realWorkspace = realpathSync(workspace);
  const anchor = existsSync(resolved) ? resolved : path.dirname(resolved);
  if (existsSync(anchor)) {
    const realAnchor = realpathSync(anchor);
    if (isOutside(realWorkspace, realAnchor)) {
      return { status: "refused", reason: "symlink escapes workspace" };
    }
  }
  return resolved;
}
