# Two-Way Communication: Widget to Model

A widget can talk back to the model through two distinct mechanisms. Getting the difference wrong is a common source of bugs, because both look like "sending data to the model" but they behave very differently: one is passive, the other is active.

## The Two Mechanisms

### `updateModelContext` — passive staging

`updateModelContext(params)` pushes content into the host's context buffer. It is **silent**: it does not trigger a model turn, and the model will not see the update until the user sends their next message. Only the last call wins (last-write-wins); each call overwrites the previous one. Use it to stage the current UI state so the model has accurate context when the user next speaks.

```typescript
await app.updateModelContext({
  content: [{ type: "text", text: `Current pizza: ${state.summary}` }],
});
```

The host must advertise the `updateModelContext` capability for this to work. Check `getHostCapabilities()` first, not `getHostContext()`, which is a different object (see [Gotcha G3 in 08-gotchas.md](08-gotchas.md)).

### `sendMessage` — active trigger

`sendMessage({ role, content })` is the **only** host-to-model call that actually triggers a model turn. When your widget calls it, the host injects a message into the conversation and the model responds. It requires the host to advertise the `message` capability.

```typescript
await app.sendMessage({
  role: "user",
  content: [{ type: "text", text: `Place my pizza order — ${state.summary}.` }],
});
```

On **claude.ai web**, every `sendMessage` call causes the host to show a red "use caution — potential prompt injection" banner, regardless of the wording of your message. This is the host's safety UX and cannot be suppressed from the server or widget. The message still goes through and the model still responds; the banner is cosmetic. Build your UX to account for it, as users who haven't seen it before may be alarmed.

## The Canonical Submit Pattern

Stage context first, trigger the turn second. The `placeOrder()` function in `src/widget/widget.ts` implements this pattern exactly:

```typescript
/**
 * The 2-way handoff. updateModelContext STAGES the order silently (it does not
 * trigger a model turn and keeps only the last update). sendMessage is the only
 * host->model call that actually triggers a turn. Canonical pattern: stage, then
 * send. Both are cap-guarded. On claude.ai web, sendMessage shows a red "use
 * caution" banner — that is host safety UX and cannot be suppressed.
 */
async function placeOrder() {
  if (!inHost) { console.info("[standalone] would place order:", state.summary); return; }
  if (can.modelContext())
    await app!.updateModelContext({ content: [{ type: "text", text: `Current pizza: ${state.summary}` }] });
  if (can.message()) {
    await app!.sendMessage({
      role: "user",
      content: [{ type: "text", text: `Place my pizza order — ${state.summary}.` }],
    });
  } else {
    log("warning", { event: "no_message_capability" });
    console.info("Host lacks `message` capability; cannot hand back to the model.");
  }
}
```

The `can.message()` and `can.modelContext()` guards call `getHostCapabilities()`. Always read from there, not from context. In the Voygent Folio Board case study, the same pattern drives the "Done — apply my picks" button, which stages the advisor's option selections and then hands off to the model to confirm the booking.

## Capability Probing

Always check capabilities before calling either verb. Hosts that do not advertise a capability may ignore the call silently or throw.

```typescript
const caps = app.getHostCapabilities();

// updateModelContext: the capability value carries the content types the host accepts.
// On Claude Desktop: { text: true, image: true }
if (caps.updateModelContext) {
  await app.updateModelContext({ content: [{ type: "text", text: "..." }] });
}

// sendMessage: the capability value carries the content types the host accepts.
// On Claude Desktop: { text: true }
if (caps.message) {
  await app.sendMessage({ role: "user", content: [{ type: "text", text: "..." }] });
}
```

Confirmed capability values from the caps probe on **Claude Desktop (Claude/1.569.0, 2026-06-13)**: `updateModelContext: { text: true, image: true }`, `message: { text: true }`. Web results are pending. See [07-capability-probing.md](07-capability-probing.md) for the full findings table.

## No Live Progress Notifications

MCP progress notifications (`notifications/progress`) are **not delivered** from claude.ai to the widget. The host does not send a `progressToken` with tool calls, so `ontoolresult` is your only callback. It fires once, when the tool completes. There is no streaming or incremental-result path from the server to the widget via the progress channel.

For live feedback during a multi-step operation, the model's narration (what Claude types in the chat thread) is the real-time channel available. Design your server tool descriptions to encourage useful narration steps, and design your widget to not rely on receiving intermediate results.

## Summary

| Verb | Triggers a model turn | Overwrites previous | Capability required |
|------|----------------------|---------------------|---------------------|
| `updateModelContext` | No — passive | Yes (last-write-wins) | `updateModelContext` |
| `sendMessage` | **Yes** | No | `message` |

Use `updateModelContext` to keep context current as the user interacts with your widget. Use `sendMessage` when the user takes a deliberate action that requires the model to respond. The canonical order is: stage first, trigger second.

See also: [07-capability-probing.md](07-capability-probing.md) for how to discover what a host actually supports, and [08-gotchas.md](08-gotchas.md) for the caution banner (G4) and missing progress notifications (G5).
