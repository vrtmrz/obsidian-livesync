import { describe, expect, it } from "vitest";

import {
    EMPTY_P2P_CHECK_DIAGNOSTICS,
    P2P_CHECK_OBSERVATION_MILLISECONDS,
    captureP2PAdditionalCheckBaseline,
    deriveP2PAdditionalCheckProgress,
    deriveP2PCheckOutcome,
} from "@/apps/webpeer/src/P2PCheckState";

describe("P2P connection-check outcome", () => {
    it("waits for a target after the browser monitor joins the room", () => {
        expect(deriveP2PCheckOutcome(EMPTY_P2P_CHECK_DIAGNOSTICS, true, 5_000)).toBe("waiting");
    });

    it("reports an active negotiation before any connection succeeds", () => {
        expect(
            deriveP2PCheckOutcome(
                {
                    ...EMPTY_P2P_CHECK_DIAGNOSTICS,
                    totalNewConnections: 1,
                    details: {
                        "rtc-1": {
                            connectionState: "connecting",
                            iceConnectionState: "checking",
                        },
                    },
                },
                true,
                10_000
            )
        ).toBe("connecting");
    });

    it("keeps a failed attempt retryable until the observation period expires", () => {
        const diagnostics = {
            ...EMPTY_P2P_CHECK_DIAGNOSTICS,
            totalNewConnections: 1,
            totalFailedConnections: 1,
        };

        expect(deriveP2PCheckOutcome(diagnostics, true, 15_000)).toBe("retrying");
        expect(deriveP2PCheckOutcome(diagnostics, true, P2P_CHECK_OBSERVATION_MILLISECONDS)).toBe("inconclusive");
    });

    it("lets a later success take precedence over failures and closure", () => {
        expect(
            deriveP2PCheckOutcome(
                {
                    ...EMPTY_P2P_CHECK_DIAGNOSTICS,
                    totalNewConnections: 2,
                    totalFailedConnections: 1,
                    totalSuccessfulConnections: 1,
                    totalClosedConnections: 1,
                },
                true,
                P2P_CHECK_OBSERVATION_MILLISECONDS * 2
            )
        ).toBe("connected");
    });

    it("distinguishes an idle page and a monitor-start error", () => {
        expect(deriveP2PCheckOutcome(EMPTY_P2P_CHECK_DIAGNOSTICS, false, 0)).toBe("idle");
        expect(deriveP2PCheckOutcome(EMPTY_P2P_CHECK_DIAGNOSTICS, false, 0, true)).toBe("error");
    });
});

describe("same-room additional-device progress", () => {
    const firstDeviceDiagnostics = {
        ...EMPTY_P2P_CHECK_DIAGNOSTICS,
        totalNewConnections: 1,
        totalSuccessfulConnections: 1,
        details: {
            "rtc-a": {
                connectionState: "connected" as const,
                iceConnectionState: "connected" as const,
            },
        },
    };

    it("captures the counter and currently active connection baseline", () => {
        expect(captureP2PAdditionalCheckBaseline(firstDeviceDiagnostics)).toEqual({
            activeConnectionIds: ["rtc-a"],
            totalClosedConnections: 0,
            totalFailedConnections: 0,
            totalNewConnections: 1,
            totalSuccessfulConnections: 1,
        });
    });

    it("does not mistake a reconnect from the first peer for an additional device", () => {
        const baseline = captureP2PAdditionalCheckBaseline(firstDeviceDiagnostics);
        const progress = deriveP2PAdditionalCheckProgress(
            {
                ...firstDeviceDiagnostics,
                totalNewConnections: 2,
                totalSuccessfulConnections: 2,
                details: {
                    "rtc-a": {
                        connectionState: "closed",
                        iceConnectionState: "closed",
                    },
                    "rtc-b": {
                        connectionState: "connected",
                        iceConnectionState: "connected",
                    },
                },
            },
            baseline,
            10_000
        );

        expect(progress).toEqual({
            activeConnections: 0,
            closedConnections: 0,
            failedConnections: 0,
            newConnections: 1,
            newActiveConnectionIds: ["rtc-b"],
            outcome: "negotiating",
            successfulConnections: 1,
        });
    });

    it("requires both a new successful state and another simultaneous active connection", () => {
        const baseline = captureP2PAdditionalCheckBaseline(firstDeviceDiagnostics);

        expect(
            deriveP2PAdditionalCheckProgress(
                {
                    ...firstDeviceDiagnostics,
                    details: {
                        ...firstDeviceDiagnostics.details,
                        "rtc-b": {
                            connectionState: "connected",
                            iceConnectionState: "connected",
                        },
                    },
                },
                baseline,
                10_000
            ).outcome
        ).toBe("negotiating");

        expect(
            deriveP2PAdditionalCheckProgress(
                {
                    ...firstDeviceDiagnostics,
                    totalNewConnections: 2,
                    totalSuccessfulConnections: 2,
                    details: {
                        ...firstDeviceDiagnostics.details,
                        "rtc-b": {
                            connectionState: "connected",
                            iceConnectionState: "connected",
                        },
                    },
                },
                baseline,
                10_000
            )
        ).toEqual({
            activeConnections: 1,
            closedConnections: 0,
            failedConnections: 0,
            newConnections: 1,
            newActiveConnectionIds: ["rtc-b"],
            outcome: "connected",
            successfulConnections: 1,
        });
    });

    it("marks an additional-device attempt inconclusive after its own observation period", () => {
        const baseline = captureP2PAdditionalCheckBaseline(firstDeviceDiagnostics);
        expect(
            deriveP2PAdditionalCheckProgress(firstDeviceDiagnostics, baseline, P2P_CHECK_OBSERVATION_MILLISECONDS)
                .outcome
        ).toBe("inconclusive");
    });
});
