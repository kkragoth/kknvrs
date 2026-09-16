import { create } from "zustand";
import { ollamaTags } from "@/api.js";
import { ConnectionStatus } from "@/lib/connection.js";
import {
    DEFAULT_MODEL,
    DEFAULT_PROVIDER,
    listAgents,
    loadKknvrsConfig,
    ollamaBaseUrl,
    resolveAgent,
    type KknvrsConfig,
} from "@/lib/kknvrs-config.js";
import { closeMcpClients } from "@/lib/mcp-manager.js";
import type { CliOptions } from "@/types.js";

/** Global session: loaded kknvrs.json + active agent + provider/model + local thread.
 * No backend login — auth is per-MCP (headers or OAuth via `kknvrs mcp auth`). */
interface SessionState {
    configPath: string;
    config: KknvrsConfig | null;
    configError: string;
    agentName: string;
    provider: string;
    model: string;
    ollamaBaseUrl: string;
    threadId: string;
    connection: ConnectionStatus;
    init: (options: CliOptions) => void;
    reloadConfig: () => void;
    setAgentName: (name: string) => void;
    setThreadId: (threadId: string) => void;
    setProvider: (provider: string | undefined) => void;
    setModel: (model: string | undefined) => void;
    setConnection: (connection: ConnectionStatus) => void;
    checkConnection: () => Promise<boolean>;
}

function agentDefault(config: KknvrsConfig | null, explicit: string | undefined): string {
    if (explicit) return explicit;
    if (process.env["KKNVRS_AGENT"]) return process.env["KKNVRS_AGENT"] as string;
    if (config?.defaultAgent) return config.defaultAgent;
    const names = config ? listAgents(config) : [];
    return names[0] ?? "";
}

export const useSessionStore = create<SessionState>()((set, get) => ({
    configPath: "",
    config: null,
    configError: "",
    agentName: "",
    provider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL,
    ollamaBaseUrl: ollamaBaseUrl(null),
    threadId: "",
    connection: ConnectionStatus.Connecting,
    init: (options) => {
        const loaded = loadKknvrsConfig(options.configPath);
        const config = loaded?.config ?? null;
        const path = loaded?.path ?? options.configPath ?? "";
        let configError = "";
        if (!loaded) {
            configError = "no kknvrs.json found — run: kknvrs init";
        }
        let agentName = agentDefault(config, options.agent);
        let provider = options.provider ?? DEFAULT_PROVIDER;
        let model = options.model ?? DEFAULT_MODEL;
        if (config && agentName) {
            try {
                const resolved = resolveAgent(config, agentName);
                agentName = resolved.name;
                if (!options.provider) provider = resolved.provider;
                if (!options.model) model = resolved.model;
            } catch (e) {
                configError = e instanceof Error ? e.message : String(e);
            }
        }
        set({
            configPath: path,
            config,
            configError,
            agentName,
            provider: provider.toLowerCase(),
            model,
            ollamaBaseUrl: ollamaBaseUrl(config, options.ollamaUrl),
            threadId: options.threadId,
            connection: ConnectionStatus.Connecting,
        });
    },
    reloadConfig: () => {
        const { configPath, agentName, provider, model, ollamaBaseUrl: currentUrl, threadId } = get();
        try {
            const loaded = loadKknvrsConfig(configPath || undefined);
            set({
                config: loaded?.config ?? null,
                configPath: loaded?.path ?? configPath,
                configError: loaded ? "" : "no kknvrs.json found — run: kknvrs init",
            });
        } catch (e) {
            set({ configError: e instanceof Error ? e.message : String(e) });
        }
        void agentName;
        void provider;
        void model;
        void currentUrl;
        void threadId;
    },
    setAgentName: (agentName) => {
        const { config, provider: curProvider, model: curModel } = get();
        void closeMcpClients();
        if (config) {
            try {
                const resolved = resolveAgent(config, agentName);
                set({
                    agentName: resolved.name,
                    provider: resolved.provider,
                    model: resolved.model,
                    threadId: "",
                });
                return;
            } catch {
                // fall through: keep raw name so /agents can explain
            }
        }
        void curProvider;
        void curModel;
        set({ agentName, threadId: "" });
    },
    setThreadId: (threadId) => set({ threadId }),
    setProvider: (provider) => {
        if (provider) set({ provider: provider.toLowerCase() });
    },
    setModel: (model) => {
        if (model) set({ model });
    },
    setConnection: (connection) => set({ connection }),
    checkConnection: async () => {
        const { ollamaBaseUrl: base } = get();
        set({ connection: ConnectionStatus.Connecting });
        const ok = await ollamaTags(base);
        set({ connection: ok ? ConnectionStatus.Connected : ConnectionStatus.Disconnected });
        return ok;
    },
}));
