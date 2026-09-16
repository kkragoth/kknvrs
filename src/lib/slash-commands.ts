import { parseSlash } from "@/lib/slash.js";
import { isRemoteMcp, listAgents, resolveAgent } from "@/lib/kknvrs-config.js";
import {
    callAggregatedTool,
    closeMcpClients,
    connectAgentServers,
    listAggregatedTools,
    mcpStatusFor,
    resourceText,
    splitToolName,
    toolText,
} from "@/lib/mcp-manager.js";
import { clearMcpTokens, loadMcpTokens } from "@/lib/mcp-oauth-store.js";
import { clearThread, listThreads } from "@/lib/threads.js";
import { isThreadId } from "@/lib/text.js";
import { useChatStore } from "@/stores/chat-store.js";
import { useSessionUiStore } from "@/stores/session-ui-store.js";
import { useSessionStore } from "@/stores/session-store.js";

/** Slash-command execution over the stores. Pure parsing lives in lib/slash.ts. */
export async function handleSlashCommand(raw: string): Promise<void> {
    const parsed = parseSlash(raw);
    if (!parsed) return;
    const session = useSessionStore.getState();
    const chat = useChatStore.getState();
    const { name, arg } = parsed;

    const needConfig = (): boolean => {
        if (!useSessionStore.getState().config) {
            chat.pushSystem("No config loaded — run: kknvrs init");
            return false;
        }
        return true;
    };

    const currentAgent = () => {
        const s = useSessionStore.getState();
        if (!s.config) return null;
        try {
            return resolveAgent(s.config, s.agentName || undefined);
        } catch (e) {
            chat.pushSystem(e instanceof Error ? e.message : String(e));
            return null;
        }
    };

    switch (name) {
        case "help":
            chat.pushSystem(
                "/agents · /agent [name] · /clear · /thread [id] · /threads · /sessions · /provider [name] · /model [name] · /quit — esc cancels a turn",
            );
            chat.pushSystem(
                "MCP (external only): /mcp status · /mcp auth <name> · /mcp logout <name> · /tools · /resources [server] · /prompts [server] · /call <server.tool> <json>",
            );
            break;
        case "agents": {
            if (!needConfig()) break;
            const names = listAgents(session.config!);
            if (names.length === 0) {
                chat.pushSystem("No agents defined — run: kknvrs init");
                break;
            }
            for (const n of names) {
                const a = resolveAgent(session.config!, n);
                chat.pushSystem(
                    `${n}${n === session.agentName ? " ← current" : ""} · ${a.provider}:${a.model} · mcps: ${a.mcps.join(", ") || "(none)"}`,
                );
            }
            break;
        }
        case "agent": {
            if (!needConfig()) break;
            if (!arg) {
                const a = currentAgent();
                if (a) chat.pushSystem(`Agent: ${a.name} · ${a.provider}:${a.model} · mcps: ${a.mcps.join(", ")}`);
                break;
            }
            try {
                resolveAgent(session.config!, arg);
            } catch (e) {
                chat.pushSystem(e instanceof Error ? e.message : String(e));
                break;
            }
            await closeMcpClients();
            session.setAgentName(arg);
            chat.clearFeed();
            const next = useSessionStore.getState();
            chat.pushSystem(
                `Switched to agent "${next.agentName}" · ${next.provider}:${next.model}. New thread on next message.`,
            );
            break;
        }
        case "clear": {
            const a = currentAgent();
            if (!a) break;
            if (!session.threadId) {
                chat.pushSystem("No thread yet — send a message first, then /clear.");
                break;
            }
            clearThread(a.name, session.threadId);
            chat.clearFeed();
            chat.pushSystem(`Local history cleared for thread ${session.threadId}.`);
            break;
        }
        case "thread":
            if (!arg) {
                chat.pushSystem(
                    session.threadId
                        ? `Current thread: ${session.threadId}. Usage: /thread <id>`
                        : "No thread yet — send a message first.",
                );
            } else if (!isThreadId(arg)) {
                chat.pushSystem("Threads are numeric (timestamps) — use /threads to list, then /thread <id>.");
            } else {
                session.setThreadId(arg);
                chat.pushSystem(`Switched to thread ${arg}.`);
            }
            break;
        case "threads": {
            const a = currentAgent();
            if (!a) break;
            const rows = listThreads(a.name);
            if (rows.length === 0) {
                chat.pushSystem(`No threads yet for agent "${a.name}".`);
            } else {
                for (const r of rows) {
                    chat.pushSystem(
                        `${r.thread_id} · ${r.title} (${r.message_count} msgs)${r.thread_id === session.threadId ? " ← current" : ""}`,
                    );
                }
                chat.pushSystem("Tip: /sessions opens a searchable picker.");
            }
            break;
        }
        case "sessions":
            useSessionUiStore.getState().setPaletteOpen(true);
            break;
        case "provider":
            if (!arg) {
                chat.pushSystem(`Provider: ${session.provider}. Usage: /provider ollama`);
            } else if (arg.toLowerCase() !== "ollama") {
                chat.pushSystem(`Only "ollama" is supported for now (asked: "${arg}").`);
            } else {
                session.setProvider(arg);
                chat.pushSystem(`Provider set to "ollama".`);
            }
            break;
        case "model":
            if (!arg) {
                chat.pushSystem(`Model: ${session.model}. Usage: /model <name> (ollama list)`);
            } else {
                session.setModel(arg);
                chat.pushSystem(`Model set to "${arg}".`);
            }
            break;
        case "mcp": {
            if (!needConfig()) break;
            const [sub, ...rest] = arg.split(/\s+/).filter(Boolean);
            const s = useSessionStore.getState();
            const a = currentAgent();
            if (!a) break;
            if (!sub || sub.toLowerCase() === "status") {
                chat.pushSystem(await mcpStatusFor(s.config!, a.mcps));
            } else if (sub.toLowerCase() === "auth") {
                const target = rest[0];
                if (!target) {
                    chat.pushSystem("Usage: /mcp auth <name> — then run in your shell: kknvrs mcp auth <name>");
                    break;
                }
                const entry = s.config!.mcp?.[target];
                if (!entry) {
                    chat.pushSystem(`Unknown MCP "${target}".`);
                    break;
                }
                if (!isRemoteMcp(entry)) {
                    chat.pushSystem(`"${target}" is a local MCP — no OAuth needed.`);
                    break;
                }
                if (entry.oauth === false) {
                    chat.pushSystem(`"${target}" uses static headers (oauth: false) — no OAuth login needed.`);
                    break;
                }
                const saved = loadMcpTokens(target);
                chat.pushSystem(
                    saved
                        ? `"${target}" already has saved tokens. To re-auth run in your shell: kknvrs mcp auth ${target}`
                        : `To authorize "${target}", run in your shell: kknvrs mcp auth ${target}`,
                );
            } else if (sub.toLowerCase() === "logout") {
                const target = rest[0];
                if (!target) {
                    chat.pushSystem("Usage: /mcp logout <name>");
                    break;
                }
                clearMcpTokens(target);
                chat.pushSystem(`Dropped saved OAuth tokens for "${target}".`);
            } else {
                chat.pushSystem("Usage: /mcp [status|auth <name>|logout <name>]");
            }
            break;
        }
        case "tools": {
            const a = currentAgent();
            if (!a || !needConfig()) break;
            try {
                const clients = await connectAgentServers(session.config!, a.mcps);
                const tools = await listAggregatedTools(clients);
                if (tools.length === 0) chat.pushSystem("MCP tools: (none)");
                else {
                    chat.pushSystem(
                        [
                            `MCP tools (${tools.length}):`,
                            ...tools.map(
                                (t) => `• ${t.name}${t.description ? ` — ${t.description.slice(0, 100)}` : ""}`,
                            ),
                        ].join("\n"),
                    );
                }
            } catch (e) {
                chat.pushSystem(e instanceof Error ? e.message : String(e));
            }
            break;
        }
        case "resources": {
            const a = currentAgent();
            if (!a || !needConfig()) break;
            try {
                const clients = await connectAgentServers(session.config!, a.mcps);
                const only = arg.trim() || undefined;
                const lines = ["MCP resources:"];
                for (const [server, client] of clients) {
                    if (only && server !== only) continue;
                    try {
                        const [{ resources }, { resourceTemplates }] = await Promise.all([
                            client.listResources(),
                            client.listResourceTemplates().catch(() => ({ resourceTemplates: [] as never[] })),
                        ]);
                        for (const r of resources) lines.push(`• [${server}] ${r.uri}${r.name ? ` (${r.name})` : ""}`);
                        for (const t of resourceTemplates) lines.push(`• [${server}] ${t.uriTemplate} (template)`);
                    } catch (e) {
                        lines.push(`• [${server}] failed: ${e instanceof Error ? e.message : String(e)}`);
                    }
                }
                chat.pushSystem(lines.length > 1 ? lines.join("\n") : "MCP resources: (none)");
            } catch (e) {
                chat.pushSystem(e instanceof Error ? e.message : String(e));
            }
            break;
        }
        case "prompts": {
            const a = currentAgent();
            if (!a || !needConfig()) break;
            try {
                const clients = await connectAgentServers(session.config!, a.mcps);
                const only = arg.trim() || undefined;
                const lines = ["MCP prompts:"];
                for (const [server, client] of clients) {
                    if (only && server !== only) continue;
                    try {
                        const { prompts } = await client.listPrompts();
                        for (const p of prompts)
                            lines.push(`• [${server}] ${p.name}${p.description ? ` — ${p.description}` : ""}`);
                    } catch (e) {
                        lines.push(`• [${server}] failed: ${e instanceof Error ? e.message : String(e)}`);
                    }
                }
                chat.pushSystem(lines.length > 1 ? lines.join("\n") : "MCP prompts: (none)");
            } catch (e) {
                chat.pushSystem(e instanceof Error ? e.message : String(e));
            }
            break;
        }
        case "call": {
            const a = currentAgent();
            if (!a || !needConfig()) break;
            const [toolName, ...jsonParts] = arg.split(/\s+/);
            if (!toolName || !splitToolName(toolName)) {
                chat.pushSystem("Usage: /call <server.tool> <json> — e.g. /call notebortt-local__board_list {}");
                break;
            }
            let args: Record<string, unknown> = {};
            const jsonStr = jsonParts.join(" ").trim();
            if (jsonStr) {
                try {
                    const parsed = JSON.parse(jsonStr) as unknown;
                    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                        chat.pushSystem('Args must be a JSON object — e.g. /call srv__tool {"id": 1}');
                        break;
                    }
                    args = parsed as Record<string, unknown>;
                } catch {
                    chat.pushSystem('Args are not valid JSON — e.g. /call srv__tool {"id": 1}');
                    break;
                }
            }
            try {
                const clients = await connectAgentServers(session.config!, a.mcps);
                chat.pushSystem(await callAggregatedTool(clients, toolName, args));
            } catch (e) {
                chat.pushSystem(e instanceof Error ? e.message : String(e));
            }
            break;
        }
        case "read": {
            // Convenience: /read <server> <uri> for resource reads.
            const a = currentAgent();
            if (!a || !needConfig()) break;
            const [server, uri] = arg.split(/\s+/);
            if (!server || !uri) {
                chat.pushSystem("Usage: /read <server> <uri>");
                break;
            }
            try {
                const clients = await connectAgentServers(session.config!, a.mcps);
                const client = clients.get(server);
                if (!client) {
                    chat.pushSystem(`Server "${server}" is not connected.`);
                    break;
                }
                chat.pushSystem(resourceText(await client.readResource({ uri })));
            } catch (e) {
                chat.pushSystem(e instanceof Error ? e.message : String(e));
            }
            break;
        }
        case "quit":
        case "exit":
            process.exit(0);
            break;
        default:
            // Back-compat: old todoist commands explain the generic replacements.
            if (
                name === "list" ||
                name === "add" ||
                name === "done" ||
                name === "reopen" ||
                name === "archive" ||
                name === "delete"
            ) {
                chat.pushSystem(
                    `Todo-specific commands are gone — use /tools to discover tools, then /call <server.tool> <json>.`,
                );
                break;
            }
            if (name === "logout") {
                chat.pushSystem("No backend login here — per-MCP logout: /mcp logout <name>");
                break;
            }
            chat.pushSystem(`Unknown command "/${name}". Try /help.`);
            void toolText;
            break;
    }
}
