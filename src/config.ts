import type { CliOptions } from "@/types.js";

function pickFlag(argv: string[], name: string): string | undefined {
    const ix = argv.indexOf(name);
    if (ix >= 0 && ix + 1 < argv.length) return argv[ix + 1];
    const prefixed = argv.find((a) => a.startsWith(name + "="));
    if (prefixed) return prefixed.slice(name.length + 1);
    return undefined;
}

function hasFlag(argv: string[], ...names: string[]): boolean {
    return names.some((n) => argv.includes(n));
}

function positional(argv: string[]): string[] {
    return argv.filter((a) => !a.startsWith("-"));
}

export interface ParsedCli {
    options: CliOptions;
    help: boolean;
    /** Headless subcommands (run without TUI): init | mcp auth/logout. */
    subcommand:
        | { kind: "none" }
        | { kind: "init" }
        | { kind: "mcp-auth"; server: string }
        | { kind: "mcp-logout"; server: string };
}

export function parseArgs(argv: string[]): ParsedCli {
    const configPath = pickFlag(argv, "--config") ?? (process.env["KKNVRS_CONFIG"] as string | undefined) ?? undefined;
    const agent = pickFlag(argv, "--agent") ?? process.env["KKNVRS_AGENT"] ?? undefined;
    const provider = pickFlag(argv, "--provider") ?? process.env["KKNVRS_PROVIDER"] ?? undefined;
    const model = pickFlag(argv, "--model") ?? process.env["KKNVRS_MODEL"] ?? undefined;
    const ollamaUrl = pickFlag(argv, "--ollama-url") ?? process.env["KKNVRS_OLLAMA_URL"] ?? undefined;
    const threadId = pickFlag(argv, "--thread") ?? process.env["KKNVRS_THREAD"] ?? "";

    const pos = positional(argv);
    let subcommand: ParsedCli["subcommand"] = { kind: "none" };
    if (pos[0] === "init") {
        subcommand = { kind: "init" };
    } else if (pos[0] === "mcp" && pos[1] === "auth" && pos[2]) {
        subcommand = { kind: "mcp-auth", server: pos[2] };
    } else if (pos[0] === "mcp" && pos[1] === "logout" && pos[2]) {
        subcommand = { kind: "mcp-logout", server: pos[2] };
    }

    return {
        options: {
            configPath,
            agent: agent || undefined,
            provider: provider || undefined,
            model: model || undefined,
            ollamaUrl: ollamaUrl || undefined,
            threadId,
        },
        help: hasFlag(argv, "--help", "-h"),
        subcommand,
    };
}

export const HELP_TEXT = `kknvrs — universal tester for web MCPs / SaaS apps (OpenTUI)

Usage:
  kknvrs [--config PATH] [--agent NAME] [--provider ollama] [--model NAME] [--ollama-url URL] [--thread ID]
  kknvrs init                       write ./kknvrs.json example config
  kknvrs mcp auth <name>            OAuth login for one remote MCP (like: opencode mcp auth)
  kknvrs mcp logout <name>          drop saved OAuth tokens for one MCP

Env: KKNVRS_CONFIG, KKNVRS_AGENT, KKNVRS_PROVIDER, KKNVRS_MODEL, KKNVRS_OLLAMA_URL, KKNVRS_THREAD

Config (kknvrs.json, opencode-style):
  mcp:   remote (url + oauth{}/false + headers w/ {env:VAR}) and local (command[]) servers
  agent: multiple agents per website — { provider, model, mcps, systemPrompt, maxSteps }
  provider.ollama.baseURL (default http://127.0.0.1:11434)

The ReAct loop runs INSIDE this CLI (Ollama + external MCPs only).
There is no /api/chat backend.

Slash commands (in-app):
  /help              show commands
  /agents            list agents
  /agent [name]      show or switch agent (multiple per website)
  /clear             delete local history for this thread
  /thread [id]       show current or switch local thread
  /threads           list local threads for this agent
  /sessions          searchable picker (resume / new)
  /provider [name]   show or set provider (ollama for now)
  /model [name]      show or set model
  /mcp status        servers for this agent
  /mcp auth <name>   OAuth login hint (runs in your shell: kknvrs mcp auth <name>)
  /mcp logout <name> drop saved OAuth tokens
  /tools             list aggregated MCP tools (<server>__<tool>)
  /resources [srv]   list MCP resources
  /prompts [srv]     list MCP prompts
  /call <srv.tool> <json>  call one MCP tool directly (bypasses the LLM)
  /quit              exit

Keys: enter send (queues while busy) · esc cancel turn · tab completes /command
  ctrl+t expand/collapse thinking · pgup/pgdn scroll · drag text = copy
`;
