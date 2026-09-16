/** Backend reachability ADT. Boot starts at Connecting so the first paint
 * never hangs silently on auth/me; unreachable flips to Disconnected. */
export enum ConnectionStatus {
    Connecting = "connecting",
    Connected = "connected",
    Disconnected = "disconnected",
}

/** Predicate helpers — call sites must use these, never raw string compares. */
export function isConnecting(status: ConnectionStatus): boolean {
    return status === ConnectionStatus.Connecting;
}

export function isConnected(status: ConnectionStatus): boolean {
    return status === ConnectionStatus.Connected;
}

export function isDisconnected(status: ConnectionStatus): boolean {
    return status === ConnectionStatus.Disconnected;
}

/** Display label: CONNECTING / CONNECTED / NO CONNECTION. */
export function connectionLabel(status: ConnectionStatus): string {
    switch (status) {
        case ConnectionStatus.Connecting:
            return "CONNECTING";
        case ConnectionStatus.Connected:
            return "CONNECTED";
        case ConnectionStatus.Disconnected:
            return "NO CONNECTION";
    }
}

/** TUI foreground color per state — disconnected is red per spec. */
export function connectionColor(status: ConnectionStatus): string {
    switch (status) {
        case ConnectionStatus.Connecting:
            return "yellow";
        case ConnectionStatus.Connected:
            return "green";
        case ConnectionStatus.Disconnected:
            return "red";
    }
}
