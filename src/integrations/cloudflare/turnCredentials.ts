import {
    CLOUDFLARE_TURN_CREDENTIAL_ENDPOINT,
    CLOUDFLARE_TURN_CREDENTIAL_TTL_SECONDS,
    type CloudflareTurnConfiguration,
    validateCloudflareTurnConfiguration,
} from "./settings";

/** Fetch-compatible function supplied by the host composition. */
export type CloudflareTurnFetch = (input: string | Request, init?: RequestInit) => Promise<Response>;

export interface CloudflareTurnDependencies {
    readonly fetch: CloudflareTurnFetch;
    readonly now?: () => number;
    readonly requestDeadlineMs?: number;
}

export const CLOUDFLARE_TURN_REQUEST_DEADLINE_MS = 15_000 as const;
export const CLOUDFLARE_TURN_MAX_RESPONSE_BYTES = 32 * 1024;
export const CLOUDFLARE_TURN_MAX_ICE_SERVER_ENTRIES = 16 as const;
export const CLOUDFLARE_TURN_MAX_ICE_SERVER_URLS = 32 as const;
export const CLOUDFLARE_TURN_MIN_REMAINING_LIFETIME_MS = 30_000 as const;

type TurnFailureCode = "configuration" | "authentication" | "unavailable" | "invalid-response";

const FAILURE_MESSAGES: Record<TurnFailureCode, string> = {
    configuration: "The Cloudflare TURN configuration is invalid.",
    authentication: "The Cloudflare TURN credential request was not authorised.",
    unavailable: "The Cloudflare TURN service is unavailable.",
    "invalid-response": "The Cloudflare TURN service returned an invalid response.",
};

function credentialFailure(code: TurnFailureCode, retryable: boolean): Error {
    return Object.assign(new Error(FAILURE_MESSAGES[code]), { code, retryable });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function abortError(): Error {
    try {
        return new DOMException("The operation was aborted.", "AbortError");
    } catch {
        const error = new Error("The operation was aborted.");
        error.name = "AbortError";
        return error;
    }
}

function throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
        throw abortError();
    }
}

function isControlCharacter(value: string): boolean {
    return Array.from(value).some((character) => {
        const code = character.charCodeAt(0);
        return code <= 0x1f || code === 0x7f;
    });
}

function isPort(value: string): boolean {
    if (!/^\d{1,5}$/.test(value)) return false;
    const port = Number(value);
    return port >= 1 && port <= 65_535;
}

function isHost(value: string): boolean {
    return value.length > 0 && /^[A-Za-z0-9._-]+$/.test(value);
}

/**
 * Validates the URL forms accepted by WebRTC's ICE server configuration.
 * TURN URLs may carry only the standard transport query parameter; userinfo,
 * paths, fragments, and arbitrary query values are not accepted.
 */
export function isSupportedIceServerUrl(value: string): boolean {
    if (value.length === 0 || value.length > 2_048 || isControlCharacter(value)) return false;
    const schemeMatch = /^(stun|stuns|turn|turns):(.+)$/i.exec(value);
    if (!schemeMatch) return false;

    const remainder = schemeMatch[2];
    const queryIndex = remainder.indexOf("?");
    const authority = queryIndex >= 0 ? remainder.slice(0, queryIndex) : remainder;
    const query = queryIndex >= 0 ? remainder.slice(queryIndex + 1) : "";
    if (authority.length === 0 || authority.includes("/") || authority.includes("#") || authority.includes("@")) {
        return false;
    }
    if (authority.includes("%")) return false;

    if (authority.startsWith("[")) {
        const closingBracket = authority.indexOf("]");
        if (closingBracket < 0) return false;
        const host = authority.slice(1, closingBracket);
        if (!/^[0-9A-Fa-f:.]+$/.test(host) || !host.includes(":")) return false;
        const suffix = authority.slice(closingBracket + 1);
        if (suffix !== "" && (!suffix.startsWith(":") || !isPort(suffix.slice(1)))) return false;
    } else {
        const colonIndex = authority.lastIndexOf(":");
        const host = colonIndex >= 0 ? authority.slice(0, colonIndex) : authority;
        if (!isHost(host) || (colonIndex >= 0 && !isPort(authority.slice(colonIndex + 1)))) return false;
        // IPv6 literals must use brackets so a colon cannot be interpreted as
        // an ambiguous port separator.
        if (colonIndex >= 0 && host.includes(":")) return false;
    }

    if (query.length === 0) return true;
    const queryParts = query.split("&");
    return queryParts.length === 1 && /^transport=(udp|tcp)$/i.test(queryParts[0]);
}

