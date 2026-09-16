/** Ollama reachability probe for boot/connection badge. No backend here. */

export const BOOT_TIMEOUT_MS = 4000;

export async function ollamaTags(baseUrl: string, timeoutMs: number = BOOT_TIMEOUT_MS): Promise<boolean> {
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
