# Architecture: How MCP Apps Works

MCP Apps is an optional, backwards-compatible extension to MCP that lets servers deliver sandboxed interactive UIs (rendered as iframes inside the host) without breaking text-only clients.

## What It Is

- **Extension identifier:** `io.modelcontextprotocol/ui`
- **Spec:** SEP-1865, stable as of 2026-01-26
- **npm package:** `@modelcontextprotocol/ext-apps`
- **Canonical spec source:** https://github.com/modelcontextprotocol/ext-apps (specification/2026-01-26/apps.mdx)

The extension is **additive and backwards-compatible.** If a host does not support MCP Apps, a tool with `_meta.ui.resourceUri` behaves as a plain tool: the model receives the `content` text, the UI resource is never fetched, and nothing breaks. If the host does support it, the tool result renders the referenced HTML resource in a sandboxed iframe alongside (or instead of) the raw text.

Hosts advertise support in the MCP `initialize` request:

```json
{
  "capabilities": {
    "extensions": {
      "io.modelcontextprotocol/ui": {
        "mimeTypes": ["text/html;profile=mcp-app"]
      }
    }
  }
}
```

## The Two-Part Registration Model

Every MCP App requires exactly two things on the server:

1. **A tool**: callable by the model (and optionally by the widget). Its `_meta.ui.resourceUri` points to the UI resource that should render when the tool fires.
2. **A UI resource**: declared at the `ui://` scheme, with `mimeType: "text/html;profile=mcp-app"`. The host fetches this via `resources/read` and renders it in a sandboxed iframe.

The tool and the resource are linked by the URI string. In this repo, `build_pizza` points at `ui://pizza/builder.html`, which is the resource registered in `src/server.ts`.

Tools can also be **app-only** (`visibility: ["app"]`), meaning they are hidden from the model's tool list but callable by the widget via the host bridge. In this repo, `pizza_state` and `pizza_pick` are app-only: the model never sees them, but the widget calls them directly to fetch menu data and apply picks without spending a model token.

See [UI Resources](02-ui-resources.md) for the full registration API and [Host API](03-host-api.md) for the widget-side communication interface.

## Lifecycle and Handshake

The communication between the widget iframe and the host uses **JSON-RPC 2.0 over `postMessage`**. The SDK wraps this in two classes:

- **`App`** (View-side, in `@modelcontextprotocol/ext-apps`): what your widget instantiates
- **`AppBridge`** (host-side): implemented by the host; you never write this yourself

The handshake sequence after the host renders the iframe:

```
View                          Host
 |                              |
 |-- ui/initialize ------------>|   (appCapabilities, appInfo, protocolVersion)
 |<-- McpUiInitializeResult ----|   (hostCapabilities, hostInfo, hostContext)
 |-- ui/notifications/initialized ->|
 |                              |
 |<-- ui/notifications/tool-input-partial (0..n) -- (streaming, optional)
 |<-- ui/notifications/tool-input ------------|   (complete tool arguments)
 |<-- ui/notifications/tool-result -----------|   (tool execution result)
 |                              |
 |    ... interactive phase ... |
 |                              |
 |<-- ui/resource-teardown -----|   (host requests graceful shutdown)
 |--> ui/resource-teardown response |
```

Register your `ontoolinput` and `ontoolresult` handlers **before** calling `app.connect()`. The host may fire these notifications immediately after the handshake completes, and late registration risks missing them.

`app.connect()` with no arguments uses `PostMessageTransport(window.parent, window.parent)` as the default transport, which is correct for an iframe widget.

## System Diagram

```
┌─────────────────────────────────────────────────────────┐
│  MCP Host  (claude.ai, Claude Desktop, ChatGPT, ...)    │
│                                                          │
│  ┌──────────────┐   JSON-RPC/SSE   ┌────────────────┐   │
│  │  Model / LLM │ ←──────────────→ │  MCP Server    │   │
│  └──────────────┘                  │  (src/server.ts)│   │
│         │                          └────────────────┘   │
│         │ tool call result                ▲             │
│         ▼                                │ resources/read│
│  ┌────────────────────────────────────────────────────┐ │
│  │  AppBridge  (host-side, postMessage)               │ │
│  └─────────────────────────┬──────────────────────────┘ │
│                             │  JSON-RPC over postMessage │
│                  ┌──────────▼──────────┐                 │
│                  │  Sandboxed iframe   │                 │
│                  │  Widget (App class) │                 │
│                  │  src/widget/        │                 │
│                  └─────────────────────┘                 │
└─────────────────────────────────────────────────────────┘
```

The host proxies server tool calls and resource reads from the widget to the MCP server. The widget never opens a direct connection to the server; everything flows through the bridge.

For web-based hosts (like claude.ai), the host interposes an additional **sandbox proxy iframe** at a different origin, which forwards messages between the outer host and the inner widget. The SDK handles this transparently; your widget code is identical regardless.

## Supported Hosts

As of the spec's stable release (2026-01-26), hosts known to support `io.modelcontextprotocol/ui`:

- **claude.ai** (web): confirmed
- **Claude Desktop**: confirmed
- **ChatGPT** (via OpenAI Apps SDK)
- **VS Code** (MCP extension)
- **Goose** (Block)
- **Postman**
- **MCPJam**

The capabilities available on each host vary. See [Host API](03-host-api.md) for the confirmed capability set on Claude Desktop from the caps-probe findings.
