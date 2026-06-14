/**
 * Entry point. Two transports:
 *
 *   node dist/index.js            -> Streamable HTTP at http://localhost:3001/mcp
 *   node dist/index.js --stdio    -> stdio (for Claude Desktop / MCP Inspector)
 *
 * A fresh McpServer is built per request in HTTP mode. That isolates per-request
 * MCP protocol state; it does not isolate application data. The demo's order state
 * in data.ts is process-global on purpose (see the note there). A real server would
 * key application state by session/user.
 *
 * The HTTP server binds to 127.0.0.1 so a local tutorial run is not reachable from
 * the network. To expose it deliberately, change HOST and add auth + allowedHosts.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import type { Request, Response } from "express";
import { createServer } from "./server.js";

async function startHttp(): Promise<void> {
  const port = parseInt(process.env.PORT ?? "3001", 10);
  const host = process.env.HOST ?? "127.0.0.1";
  // host here also controls the SDK's DNS-rebinding protection. Keep it on localhost
  // for local development; only widen it behind real auth.
  const app = createMcpExpressApp({ host });
  // Open CORS is fine for a localhost demo. If you set HOST to a reachable
  // address, lock this down: a real origin allowlist (cors({ origin: [...] })),
  // authentication, and the SDK's allowedHosts. Do not expose this as-is.
  app.use(cors());

  app.all("/mcp", async (req: Request, res: Response) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  app.listen(port, host, () => {
    console.log(`MCP server (Streamable HTTP) on http://${host}:${port}/mcp`);
  });
}

async function startStdio(): Promise<void> {
  await createServer().connect(new StdioServerTransport());
}

const main = process.argv.includes("--stdio") ? startStdio : startHttp;
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
