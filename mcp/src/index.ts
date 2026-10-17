#!/usr/bin/env node
import { createServer as createHttpServer, type IncomingMessage } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";

/**
 *   euthyna-mcp                 stdio (Claude Code, Claude Desktop, Cursor, …)
 *   euthyna-mcp --http [port]   Streamable HTTP at http://localhost:<port>/mcp (default 3333)
 */
const args = process.argv.slice(2);
const httpIdx = args.indexOf("--http");

if (httpIdx === -1) {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  // stdout carries the protocol, so any log goes to stderr.
  console.error("euthyna-mcp: ready on stdio");
} else {
  const port = Number(args[httpIdx + 1]) || Number(process.env.PORT) || 3333;

  const readBody = (req: IncomingMessage) =>
    new Promise<unknown>((resolve, reject) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        try {
          resolve(raw ? JSON.parse(raw) : undefined);
        } catch (e) {
          reject(e);
        }
      });
      req.on("error", reject);
    });

  createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, name: "euthyna-mcp" }));
      return;
    }
    if (url.pathname !== "/mcp") {
      res.writeHead(404).end("Not found. The MCP endpoint is /mcp");
      return;
    }
    if (req.method !== "POST") {
      // Stateless server: no sessions to stream or delete.
      res.writeHead(405, { allow: "POST" }).end("Method not allowed");
      return;
    }
    try {
      // Stateless: a fresh server and transport per request, so requests never share state.
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, await readBody(req));
    } catch (e) {
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: e instanceof Error ? e.message : "internal error" }, id: null }));
    }
  }).listen(port, () => console.error(`euthyna-mcp: Streamable HTTP on http://localhost:${port}/mcp`));
}
