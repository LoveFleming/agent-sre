/**
 * mcp-server.mjs — MCP Server (Model Context Protocol)
 *
 * Exposes agent-sre's tools and crews to external MCP clients
 * (Claude Desktop, Cursor, custom clients, etc.)
 *
 * Protocol: JSON-RPC 2.0 over stdio
 *
 * Usage:
 *   node server/mcp-server.mjs                    # stdio mode (for Claude Desktop etc.)
 *   node server/mcp-server.mjs --port 4300        # SSE mode (HTTP)
 *
 * Claude Desktop config example:
 *   {
 *     "mcpServers": {
 *       "agent-sre": {
 *         "command": "node",
 *         "args": ["/path/to/agent-sre/server/mcp-server.mjs"]
 *       }
 *     }
 *   }
 */

import { createServer } from "http";
import { loadAllTools } from "./tool-loader.mjs";
import { loadAllCrews } from "./crew-loader.mjs";
import { toolRegistry } from "./tool-registry.mjs";
import { runAgentLoop } from "./agent-loop.mjs";
import { getCrew } from "./crew-loader.mjs";
import { loadConversation, saveConversation } from "./conversation.mjs";

// ── JSON-RPC helpers ──

function rpcResult(id, result) {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

function rpcError(id, code, message) {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

/** Build MCP tool list from registered tools */
function buildMCPTools() {
  const names = toolRegistry.list();
  return names.map(name => {
    const entry = toolRegistry.get(name);
    const fn = entry.definition.function;
    return {
      name: fn.name,
      description: fn.description,
      inputSchema: fn.parameters || { type: "object", properties: {} },
    };
  });
}

/** Build MCP resource list from crews */
function buildMCPResources() {
  const crews = loadAllCrews();
  return crews.map(c => ({
    uri: `sre://crew/${c.id}`,
    name: `${c.emoji || "👤"} ${c.codename || c.title}`,
    description: c.description || c.expertise?.slice(0, 100) || "",
    mimeType: "application/json",
  }));
}

/** Build MCP prompts from crews */
function buildMCPPrompts() {
  const crews = loadAllCrews();
  return crews.map(c => ({
    name: `chat_${c.id.replace(/\./g, "_")}`,
    description: `Chat with ${c.codename || c.title} — ${c.description?.slice(0, 60) || ""}`,
    arguments: [
      {
        name: "message",
        description: "Message to the SRE agent",
        required: true,
      },
    ],
  }));
}

// ── Handle single JSON-RPC request ──

async function handleRequest(msg) {
  const { id, method, params } = msg;

  switch (method) {
    // ── Lifecycle ──
    case "initialize": {
      return rpcResult(id, {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: { listChanged: true },
          resources: { listChanged: false },
          prompts: { listChanged: false },
        },
        serverInfo: {
          name: "agent-sre",
          version: "1.0.0",
        },
      });
    }

    case "initialized":
    case "notifications/initialized":
      return null; // notification, no response

    case "ping": {
      return rpcResult(id, {});
    }

    // ── Tools ──
    case "tools/list": {
      return rpcResult(id, { tools: buildMCPTools() });
    }

    case "tools/call": {
      const { name, arguments: args } = params || {};
      const entry = toolRegistry.get(name);
      if (!entry) {
        return rpcError(id, -32602, `Unknown tool: ${name}`);
      }
      try {
        const result = await entry.handler(args || {}, { mcp: true });
        return rpcResult(id, {
          content: [
            {
              type: "text",
              text: result.text || JSON.stringify(result),
            },
          ],
        });
      } catch (err) {
        return rpcResult(id, {
          content: [{ type: "text", text: `Error: ${err.message}` }],
          isError: true,
        });
      }
    }

    // ── Resources ──
    case "resources/list": {
      return rpcResult(id, { resources: buildMCPResources() });
    }

    case "resources/read": {
      const { uri } = params || {};
      const crewMatch = uri?.match(/^sre:\/\/crew\/(.+)$/);
      if (crewMatch) {
        const crew = getCrew(decodeURIComponent(crewMatch[1]));
        if (!crew) return rpcError(id, -32602, "Crew not found");
        return rpcResult(id, {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(crew, null, 2),
            },
          ],
        });
      }
      return rpcError(id, -32602, `Unknown resource: ${uri}`);
    }

    // ── Prompts ──
    case "prompts/list": {
      return rpcResult(id, { prompts: buildMCPPrompts() });
    }

    case "prompts/get": {
      const { name, arguments: args } = params || {};
      // name = "chat_sre_commander" → crewId = "sre.commander"
      const crewId = name?.replace(/^chat_/, "").replace(/_/g, ".");
      const crew = getCrew(crewId);
      if (!crew) return rpcError(id, -32602, `Unknown prompt: ${name}`);

      const message = args?.message || "Hello";
      return rpcResult(id, {
        description: `Chat with ${crew.codename || crew.title}`,
        messages: [
          {
            role: "user",
            content: { type: "text", text: message },
          },
        ],
      });
    }

    // ── Completion (chat with crew via MCP) ──
    case "completion/complete": {
      const { ref, argument } = params || {};
      // Allow external clients to run full agent loop
      const crewId = ref?.uri?.match(/^sre:\/\/crew\/(.+)$/)?.[1];
      if (crewId) {
        const crew = getCrew(decodeURIComponent(crewId));
        if (!crew) return rpcError(id, -32602, "Crew not found");

        const message = argument?.value || "";
        const history = loadConversation(crewId);
        const result = await runAgentLoop({ crew, message, history });
        saveConversation(crewId, result.history);

        return rpcResult(id, {
          completion: {
            text: result.content,
            stopReason: "stop",
          },
        });
      }
      return rpcError(id, -32602, "Invalid completion ref");
    }

    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

// ── Stdio mode ──

async function runStdio() {
  const crews = loadAllCrews();
  const tools = await loadAllTools();
  console.error(`[MCP Server] Loaded ${crews.length} crews, ${tools.length} tools`);

  let buffer = "";

  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", async (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const msg = JSON.parse(trimmed);
        const response = await handleRequest(msg);

        // Send response (null = notification, no response)
        if (response !== null) {
          process.stdout.write(response + "\n");
        }
      } catch (err) {
        const errResponse = rpcError(msg?.id ?? null, -32700, `Parse error: ${err.message}`);
        process.stdout.write(errResponse + "\n");
      }
    }
  });

  process.stdin.on("end", () => {
    process.exit(0);
  });

  // Handle tool list changes (if tools are dynamically added)
  process.on("SIGUSR2", () => {
    const notification = JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/tools/list_changed",
    });
    process.stdout.write(notification + "\n");
  });
}

// ── SSE mode (HTTP) ──

async function runSSE(port) {
  const crews = loadAllCrews();
  const tools = await loadAllTools();
  console.log(`[MCP Server] Loaded ${crews.length} crews, ${tools.length} tools`);

  const server = createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 1024 * 1024) {
          res.writeHead(413);
          res.end();
        }
      });
      req.on("end", async () => {
        try {
          const msg = JSON.parse(body);
          const response = await handleRequest(msg);
          if (response !== null) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(response);
          } else {
            res.writeHead(204);
            res.end();
          }
        } catch (err) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(rpcError(null, -32700, `Parse error: ${err.message}`));
        }
      });
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  server.listen(port, () => {
    console.log(`[MCP Server] SSE endpoint: http://localhost:${port}`);
  });
}

// ── Main ──

const args = process.argv.slice(2);
const portIdx = args.indexOf("--port");
const port = portIdx >= 0 ? parseInt(args[portIdx + 1], 10) : null;

if (port) {
  runSSE(port);
} else {
  runStdio();
}
