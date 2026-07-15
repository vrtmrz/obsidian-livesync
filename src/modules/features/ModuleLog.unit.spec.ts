import { describe, expect, it } from "vitest";
import { hasRemoteActivity } from "./RemoteActivityStatus.ts";

describe("hasRemoteActivity", () => {
    it("preserves the existing HTTP request balance signal", () => {
        expect(hasRemoteActivity(2, 1, 0)).toBe(true);
        expect(hasRemoteActivity(2, 2, 0)).toBe(false);
    });

    it("reports bounded remote activity without an HTTP request imbalance", () => {
        expect(hasRemoteActivity(2, 2, 1)).toBe(true);
    });
});
