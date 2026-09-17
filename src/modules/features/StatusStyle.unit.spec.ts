import { describe, expect, it } from "vitest";

import {
    STATUS_STYLE_KEY,
    StatusStyles,
    deriveMinimalState,
    formatMinimalCounters,
    getStatusStyle,
    setStatusStyle,
} from "./StatusStyle.ts";

describe("getStatusStyle", () => {
    it("falls back to classic when the key is absent or unknown", () => {
        expect(getStatusStyle(undefined)).toBe(StatusStyles.CLASSIC);
        expect(getStatusStyle({})).toBe(StatusStyles.CLASSIC);
        expect(getStatusStyle({ [STATUS_STYLE_KEY]: "bogus" })).toBe(StatusStyles.CLASSIC);
    });
    it("round-trips through setStatusStyle", () => {
        const settings = {} as object;
        setStatusStyle(settings, StatusStyles.MINIMAL);
        expect(getStatusStyle(settings)).toBe(StatusStyles.MINIMAL);
        setStatusStyle(settings, StatusStyles.CLASSIC);
        expect(getStatusStyle(settings)).toBe(StatusStyles.CLASSIC);
    });
});

describe("deriveMinimalState", () => {
    it("treats a paused live replication with nothing queued as idle", () => {
        expect(deriveMinimalState("PAUSED", 0)).toBe("idle");
        expect(deriveMinimalState("CLOSED", 0)).toBe("idle");
        expect(deriveMinimalState("NOT_CONNECTED", 0)).toBe("idle");
        expect(deriveMinimalState("COMPLETED", 0)).toBe("idle");
    });
    it("is active while a batch is moving or work is queued", () => {
        expect(deriveMinimalState("CONNECTED", 0)).toBe("active");
        expect(deriveMinimalState("STARTED", 0)).toBe("active");
        expect(deriveMinimalState("JOURNAL_SEND", 0)).toBe("active");
        expect(deriveMinimalState("PAUSED", 2)).toBe("active");
        expect(deriveMinimalState("CLOSED", 1)).toBe("active");
    });
    it("reports an error regardless of queued work", () => {
        expect(deriveMinimalState("ERRORED", 0)).toBe("error");
        expect(deriveMinimalState("ERRORED", 5)).toBe("error");
    });
});

describe("formatMinimalCounters", () => {
    it("omits zero counters", () => {
        expect(formatMinimalCounters(0, 0)).toBe("");
        expect(formatMinimalCounters(2, 0)).toBe("↑2");
        expect(formatMinimalCounters(0, 3)).toBe("↓3");
        expect(formatMinimalCounters(2, 3)).toBe("↑2 ↓3");
    });
});
