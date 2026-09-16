import { runAgentTurn } from "@/lib/agent-loop.js";
import { ConnectionStatus } from "@/lib/connection.js";
import { resolveAgent } from "@/lib/kknvrs-config.js";
import { connectAgentServers } from "@/lib/mcp-manager.js";
import {
    appendAnswer,
    cancelTurn,
    completeTurnIfWorking,
    createTurn,
    failTurn,
    resolveClarificationPick,
    setClarification,
} from "@/lib/turn.js";
import type { OllamaMessage } from "@/lib/ollama.js";
import { loadThreadMessages, mostRecentThreadId, newThreadId, saveThread } from "@/lib/threads.js";
import { useChatStore } from "@/stores/chat-store.js";
import { useSessionStore } from "@/stores/session-store.js";

/** Turn orchestration: in-CLI ReAct loop (Ollama + external MCPs), abort, and
 * queue-or-start submit. Same store shape as before so the TUI is untouched. */
let abortController: AbortController | null = null;

export async function startTurn(userText: string): Promise<void> {
    const session = useSessionStore.getState();
    const chat = useChatStore.getState();
    const config = session.config;
    if (!config) {
        chat.pushSystem("No config loaded — run: kknvrs init");
        return;
    }
    let agent;
    try {
        agent = resolveAgent(config, session.agentName || undefined);
    } catch (e) {
        chat.pushSystem(e instanceof Error ? e.message : String(e));
        return;
    }
    const turn = createTurn(userText);
    const id = turn.id;
    chat.pushTurn(turn);
    chat.markClarificationsAnswered(id);
    chat.setBusy(true);
    chat.setStatus("Thinking…");
    const ctrl = new AbortController();
    abortController = ctrl;
    let sawContent = false;
    let sawAsk = false;

    // Local thread: resume most recent when none selected (mirrors old default).
    let threadId = session.threadId;
    if (!threadId) {
        threadId = mostRecentThreadId(agent.name) ?? newThreadId();
        session.setThreadId(threadId);
    }
    const history: OllamaMessage[] = loadThreadMessages(agent.name, threadId);

    try {
        const clients = await connectAgentServers(config, agent.mcps);
        session.setConnection(ConnectionStatus.Connected);
        const events = runAgentTurn({
            config,
            agent,
            baseUrl: session.ollamaBaseUrl,
            clients,
            history,
            userText,
            signal: ctrl.signal,
        });
        for await (const evt of events) {
            if (evt.type === "token") {
                sawContent = true;
                const chunk = evt.content;
                chat.updateTurn(id, (t) => appendAnswer(t, chunk));
            } else if (evt.type === "tool_call") {
                const step = { tool: evt.tool, args: evt.args ?? {}, startedAt: Date.now() };
                chat.updateTurn(id, (t) => ({ ...t, tools: [...t.tools, step] }));
                chat.setStatus(`Running ${evt.tool}…`);
            } else if (evt.type === "tool_result") {
                const at = Date.now();
                chat.updateTurn(id, (t) => {
                    const tools = [...t.tools];
                    for (let i = tools.length - 1; i >= 0; i--) {
                        if (tools[i]!.output === undefined) {
                            tools[i] = {
                                ...tools[i]!,
                                output: evt.output ?? "",
                                elapsedMs: at - tools[i]!.startedAt,
                            };
                            break;
                        }
                    }
                    return { ...t, tools };
                });
                chat.setStatus("Thinking…");
            } else if (evt.type === "ask_user") {
                sawContent = true;
                sawAsk = true;
                const question =
                    typeof evt.question === "string" && evt.question.trim() ? evt.question : "Could you clarify?";
                const options = Array.isArray(evt.options) ? evt.options.filter((o) => typeof o === "string") : [];
                chat.updateTurn(id, (t) => setClarification(t, question, options));
                chat.setStatus("Waiting for your answer…");
            } else if (evt.type === "error") {
                chat.updateTurn(id, failTurn);
                chat.pushSystem(evt.message);
                chat.setStatus("Turn failed.");
            } else if (evt.type === "done") {
                chat.updateTurn(id, completeTurnIfWorking);
                const queued = useChatStore.getState().queue.length;
                chat.setStatus(queued > 0 ? "Sending queued message…" : sawAsk ? "Waiting for your answer…" : "Ready.");
            }
        }
        if (!sawContent) {
            chat.updateTurn(id, (t) => (t.answer === "" ? { ...t, answer: "(no reply — empty turn)" } : t));
        }
        try {
            saveThread(agent.name, threadId, history);
        } catch (e) {
            chat.pushSystem(`warning: could not save thread (${e instanceof Error ? e.message : String(e)})`);
        }
    } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
            chat.updateTurn(id, cancelTurn);
            chat.pushSystem("Turn cancelled.");
            chat.setStatus("Ready.");
            try {
                saveThread(agent.name, threadId, history);
            } catch {
                // ignore
            }
        } else {
            const message = e instanceof Error ? e.message : String(e);
            if (
                message.includes("fetch failed") ||
                message.includes("fetch") ||
                message.includes("unreachable") ||
                message.includes("ECONNREFUSED") ||
                message.includes("Network") ||
                message.includes("ollama")
            ) {
                session.setConnection(ConnectionStatus.Disconnected);
            }
            chat.updateTurn(id, failTurn);
            chat.pushSystem(`that turn failed (${message}). Try rephrasing.`);
            chat.setStatus("Turn failed.");
        }
    } finally {
        chat.setBusy(false);
        abortController = null;
        const next = chat.takeNextQueued();
        if (next) {
            const fresh = useChatStore.getState();
            void startTurn(resolveClarificationPick(fresh.feed, next.text));
        }
    }
}

export function submitChatText(text: string): void {
    const chat = useChatStore.getState();
    const resolved = resolveClarificationPick(chat.feed, text);
    if (chat.busy) {
        chat.enqueue(resolved);
        return;
    }
    void startTurn(resolved);
}

export function cancelTurnRequest(): void {
    abortController?.abort();
}

export function isTurnRunning(): boolean {
    return abortController !== null;
}
