/**
 * tool-loader.mjs — Auto-discover and register tool providers from tools/ directory
 *
 * Each provider has:
 *   tools/<provider-id>/handler.mjs   — default export: async (args, ctx) => { text, data?, error? }
 *   tools/<provider-id>/tools/*.json  — tool definitions { name, description, parameters }
 *   tools/<provider-id>/config.json   — optional provider config
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { resolve, dirname, relative, isAbsolute } from "path";
import { fileURLToPath } from "url";
import { toolRegistry } from "./tool-registry.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const TOOLS_DIR = resolve(ROOT, "tools");

/**
 * Resolve `child` against `base` and assert the result stays within `base`.
 * Rejects path traversal (`../`) and absolute paths that escape the base dir.
 * @param {string} base - Absolute base directory to anchor to.
 * @param {...string} child - Path segments to resolve under `base`.
 * @returns {string} The safe absolute path within `base`.
 * @throws {Error} If the resolved path escapes `base`.
 */
function safeResolve(base, ...child) {
  const childPath = child.length === 1 ? child[0] : child.join("/");
  // Reject absolute paths passed as child segments — they would hijack join/resolve.
  if (isAbsolute(childPath)) {
    throw new Error(`Path traversal blocked: absolute path "${childPath}"`);
  }
  const resolved = resolve(base, childPath);
  const rel = relative(base, resolved);
  // `relative()` returns a string starting with `..` (or `""` when equal) on escape.
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path traversal blocked: "${childPath}" escapes base "${base}"`);
  }
  return resolved;
}

/** Load all tool providers */
export async function loadAllTools() {
  const loaded = [];

  if (!existsSync(TOOLS_DIR)) return loaded;

  const providers = readdirSync(TOOLS_DIR).filter(f => {
    const dirPath = safeResolve(TOOLS_DIR, f);
    return statSync(dirPath).isDirectory();
  });

  for (const providerId of providers) {
    const providerDir = safeResolve(TOOLS_DIR, providerId);
    const handlerPath = safeResolve(providerDir, "handler.mjs");
    const toolsDir = safeResolve(providerDir, "tools");

    if (!existsSync(handlerPath) || !existsSync(toolsDir)) continue;

    try {
      // Import handler — fix PAAW_ROOT references to use agent-sre ROOT.
      // handlerPath is already validated to be within providerDir by safeResolve.
      const handler = (await import(handlerPath)).default;

      // Load all tool definitions
      const toolFiles = readdirSync(toolsDir).filter(f => f.endsWith(".json"));

      for (const toolFile of toolFiles) {
        const toolPath = safeResolve(toolsDir, toolFile);
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
