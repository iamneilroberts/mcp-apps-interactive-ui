# voygent-mcp-app-demo

**A worked, runnable example of building interactive in-chat UI with [MCP Apps](https://github.com/modelcontextprotocol/ext-apps), plus a field guide to the gotchas you only learn by shipping one.**

MCP Apps (the `io.modelcontextprotocol/ui` extension, SEP-1865) lets an MCP server hand the host a sandboxed HTML widget instead of a wall of text. The model calls one tool and the user gets a real interface: option pickers, live totals, buttons that talk back to the model. This repo is a minimal working example of that pattern, distilled from a production app ([Voygent's Folio Board](CASE-STUDY.md), a whole-trip interactive board running in claude.ai today).

![The Pizza Builder example running standalone](media/pizza-builder.png)

> The example app is a **Pizza Builder**: pick size, crust, and toppings; watch the price update live; hit *Place order* and it hands the choice back to the model. The domain is intentionally simple so the MCP Apps mechanics stay in focus. Every pattern here maps directly to what the Folio Board uses for a 10-day trip.

---

## What you'll learn

This repo demonstrates, in ~350 lines of commented source, every capability that makes an MCP App feel native:

| Capability | How | Where |
|---|---|---|
| Render an interactive widget from a tool call | `_meta.ui.resourceUri` links a tool to a `ui://` resource | [`src/server.ts`](src/server.ts), [docs/02](docs/02-ui-resources.md) |
| Keep the model's context tiny | launcher returns a `{orderId}` ref; the widget fetches the rest via an **app-only** tool | [docs/06](docs/06-token-economy.md) |
| Let the user pick options without spending tokens | `visibility: ["app"]` tools the model never sees | [`src/server.ts`](src/server.ts) |
| Hand a result back to the model | `updateModelContext` (stage) → `sendMessage` (trigger) | [docs/05](docs/05-two-way-comms.md) |
| Show external images | `_meta.ui.csp.resourceDomains` | [docs/04](docs/04-csp-and-imagery.md) |
| Download a file | `app.downloadFile` | [`src/widget/widget.ts`](src/widget/widget.ts) |
| Go fullscreen | `app.requestDisplayMode` (gated on `availableDisplayModes`) | [`src/widget/widget.ts`](src/widget/widget.ts) |
| Match the host's theme/fonts | `applyHostStyleVariables` / `applyHostFonts` | [docs/03](docs/03-host-api.md) |
| See what the host actually granted you | `getHostCapabilities()` + a capability probe | [docs/07](docs/07-capability-probing.md) |

Also included: [**10 gotchas**](docs/08-gotchas.md) covering URI caching, the silent `updateModelContext`, the red caution banner, the session-locked tool catalog, and more.

---

## Quickstart

```bash
git clone https://github.com/iamneilroberts/voygent-mcp-app-demo
cd voygent-mcp-app-demo
npm install
npm run build
```

**See the widget immediately, no host required.** The build produces a single self-contained `dist/builder.html` that falls back to mock data when opened directly:

```bash
# macOS
open dist/builder.html
# Linux
xdg-open dist/builder.html
```

**Run it as a real MCP server:**

```bash
npm start            # Streamable HTTP at http://localhost:3001/mcp
npm run start:stdio  # stdio, for Claude Desktop / MCP Inspector
```

**Connect it to a host:**

- **Claude Desktop**: add to your MCP config:
  ```json
  {
    "mcpServers": {
      "pizza": { "command": "node", "args": ["/abs/path/to/voygent-mcp-app-demo/dist/index.js", "--stdio"] }
    }
  }
  ```
  Then ask Claude: *"build me a pizza"* → the board renders inline.
- **MCP Inspector**: `npx @modelcontextprotocol/inspector node dist/index.js --stdio`.

---

## Architecture in one diagram

```
  ┌─────────┐  tool call   ┌──────────┐  postMessage   ┌──────────────┐
  │  Model  │ ───────────▶ │   Host   │ ◀────JSON-RPC──▶│  Widget      │
  │ (Claude)│ ◀─result/UI─ │(claude.ai│   (the bridge)  │ (iframe,     │
  └─────────┘              │ /Desktop)│                 │  sandboxed)  │
                           └────┬─────┘                 └──────┬───────┘
                                │  proxies app.callServerTool()│
                                ▼                              ▼
                           ┌─────────────────────────────────────┐
                           │   Your MCP server (src/server.ts)    │
                           │  build_pizza · pizza_state · pizza_pick │
                           └─────────────────────────────────────┘
```

The model launches the board once. After that the widget talks to your server directly through the host (`app.callServerTool`), so picking toppings costs zero model tokens. The widget hands control back to the model only when the user is done. Full walkthrough: [docs/01](docs/01-architecture.md).

---

## Repo layout

```
src/
  server.ts          the MCP server: 1 launcher tool + 2 app-only tools + 1 UI resource
  data.ts            the toy domain (menu, orders, pricing)
  index.ts           transport wiring (Streamable HTTP + stdio)
  widget/
    widget.ts        the App: render, pick, place-order, download, fullscreen, theme
    widget.html      the shell (CSS + JS get inlined here at build time)
    styles.css
esbuild.mjs          bundles the widget into one self-contained HTML the server serves
docs/                01–08: the deep dives
CASE-STUDY.md        Voygent's Folio Board: the production app this was distilled from
media/               screenshots
```

---

## The deep dives

1. [Architecture & lifecycle](docs/01-architecture.md): the handshake, the bridge, the two-part registration.
2. [Declaring UI resources](docs/02-ui-resources.md): `ui://`, the MIME type, `_meta.ui.resourceUri`, tool visibility.
3. [The host API](docs/03-host-api.md): every `app.*` method, and the capabilities-vs-context distinction.
4. [CSP & imagery](docs/04-csp-and-imagery.md): why your image is blocked and how to declare the domains you need.
5. [Two-way comms](docs/05-two-way-comms.md): `updateModelContext` vs `sendMessage`, the caution banner, no progress tokens.
6. [The token economy](docs/06-token-economy.md): the ref-and-fetch pattern that kept a 9k-token payload out of the model's context (~98.5% smaller).
7. [Probing host capabilities](docs/07-capability-probing.md): how to find out what a host actually grants, with real Claude Desktop results.
8. [Gotchas](docs/08-gotchas.md): 10 things to know before shipping.

---

## Status of the findings

The capability claims in [docs/07](docs/07-capability-probing.md) come from running a probe app inside a live host. **Claude Desktop (`Claude/1.569.0`, 2026-06-13) is empirically confirmed.** Some claude.ai **web** cells are marked *pending* where we hadn't yet captured them in-host. They are labeled as pending, not guessed. Hosts evolve; re-probe before you rely on a specific cell.

## Credits

Built by [Neil Roberts](https://github.com/iamneilroberts), distilled from [Voygent](https://voygent.ai)'s Folio Board. MCP Apps spec: [modelcontextprotocol/ext-apps](https://github.com/modelcontextprotocol/ext-apps). MIT licensed.
