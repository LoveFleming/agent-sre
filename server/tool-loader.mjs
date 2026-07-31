/**
 * tool-loader.mjs — Auto-discover and register tool providers from tools/ directory
 *
 * Each provider has:
 *   tools/<provider-id>/handler.mjs   — default export: async (args, ctx) => { text, data?, error? }
 *   tools/<provider-id>/tools/*.json  — tool definitions { name, description, parameters }
 *   tools/<provider-id>/config.json   — optional provider config
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { toolRegistry } from "./tool-registry.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const TOOLS_DIR = resolve(ROOT, "tools");

/** Load all tool providers */
export async function loadAllTools() {
  const loaded = [];

  if (!existsSync(TOOLS_DIR)) return loaded;

  const providers = readdirSync(TOOLS_DIR).filter(f =>
    statSync(join(TOOLS_DIR, f)).isDirectory()
  );

  for (const providerId of providers) {
    const providerDir = join(TOOLS_DIR, providerId);
    const handlerPath = join(providerDir, "handler.mjs");
    const toolsDir = join(providerDir, "tools");

    if (!existsSync(handlerPath) || !existsSync(toolsDir)) continue;

    try {
      // Import handler — fix PAAW_ROOT references to use agent-sre ROOT
      const handler = (await import(handlerPath)).default;

      // Load all tool definitions
      const toolFiles = readdirSync(toolsDir).filter(f => f.endsWith(".json"));

      for (const toolFile of toolFiles) {
        const toolPath = join(toolsDir, toolFile);
        try {
          const def = JSON.parse(readFileSync(toolPath, "utf-8"));

          // Register each tool with a closure that sets ROOT
          const wrappedHandler = async (args, ctx) => {
            // Set ROOT env so handlers can find their config
            const originalRoot = process.env.PAAW_ROOT;
            process.env.PAAW_ROOT = ROOT;
            try {
              return await handler(args, { ...ctx, providerId, rootPath: ROOT });
            } finally {
              if (originalRoot !== undefined) process.env.PAAW_ROOT = originalRoot;
            }
          };

          const toolName = def.name || toolFile.replace(".json", "");
          toolRegistry.register({
            name: toolName,
            definition: {
              type: "function",
              function: {
                name: toolName,
                description: def.description || "",
                parameters: def.parameters || { type: "object", properties: {} },
              },
            },
            handler: wrappedHandler,
            source: `provider:${providerId}`,
          });

          loaded.push(`${providerId}/${toolName}`);
        } catch (err) {
          console.error(`[tool-loader] Failed to load ${providerId}/${toolFile}: ${err.message}`);
        }
      }
    } catch (err) {
      console.error(`[tool-loader] Failed to load provider ${providerId}: ${err.message}`);
    }
  }

  return loaded;
}
