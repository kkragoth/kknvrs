import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { kknvrsThreadsDir } from "@/lib/kknvrs-home.js";
import type { OllamaMessage } from "@/lib/ollama.js";

/** Local conversation threads (~/.config/kknvrs/threads/<agent>/<id>.json).
 * Replaces the backend's server-side numeric threads: the CLI owns history now. */

export interface LocalThreadSummary {
    thread_id: string;
    title: string;
    message_count: number;
    updated_at?: string | null;
}

interface ThreadFile {
    id: string;
    agent: string;
    title: string;
    updated_at: string;
    messages: OllamaMessage[];
}

function threadsRoot(): string {
    return kknvrsThreadsDir();
}

function agentDir(agent: string): string {
    const safe = agent.replace(/[^A-Za-z0-9._-]/g, "_");
    return join(threadsRoot(), safe);
}

function threadFile(agent: string, id: string): string {
    return join(agentDir(agent), `${id}.json`);
}

function readFile(agent: string, id: string): ThreadFile | null {
    try {
        const f = threadFile(agent, id);
        if (!existsSync(f)) return null;
        return JSON.parse(readFileSync(f, "utf8")) as ThreadFile;
    } catch {
        return null;
    }
}

export function listThreads(agent: string): LocalThreadSummary[] {
    const dir = agentDir(agent);
    if (!existsSync(dir)) return [];
    const out: LocalThreadSummary[] = [];
    for (const name of readdirSync(dir)) {
        if (!name.endsWith(".json")) continue;
        const id = name.slice(0, -".json".length);
        const tf = readFile(agent, id);
        if (!tf) continue;
        out.push({
            thread_id: tf.id,
            title: tf.title || "(untitled)",
            message_count: tf.messages.length,
            updated_at: tf.updated_at,
        });
    }
    out.sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
    return out;
}

export function loadThreadMessages(agent: string, id: string): OllamaMessage[] {
    return readFile(agent, id)?.messages ?? [];
}

export function mostRecentThreadId(agent: string): string | null {
    const rows = listThreads(agent);
    return rows.length > 0 ? rows[0]!.thread_id : null;
}

export function newThreadId(): string {
    return String(Date.now());
}

function titleFor(messages: OllamaMessage[]): string {
    const firstUser = messages.find((m) => m.role === "user");
    const text = (firstUser?.content ?? "").replace(/\s+/g, " ").trim();
    if (!text) return "(untitled)";
    return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

export function saveThread(agent: string, id: string, messages: OllamaMessage[]): void {
    mkdirSync(agentDir(agent), { recursive: true });
    const tf: ThreadFile = {
        id,
        agent,
        title: titleFor(messages),
        updated_at: new Date().toISOString(),
        messages,
    };
    writeFileSync(threadFile(agent, id), JSON.stringify(tf, null, 2));
}

export function clearThread(agent: string, id: string): boolean {
    const f = threadFile(agent, id);
    if (!existsSync(f)) return false;
    try {
        unlinkSync(f);
        return true;
    } catch {
        return false;
    }
}
