/**
 * mcp-client.mjs — MCP Client
 *
 * Connects to external MCP servers and registers their tools
 * into agent-sre's tool registry.
 *
 * Supports stdio transport (spawn child process).
 *
 * Config format (config/mcp-servers.json):
 *   {
 *     "servers": {
 *       "filesystem": {
 *         "command": "npx",
 *         "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
 *         "env": {}
 *       },
 *       "github": {
 *         "command": "npx",
 *         "args": ["-y", "@modelcontextprotocol/server-github"],
 *         "env": { "GITHUB_TOKEN": "ghp_..." }
 *       }
 *     }
 *   }
 */

import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { toolRegistry } from "./tool-registry.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

/** Load MCP server config */
function loadMCPConfig() {
  const configPath = resolve(ROOT, "config/mcp-servers.json");
  if (!existsSync(configPath)) return { servers: {} };
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return { servers: {} };
  }
}

class MCPClient {
  constructor(name, config) {
    this.name = name;
    this.config = config;
    this.process = null;
    this.msgId = 0;
    this.pending = new Map(); // id → {resolve, reject}
    this.buffer = "";
    this.tools = [];
    this.initialized = false;
  }

  /** Start the MCP server process and initialize */
  async connect() {
    const { command, args = [], env = {} } = this.config;

    this.process = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });

    this.process.stderr.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg) console.log(`[mcp:${this.name}] ${msg}`);
    });

    this.process.stdout.on("data", (data) => this._onData(data));
    this.process.on("exit", (code) => {
      console.log(`[mcp:${this.name}] Process exited (code ${code})`);
      this.initialized = false;
    });

    // Wait for process to start
    await new Promise(r => setTimeout(r, 500));

    // Initialize handshake
    const initResult = await this._request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "agent-sre", version: "1.0.0" },
    });

    this._notify("notifications/initialized", {});
    this.initialized = true;

    // Load tools
    await this._loadTools();

    return this.tools;
  }

  /** List + register tools from MCP server */
  async _loadTools() {
    const result = await this._request("tools/list", {});
    this.tools = result.tools || [];
  }

  /** Call a tool on the MCP server */
  async callTool(name, args) {
    const result = await this._request("tools/call", { name, arguments: args });
    // Extract text from content array
    if (result.content?.length) {
      const texts = result.content
        .filter(c => c.type === "text")
        .map(c => c.text);
      return { text: texts.join("\n"), error: result.isError };
    }
    return { text: JSON.stringify(result), error: result.isError };
  }

  /** Send JSON-RPC request (returns promise) */
  _request(method, params) {
    const id = ++this.msgId;
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timeout: ${method} (server: ${this.name})`));
      }, 30_000);

      this.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });

      this.process.stdin.write(msg + "\n");
    });
  }

  /** Send JSON-RPC notification (no response expected) */
  _notify(method, params) {
    const msg = JSON.stringify({ jsonrpc: "2.0", method, params });
    this.process.stdin.write(msg + "\n");
  }

  /** Handle stdout data (parse JSON-RPC responses) */
  _onData(data) {
    this.buffer += data.toString();
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const msg = JSON.parse(trimmed);

        // Response to our request
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) {
            reject(new Error(msg.error.message || "MCP error"));
          } else {
            resolve(msg.result);
          }
        }
        // Notifications (we can handle tool list changes etc. later)
        else if (msg.method === "notifications/tools/list_changed") {
          this._loadTools().catch(() => {});
        }
      } catch {}
    }
  }

  /** Disconnect */
  disconnect() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.initialized = false;
  }
}

/** Connect to all configured MCP servers and register their tools */
export async function connectAllMCPServers() {
  const config = loadMCPConfig();
  const servers = config.servers || {};
  const clients = [];
  const registered = [];

  for (const [name, serverConfig] of Object.entries(servers)) {
    try {
      const client = new MCPClient(name, serverConfig);
      const tools = await client.connect();

      // Register each tool in our registry
      for (const tool of tools) {
        const toolName = `mcp.${name}.${tool.name}`;

        // Create a handler that calls the MCP server
        const handler = async (args) => {
          return await client.callTool(tool.name, args);
        };

        toolRegistry.register({
          name: toolName,
          definition: {
            type: "function",
            function: {
              name: toolName,
              description: `[MCP:${name}] ${tool.description || ""}`,
              parameters: tool.inputSchema || { type: "object", properties: {} },
            },
          },
          handler,
          source: `mcp:${name}`,
        });

        registered.push(toolName);
      }

      clients.push(client);
      console.log(`[mcp-client] Connected to "${name}": ${tools.length} tools registered`);
    } catch (err) {
      console.error(`[mcp-client] Failed to connect "${name}": ${err.message}`);
    }
  }

  return { clients, registered };
}

/** Graceful shutdown for all MCP clients */
export function disconnectAllMCPClients(clients) {
  for (const c of clients) {
    try { c.disconnect(); } catch {}
  }
}
