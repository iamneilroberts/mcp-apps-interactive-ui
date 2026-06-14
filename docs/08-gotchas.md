# Gotchas: A Field Guide

Ten things that will bite you. Each one is a real finding from building the Voygent Folio Board on claude.ai and Claude Desktop. For each: the symptom, the cause, and the fix.

---

## G1: claude.ai caches `ui://` resources by URI; the widget does not update on reconnect

**Symptom:** You change your widget code, redeploy, reconnect to the MCP server, open a new tool result, and the old widget renders. The changes are gone. Clearing the connection and reconnecting does not help on claude.ai web.

**Cause:** claude.ai caches the HTML content of `ui://` resources keyed on the URI string. If the URI is the same, it serves the cached content. Reconnecting does not clear the cache; only a fresh chat session does. Claude Desktop refetches the resource on reconnect.

**Fix:** Content-version your URI. Hash your built widget bundle and embed the hash in the URI string:

```
ui://pizza/builder.html?v=a3f9c2e1
```

Bump the hash whenever the bundle changes. On claude.ai web, direct users to open a fresh chat after a widget update. On Desktop, reconnect is sufficient.

Note: if you serve the HTML from an external store (e.g., R2), make sure the stored content and the URI version token stay in sync. An out-of-date store can serve stale HTML even with a fresh URI.

---

## G2: Tool catalog is locked per session; new tools are invisible until reconnect

**Symptom:** You add a new tool to your MCP server and redeploy. The model cannot see or call the new tool, even after it confirms you redeployed.

**Cause:** claude.ai locks the tool catalog at session connect time. MCP's `tools/list_changed` notification is not acted on; the host does not re-fetch the catalog mid-session. This is by design on claude.ai ([ADR-0004](https://github.com/modelcontextprotocol/ext-apps) in the spec context).

**Fix:** Reconnect the MCP server. On claude.ai, close and re-add the server connection, then start a new chat. The new tool catalog is fetched on the next connect.

---

## G3: `updateModelContext` is passive; caps are on `getHostCapabilities()`, not `getHostContext()`

**Symptom (part 1):** You call `updateModelContext` with the current widget state, then expect the model to notice and respond. Nothing happens. The model's next reply ignores the staged content entirely.

**Cause:** `updateModelContext` is passive and silent. It does not trigger a model turn. It does not push a notification. It stages content that will be visible on the model's next user turn, meaning the next time the user (or your widget via `sendMessage`) sends a message. Only the last call's content survives (last-write-wins). It is a staging buffer, not a trigger.

**Fix:** Always follow `updateModelContext` with `sendMessage` if you want the model to act on the staged content. See [05-two-way-comms.md](05-two-way-comms.md).

**Symptom (part 2):** You check `app.getHostContext().message` to see if the host supports `sendMessage`. It is `undefined`. The capability check returns false, and your submit button is disabled, even on a host that supports `sendMessage`.

**Cause:** Capability flags (`message`, `updateModelContext`, `downloadFile`, `logging`, etc.) live on `getHostCapabilities()`, which is populated from the `ui/initialize` handshake response. `getHostContext()` is a different object containing display, theme, locale, and dimension information, not capability flags. Confusing the two produces no error, just a silent false.

**Fix:** Always read capability flags from `app.getHostCapabilities()`. The only field that lives on context and is relevant to capability-style checks is `availableDisplayModes`, which tells you whether fullscreen is available:

```typescript
// CORRECT
const canSend = !!app.getHostCapabilities().message;
const canFullscreen = app.getHostContext()?.availableDisplayModes?.includes("fullscreen");

// WRONG — capabilities are not in context
const canSend = !!app.getHostContext().message; // always undefined
```

---

## G4: `sendMessage` triggers a red "use caution" banner on claude.ai web

**Symptom:** The user clicks your "Place order" or "Apply picks" button. A red banner appears in the claude.ai chat interface warning about potential prompt injection. The user is alarmed.

**Cause:** claude.ai's host UX shows a caution banner any time `sendMessage` injects a message into the conversation. This is a host-level safety feature and applies to all `sendMessage` calls unconditionally, regardless of message content or wording. It cannot be suppressed or configured from your server or widget.

**Fix:** There is no technical fix. The flow works: the model receives the message and responds. Design your UX to set user expectations. Label the button clearly (e.g., "Send to Claude →") and consider a brief in-widget note for first-time users. The banner is informational and the user can dismiss it and proceed. See [05-two-way-comms.md](05-two-way-comms.md) for the full submit pattern.

---

## G5: MCP progress notifications are dead on claude.ai

**Symptom:** You return a `progressToken` from your tool and emit `notifications/progress` updates as the tool runs. The widget's progress handler never fires. The UI shows no incremental progress.

**Cause:** claude.ai does not send a `progressToken` with tool invocations. Without a token, the server has no way to associate progress notifications with a specific call, and the host has no mechanism to route them to the widget. This is a host-level limitation, not a bug in your code.

**Fix:** Design for pull-based feedback only. `ontoolresult` fires once when the tool completes; that is your only callback. For long-running operations, break them into smaller tool calls, each of which completes quickly. For live user feedback during a multi-step flow, rely on the model's narration in the chat thread (what Claude types while tools run). That is the real-time feedback channel available on claude.ai.

---

## G6: `visibility: ["app"]` hides the tool, not the result content

**Symptom:** You add `visibility: ["app"]` to a tool that returns a large payload, expecting the model to skip it. But the model still receives the large payload in its context.

**Cause:** `visibility: ["app"]` removes the tool from the model's `tools/list`. The model cannot call it and does not see it listed. It does **not** create a per-result content filter. If the model somehow calls an app-only tool (which it should not, since the tool is hidden), the result would still flow into context. The flag controls tool visibility, not data routing.

