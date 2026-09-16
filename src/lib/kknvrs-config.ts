import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import yaml from "yaml";
import { kknvrsHome } from "@/lib/kknvrs-home.js";

/** opencode-style config for kknvrs: external MCPs + per-website agents + providers.
 * No backend: the ReAct loop runs in-CLI (Ollama) against external MCPs only. */

export interface RemoteMcpEntry {
    type: "remote";
    url: string;
    enabled?: boolean;
    /** false = plain headers, no OAuth. object/missing = OAuth DCR flow allowed. */
    oauth?: false | Record<string, unknown>;
    headers?: Record<string, string>;
}

export interface LocalMcpEntry {
    type: "local";
    command: string[];
    enabled?: boolean;
    env?: Record<string, string>;
}

export type McpEntry = RemoteMcpEntry | LocalMcpEntry;

export function isRemoteMcp(entry: McpEntry): entry is RemoteMcpEntry {
    return entry.type === "remote";
}

export function isMcpEnabled(entry: McpEntry): boolean {
    return entry.enabled !== false;
}

/** One agent = one website under test (multiple agents per website allowed,
 * e.g. notebortt-explorer vs notebortt- adversarial). */
export interface AgentDef {
    /** Model name, e.g. "gemma4:31b-cloud". Provider defaults to ollama. */
    model?: string;
    provider?: string;
    systemPrompt?: string;
    /** Keys into top-level `mcp`. Empty = all enabled servers. */
    mcps?: string[];
    maxSteps?: number;
}

export interface OllamaProviderOptions {
    baseURL?: string;
}

export interface KknvrsConfig {
    $schema?: string;
    mcp?: Record<string, McpEntry>;
    agent?: Record<string, AgentDef>;
    defaultAgent?: string;
    provider?: {
        ollama?: OllamaProviderOptions;
    };
}

export interface ResolvedAgent extends AgentDef {
    name: string;
    provider: string;
    model: string;
    mcps: string[];
    maxSteps: number;
}

export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
export const DEFAULT_MODEL = "gemma4:31b-cloud";
export const DEFAULT_PROVIDER = "ollama";
export const DEFAULT_MAX_STEPS = 25;

const ENV_RE = /\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g;

export function expandEnv(value: string): string {
    return value.replace(ENV_RE, (_m, name: string) => process.env[name] ?? "");
}

function expandStrings(obj: unknown): unknown {
    if (typeof obj === "string") return expandEnv(obj);
    if (Array.isArray(obj)) return obj.map(expandStrings);
    if (obj && typeof obj === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) out[k] = expandStrings(v);
        return out;
    }
    return obj;
}

export function configDir(): string {
    return kknvrsHome();
}

export function defaultConfigPaths(): string[] {
    return [join(process.cwd(), "kknvrs.json"), join(configDir(), "kknvrs.json")];
}

export function resolveConfigPath(explicit?: string): string | null {
    if (explicit) return explicit;
    if (process.env["KKNVRS_CONFIG"]) return process.env["KKNVRS_CONFIG"] as string;
    for (const p of defaultConfigPaths()) {
        if (existsSync(p)) return p;
    }
    return null;
}

export function loadConfigFile(path: string): KknvrsConfig {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return expandStrings(parsed) as KknvrsConfig;
}

export interface LoadedConfig {
    config: KknvrsConfig;
    path: string;
}

export function loadKknvrsConfig(explicit?: string): LoadedConfig | null {
    const path = resolveConfigPath(explicit);
    if (!path) return null;
    if (!existsSync(path)) throw new Error(`config not found at ${path} — run: kknvrs init`);
    const config = loadConfigFile(path);
    // File agents (agents/*.md) merge under inline agents: per-agent fields
    // from kknvrs.json win, file supplies the rest (notably systemPrompt).
    const fileAgents = loadFileAgents(path);
    const inlineAgents = config.agent ?? {};
    const merged: Record<string, AgentDef> = { ...fileAgents };
    for (const [name, inline] of Object.entries(inlineAgents)) {
        merged[name] = { ...(fileAgents[name] ?? {}), ...inline };
    }
    config.agent = merged;
    return { config, path };
}

/** Agent definition files: <config-dir>/agents/*.md plus ~/.config/kknvrs/agents/*.md.
 * Same shape as opencode agents — YAML frontmatter (provider, model, mcps,
 * maxSteps; unknown keys like mode/permission are ignored) + markdown body
 * as the system prompt. File name (minus .md) is the agent name. */
export function agentsDirs(configPath: string): string[] {
    return [join(dirname(configPath), "agents"), join(kknvrsHome(), "agents")];
}

function normalizeMcps(raw: unknown): string[] | undefined {
    if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === "string");
    if (typeof raw === "string") {
        const parts = raw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        return parts.length > 0 ? parts : undefined;
    }
    return undefined;
}

export function parseAgentMarkdown(name: string, content: string): AgentDef {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) return { systemPrompt: content.trim() || undefined };
    let front: Record<string, unknown> = {};
    try {
        front = (yaml.parse(match[1] as string) as Record<string, unknown> | null) ?? {};
    } catch {
        front = {};
    }
    void name;
    const def: AgentDef = {};
    if (typeof front["provider"] === "string") def.provider = front["provider"];
    if (typeof front["model"] === "string") def.model = front["model"];
    const mcps = normalizeMcps(front["mcps"]);
    if (mcps) def.mcps = mcps;
    if (typeof front["maxSteps"] === "number") def.maxSteps = front["maxSteps"];
    const body = (match[2] ?? "").trim();
    if (body) def.systemPrompt = body;
    return def;
}

