# Token Economy: Keeping the Model Context Small

Interactive widgets often need to display a large payload (a full menu, a trip itinerary, a rich dataset) that would be expensive and noisy if the model had to read it on every tool call. MCP Apps gives you a clean way to route that payload directly to the widget without ever touching the model's context.

## The Problem

A naive MCP App tool returns all the data the widget needs in its result, which flows into the model's context window. For a rich UI, that payload can easily run to thousands of tokens per invocation. Multiplied across a conversation, the cost compounds quickly, and the model's context fills with rendering data it doesn't need to reason about.

In the Voygent Folio Board, the full trip projection (hotels, flights, day-by-day itinerary, advisor notes, traveler details) runs to approximately **9,155 tokens**. Returning that from the launcher tool on every board open was unacceptable.

## The Pattern: Tiny Ref + App-Only Data Tool

Split the data flow into two separate tools:

1. **The launcher tool** (`visibility: ["model", "app"]`, the default): called by the model. Returns only a **tiny reference** that identifies the session. The model sees this result and links the UI resource. Nothing else lands in the model's context.

2. **The data tool** (`visibility: ["app"]`): called by the widget directly. Returns the full payload. The model never sees this tool or its results.

In this repo, `build_pizza` is the launcher and `pizza_state` is the data tool. The launcher result that lands in the model's context:

```typescript
// src/server.ts — build_pizza result
return {
  content: [
    {
      type: "text",
      text: `Opened the pizza builder (order ${order.id}). The user is choosing options.`,
    },
  ],
  structuredContent: { orderId: order.id },
};
```

The model sees a single sentence and a `{ orderId }` struct. The full menu (sizes, crusts, toppings, prices, hero image URL) stays on the server until the widget asks for it.

The widget fetches the full state as soon as it receives the tool result:

```typescript
// src/widget/widget.ts — boot()
app.ontoolresult = async (res: CallToolResult) => {
  const orderId = (res.structuredContent as { orderId?: string })?.orderId;
  if (!orderId) return;
  const stateRes = await app!.callServerTool({ name: "pizza_state", arguments: { orderId } });
  const next = readState(stateRes);
  if (next) { state = next; render(); }
};
```

`pizza_state` is registered with `visibility: ["app"]` in `src/server.ts`, so the model never sees it in `tools/list`:

```typescript
registerAppTool(
  server,
  "pizza_state",
  {
    title: "Pizza state (internal)",
    description: "Returns the full menu and current order for the widget.",
    inputSchema: { orderId: z.string() },
    _meta: { ui: { visibility: ["app"] } }, // hidden from the model's tool list
  },
  async ({ orderId }) => { /* ... returns full menu + order */ },
);
```

## Why a separate tool, not a per-result filter

`visibility: ["app"]` hides the **entire tool** from the model's tool list. It is **not** a per-result content filter. There is no mechanism to make the result of a model-visible tool invisible to the model while still delivering it to the widget.

This means the only way to route large payloads exclusively to the widget is to put them in a separate app-only tool that the model never calls. You cannot return both a tiny ref (for the model) and a large payload (for the widget) from a single tool invocation.

The correct architecture is always: one model-visible launcher returning a ref, plus one or more app-only data tools returning the full payload.

## Real Numbers from the Folio Board

From the Voygent Folio Board production deployment:

| What the model sees | Token count |
|---------------------|-------------|
| Full trip projection (naive approach) | ~9,155 tokens |
| Launcher ref `{ __voygentFolioBoardRef: { tripId, rev } }` | ~132 tokens |
| **Reduction** | **~98.5%** |

The widget fetches the full projection itself via the app-only `folio_board_data` tool (also `visibility: ["app"]`). The model sees only the tiny ref; the board renders the complete trip.

## Gotcha: Nested Object Parameters Get Stringified

When the widget calls an app-only tool via `app.callServerTool()` on claude.ai, nested object parameters may arrive at the server as a JSON string rather than a parsed object. This is a host serialization quirk (see [G7 in 08-gotchas.md](08-gotchas.md)).

Guard against it on the server with `z.preprocess`:

```typescript
const nestedSchema = z.preprocess(
  (v) => (typeof v === "string" ? JSON.parse(v) : v),
  z.object({ tripId: z.string(), rev: z.number() }),
);
```

Apply this to any parameter that is itself an object, not a scalar. Scalars (`z.string()`, `z.number()`) are not affected.

## Summary

- Return only a tiny identifier from your launcher tool. The model's context is for reasoning, not rendering data.
- Place the full payload behind an app-only tool (`visibility: ["app"]`). The widget fetches it; the model never sees it.
- `visibility: ["app"]` is tool-level, not result-level. You need a separate tool, not a flag on the result.
- Coerce nested object params with `z.preprocess(JSON.parse)` on the server side.

See also: [05-two-way-comms.md](05-two-way-comms.md) for how the widget hands results back to the model, and [08-gotchas.md](08-gotchas.md) for G6 (visibility scope) and G7 (param stringification).
