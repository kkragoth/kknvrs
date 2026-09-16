import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { KknvrsConfig, McpEntry } from "@/lib/kknvrs-config.js";
import { isRemoteMcp } from "@/lib/kknvrs-config.js";
import { validAccessToken } from "@/lib/mcp-oauth-store.js";

/** Multi-server MCP manager: connects the active agent's servers (remote
 * Streamable HTTP incl. OAuth/JWT headers, plus local stdio) and exposes an
 * aggregated tool list to the in-CLI ReAct loop. */

const CLIENT_NAME = "kknvrs-cli";
const CLIENT_VERSION = "0.1.0";

export const TOOL_SEP = "__";

interface CachedClient {
    client: Client;
    key: string;
}

const cache = new Map<string, CachedClient>();

export interface AggregatedTool {
    /** Namespaced name exposed to the model: "<server>__<tool>". */
    name: string;
    server: string;
    tool: string;
    description?: string;
    inputSchema: Record<string, unknown>;
}

export function splitToolName(namespaced: string): { server: string; tool: string } | null {
    const ix = namespaced.indexOf(TOOL_SEP);
    if (ix <= 0) return null;
    return { server: namespaced.slice(0, ix), tool: namespaced.slice(ix + TOOL_SEP.length) };
}

async function authHeaders(config: KknvrsConfig, name: string, entry: McpEntry): Promise<Record<string, string>> {
    void config;
    if (!isRemoteMcp(entry)) return {};
    const headers: Record<string, string> = { ...(entry.headers ?? {}) };
    if (entry.oauth === false) return headers;
    const token = await validAccessToken(name);
    if (token && !headers["Authorization"]) headers["Authorization"] = `Bearer ${token}`;
    return headers;
}

function cacheKey(name: string, headers: Record<string, string>, entry: McpEntry): string {
    if (!isRemoteMcp(entry)) return `local:${name}`;
    return `remote:${name}\n${entry.url}\n${headers["Authorization"] ?? ""}`;
}

export async function getMcpClient(config: KknvrsConfig, name: string, entry: McpEntry): Promise<Client> {
    const headers = await authHeaders(config, name, entry);
    const key = cacheKey(name, headers, entry);
    const hit = cache.get(name);
    if (hit && hit.key === key) return hit.client;
    if (hit) {
        try {
            await hit.client.close();
        } catch {
            // ignore
        }
        cache.delete(name);
    }
    const client = new Client({ name: CLIENT_NAME, version: CLIENT_VERSION });
    try {
        if (isRemoteMcp(entry)) {
            const transport = new StreamableHTTPClientTransport(new URL(entry.url), {
                requestInit: { headers },
            });
            await client.connect(transport);
        } else {
            const transport = new StdioClientTransport({
                command: entry.command[0] ?? "",
                args: entry.command.slice(1),
                env: { ...process.env, ...(entry.env ?? {}) } as Record<string, string>,
            });
            await client.connect(transport);
        }
    } catch (e) {
        const hint = isRemoteMcp(entry) && entry.oauth !== false ? ` (try: /mcp auth ${name})` : "";
        throw new Error(`MCP connect failed for "${name}" (${messageOf(e)})${hint}`);
    }
    cache.set(name, { client, key });
    return client;
}

/** Connect all of an agent's servers; throws a joined error when any fail. */
export async function connectAgentServers(config: KknvrsConfig, serverNames: string[]): Promise<Map<string, Client>> {
    const out = new Map<string, Client>();
    const failures: string[] = [];
    for (const name of serverNames) {
        const entry = config.mcp?.[name];
        if (!entry) {
            failures.push(`"${name}": not in config mcp`);
            continue;
        }
        try {
            out.set(name, await getMcpClient(config, name, entry));
        } catch (e) {
            failures.push(`"${name}": ${messageOf(e)}`);
        }
    }
    if (out.size === 0 && failures.length > 0) {
        throw new Error(`No MCP servers connected:\n• ${failures.join("\n• ")}`);
    }
    return out;
}

export async function closeMcpClients(): Promise<void> {
    const clients = [...cache.values()];
    cache.clear();
    for (const { client } of clients) {
        try {
            await client.close();
        } catch {
            // ignore
        }
    }
}

export async function dropMcpClient(name: string): Promise<void> {
    const hit = cache.get(name);
    if (!hit) return;
    cache.delete(name);
    try {
        await hit.client.close();
    } catch {
        // ignore
    }
}

