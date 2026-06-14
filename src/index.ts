/**
 * Entry point. Two transports:
 *
 *   node dist/index.js            -> Streamable HTTP at http://localhost:3001/mcp
 *   node dist/index.js --stdio    -> stdio (for Claude Desktop / MCP Inspector)
 *
 * A fresh McpServer is built per request in HTTP mode — the SDK requirement that
 * avoids cross-client state leaking between sessions.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import type { Request, Response } from "express";
import { createServer } from "./server.js";

async function startHttp(): Promise<void> {
  const port = parseInt(process.env.PORT ?? "3001", 10);
  const app = createMcpExpressApp({ host: "0.0.0.0" });
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

  app.listen(port, () => {
    console.log(`MCP server (Streamable HTTP) on http://localhost:${port}/mcp`);
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
