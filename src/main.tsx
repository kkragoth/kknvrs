import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "@/App.js";
import { HELP_TEXT, parseArgs } from "@/config.js";
import { loadKknvrsConfig, writeExampleConfig } from "@/lib/kknvrs-config.js";
import { runMcpOAuthFlow } from "@/lib/mcp-oauth-flow.js";
import { clearMcpTokens } from "@/lib/mcp-oauth-store.js";
import { useSessionStore } from "@/stores/session-store.js";
import { useAuthStore } from "@/stores/auth-store.js";
import { isRemoteMcp } from "@/lib/kknvrs-config.js";

async function main(): Promise<void> {
    const { options, help, subcommand } = parseArgs(process.argv.slice(2));
    if (help) {
        process.stdout.write(HELP_TEXT);
        process.exit(0);
    }

    if (subcommand.kind === "init") {
        const target = options.configPath ?? `${process.cwd()}/kknvrs.json`;
        try {
            writeExampleConfig(target);
            process.stdout.write(`Wrote example config to ${target}\n`);
            process.stdout.write(`Next: edit agents/mcps, then run: kknvrs\n`);
        } catch (e) {
            process.stderr.write(`init failed: ${e instanceof Error ? e.message : String(e)}\n`);
            process.exit(1);
        }
        process.exit(0);
    }

    if (subcommand.kind === "mcp-auth") {
        const loaded = loadKknvrsConfig(options.configPath);
        if (!loaded) {
            process.stderr.write("no kknvrs.json found — run: kknvrs init\n");
            process.exit(1);
        }
        const entry = loaded.config.mcp?.[subcommand.server];
        if (!entry) {
            process.stderr.write(`unknown MCP "${subcommand.server}"\n`);
            process.exit(1);
        }
        if (!isRemoteMcp(entry)) {
            process.stderr.write(`"${subcommand.server}" is a local MCP — no OAuth needed.\n`);
            process.exit(1);
        }
        if (entry.oauth === false) {
            process.stderr.write(
                `"${subcommand.server}" uses static headers (oauth: false) — no OAuth login needed.\n`,
            );
            process.exit(1);
        }
        try {
            await runMcpOAuthFlow(subcommand.server, entry.url);
        } catch (e) {
            process.stderr.write(`mcp auth failed: ${e instanceof Error ? e.message : String(e)}\n`);
            process.exit(1);
        }
        process.exit(0);
    }

    if (subcommand.kind === "mcp-logout") {
        clearMcpTokens(subcommand.server);
        process.stdout.write(`Dropped saved OAuth tokens for "${subcommand.server}".\n`);
        process.exit(0);
    }

    try {
        useSessionStore.getState().init(options);
    } catch (e) {
        process.stderr.write(`fatal: ${e instanceof Error ? e.message : String(e)}\n`);
        process.exit(1);
    }
    useAuthStore.getState().boot();
    const renderer = await createCliRenderer({ exitOnCtrlC: true, useMouse: true });
    createRoot(renderer).render(<App />);
}

main().catch((err) => {
    process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
});
