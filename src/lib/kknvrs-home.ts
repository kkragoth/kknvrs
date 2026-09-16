import { homedir } from "node:os";
import { join } from "node:path";

/** Single home for all kknvrs state: config, MCP OAuth tokens, threads.
 * Override with KKNVRS_HOME. Defaults to ~/.config/kknvrs. */
export function kknvrsHome(): string {
    const explicit = process.env["KKNVRS_HOME"];
    if (explicit && explicit.trim()) return explicit;
    return join(homedir(), ".config", "kknvrs");
}

export function kknvrsAuthDir(): string {
    return join(kknvrsHome(), "mcp-auth");
}

export function kknvrsThreadsDir(): string {
    return join(kknvrsHome(), "threads");
}
