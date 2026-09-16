import { afterEach, describe, expect, it, vi } from "vitest";
import {
    CLOUDFLARE_TURN_MAX_RESPONSE_BYTES,
    CLOUDFLARE_TURN_REQUEST_DEADLINE_MS,
    acquireCloudflareTurnCredentials,
} from "./turnCredentials";
import {
    CLOUDFLARE_TURN_CREDENTIAL_ENDPOINT,
    CLOUDFLARE_TURN_CREDENTIAL_TTL_SECONDS,
    validateCloudflareTurnConfiguration,
} from "./settings";

const configuration = {
    turnKeyId: "key-123",
    apiToken: "token_abc-123",
} as const;

function response(body: unknown, status = 201): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

function validBody() {
    return {
        iceServers: [
            {
                urls: ["turn:relay.example.test:3478?transport=udp", "turns:relay.example.test:5349"],
                username: "turn-user",
                credential: "turn-password",
            },
            { urls: "stun:stun.example.test:3478" },
        ],
    };
}

afterEach(() => {
    vi.useRealTimers();
});

describe("Cloudflare TURN credentials", () => {
    it("requests the fixed endpoint with the bearer token and TTL", async () => {
        const now = 1_000_000;
        let requestUrl: string | Request | undefined;
        let requestInit: RequestInit | undefined;
        const fetch = vi.fn(async (input: string | Request, init?: RequestInit) => {
            requestUrl = input;
            requestInit = init;
            return response(validBody());
        });
        const dependencies = { fetch, now: () => now };

        const result = await acquireCloudflareTurnCredentials(
            configuration,
            dependencies,
            new AbortController().signal
        );

        expect(requestUrl).toBe(`${CLOUDFLARE_TURN_CREDENTIAL_ENDPOINT}/key-123/credentials/generate-ice-servers`);
        expect(requestInit).toMatchObject({
            method: "POST",
            redirect: "error",
            credentials: "omit",
            cache: "no-store",
            body: JSON.stringify({ ttl: CLOUDFLARE_TURN_CREDENTIAL_TTL_SECONDS }),
        });
        expect(new Headers(requestInit?.headers).get("authorization")).toBe("Bearer token_abc-123");
        expect(new Headers(requestInit?.headers).get("content-type")).toBe("application/json");
        expect(requestInit?.signal).toBeInstanceOf(AbortSignal);
        expect(result.iceServers).toHaveLength(2);
        expect(result.expiresAt).toBe(now + CLOUDFLARE_TURN_CREDENTIAL_TTL_SECONDS * 1_000);
    });

    it("rejects malformed, oversized, and STUN-only responses without exposing secrets", async () => {
        const cases: Array<{ body: unknown; expectedCode: string }> = [
            { body: { iceServers: [] }, expectedCode: "invalid-response" },
            { body: { iceServers: [{ urls: "turn:relay.example.test:3478" }] }, expectedCode: "invalid-response" },
            { body: { iceServers: [{ urls: "stun:stun.example.test:3478" }] }, expectedCode: "invalid-response" },
        ];
        for (const testCase of cases) {
            const dependencies = {
                fetch: vi.fn(async () => response(testCase.body)),
                now: () => 1_000_000,
            };
            const error = await acquireCloudflareTurnCredentials(
                configuration,
                dependencies,
                new AbortController().signal
            ).catch((reason: unknown) => reason);
            expect(error).toMatchObject({ code: testCase.expectedCode });
            expect(String(error)).not.toContain(configuration.apiToken);
            expect(String(error)).not.toContain(configuration.turnKeyId);
        }

        const oversized = "x".repeat(CLOUDFLARE_TURN_MAX_RESPONSE_BYTES + 1);
        const dependencies = {
            fetch: vi.fn(async () => new Response(oversized, { status: 201 })),
            now: () => 1_000_000,
        };
        const error = await acquireCloudflareTurnCredentials(
            configuration,
            dependencies,
            new AbortController().signal
        ).catch((reason: unknown) => reason);
        expect(error).toMatchObject({ code: "invalid-response" });
    });

    it("classifies authentication and transient provider failures", async () => {
        const authDependencies = {
            fetch: vi.fn(async () => response({}, 401)),
        };
        await expect(
            acquireCloudflareTurnCredentials(configuration, authDependencies, new AbortController().signal)
        ).rejects.toMatchObject({
            code: "authentication",
            retryable: false,
        });

        const transientDependencies = {
            fetch: vi.fn(async () => response({}, 503)),
        };
        await expect(
            acquireCloudflareTurnCredentials(configuration, transientDependencies, new AbortController().signal)
        ).rejects.toMatchObject({
            code: "unavailable",
            retryable: true,
        });
    });

    it("propagates caller cancellation and turns a deadline into an unavailable failure", async () => {
        const controller = new AbortController();
        const fetch = vi.fn((_input: string | Request, init?: RequestInit) => {
            return new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {
                    once: true,
                });
            });
        });
        const dependencies = { fetch };
        const cancelled = acquireCloudflareTurnCredentials(configuration, dependencies, controller.signal);
        controller.abort();
        await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });

        vi.useFakeTimers();
        const timedDependencies = { fetch };
        const timed = acquireCloudflareTurnCredentials(configuration, timedDependencies, new AbortController().signal);
        const assertion = expect(timed).rejects.toMatchObject({ code: "unavailable", retryable: true });
        await vi.advanceTimersByTimeAsync(CLOUDFLARE_TURN_REQUEST_DEADLINE_MS);
        await assertion;
    });

    it("rejects an issuance which has no usable remaining lifetime", async () => {
        let now = 1_000_000;
        const dependencies = {
            fetch: vi.fn(async () => {
                now += CLOUDFLARE_TURN_CREDENTIAL_TTL_SECONDS * 1_000;
                return response(validBody());
            }),
            now: () => now,
        };
        await expect(
            acquireCloudflareTurnCredentials(configuration, dependencies, new AbortController().signal)
        ).rejects.toMatchObject({
            code: "invalid-response",
        });
    });
});

describe("Cloudflare TURN input validation", () => {
    it("rejects unsafe key IDs and malformed bearer credentials", () => {
        expect(
            validateCloudflareTurnConfiguration({ turnKeyId: "key/id", apiToken: configuration.apiToken })
        ).toContain("unsupported characters");
        expect(validateCloudflareTurnConfiguration({ ...configuration, apiToken: "token with spaces" })).toContain(
            "Bearer token syntax"
        );
    });
});
