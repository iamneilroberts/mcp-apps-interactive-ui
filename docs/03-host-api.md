# Host API

The widget communicates with the host through the `App` class from `@modelcontextprotocol/ext-apps`. This document is a reference for every method, handler, and React hook on the View (widget) side.

## Connecting

```typescript
import { App } from "@modelcontextprotocol/ext-apps";

const app = new App(
  { name: "PizzaBuilder", version: "1.0.0" },
  {},                          // McpUiAppCapabilities
  { autoResize: true },        // AppOptions (autoResize is the default)
);

// Register handlers BEFORE connecting — one-shot events like
// ontoolinput fire immediately after the handshake and cannot be
// recovered if you register late.
app.ontoolinput = (params) => { /* ... */ };
app.ontoolresult = (params) => { /* ... */ };

await app.connect();
// Default transport: PostMessageTransport(window.parent, window.parent)
// Performs the ui/initialize → McpUiInitializeResult → ui/notifications/initialized handshake.
```

`connect()` stores `hostCapabilities`, `hostInfo`, and `hostContext` from the handshake result. Those are accessible via the three getters below.

## Getters (post-connect)

| Method | Returns | Description |
|---|---|---|
| `app.getHostCapabilities()` | `McpUiHostCapabilities \| undefined` | Feature flags advertised by the host during the handshake. Gate capability-dependent calls on this. |
| `app.getHostContext()` | `McpUiHostContext \| undefined` | Runtime environment: theme, locale, timezone, `displayMode`, `availableDisplayModes`, `containerDimensions`, `platform`, `deviceCapabilities`, style variables. Auto-updated on `hostcontextchanged` notifications. |
| `app.getHostVersion()` | `Implementation \| undefined` | Host name + version string (`{ name, version }`). |

### Critical gotcha: capabilities vs. context

**`getHostCapabilities()`** and **`getHostContext()`** return completely different objects.

- **Capabilities** are what the host can do: `openLinks`, `downloadFile`, `serverTools`, `serverResources`, `logging`, `sampling`, `sandbox`. These come from `hostCapabilities` in the handshake result.
- **Context** is the runtime environment: `theme`, `locale`, `displayMode`, `containerDimensions`, `platform`. These come from `hostContext` in the handshake result.

A common bug is checking `app.getHostContext()?.downloadFile` (always `undefined`) instead of `app.getHostCapabilities()?.downloadFile`. Always gate capability-dependent calls on `getHostCapabilities()`.

```typescript
// Correct — check capabilities
if (app.getHostCapabilities()?.downloadFile) {
  await app.downloadFile({ contents: [...] });
}

// Wrong — getHostContext() has no capability fields
if (app.getHostContext()?.downloadFile) { /* never fires */ }
```

Confirmed capability set on **Claude Desktop** (Claude/1.569.0, 2026-06-13, from caps-probe):

```
openLinks ✓   downloadFile ✓   serverTools ✓   serverResources ✓
logging ✓     updateModelContext ✓ {text, image}    message ✓ {text}
sampling ✗    sandbox: {}
```

Web capabilities probe is **pending** (not yet confirmed for claude.ai web).

## Outbound Requests (View → Host)

### Server proxying

| Method | Description | Requires capability |
|---|---|---|
| `app.callServerTool(params, options?)` | Call a tool on the originating MCP server, proxied through the host. Returns `CallToolResult`. Check `result.isError` — transport errors throw, tool errors return. | `hostCapabilities.serverTools` |
| `app.readServerResource(params, options?)` | Read a resource from the originating MCP server (proxied). | `hostCapabilities.serverResources` |
| `app.listServerResources(params?, options?)` | List available resources from the MCP server (proxied). Supports `cursor` for pagination. | `hostCapabilities.serverResources` |

### LLM / conversation

| Method | Description | Requires capability |
|---|---|---|
| `app.createSamplingMessage(params, options?)` | Request an LLM completion from the host's model connection (`sampling/createMessage`). Host has full discretion — it may modify or reject. | `hostCapabilities.sampling` |
| `app.sendMessage(params, options?)` | Insert a message into the host's chat interface (`ui/message`). On claude.ai, this triggers a **red prompt-injection caution banner** — this is host UX and unavoidable. | — |
| `app.updateModelContext(params, options?)` | Silently stage data for the model's next turn (`ui/update-model-context`). **Passive** — does not trigger a model response. Last-write-wins; each call overwrites the previous context. Pair with `sendMessage` to trigger the turn. | — |

