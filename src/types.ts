export interface CliOptions {
    configPath?: string;
    agent?: string;
    provider?: string;
    model?: string;
    ollamaUrl?: string;
    threadId: string;
}

export type ChatEvent =
    | { type: "token"; content: string }
    | { type: "tool_call"; tool: string; args: Record<string, unknown> }
    | { type: "tool_result"; tool: string; output: string }
    | { type: "usage"; usage: TokenUsage }
    | { type: "ask_user"; question: string; options?: string[] }
    | { type: "done" }
    | { type: "error"; message: string };

/** Token accounting per turn. Ollama reports input (prompt_eval_count)
 * and output (eval_count); multi-step ReAct turns sum every step. */
export interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
}

export interface ToolStep {
    tool: string;
    args: Record<string, unknown>;
    output?: string;
    elapsedMs?: number;
    startedAt: number;
}

export enum TurnPhase {
    Working = "working",
    Done = "done",
    Error = "error",
    Cancelled = "cancelled",
}

export interface Turn {
    id: number;
    userText: string;
    answer: string;
    phase: TurnPhase;
    tools: ToolStep[];
    /** Summed model usage for this turn (all ReAct steps). */
    tokens: TokenUsage;
    /** Clarifying question the model asked instead of acting; reply continues the thread. */
    clarification?: Clarification;
    /** Thinking detail lines visible (auto-on while working, auto-off when done). */
    expanded: boolean;
    startedAt: number;
    endedAt?: number;
}

export interface Clarification {
    question: string;
    options: string[];
}

export type FeedItem =
    | { kind: "system"; id: number; text: string }
    | { kind: "turn"; turn: Turn }
    | { kind: "queued"; id: number; text: string };

export interface SlashCommand {
    name: string;
    usage: string;
    desc: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
    { name: "/help", usage: "/help", desc: "show commands" },
    { name: "/agents", usage: "/agents", desc: "list agents (one per website under test)" },
    { name: "/agent", usage: "/agent [name]", desc: "show or switch agent" },
    { name: "/clear", usage: "/clear", desc: "delete local history for this thread" },
    { name: "/thread", usage: "/thread [id]", desc: "show current or switch local thread" },
    { name: "/threads", usage: "/threads", desc: "list local threads for this agent" },
    { name: "/sessions", usage: "/sessions", desc: "search, resume, or start sessions" },
    { name: "/provider", usage: "/provider [name]", desc: "show or set provider (ollama)" },
    { name: "/model", usage: "/model [name]", desc: "show or set model" },
    { name: "/mcp", usage: "/mcp [status|auth <name>|logout <name>]", desc: "MCP servers for this agent" },
    { name: "/tools", usage: "/tools", desc: "list aggregated MCP tools" },
    { name: "/resources", usage: "/resources [server]", desc: "list MCP resources" },
    { name: "/prompts", usage: "/prompts [server]", desc: "list MCP prompts" },
    { name: "/call", usage: "/call <server.tool> <json>", desc: "call one MCP tool directly" },
    { name: "/quit", usage: "/quit", desc: "exit" },
];