export function loadFileAgents(configPath: string): Record<string, AgentDef> {
    const out: Record<string, AgentDef> = {};
    for (const dir of agentsDirs(configPath)) {
        let names: string[];
        try {
            names = readdirSync(dir);
        } catch {
            continue;
        }
        for (const file of names) {
            if (!file.endsWith(".md")) continue;
            const name = file.slice(0, -".md".length);
            if (out[name]) continue;
            try {
                out[name] = parseAgentMarkdown(name, readFileSync(join(dir, file), "utf8"));
            } catch {
                // skip unreadable agent files
            }
        }
    }
    return out;
}

export function ollamaBaseUrl(config: KknvrsConfig | null, override?: string): string {
    if (override) return override.replace(/\/$/, "");
    const fromEnv = process.env["KKNVRS_OLLAMA_URL"] ?? process.env["OLLAMA_BASE_URL"];
    if (fromEnv) return fromEnv.replace(/\/$/, "");
    const fromConfig = config?.provider?.ollama?.baseURL;
    if (fromConfig) return fromConfig.replace(/\/$/, "");
    return DEFAULT_OLLAMA_BASE_URL;
}

export function listAgents(config: KknvrsConfig): string[] {
    return Object.keys(config.agent ?? {});
}

export function resolveAgent(config: KknvrsConfig, name?: string): ResolvedAgent {
    const agents = config.agent ?? {};
    const names = Object.keys(agents);
    const pick = name ?? config.defaultAgent ?? names[0];
    if (!pick || !agents[pick]) {
        throw new Error(
            names.length === 0
                ? "no agents defined — run: kknvrs init"
                : `unknown agent "${pick ?? ""}". Available: ${names.join(", ")}`,
        );
    }
    const def = agents[pick] as AgentDef;
    const enabledMcps = Object.entries(config.mcp ?? {})
        .filter(([, e]) => isMcpEnabled(e as McpEntry))
        .map(([k]) => k);
    const mcps = def.mcps && def.mcps.length > 0 ? def.mcps : enabledMcps;
    return {
        ...def,
        name: pick,
        provider: (def.provider ?? DEFAULT_PROVIDER).toLowerCase(),
        model: def.model ?? DEFAULT_MODEL,
        mcps,
        maxSteps: def.maxSteps ?? DEFAULT_MAX_STEPS,
    };
}

/** Agent servers filtered to enabled + present in config (warn on missing). */
export function agentServers(config: KknvrsConfig, agent: ResolvedAgent): string[] {
    const out: string[] = [];
    for (const name of agent.mcps) {
        const entry = config.mcp?.[name];
        if (!entry) throw new Error(`agent "${agent.name}" wants unknown mcp "${name}"`);
        if (isMcpEnabled(entry)) out.push(name);
    }
    return out;
}

export function exampleConfig(): string {
    return JSON.stringify(
        {
            $schema: "https://kknvrs.local/config.json",
            mcp: {
                "notebortt-local": {
                    type: "remote",
                    url: "http://localhost:8080/mcp",
                    oauth: {},
                },
                notebortt: {
                    type: "remote",
                    url: "https://api.notebortt-api.com/mcp",
                    oauth: {},
                    enabled: false,
                },
                "todoist-ai": {
                    type: "remote",
                    url: "http://localhost:8000/mcp/",
                    oauth: false,
                    headers: { Authorization: "Bearer {env:TODOIST_AI_TOKEN}" },
                },
            },
            agent: {
                "notebortt-explorer": {
                    provider: "ollama",
                    model: "gemma4:31b-cloud",
                    mcps: ["notebortt-local"],
                    systemPrompt:
                        "You are testing the Notebortt web app through its MCP tools. " +
                        "Explore first (list boards/notes), never guess IDs, narrate what you do.",
                },
                "notebortt-adversarial": {
                    provider: "ollama",
                    model: "gemma4:31b-cloud",
                    mcps: ["notebortt-local"],
                    systemPrompt:
                        "You are adversarially testing the Notebortt web app. " +
                        "Try invalid args, missing IDs, and out-of-order calls; report failures precisely.",
                },
                "todoist-smoke": {
                    provider: "ollama",
                    model: "gemma4:31b-cloud",
                    mcps: ["todoist-ai"],
                    systemPrompt: "Smoke-test the Todoist MCP: list, add, complete one todo, then report.",
                },
            },
            defaultAgent: "notebortt-explorer",
            provider: { ollama: { baseURL: "http://127.0.0.1:11434" } },
        },
        null,
        4,
    );
}

export function writeExampleConfig(path: string): void {
    const dir = path.split("/").slice(0, -1).join("/") || ".";
    mkdirSync(dir, { recursive: true });
    if (existsSync(path)) throw new Error(`refusing to overwrite existing ${path}`);
    writeFileSync(path, exampleConfig() + "\n");
}