### Navigation and display

| Method | Description | Requires capability |
|---|---|---|
| `app.openLink({ url }, options?)` | Ask the host to open a URL in the default browser. The sandboxed iframe cannot call `window.open`. | `hostCapabilities.openLinks` |
| `app.downloadFile({ contents }, options?)` | Ask the host to download a file. Pass an `EmbeddedResource` (inline text/blob) or `ResourceLink` (URL the host fetches). Sandboxed iframes cannot trigger downloads directly. | `hostCapabilities.downloadFile` |
| `app.requestDisplayMode({ mode }, options?)` | Request a display mode change: `"inline"` \| `"fullscreen"` \| `"pip"`. The host returns the **actual** mode set, which may differ from requested. Always check `availableDisplayModes` in host context first. | — |
| `app.requestTeardown(params?)` | Fire-and-forget: ask the host to tear down this app. If the host approves, it will send `ui/resource-teardown` for graceful shutdown via `onteardown`. | — |

### Telemetry and sizing

| Method | Description |
|---|---|
| `app.sendLog(params)` | Send a log notification to the host (`notifications/message`). Logs are not added to conversation context but may be recorded for debugging. |
| `app.sendSizeChanged({ width, height })` | Notify the host of an iframe size change. Called automatically when `autoResize: true` (the default). |

### App-registered tools (experimental)

| Method | Description |
|---|---|
| `app.registerTool(name, config, cb)` | Register a tool on the App itself that the host can call back into. Requires `tools` capability in `McpUiAppCapabilities`. |
| `app.sendToolListChanged()` | Notify the host that the app's tool list has changed. |

> **ADR-0013 note:** On Claude Desktop (as of 2026-06-13), `onlisttools` and `oncalltool` did **not** fire. App-registered tools are not supported by the Desktop host. Do not depend on this path in production until confirmed.

## Inbound Handlers (Host → View)

Assign these before `connect()`. Assigning a new value replaces the previous handler (DOM-style semantics). Use `app.addEventListener(event, handler)` if you need multiple listeners on the same event.

| Property | Event | Description |
|---|---|---|
| `app.ontoolinput` | `toolinput` | Host sends the complete tool arguments after the handshake. Fired at most once per tool call. |
| `app.ontoolinputpartial` | `toolinputpartial` | Host sends partial (streamed) tool arguments before `tool-input` completes. Use for progressive rendering only — partial JSON is "healed" (unclosed brackets auto-closed). |
| `app.ontoolresult` | `toolresult` | Host sends the `CallToolResult` after server-side tool execution completes. |
| `app.ontoolcancelled` | `toolcancelled` | Host sends this if the tool was cancelled (user action, classifier, error). |
| `app.onhostcontextchanged` | `hostcontextchanged` | Host sends a partial `HostContext` when theme, locale, display mode, or container dimensions change. The `App` class merges these into the internal context automatically before your handler fires. |
| `app.onteardown` | — (request) | Host sends `ui/resource-teardown` before unmounting the iframe. Async-safe: await cleanup, then return `{}`. |
| `app.oncalltool` | — (request) | Host calls a tool registered on the App via `registerTool`. |
| `app.onlisttools` | — (request) | Host lists tools registered on the App. |

## React Hooks

If your widget uses React, the package exports hooks that wrap the `App` lifecycle:

| Hook | Description |
|---|---|
| `useApp()` | Returns the connected `App` instance for the current render tree. |
| `useHostStyles()` | Returns the current `styles` from host context, re-renders on `hostcontextchanged`. |
| `useAutoResize()` | Sets up automatic `sendSizeChanged` notifications via `ResizeObserver`. |
| `useDocumentTheme()` | Syncs `document.documentElement` class to host `theme` (`"light"` / `"dark"`). |

## Styling Helpers

These utilities apply host-provided CSS variables and fonts to the document:

| Helper | Description |
|---|---|
| `applyHostStyleVariables(variables)` | Sets the 76+ standardized CSS custom properties (colors, typography, borders, shadows) on `document.documentElement`. |
| `applyHostFonts(css)` | Injects `@font-face` / `@import` font CSS from `hostContext.styles.css.fonts` into the document. |
| `applyDocumentTheme(theme)` | Applies the host `theme` value to the document root (for `light-dark()` CSS function compatibility). |
| `getDocumentTheme()` | Returns the current document theme. |

Use CSS `var(--color-background-primary)` etc. with fallback values in `:root` for hosts that omit some variables. See the spec for the full list of standardized variable names.
