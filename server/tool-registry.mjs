/**
 * tool-registry.mjs — Tool registration + execution system
 *
 * Any module can register tools. The agent loop queries definitions and executes calls.
 *
 * ToolEntry = {
 *   name: string
 *   definition: { type: "function", function: { name, description, parameters } }
 *   handler: (args, ctx) => Promise<{ text: string, data?: any, error?: boolean }>
 *   source?: string
 * }
 */

class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  /** Register a tool */
  register(entry) {
    if (!entry?.name) throw new Error("Tool must have a name");
    this.tools.set(entry.name, entry);
  }

  /** Register multiple tools */
  registerAll(entries) {
    for (const e of entries) this.register(e);
  }

  /** Get all tool definitions (for LLM) */
  getDefinitions(filterNames) {
    const tools = filterNames
      ? [...this.tools.values()].filter(t => filterNames.includes(t.name))
      : [...this.tools.values()];
    return tools.map(t => t.definition);
  }

  /** Get tool by name */
  get(name) {
    return this.tools.get(name);
  }

  /** List all registered tool names */
  list() {
    return [...this.tools.keys()];
  }

  /** Execute a tool call from LLM response */
  async execute(call, ctx = {}) {
    const name = call.function?.name || call.name;
    if (!name) return { text: "Invalid tool call: missing name", error: true };

    const entry = this.tools.get(name);
    if (!entry) return { text: `Unknown tool: ${name}`, error: true };

    let args = {};
    try {
      args = call.function?.arguments
        ? JSON.parse(call.function.arguments)
        : call.arguments || {};
    } catch {
      args = {};
    }

    ctx.toolName = name;

    try {
      const result = await entry.handler(args, ctx);
      return result || { text: "(no output)" };
    } catch (err) {
      return { text: `Tool "${name}" error: ${err.message}`, error: true };
    }
  }

  /** Clear all tools */
  clear() {
    this.tools.clear();
  }
}

export const toolRegistry = new ToolRegistry();
export default toolRegistry;