function isTurnUrl(value: string): boolean {
    return /^(turn|turns):/i.test(value);
}

function isCredential(value: unknown): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= 4_096 && !isControlCharacter(value);
}

function normaliseIceServers(value: unknown): readonly RTCIceServer[] {
    if (!isRecord(value) || !Array.isArray(value.iceServers)) {
        throw credentialFailure("invalid-response", false);
    }
    if (value.iceServers.length === 0 || value.iceServers.length > CLOUDFLARE_TURN_MAX_ICE_SERVER_ENTRIES) {
        throw credentialFailure("invalid-response", false);
    }

    const servers: RTCIceServer[] = [];
    let urlCount = 0;
    let hasTurnServer = false;

    for (const candidate of value.iceServers) {
        if (!isRecord(candidate)) throw credentialFailure("invalid-response", false);
        const rawUrls = candidate.urls;
        const urls =
            typeof rawUrls === "string"
                ? [rawUrls]
                : Array.isArray(rawUrls) && rawUrls.every((url): url is string => typeof url === "string")
                  ? [...rawUrls]
                  : undefined;
        if (!urls || urls.length === 0) throw credentialFailure("invalid-response", false);

        urlCount += urls.length;
        if (urlCount > CLOUDFLARE_TURN_MAX_ICE_SERVER_URLS || urls.some((url) => !isSupportedIceServerUrl(url))) {
            throw credentialFailure("invalid-response", false);
        }

        const turnEntry = urls.some(isTurnUrl);
        hasTurnServer ||= turnEntry;
        const normalised: RTCIceServer = { urls };
        if (turnEntry) {
            if (!isCredential(candidate.username) || !isCredential(candidate.credential)) {
                throw credentialFailure("invalid-response", false);
            }
            normalised.username = candidate.username;
            normalised.credential = candidate.credential;
        }
        servers.push(normalised);
    }

    if (!hasTurnServer) throw credentialFailure("invalid-response", false);
    return Object.freeze(servers);
}

class BoundedResponseError extends Error {
    constructor(readonly kind: "too-large" | "invalid-length" | "read-failed") {
        super(kind);
    }
}

async function readResponseBody(response: Response): Promise<string> {
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null) {
        const declaredLength = Number(contentLength);
        if (!Number.isFinite(declaredLength) || declaredLength < 0) {
            throw new BoundedResponseError("invalid-length");
        }
        if (declaredLength > CLOUDFLARE_TURN_MAX_RESPONSE_BYTES) {
            throw new BoundedResponseError("too-large");
        }
    }

    if (!response.body) {
        try {
            const text = await response.text();
            if (new TextEncoder().encode(text).byteLength > CLOUDFLARE_TURN_MAX_RESPONSE_BYTES) {
                throw new BoundedResponseError("too-large");
            }
            return text;
        } catch (error) {
            if (error instanceof BoundedResponseError) throw error;
            throw new BoundedResponseError("read-failed");
        }
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
        while (true) {
            const result = await reader.read();
            if (result.done) break;
            totalBytes += result.value.byteLength;
            if (totalBytes > CLOUDFLARE_TURN_MAX_RESPONSE_BYTES) {
                try {
                    await reader.cancel();
                } catch {
                    // The response is already invalid because it exceeded the
                    // bound; cancellation failure must not change the safe
                    // classification or expose a host-specific error.
                }
                throw new BoundedResponseError("too-large");
            }
            chunks.push(result.value);
        }
    } catch (error) {
        if (error instanceof BoundedResponseError) throw error;
        throw new BoundedResponseError("read-failed");
    } finally {
        reader.releaseLock();
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
}

