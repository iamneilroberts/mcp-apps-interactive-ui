/**
 * The MCP server. Registers:
 *
 *   1. build_pizza   (model + app)  — the launcher tool. Its result links to the
 *                                     UI resource via _meta.ui.resourceUri, and
 *                                     carries only a tiny {orderId} ref (the model
 *                                     never sees the whole menu — see docs/06).
 *   2. pizza_state   (app-only)     — the widget fetches the full menu + order.
 *   3. pizza_pick    (app-only)     — the widget toggles a size/crust/topping.
 *   4. ui://pizza/builder.html      — the interactive UI resource, with a CSP
 *                                     that allows the one external image domain.
 *
 * "app-only" tools (visibility: ["app"]) are deliberately hidden from the model's
 * tool list. The model launches the board once; the widget then talks to the
 * server directly without spending a single model token. See docs/06.
 */

import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { MENU, applyPick, createOrder, getOrder, priceOf, summarize } from "./data.js";

// Works from source (server.ts) and from the esbuild output (dist/server.js).
const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "..", "dist")
  : import.meta.dirname;

const RESOURCE_URI = "ui://pizza/builder.html";

/**
 * The serialized state the WIDGET consumes. The model never receives this — only
 * the widget does, via the app-only pizza_state / pizza_pick tools.
 */
function stateFor(orderId: string) {
  const order = getOrder(orderId);
  if (!order) return null;
  return {
    orderId,
    menu: MENU,
    selections: order.selections,
    total: priceOf(order),
    summary: summarize(order),
  };
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "Pizza Builder (MCP App demo)",
    version: "1.0.0",
  });

  // 1. The launcher. Visible to the model. Returns a TINY ref + the UI link.
  registerAppTool(
    server,
    "build_pizza",
    {
      title: "Build a pizza",
      description:
        "Open an interactive pizza builder. The user picks size, crust, and toppings " +
        "in a live board and sees the running price; nothing else is needed from you.",
      inputSchema: {},
      // Note: the model-visible output is intentionally small (just an id).
      outputSchema: z.object({ orderId: z.string() }),
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async (): Promise<CallToolResult> => {
      const order = createOrder();
      return {
        // Keep the text terse — this is what lands in the model's context.
        content: [
          {
            type: "text",
            text: `Opened the pizza builder (order ${order.id}). The user is choosing options.`,
          },
        ],
        structuredContent: { orderId: order.id },
      };
    },
  );

  // 2. App-only: the widget fetches the full menu + current order.
  registerAppTool(
    server,
    "pizza_state",
    {
      title: "Pizza state (internal)",
      description: "Returns the full menu and current order for the widget.",
      inputSchema: { orderId: z.string() },
      _meta: { ui: { visibility: ["app"] } }, // hidden from the model's tool list
    },
    async ({ orderId }): Promise<CallToolResult> => {
      const state = stateFor(orderId);
      if (!state) return errorResult(`Unknown order ${orderId}`);
      return okResult(state);
    },
  );

  // 3. App-only: toggle a selection. Radio groups replace; multi groups toggle.
  registerAppTool(
    server,
    "pizza_pick",
    {
      title: "Pizza pick (internal)",
      description: "Applies a size/crust/topping selection for the widget.",
      inputSchema: {
        orderId: z.string(),
        groupId: z.string(),
        optionId: z.string(),
      },
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ orderId, groupId, optionId }): Promise<CallToolResult> => {
      // Validate against the menu first so a direct MCP client gets a clear
      // error instead of silently storing an unknown group/option.
      const group = MENU.groups.find((g) => g.id === groupId);
      const option = group?.options.find((o) => o.id === optionId);
      if (!group || !option) return errorResult(`Invalid pick: ${groupId} / ${optionId}`);
      const updated = applyPick(orderId, groupId, optionId);
      if (!updated) return errorResult(`Unknown order ${orderId}`);
      return okResult(stateFor(orderId));
    },
  );

  // 4. The UI resource. The CSP is the only reason the external hero image loads.
  registerAppResource(
    server,
    RESOURCE_URI,
    RESOURCE_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      // List-level default; the read callback below sets the authoritative copy.
      _meta: { ui: { csp: { resourceDomains: ["https://images.unsplash.com"] } } },
    },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "builder.html"), "utf-8");
      return {
        contents: [
          {
            uri: RESOURCE_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            // The content-item CSP wins when both are present. Declare the exact
            // external origins your widget needs — the host's default sandbox is
            // img-src 'self' data:, which would block the hero image.
            _meta: { ui: { csp: { resourceDomains: ["https://images.unsplash.com"] } } },
          },
        ],
      };
    },
  );

  return server;
}

function okResult(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data as Record<string, unknown>,
  };
}

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}
