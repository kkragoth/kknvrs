import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { kknvrsAuthDir } from "@/lib/kknvrs-home.js";

/** Per-MCP OAuth token persistence (~/.config/kknvrs/mcp-auth/<name>.json).
 * Mirrors what `opencode mcp auth` stores: client registration + tokens. */

export interface McpOAuthTokens {
    access_token: string;
    refresh_token?: string;
    expires_at?: number;
    token_endpoint?: string;
    client_id?: string;
    client_secret?: string;
    scope?: string;
    obtained_at?: number;
}

function authDir(): string {
    return kknvrsAuthDir();
}

function authFile(serverName: string): string {
    const safe = serverName.replace(/[^A-Za-z0-9._-]/g, "_");
    return join(authDir(), `${safe}.json`);
}

export function loadMcpTokens(serverName: string): McpOAuthTokens | null {
    try {
        const f = authFile(serverName);
        if (!existsSync(f)) return null;
        const data = JSON.parse(readFileSync(f, "utf8")) as McpOAuthTokens;
        if (!data || typeof data.access_token !== "string") return null;
        return data;
    } catch {
        return null;
    }
}

export function saveMcpTokens(serverName: string, tokens: McpOAuthTokens): void {
    mkdirSync(authDir(), { recursive: true, mode: 0o700 });
    writeFileSync(authFile(serverName), JSON.stringify({ ...tokens, obtained_at: Date.now() }, null, 2), {
        mode: 0o600,
    });
}

export function clearMcpTokens(serverName: string): void {
    try {
        const f = authFile(serverName);
        if (existsSync(f)) unlinkSync(f);
    } catch {
        // ignore
    }
}

export function isExpired(tokens: McpOAuthTokens, skewMs = 60_000): boolean {
    if (!tokens.expires_at) return false;
    return Date.now() + skewMs >= tokens.expires_at;
}

/** Refresh with the stored refresh_token when possible; returns fresh tokens or null. */
export async function refreshMcpTokens(serverName: string): Promise<McpOAuthTokens | null> {
    const cur = loadMcpTokens(serverName);
    if (!cur?.refresh_token || !cur.token_endpoint) return null;
    const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: cur.refresh_token,
    });
    if (cur.client_id) body.set("client_id", cur.client_id);
    if (cur.client_secret) body.set("client_secret", cur.client_secret);
    let res: Response;
    try {
        res = await fetch(cur.token_endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
        });
    } catch {
        return null;
    }
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
    } | null;
    if (!data || typeof data.access_token !== "string") return null;
    const next: McpOAuthTokens = {
        ...cur,
        access_token: data.access_token,
        refresh_token: typeof data.refresh_token === "string" ? data.refresh_token : cur.refresh_token,
        scope: typeof data.scope === "string" ? data.scope : cur.scope,
        expires_at: typeof data.expires_in === "number" ? Date.now() + data.expires_in * 1000 : cur.expires_at,
    };
    saveMcpTokens(serverName, next);
    return next;
}

/** Valid (non-expired, refreshed when possible) access token, or null. */
export async function validAccessToken(serverName: string): Promise<string | null> {
    const cur = loadMcpTokens(serverName);
    if (!cur) return null;
    if (!isExpired(cur)) return cur.access_token;
    const refreshed = await refreshMcpTokens(serverName);
    return refreshed?.access_token ?? null;
}
