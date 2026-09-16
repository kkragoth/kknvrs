import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { KknvrsConfig, ResolvedAgent } from "@/lib/kknvrs-config.js";
import {
    callAggregatedTool,
    getPromptText,
    listAggregatedPrompts,
    listAggregatedTools,
    splitToolName,
} from "@/lib/mcp-manager.js";
import type { OllamaMessage, OllamaToolDef } from "@/lib/ollama.js";
import { streamOllamaChat } from "@/lib/ollama.js";
import type { ChatEvent } from "@/types.js";

/** In-CLI ReAct loop (port of todoist-ai backend service.py, minus server I/O).
 * model -> tools -> model until the model answers without tool_calls or
 * maxSteps runs out. Only external MCPs are touched; there is no /api/chat. */

export function agentSystemPrompt(agent: ResolvedAgent, today: Date = new Date()): string {
    const base =
        agent.systemPrompt?.trim() ||
        "You are testing a web app through its MCP tools. Explore first with read-only tools, " +
            "never guess IDs, and narrate what you do and what you find.";
    const dateStr = today.toISOString().slice(0, 10);
    const day = today.toLocaleDateString("en-US", { weekday: "long" });
    return (
        `${base}\n` +
        `Rules: for questions about the app, call a list/read tool first; never answer from memory. ` +
        `Use IDs from listed results, never guess one. When a call fails, report the exact error. ` +
        `Tool names are namespaced as <server>__<tool> (e.g. notebortt-local__board_list): ` +
        `strip the prefix to get the real tool name from your instructions. ` +
        `Servers also publish curated MCP prompts (canned expert workflows): discover them with ` +
        `mcp_list_prompts, fetch one with mcp_get_prompt, then follow its instructions. ` +
        `Today is ${dateStr} (${day}).`
    );
}

export interface AgentTurnParams {
    config: KknvrsConfig;
    agent: ResolvedAgent;
    baseUrl: string;
    clients: Map<string, Client>;
    /** Mutable conversation history (user/assistant/tool only, no system). Mutated in place. */
    history: OllamaMessage[];
    userText: string;
    signal?: AbortSignal;
}

function toOllamaTools(tools: Awaited<ReturnType<typeof listAggregatedTools>>): OllamaToolDef[] {
    return tools.map((t) => ({
        type: "function",
        function: {
            name: t.name,
            description: t.description ?? `${t.tool} on ${t.server}`,
            parameters:
                Object.keys(t.inputSchema ?? {}).length > 0 ? t.inputSchema : { type: "object", properties: {} },
        },
    }));
}

/** Synthetic tools (handled locally, never sent to an MCP server) that let the
 * model discover and pull curated server prompts mid-turn. */
const META_LIST_PROMPTS = "mcp_list_prompts";
const META_GET_PROMPT = "mcp_get_prompt";

