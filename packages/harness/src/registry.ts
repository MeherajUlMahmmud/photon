import type { ToolDefinition, ToolRegistry } from "./types.js";

export class InMemoryToolRegistry implements ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  schemasForModel() {
    return this.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      // Zod → JSON Schema is left to providers/adapters later; expose raw shape hint
      inputSchema: zodToRoughJsonSchema(tool.inputSchema),
    }));
  }
}

function zodToRoughJsonSchema(schema: ToolDefinition["inputSchema"]): Record<string, unknown> {
  // Minimal placeholder; providers can replace with a proper zod-to-json-schema later.
  return {
    type: "object",
    description: schema.description ?? "tool input",
  };
}
