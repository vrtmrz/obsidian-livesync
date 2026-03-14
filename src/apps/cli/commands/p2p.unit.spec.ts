import { describe, expect, it } from "vitest";
import { parseTimeoutSeconds } from "./p2p";

describe("p2p command helpers", () => {
    it("accepts non-negative timeout", () => {
        expect(parseTimeoutSeconds("0", "p2p-peers")).toBe(0);
        expect(parseTimeoutSeconds("2.5", "p2p-sync")).toBe(2.5);
    });

    it("rejects invalid timeout values", () => {
        expect(() => parseTimeoutSeconds("-1", "p2p-peers")).toThrow(
            "p2p-peers requires a non-negative timeout in seconds"
        );
        expect(() => parseTimeoutSeconds("abc", "p2p-sync")).toThrow(
            "p2p-sync requires a non-negative timeout in seconds"
        );
    });
});
