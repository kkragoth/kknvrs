/** Ollama native client (/api/chat) with tool calling. Provider #1 for kknvrs;
 * the in-CLI ReAct loop (agent-loop.ts) is the only caller that needs tools. */

export interface OllamaMessage {
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    tool_calls?: OllamaToolCall[];
    /** Tool result messages carry the originating call name for UIs. */
    tool_name?: string;
}

export interface OllamaToolCall {
    function: {
        name: string;
        arguments: Record<string, unknown>;
    };
}

export interface OllamaToolDef {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters: Record<string, unknown>;
    };
}

export type OllamaStreamEvent =
    | { type: "token"; content: string }
    | { type: "tool_calls"; calls: OllamaToolCall[] }
    | { type: "done"; totalDurationNs?: number };

export async function ollamaHealth(baseUrl: string, timeoutMs = 4000): Promise<boolean> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    timer.unref?.();
    try {
        const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, { signal: ctrl.signal });
        return res.ok;
    } catch {
        return false;
    } finally {
        clearTimeout(timer);
    }
}

interface StreamLine {
    message?: {
        role?: string;
        content?: string;
        tool_calls?: Array<{
            function?: { name?: string; arguments?: Record<string, unknown> | string };
        }>;
    };
    done?: boolean;
    total_duration?: number;
    error?: string;
}

function normalizeArgs(raw: unknown): Record<string, unknown> {
    if (!raw) return {};
    if (typeof raw === "object") return raw as Record<string, unknown>;
    if (typeof raw === "string") {
        try {
            const parsed = JSON.parse(raw) as unknown;
            if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
        } catch {
            // fall through
        }
    }
    return {};
}

/** Stream one assistant turn (text + terminal tool_calls) from Ollama. */
export async function* streamOllamaChat(params: {
    baseUrl: string;
    model: string;
    messages: OllamaMessage[];
    tools?: OllamaToolDef[];
    signal?: AbortSignal;
}): AsyncGenerator<OllamaStreamEvent> {
    const { baseUrl, model, messages, tools, signal } = params;
    let res: Response;
    try {
        res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model,
                messages,
                stream: true,
                ...(tools && tools.length > 0 ? { tools } : {}),
            }),
            signal,
        });
    } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        throw new Error(`ollama unreachable at ${baseUrl} — is ollama serve running?`);
    }
    if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        throw new Error(`ollama chat failed (${res.status}): ${text.slice(0, 300)}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const pendingCalls: OllamaToolCall[] = [];
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = buf.indexOf("\n")) >= 0) {
                const line = buf.slice(0, nl).trim();
                buf = buf.slice(nl + 1);
                if (!line) continue;
                let json: StreamLine;
                try {
                    json = JSON.parse(line) as StreamLine;
                } catch {
                    continue;
                }
                if (json.error) throw new Error(`ollama error: ${json.error.slice(0, 300)}`);
                const msg = json.message;
                if (msg?.content) yield { type: "token", content: msg.content };
                if (msg?.tool_calls) {
                    for (const tc of msg.tool_calls) {
                        const name = tc.function?.name;
                        if (!name) continue;
                        pendingCalls.push({
                            function: { name, arguments: normalizeArgs(tc.function?.arguments) },
                        });
                    }
                }
                if (json.done) {
                    if (pendingCalls.length > 0) {
                        yield { type: "tool_calls", calls: pendingCalls.splice(0) };
                    }
                    yield { type: "done", totalDurationNs: json.total_duration };
                    return;
                }
            }
        }
        if (pendingCalls.length > 0) {
            yield { type: "tool_calls", calls: pendingCalls.splice(0) };
        }
        yield { type: "done" };
    } finally {
        reader.releaseLock();
    }
}
