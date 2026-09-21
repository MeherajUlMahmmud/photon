import type { ToolDefinition } from "@photon/harness";
import { bashTool } from "./bash.js";
import { csTool } from "./cs.js";
import { lsTool } from "./ls.js";
import { readFileTool } from "./read_file.js";
import { writeFileTool } from "./write_file.js";

/**
 * Every tool the desktop can run. Names match the rows the server seeds in
 * `LlmToolModel` (`4_create_default_llm_tools`): the model asks for a name,
 * the desktop looks it up here.
 */
export function createDefaultToolset(): ToolDefinition[] {
  return [lsTool, csTool, readFileTool, writeFileTool, bashTool];
}

export { lsTool, csTool, readFileTool, writeFileTool, bashTool };
