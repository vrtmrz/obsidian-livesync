import { describe, expect, it } from "vitest";

import {
    REMOTE_OPERATION_ACTIVITY_ICON,
    REMOTE_REQUEST_ACTIVITY_ICON,
    formatRemoteActivityStatusLabel,
    getTrackedRequestCount,
} from "./RemoteActivityStatus.ts";

describe("getTrackedRequestCount", () => {
    it("reports the non-negative difference between starts and completions", () => {
        expect(getTrackedRequestCount(3, 2)).toBe(1);
        expect(getTrackedRequestCount(2, 2)).toBe(0);
        expect(getTrackedRequestCount(2, 3)).toBe(0);
    });
});

describe("formatRemoteActivityStatusLabel", () => {
    it("separates a finite remote operation from tracked physical requests", () => {
        expect(formatRemoteActivityStatusLabel({ remoteOperationCount: 1, trackedRequestCount: 0 })).toBe(
            `${REMOTE_OPERATION_ACTIVITY_ICON} `
        );
        expect(formatRemoteActivityStatusLabel({ remoteOperationCount: 0, trackedRequestCount: 1 })).toBe(
            `${REMOTE_REQUEST_ACTIVITY_ICON}1 `
        );
        expect(formatRemoteActivityStatusLabel({ remoteOperationCount: 1, trackedRequestCount: 2 })).toBe(
            `${REMOTE_OPERATION_ACTIVITY_ICON} ${REMOTE_REQUEST_ACTIVITY_ICON}2 `
        );
    });

    it("omits inactive and invalid negative activity counts", () => {
        expect(formatRemoteActivityStatusLabel({ remoteOperationCount: 0, trackedRequestCount: 0 })).toBe("");
        expect(formatRemoteActivityStatusLabel({ remoteOperationCount: -1, trackedRequestCount: -1 })).toBe("");
    });
});
