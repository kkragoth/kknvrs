import { Spinner } from "@/components/ui/spinner.js";
import { formatUsageShort, hasUsage, sessionUsage } from "@/lib/tokens.js";
import { useChatStore } from "@/stores/chat-store.js";

/** Status line: copy flash wins, then working spinner, then idle status.
 * A session token total ("↑1.2k ↓800") trails whenever usage exists. */
export function StatusLine() {
    const busy = useChatStore((s) => s.busy);
    const status = useChatStore((s) => s.status);
    const queue = useChatStore((s) => s.queue);
    const flash = useChatStore((s) => s.flash);
    const feed = useChatStore((s) => s.feed);

    const total = sessionUsage(feed);
    const usageSuffix = hasUsage(total) ? ` · ${formatUsageShort(total)}` : "";

    const label = flash
        ? flash
        : busy
          ? `Working…${queue.length > 0 ? ` · Queued (${queue.length})` : ""}${usageSuffix} (esc cancels)`
          : `${status}${usageSuffix}`;

    if (busy) {
        return <Spinner type="dots" label={label} />;
    }
    return <text fg="gray">{label}</text>;
}
