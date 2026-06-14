# UI Resources

A UI resource is the HTML document that renders inside the host's sandboxed iframe. This document covers how to declare, register, and link a UI resource to a tool.

## The `ui://` Scheme and MIME Type

UI resources use the `ui://` URI scheme to distinguish them from ordinary MCP resources. The MIME type must be exactly `"text/html;profile=mcp-app"` (the SDK exports this as the constant `RESOURCE_MIME_TYPE`).

```typescript
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
// "text/html;profile=mcp-app"
```

Hosts **prefetch** UI resources at connection time (when they receive the `resources/list` response), before any tool is called. This is by design: it separates the static template from the dynamic data, improves performance, and lets the host review the resource content before rendering it.

## Registering a UI Resource and Tool

Use `registerAppResource` and `registerAppTool` from `@modelcontextprotocol/ext-apps/server`. These are thin wrappers over the base SDK that normalize the UI metadata and set default MIME types.

### Signatures

```typescript
registerAppTool(
  server: Pick<McpServer, "registerTool">,
  name: string,
  config: McpUiAppToolConfig,   // must include _meta.ui.resourceUri or _meta.ui.visibility
  cb: ToolCallback,
): RegisteredTool

registerAppResource(
  server: Pick<McpServer, "registerResource">,
  name: string,
  uri: string,
  config: McpUiAppResourceConfig,  // optional _meta.ui.csp etc.
  readCallback: McpUiReadResourceCallback,
): RegisteredResource
```

### From `src/server.ts` in this repo

```typescript
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";

const RESOURCE_URI = "ui://pizza/builder.html";

// Model-visible launcher tool — links to the UI resource via _meta.ui.resourceUri
registerAppTool(
  server,
  "build_pizza",
  {
    title: "Build a pizza",
    description: "Open an interactive pizza builder. ...",
    inputSchema: {},
    outputSchema: z.object({ orderId: z.string() }),
    _meta: { ui: { resourceUri: RESOURCE_URI } },
  },
  async (): Promise<CallToolResult> => {
    const order = createOrder();
    return {
      content: [{ type: "text", text: `Opened the pizza builder (order ${order.id}).` }],
      structuredContent: { orderId: order.id },
    };
  },
);

// The UI resource itself
registerAppResource(
  server,
  RESOURCE_URI,       // name (reusing the URI string here; can be any display name)
  RESOURCE_URI,       // uri
  {
    mimeType: RESOURCE_MIME_TYPE,
    _meta: { ui: { csp: { resourceDomains: ["https://images.unsplash.com"] } } },
  },
  async (): Promise<ReadResourceResult> => {
    const html = await fs.readFile(path.join(DIST_DIR, "builder.html"), "utf-8");
    return {
      contents: [{
        uri: RESOURCE_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: html,
        _meta: { ui: { csp: { resourceDomains: ["https://images.unsplash.com"] } } },
      }],
    };
  },
);
```

## Linking a Tool to Its UI: `_meta.ui.resourceUri`

The preferred format is the **nested** `_meta.ui.resourceUri`:

```typescript
_meta: { ui: { resourceUri: "ui://pizza/builder.html" } }
```

The flat `_meta["ui/resourceUri"]` format is **deprecated** (will be removed before GA) but is still supported for backwards compatibility. `registerAppTool` automatically sets both forms so that older hosts stay compatible.

## The Single-File Requirement

The resource returned by `resources/read` must be **a single self-contained HTML document**. The host renders it in a sandboxed iframe; it cannot load external scripts via `<script src="...">` (those requests would be blocked by the sandbox CSP) and cannot reference separate CSS files. Everything (JavaScript, styles, fonts, images) must be inlined.

This repo inlines the widget bundle using `esbuild.mjs`, which produces `dist/builder.html` with all JS and CSS baked in. See `esbuild.mjs` at the repo root for the build configuration.

The build step is required before the server can serve the widget:

```bash
npm run build       # bundles src/widget/ → dist/builder.html
npm run dev         # watches + rebuilds + starts the server
```

## Tool Visibility: `_meta.ui.visibility`

`visibility` controls who can call a tool:

| Value | Behaviour |
|---|---|
| `["model", "app"]` | Default. Tool appears in the model's tool list and is callable by the widget. |
| `["model"]` | Model-only. Widget cannot call it. |
| `["app"]` | App-only. Tool is **excluded from the model's tool list** entirely. The widget can call it via the host bridge. |

`visibility: ["app"]` hides the **entire tool** from the model, not just its result. If you need to pass large data to the widget without it appearing in the model's context, use a separate app-only tool that returns the full payload, and have the model-visible tool return only a small reference (e.g., an `orderId`).

In this repo, `pizza_state` and `pizza_pick` are app-only. The model sees only `build_pizza` and its tiny `{ orderId }` result. The widget then calls `pizza_state` to fetch the full menu and `pizza_pick` to apply selections, with zero additional model tokens.

```typescript
// App-only tool — invisible to the model
registerAppTool(
  server,
  "pizza_state",
  {
    description: "Returns the full menu and current order for the widget.",
    inputSchema: { orderId: z.string() },
    _meta: { ui: { visibility: ["app"] } },   // no resourceUri needed for app-only
  },
  async ({ orderId }) => { /* ... */ },
);
```

**Note:** `visibility: ["app"]` hides the tool, not per-result content. A single tool cannot conditionally show or hide its result from the model; that decision is structural (separate tools). See [Architecture](01-architecture.md) for the token-split pattern.

## CSP and Imagery

See [CSP and Imagery](04-csp-and-imagery.md) for how to declare external domains your widget needs to load images, scripts, or make network requests.
