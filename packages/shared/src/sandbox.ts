import path from "node:path";
import fs from "node:fs";

export class PathSandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathSandboxError";
  }
}

/**
 * Restricts filesystem paths to an allowlist of workspace roots.
 * Opening a workspace grants RW inside that root only.
 */
export class PathSandbox {
  private readonly roots: string[];

  constructor(roots: string[]) {
    if (roots.length === 0) {
      throw new PathSandboxError("At least one workspace root is required");
    }
    this.roots = roots.map((root) => this.canonicalize(root));
  }

  get primaryRoot(): string {
    return this.roots[0]!;
  }

  get allowlist(): readonly string[] {
    return this.roots;
  }

  /** Resolve a user/tool path and ensure it stays inside an allowlisted root. */
  resolve(inputPath: string, cwd = this.primaryRoot): string {
    const base = path.isAbsolute(inputPath) ? inputPath : path.resolve(cwd, inputPath);
    const resolved = this.canonicalize(base);
    if (!this.isInsideAllowlist(resolved)) {
      throw new PathSandboxError(`Path escapes workspace allowlist: ${inputPath}`);
    }
    return resolved;
  }

  isInsideAllowlist(absolutePath: string): boolean {
    const resolved = this.canonicalize(absolutePath);
    return this.roots.some((root) => resolved === root || resolved.startsWith(root + path.sep));
  }

  private canonicalize(p: string): string {
    const absolute = path.resolve(p);
    try {
      return fs.realpathSync.native(absolute);
    } catch {
      // Path may not exist yet (e.g. create). Canonicalize existing parents.
      const parent = path.dirname(absolute);
      const base = path.basename(absolute);
      try {
        return path.join(fs.realpathSync.native(parent), base);
      } catch {
        return absolute;
      }
    }
  }
}
