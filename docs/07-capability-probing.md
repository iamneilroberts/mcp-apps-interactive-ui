# Capability Probing: Know What Your Host Supports

The `io.modelcontextprotocol/ui` extension defines a set of capabilities that hosts may or may not implement. You cannot determine what a specific host supports from a shell, a spec doc, or a README. The only reliable way is to ask the host directly, from inside a live host session, by reading `getHostCapabilities()` and `getHostContext()` after the handshake.

## Why Runtime Probing Matters

Capabilities vary by host, by host version, and for some capabilities by the context in which the widget is displayed (inline vs. fullscreen). A widget that assumes capabilities without checking will silently fail or crash on hosts that don't support them. Cap-guarding every host API call (as `src/widget/widget.ts` does throughout) is the baseline; knowing the actual capability set of your target hosts is the next step.

## The Two Capability Sources

After `await app.connect()`, two methods give you host information:

- **`app.getHostCapabilities()`** returns the `hostCapabilities` object from the `ui/initialize` handshake response. This is where you find `openLinks`, `downloadFile`, `logging`, `updateModelContext`, `message`, `sampling`, etc. It is populated once at handshake time and does not change.

- **`app.getHostContext()`** returns the `hostContext` object: `theme`, `locale`, `displayMode`, `availableDisplayModes`, `containerDimensions`, `styles`, `deviceCapabilities`, etc. This changes when the host context changes (e.g., the user switches to fullscreen) and is delivered via `onhostcontextchanged`. Capability flags are not in context; they are in capabilities. Confusing the two is [Gotcha G3](08-gotchas.md).

## Building a Caps-Probe App

The simplest probe is an MCP App whose widget, on connect, reads both objects and renders them. The widget in this repo does exactly this on every boot:

```typescript
// src/widget/widget.ts — boot()
log("info", { event: "connected", capabilities: caps(), context: app.getHostContext() });
```

`sendLog` routes the payload to the host's logging channel (if supported), which you can read from the MCP server's log stream. A dedicated probe app would render the full objects to the DOM so you can read them directly in the host UI.

A minimal probe widget:

```typescript
await app.connect();

const capabilities = app.getHostCapabilities();
const context = app.getHostContext();

// Render to DOM for direct inspection
document.body.innerHTML = `
  <h2>Capabilities</h2>
  <pre>${JSON.stringify(capabilities, null, 2)}</pre>
  <h2>Context</h2>
  <pre>${JSON.stringify(context, null, 2)}</pre>
`;

// Also log if the host supports it
if (capabilities.logging) {
  await app.sendLog({ level: "info", data: { capabilities, context } });
}
```

Probe **app-registered tools** (the `onlisttools`/`oncalltool` handlers) separately, since they represent a different communication direction (model calling into the widget, not widget calling the server). Register handlers before connect and observe whether they fire:

```typescript
app.onlisttools = async () => ({ tools: [{ name: "widget_action", description: "...", inputSchema: {} }] });
app.oncalltool = async ({ name, arguments: args }) => ({ content: [{ type: "text", text: "ok" }] });
await app.connect();
// If onlisttools fires, the host supports app-registered tools.
// If it never fires across a full session, it is unsupported on this host.
```

## Empirical Findings: Claude Desktop

The following results are from Voygent's caps-probe MCP App running against **Claude Desktop (Claude/1.569.0)** on 2026-06-13. All Desktop cells are confirmed. Web cells are marked pending because the claude.ai web probe had not been run at time of writing.

### Capabilities (`getHostCapabilities()`)

| Capability | Claude Desktop | claude.ai web |
|------------|---------------|---------------|
| `openLinks` | confirmed | pending |
| `downloadFile` | confirmed | pending |
| `serverTools` | confirmed | pending |
| `serverResources` | confirmed | pending |
| `logging` | confirmed | pending |
| `updateModelContext` | `{ text: true, image: true }` | pending |
| `message` | `{ text: true }` | pending |
| `sampling` | **not supported** | pending |
| `sandbox` | `{}` (present, empty) | pending |

### Context (`getHostContext()`)

| Field | Claude Desktop value |
|-------|---------------------|
| `theme` | `dark` |
| `platform` | `desktop` |
| `locale` | `en-US` |
| `deviceCapabilities.touch` | `false` |
| `deviceCapabilities.hover` | `true` |
| `displayMode` | `inline` |
| `availableDisplayModes` | `["inline", "fullscreen"]` (no `pip`) |
| `containerDimensions.width` | `736` |
| `containerDimensions.maxHeight` | `5000` |
| `styles.variables` count | 76 CSS custom properties |
| Font | Anthropic Sans (via `styles.css.fonts`) |

### App-Registered Tools (model → widget direction)

`onlisttools` did **not** fire on Claude Desktop across the full probe session. `oncalltool` also did not fire. Conclusion: **app-registered tools (the model calling into the widget) are not supported on Claude Desktop.** This is a firm finding, not a timing issue. The probe ran for a complete session. This capability (ADR-0013 in Voygent's codebase) is **leaning rejected** for Desktop.

Web results for app-registered tools are pending.

### CSP / Imagery

Confirmed separately (via the folio-imagery-csp branch, tested on both web and Desktop): `_meta.ui.csp.resourceDomains` is honored by both hosts for external `<img>` tags. Declare the exact origin (e.g., `["https://images.unsplash.com"]`) in the content item of your resource read response. See [08-gotchas.md G8](08-gotchas.md) for the default sandbox restriction that makes this necessary.

## Cap-Guard Pattern

The `can` object in `src/widget/widget.ts` shows the recommended pattern for guarding all host API calls:

```typescript
const can = {
  message:      () => !!app?.getHostCapabilities()?.message,
  modelContext: () => !!app?.getHostCapabilities()?.updateModelContext,
  download:     () => !!app?.getHostCapabilities()?.downloadFile,
  log:          () => !!app?.getHostCapabilities()?.logging,
  fullscreen:   () =>
    (app?.getHostContext()?.availableDisplayModes ?? []).includes("fullscreen"),
};
```

Note the asymmetry: `can.fullscreen()` reads from `getHostContext()` because fullscreen availability is a context property (`availableDisplayModes`), not a top-level capability flag. All other capabilities read from `getHostCapabilities()`.

## See Also

- [05-two-way-comms.md](05-two-way-comms.md): confirmed capability values for `updateModelContext` and `message`
- [08-gotchas.md](08-gotchas.md): G3 (caps vs. context confusion), G8 (CSP defaults), G10 (container width)
- Spec: https://github.com/modelcontextprotocol/ext-apps (specification/2026-01-26/apps.mdx)