const META_TOOLS: OllamaToolDef[] = [
    {
        type: "function",
        function: {
            name: META_LIST_PROMPTS,
            description:
                "List curated MCP prompt workflows published by connected servers (e.g. create-bmc, review). " +
                "Call this when the user asks for something a canned expert workflow might cover.",
            parameters: {
                type: "object",
                properties: {
                    server: {
                        type: "string",
                        description: "Optional: only list prompts from this MCP server.",
                    },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: META_GET_PROMPT,
            description:
                "Fetch one curated MCP prompt by its namespaced name (<server>__<prompt>) with string arguments. " +
                "Returns the server's expert instructions — follow them.",
            parameters: {
                type: "object",
                properties: {
                    name: {
                        type: "string",
                        description: "Namespaced prompt, e.g. notebortt__create-bmc.",
                    },
                    arguments: {
                        type: "object",
                        description: "Prompt arguments as string key/values.",
                        additionalProperties: { type: "string" },
                    },
                },
                required: ["name"],
            },
        },
    },
];

async function runOneTool(clients: Map<string, Client>, name: string, args: Record<string, unknown>): Promise<string> {
    if (name === META_LIST_PROMPTS) {
        const only = typeof args["server"] === "string" ? args["server"] : undefined;
        const prompts = await listAggregatedPrompts(clients);
        const rows = prompts.filter((p) => !only || p.server === only);
        if (rows.length === 0) return "MCP prompts: (none)";
        return [
            "MCP prompts (fetch one with mcp_get_prompt):",
            ...rows.map((p) => {
                const argList = (p.arguments ?? [])
                    .map((a) => `${a.name}${a.required ? " (required)" : ""}`)
                    .join(", ");
                return `• ${p.name}${p.description ? ` — ${p.description}` : ""}${argList ? ` [args: ${argList}]` : ""}`;
            }),
        ].join("\n");
    }
    if (name === META_GET_PROMPT) {
        const promptName = args["name"];
        if (typeof promptName !== "string" || !splitToolName(promptName)) {
            throw new Error(`mcp_get_prompt needs a namespaced name — e.g. { "name": "notebortt__create-bmc" }`);
        }
        const promptArgs =
            args["arguments"] && typeof args["arguments"] === "object"
                ? (args["arguments"] as Record<string, unknown>)
                : {};
        return await getPromptText(clients, promptName, promptArgs);
    }
    return await callAggregatedTool(clients, name, args);
}

export async function* runAgentTurn(params: AgentTurnParams): AsyncGenerator<ChatEvent> {
    const { agent, baseUrl, clients, history, userText, signal } = params;
    void params.config;
    let tools: Awaited<ReturnType<typeof listAggregatedTools>>;
    try {
        tools = await listAggregatedTools(clients);
    } catch (e) {
        yield { type: "error", message: e instanceof Error ? e.message : String(e) };
        return;
    }

    const messages: OllamaMessage[] = [
        { role: "system", content: agentSystemPrompt(agent) },
        ...history,
        { role: "user", content: userText },
    ];
    history.push({ role: "user", content: userText });
    const ollamaTools = [...toOllamaTools(tools), ...META_TOOLS];
    const maxSteps = Math.max(1, agent.maxSteps);

    for (let step = 0; step < maxSteps; step++) {
        if (signal?.aborted) return;
        let assistantText = "";
        let toolCalls: { function: { name: string; arguments: Record<string, unknown> } }[] = [];
        try {
            for await (const evt of streamOllamaChat({
                baseUrl,
                model: agent.model,
                messages,
                tools: ollamaTools,
                signal,
            })) {
                if (evt.type === "token") {
                    assistantText += evt.content;
                    yield { type: "token", content: evt.content };
                } else if (evt.type === "tool_calls") {
                    toolCalls = evt.calls;
                } else if (evt.type === "done") {
                    break;
                }
            }
        } catch (e) {
            if (e instanceof DOMException && e.name === "AbortError") return;
            yield { type: "error", message: e instanceof Error ? e.message : String(e) };
            return;
        }

        if (toolCalls.length === 0) {
            history.push({ role: "assistant", content: assistantText });
            yield { type: "done" };
            return;
        }

        messages.push({ role: "assistant", content: assistantText, tool_calls: toolCalls });
        history.push({ role: "assistant", content: assistantText, tool_calls: toolCalls });

        for (const call of toolCalls) {
            if (signal?.aborted) return;
            const args = call.function.arguments ?? {};
            yield { type: "tool_call", tool: call.function.name, args };
            const startedAt = Date.now();
            void startedAt;
            try {
                const output = await runOneTool(clients, call.function.name, args);
                yield { type: "tool_result", tool: call.function.name, output };
                const toolMsg: OllamaMessage = {
                    role: "tool",
                    content: output,
                    tool_name: call.function.name,
                };
                messages.push(toolMsg);
                history.push(toolMsg);
            } catch (e) {
                const output = `Error: ${e instanceof Error ? e.message : String(e)}`;
                yield { type: "tool_result", tool: call.function.name, output };
                const toolMsg: OllamaMessage = {
                    role: "tool",
                    content: output,
                    tool_name: call.function.name,
                };
                messages.push(toolMsg);
                history.push(toolMsg);
            }
        }
        // loop: model sees tool outputs and continues
    }

    yield {
        type: "error",
        message: `stopped after ${maxSteps} tool rounds without a final answer — try a smaller request or /agent with a higher maxSteps.`,
    };
}