function classifyHttpFailure(status: number): Error {
    if (status === 401 || status === 403) {
        return credentialFailure("authentication", false);
    }
    if (status === 408 || status === 429 || status >= 500) {
        return credentialFailure("unavailable", true);
    }
    return credentialFailure("unavailable", false);
}

function parseResponseBody(body: string): readonly RTCIceServer[] {
    let value: unknown;
    try {
        value = JSON.parse(body) as unknown;
    } catch {
        throw credentialFailure("invalid-response", false);
    }
    return normaliseIceServers(value);
}

/** Acquire one temporary ICE configuration for a new room connection. */
export async function acquireCloudflareTurnCredentials(
    configuration: CloudflareTurnConfiguration,
    dependencies: CloudflareTurnDependencies,
    signal: AbortSignal
): Promise<{ iceServers: readonly RTCIceServer[]; expiresAt: number }> {
    if (validateCloudflareTurnConfiguration(configuration)) throw credentialFailure("configuration", false);
    const now = dependencies.now ?? Date.now;
    const requestDeadlineMs = dependencies.requestDeadlineMs ?? CLOUDFLARE_TURN_REQUEST_DEADLINE_MS;
    throwIfAborted(signal);
    const requestStartedAt = now();
    if (!Number.isFinite(requestStartedAt)) {
        throw credentialFailure("unavailable", true);
    }

    const requestController = new AbortController();
    let cancelledByCaller = false;
    let rejectCaller: ((reason?: unknown) => void) | undefined;
    const callerAbort = new Promise<never>((_resolve, reject) => {
        rejectCaller = reject;
    });
    let timedOut = false;
    const onAbort = () => {
        cancelledByCaller = true;
        requestController.abort();
        rejectCaller?.(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
        signal.removeEventListener("abort", onAbort);
        requestController.abort();
        throw abortError();
    }
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
        timeoutId = globalThis.setTimeout(() => {
            timedOut = true;
            requestController.abort();
            reject(credentialFailure("unavailable", true));
        }, requestDeadlineMs);
    });

    const cleanup = () => {
        if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId);
        signal.removeEventListener("abort", onAbort);
    };

    const endpoint = `${CLOUDFLARE_TURN_CREDENTIAL_ENDPOINT}/${configuration.turnKeyId}/credentials/generate-ice-servers`;
    let response: Response;
    try {
        response = await Promise.race([
            dependencies.fetch(endpoint, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${configuration.apiToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ ttl: CLOUDFLARE_TURN_CREDENTIAL_TTL_SECONDS }),
                signal: requestController.signal,
                redirect: "error",
                credentials: "omit",
                cache: "no-store",
            }),
            callerAbort,
            deadline,
        ]);
    } catch {
        cleanup();
        if (cancelledByCaller || signal.aborted) throw abortError();
        if (timedOut) throw credentialFailure("unavailable", true);
        throw credentialFailure("unavailable", true);
    }

    if (cancelledByCaller || signal.aborted) {
        cleanup();
        throw abortError();
    }
    if (timedOut || requestController.signal.aborted) {
        cleanup();
        throw credentialFailure("unavailable", true);
    }
    if (response.status !== 201) {
        cleanup();
        throw classifyHttpFailure(response.status);
    }

    let body: string;
    try {
        body = await Promise.race([readResponseBody(response), callerAbort, deadline]);
    } catch (error) {
        cleanup();
        if (cancelledByCaller || signal.aborted) throw abortError();
        if (timedOut) throw credentialFailure("unavailable", true);
        if (error instanceof BoundedResponseError && error.kind === "read-failed") {
            throw credentialFailure("unavailable", true);
        }
        throw credentialFailure("invalid-response", false);
    }

    try {
        throwIfAborted(signal);
        const iceServers = parseResponseBody(body);
        const expiresAt = requestStartedAt + CLOUDFLARE_TURN_CREDENTIAL_TTL_SECONDS * 1_000;
        if (!Number.isFinite(expiresAt) || expiresAt <= now() + CLOUDFLARE_TURN_MIN_REMAINING_LIFETIME_MS) {
            throw credentialFailure("invalid-response", false);
        }
        return { iceServers, expiresAt };
    } finally {
        cleanup();
    }
}
