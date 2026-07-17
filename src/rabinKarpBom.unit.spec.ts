import { splitPiecesRabinKarp } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/chunks";
import { describe, expect, it } from "vitest";

describe("Rabin-Karp text splitting", () => {
    it("preserves U+FEFF at the beginning of an internal chunk", async () => {
        const content = `${"a".repeat(1024)}\uFEFF${"b".repeat(1024)}`;
        const createChunks = await splitPiecesRabinKarp(new Blob([content], { type: "text/plain" }), 1024, true, 1024);
        const chunks: string[] = [];

        for await (const chunk of createChunks()) {
            chunks.push(chunk);
        }

        expect(chunks).toHaveLength(3);
        expect(chunks[1].startsWith("\uFEFF")).toBe(true);
        expect(chunks.join("")).toBe(content);
    });
});