function messageOf(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

interface TextItem {
    type: string;
    text?: unknown;
}

/** Pull printable text out of a call_tool result (text blocks joined). */
export function toolText(result: unknown): string {
    if (typeof result === "object" && result !== null && "content" in result) {
        const content = (result as { content?: unknown }).content;
        if (Array.isArray(content)) {
            const parts: string[] = [];
            for (const item of content) {
                if (
                    typeof item === "object" &&
                    item !== null &&
                    (item as TextItem).type === "text" &&
                    typeof (item as TextItem).text === "string"
                ) {
                    parts.push((item as TextItem).text as string);
                }
            }
            if (parts.length > 0) return parts.join("\n");
        }
    }
    return JSON.stringify(result);
}

/** Pull text out of a resources/read result (first content entry). */
export function resourceText(result: unknown): string {
    if (typeof result === "object" && result !== null && "contents" in result) {
        const contents = (result as { contents?: unknown }).contents;
        if (Array.isArray(contents) && contents.length > 0) {
            const first = contents[0] as { text?: unknown };
            if (typeof first.text === "string") return first.text;
            return JSON.stringify(first);
        }
    }
    return JSON.stringify(result);
}

export async function listAggregatedTools(clients: Map<string, Client>): Promise<AggregatedTool[]> {
    const out: AggregatedTool[] = [];
    for (const [server, client] of clients) {
        const { tools } = await client.listTools();
        for (const t of tools) {
            out.push({
                name: `${server}${TOOL_SEP}${t.name}`,
                server,
                tool: t.name,
                description: t.description,
                inputSchema: (t.inputSchema as Record<string, unknown> | undefined) ?? {
                    type: "object",
                    properties: {},
                },
            });
        }
    }
    return out;
}

export async function callAggregatedTool(
    clients: Map<string, Client>,
    namespaced: string,
    args: Record<string, unknown>,
): Promise<string> {
    const split = splitToolName(namespaced);
    if (!split) throw new Error(`unknown tool "${namespaced}"`);
    const client = clients.get(split.server);
    if (!client) throw new Error(`MCP server "${split.server}" is not connected`);
    try {
        return toolText(await client.callTool({ name: split.tool, arguments: args }));
    } catch (e) {
        throw new Error(`MCP ${namespaced} failed (${messageOf(e)})`);
    }
}

export async function mcpStatusFor(config: KknvrsConfig, serverNames: string[]): Promise<string> {
    const lines: string[] = [];
    for (const name of serverNames) {
        const entry = config.mcp?.[name];
        if (!entry) {
            lines.push(`• ${name}: missing from config`);
            continue;
        }
        try {
            const client = await getMcpClient(config, name, entry);
            const [tools, resources, prompts] = await Promise.all([
                client.listTools(),
                client.listResources().catch(() => ({ resources: [] as never[] })),
                client.listPrompts().catch(() => ({ prompts: [] as never[] })),
            ]);
            const version = client.getServerVersion();
            const label = version?.name ?? (isRemoteMcp(entry) ? entry.url : "local");
            lines.push(
                `• ${name}: ${label} · ${tools.tools.length} tools · ${resources.resources.length} resources · ${prompts.prompts.length} prompts`,
            );
        } catch (e) {
            lines.push(`• ${name}: FAILED — ${messageOf(e)}`);
        }
    }
    return lines.length > 0 ? ["MCP servers:", ...lines].join("\n") : "No MCP servers configured.";
}

/** ---- MCP prompt discovery (lets the agent pull server prompts mid-turn) ---- */

export interface AggregatedPrompt {
    /** Namespaced name: "<server>__<prompt>". */
    name: string;
    server: string;
    prompt: string;
    description?: string;
    arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

export async function listAggregatedPrompts(clients: Map<string, Client>): Promise<AggregatedPrompt[]> {
    const out: AggregatedPrompt[] = [];
    for (const [server, client] of clients) {
        let prompts: Awaited<ReturnType<Client["listPrompts"]>>["prompts"];
        try {
            ({ prompts } = await client.listPrompts());
        } catch {
            continue;
        }
        for (const p of prompts) {
            out.push({
                name: `${server}${TOOL_SEP}${p.name}`,
                server,
                prompt: p.name,
                description: p.description,
                arguments: p.arguments as AggregatedPrompt["arguments"],
            });
        }
    }
    return out;
}

function promptArgsToStrings(args: Record<string, unknown>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(args)) {
        if (v === undefined || v === null) continue;
        out[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
    return out;
}

/** Fetch one server prompt and render its messages as followable text. */
export async function getPromptText(
    clients: Map<string, Client>,
    namespaced: string,
    args: Record<string, unknown>,
): Promise<string> {
    const split = splitToolName(namespaced);
    if (!split) throw new Error(`unknown prompt "${namespaced}"`);
    const client = clients.get(split.server);
    if (!client) throw new Error(`MCP server "${split.server}" is not connected`);
    let result: Awaited<ReturnType<Client["getPrompt"]>>;
    try {
        result = await client.getPrompt({ name: split.tool, arguments: promptArgsToStrings(args) });
    } catch (e) {
        throw new Error(`MCP prompt ${namespaced} failed (${messageOf(e)})`);
    }
    const lines = [`[MCP prompt ${namespaced} — follow these instructions:]`];
    for (const m of result.messages ?? []) {
        const role = m.role ?? "user";
        const content = m.content;
        if (content && typeof content === "object" && "text" in content && typeof content.text === "string") {
            lines.push(`<${role}>: ${content.text}`);
        } else {
            lines.push(`<${role}>: ${JSON.stringify(content)}`);
        }
    }
    if (result.description) lines.push(`(description: ${result.description})`);
    return lines.join("\n");
}
