import type { ToolDefinition } from "@photon/harness";
import { bashTool } from "./bash.js";
import { csTool } from "./cs.js";
import { lsTool } from "./ls.js";

export function createDefaultToolset(): ToolDefinition[] {
  return [lsTool, csTool, bashTool];
}

export { lsTool, csTool, bashTool };
