import { getSlashCompletions } from "@/lib/slash.js";
import { useComposerStore } from "@/stores/composer-store.js";

/** Slash-command completion popup (tab accepts, ↑↓ navigates). */
export function CommandPopup() {
    const draft = useComposerStore((s) => s.draft);
    const completeIdx = useComposerStore((s) => s.completeIdx);
    const matches = getSlashCompletions(draft);
    const active = Math.min(completeIdx, Math.max(matches.length - 1, 0));

    return (
        <>
            {matches.length > 0 && (
                <box border title="Commands (tab completes · ↑↓ navigate · esc dismisses)" style={{ paddingLeft: 1 }}>
                    <box flexDirection="column">
                        {matches.map((c, i) => (
                            <text key={c.name} fg={i === active ? "cyan" : undefined}>
                                {i === active ? "› " : " "}
                                {c.usage} <span fg="gray">— {c.desc}</span>
                            </text>
                        ))}
                    </box>
                </box>
            )}
        </>
    );
}
