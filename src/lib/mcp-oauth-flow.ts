import { createServer } from "node:http";
import { execFile } from "node:child_process";
import {
    discoverOAuthServerInfo,
    exchangeAuthorization,
    registerClient,
    startAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { saveMcpTokens } from "@/lib/mcp-oauth-store.js";

/** Interactive OAuth flow for one remote MCP server (MCP OAuth 2.1 / DCR + PKCE).
 * Same shape as `opencode mcp auth`: discover -> register -> browser -> callback
 * -> code exchange -> save to ~/.config/kknvrs/mcp-auth/<name>.json. */

function openBrowser(url: string): void {
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
    const args = process.platform === "darwin" ? [url] : process.platform === "win32" ? ["/c", "start", url] : [url];
    execFile(opener, args, (err) => {
        if (err) process.stdout.write(`Open this URL in your browser:\n${url}\n`);
    });
}

function waitForCode(port: number): Promise<{ code: string; state: string }> {
    return new Promise((resolve, reject) => {
        const server = createServer((req, res) => {
            try {
                const url = new URL(req.url ?? "/", "http://127.0.0.1");
                if (url.pathname !== "/callback") {
                    res.writeHead(404).end("not found");
                    return;
                }
                const code = url.searchParams.get("code");
                const state = url.searchParams.get("state") ?? "";
                const err = url.searchParams.get("error");
                if (err || !code) {
                    res.writeHead(400, { "Content-Type": "text/plain" }).end(
                        `Authorization failed: ${err ?? "missing code"}. You can close this tab.`,
                    );
                    server.close();
                    reject(new Error(`authorization failed: ${err ?? "missing code"}`));
                    return;
                }
                res.writeHead(200, { "Content-Type": "text/html" }).end(
                    "<h1>kknvrs: authorized</h1><p>You can close this tab and return to the terminal.</p>",
                );
                server.close();
                resolve({ code, state });
            } catch (e) {
                server.close();
                reject(e instanceof Error ? e : new Error(String(e)));
            }
        });
        server.on("error", reject);
        server.listen(port, "127.0.0.1");
    });
}

export async function runMcpOAuthFlow(serverName: string, serverUrl: string): Promise<void> {
    process.stdout.write(`Discovering OAuth metadata for ${serverName} (${serverUrl})…\n`);
    const {
        authorizationServerUrl,
        authorizationServerMetadata: metadata,
        resourceMetadata,
    } = await discoverOAuthServerInfo(serverUrl);

    // Ephemeral localhost callback; registered as the client's redirect URI.
    const probe = createServer();
    const callbackPort = await new Promise<number>((resolve, reject) => {
        probe.on("error", reject);
        probe.listen(0, "127.0.0.1", () => {
            const addr = probe.address();
            probe.close(() => {
                if (addr && typeof addr === "object") resolve(addr.port);
                else reject(new Error("could not allocate callback port"));
            });
        });
    });
    const redirectUri = `http://127.0.0.1:${callbackPort}/callback`;

    process.stdout.write(`Registering OAuth client at ${authorizationServerUrl}…\n`);
    const clientInfo = await registerClient(authorizationServerUrl, {
        metadata,
        clientMetadata: {
            redirect_uris: [redirectUri],
            token_endpoint_auth_method: "none",
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            client_name: "kknvrs-cli",
        },
    });
    if (!clientInfo.client_id) throw new Error("server did not return a client_id");

    const resource = resourceMetadata?.resource ? new URL(resourceMetadata.resource) : undefined;
    const expectedState = crypto.randomUUID();
    const { authorizationUrl, codeVerifier } = await startAuthorization(authorizationServerUrl, {
        metadata,
        clientInformation: clientInfo,
        redirectUrl: redirectUri,
        scope: resourceMetadata?.scopes_supported?.join(" "),
        state: expectedState,
        resource,
    });

    process.stdout.write(`\nAuthorize ${serverName} in your browser:\n${authorizationUrl}\n`);
    openBrowser(authorizationUrl.toString());
    process.stdout.write(`Waiting for callback on ${redirectUri}…\n`);
    const { code, state } = await waitForCode(callbackPort);
    if (state && state !== expectedState) throw new Error("OAuth state mismatch — aborted");

    const tokens = await exchangeAuthorization(authorizationServerUrl, {
        metadata,
        clientInformation: clientInfo,
        authorizationCode: code,
        codeVerifier,
        redirectUri,
        resource,
    });
    if (!tokens.access_token) throw new Error("token exchange returned no access_token");

    saveMcpTokens(serverName, {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: typeof tokens.expires_in === "number" ? Date.now() + tokens.expires_in * 1000 : undefined,
        token_endpoint: metadata?.token_endpoint,
        client_id: clientInfo.client_id,
        client_secret: clientInfo.client_secret,
        scope: tokens.scope,
    });
    process.stdout.write(`Authorized ${serverName} — tokens saved.\n`);
}