**Fix:** To route large payloads exclusively to the widget, you need two separate tools: (1) a model-visible launcher that returns only a tiny reference, and (2) an app-only data tool that the widget calls to fetch the full payload. See [06-token-economy.md](06-token-economy.md) for the full pattern with real token numbers from the Folio Board case study.

---

## G7: claude.ai stringifies nested object parameters to app-only tools

**Symptom:** Your widget calls an app-only tool with a nested object as a parameter. The server receives the value as a JSON string instead of a parsed object. `z.object(...)` throws a parse error; your tool returns an error result.

**Cause:** claude.ai serializes tool arguments through the host bridge and may stringify nested objects rather than passing them as structured data. Scalar types (`string`, `number`, `boolean`) are unaffected.

**Fix:** Wrap any nested object schema in `z.preprocess` to coerce strings to parsed objects on the server:

```typescript
const nestedSchema = z.preprocess(
  (v) => (typeof v === "string" ? JSON.parse(v) : v),
  z.object({ tripId: z.string(), rev: z.number() }),
);
```

Apply this defensive coercion to every parameter that is itself an object. Scalar parameters do not need it.

---

## G8: The default CSP sandbox blocks external images

**Symptom:** Your widget references an external image (a hero photo, a thumbnail, a product image). In a browser standalone preview, the image loads fine. Inside a host iframe, the image does not load (broken image icon or nothing at all).

**Cause:** The MCP Apps spec defines a restrictive default Content Security Policy for sandboxed widget iframes. The default `img-src` is `'self' data:`. No external origins are allowed and external `<img>` tags are silently blocked.

**Fix:** Declare `resourceDomains` in your resource's `_meta.ui.csp`. This expands `img-src` (and `script-src`, `style-src`, `font-src`, `media-src`) to include the listed origins. Wildcards are supported. Declare this on the **content item** returned from your resource read handler; that is the authoritative copy:

```typescript
// src/server.ts — resource read handler
return {
  contents: [{
    uri: RESOURCE_URI,
    mimeType: RESOURCE_MIME_TYPE,
    text: html,
    _meta: {
      ui: { csp: { resourceDomains: ["https://images.unsplash.com"] } },
    },
  }],
};
```

On claude.ai web and Claude Desktop, `resourceDomains` is honored for external `<img>` tags. Add `onerror` handlers to your images to degrade gracefully in hosts that do not honor it:

```typescript
img.onerror = () => img.parentElement?.remove();
```

---

## G9: Sandboxed iframes cannot call `window.open`

**Symptom:** Your widget calls `window.open(url)` to open an external link. Nothing happens. No new tab opens. No error in the console (or a silent permissions error).

**Cause:** The widget runs in a sandboxed iframe. The `allow-popups` sandbox flag is not set by default in MCP Apps hosts. `window.open` requires `allow-popups` and is silently blocked without it.

**Fix:** Use `app.openLink(url)` instead. This delegates the open to the host, which handles it outside the sandboxed context. The host must advertise the `openLinks` capability. On Claude Desktop, `openLinks` is confirmed supported.

```typescript
if (app.getHostCapabilities().openLinks) {
  await app.openLink("https://example.com/more-info");
}
```

---

## G10: Inline container width is fixed at 736 px; height flexes to 5000 px

**Symptom:** Your widget looks correct in a 1280-wide browser preview. Inside the claude.ai host (inline mode), it overflows, wraps awkwardly, or key elements are clipped.

**Cause:** On Claude Desktop (confirmed 2026-06-13), the inline widget container is exactly `736 px` wide (`containerDimensions.width: 736`). The maximum height is `5000 px`. These are the actual values returned by `getHostContext()`, not guidelines.

**Fix:** Design your widget to a 736 px reference width. Use `px` or layout units relative to the container (`%`, `ch`, and `vw` do not help here). Verify your layout at that exact width before shipping. For content that exceeds the height budget, use internal scroll within the widget rather than relying on the host to scroll around it.

For a wider layout, prompt the user to request fullscreen (`requestDisplayMode({ mode: "fullscreen" })`), which removes the width constraint. Gate this on `availableDisplayModes` from `getHostContext()`. Confirmed `["inline", "fullscreen"]` on Desktop; `pip` is not present.

See [07-capability-probing.md](07-capability-probing.md) for the full context values from the caps probe, and [05-two-way-comms.md](05-two-way-comms.md) for the cap-guard pattern used throughout `src/widget/widget.ts`.

---

## Quick Reference

| # | Symptom in one line | Fix in one line |
|---|---------------------|-----------------|
| G1 | Widget doesn't update after redeploy on claude.ai | Content-version the `ui://` URI; use a fresh chat on web |
| G2 | New tool invisible to model after redeploy | Reconnect the MCP server; restart the chat session |
| G3 | `updateModelContext` doesn't trigger the model / caps check returns wrong value | `updateModelContext` is passive; read caps from `getHostCapabilities()` |
| G4 | Red caution banner appears on sendMessage | Host safety UX; cannot suppress; set user expectations |
| G5 | Progress notifications never arrive | Host sends no progressToken; design for pull-based feedback |
| G6 | Large payload still in model context despite `visibility: ["app"]` | Use a separate app-only data tool + tiny-ref launcher |
| G7 | Nested object param arrives as a JSON string | `z.preprocess(v => typeof v==="string" ? JSON.parse(v) : v, schema)` |
| G8 | External images blocked in host iframe | Declare `resourceDomains` in `_meta.ui.csp` on the content item |
| G9 | `window.open` silently does nothing | Use `app.openLink(url)` instead |
| G10 | Widget overflows or wraps at host width | Design to 736 px inline; use fullscreen for wider layouts |
