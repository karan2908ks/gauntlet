# Contributing

Issues and pull requests are welcome. A useful change is one scenario or one adapter, with a test that shows the new behavior.

## Checks

Node 22 and pnpm are required.

```
pnpm install
pnpm lint
pnpm typecheck
pnpm test
```

`pnpm exec gauntlet run --adapter reference-naive` exits 1. That is the naive adapter failing the suite. `reference-hardened` exits 0.

## Add a scenario

Add an object to the `scenarios` array in `src/scenarios.ts`.

Give it an id, a title, a category, and a one-line summary that names the failure. `probes` returns the raw model output. `expect` reads the adapter output and the sandbox, and returns `{ ok, reason }`. `reason` is one line.

`reference-naive` should fail the new scenario. `reference-hardened` should pass it. Extend the policy object in `src/adapters/reference.ts` when the new case is another switch on the same executor. Add a third adapter only when the case is a different parser.

The test in `test/scenarios.test.ts` already runs every scenario against both adapters. Update it if the naive adapter should pass the new case.

## Add an adapter

Implement the `Adapter` type and append it to the `adapters` array in `src/adapters/reference.ts`. Move that array out of the reference file if a second module needs to register there.

```ts
const mine: Adapter = {
  name: "my-agent",
  async run({ raw, sandboxDir, aborted }) {
    if (aborted) return { status: "refused", reason: "stream aborted" };
    const call = parse(raw);
    if (!call) return { status: "refused", reason: "could not parse" };
    return executeInside(sandboxDir, call);
  },
};
```

Gauntlet does not parse the payload before your adapter sees it. `run` receives the raw string, the workspace directory, and whether the stream aborted. Return `executed` with the tool call and the tool result, or `refused` with a one-line reason.

The reference adapters understand two fixture shapes used by the built-in scenarios. XML is a root tag whose child elements are the arguments. JSON is `{"name":"tool","arguments":{...}}`. A real adapter can ignore both and parse whatever its agent emits. The scenario check only looks at the returned call and at files inside the sandbox.

Three adapters are intentionally not in v0.1. Open an issue before starting one.

- An XML tool-call parser, the Nano-Collective/nanocoder failure class.
- An OpenAI or Anthropic function-call JSON layer.
- An MCP filesystem server.

## Sandbox

The runner creates the temp directory. The adapter may only touch `sandboxDir`.
