import { describe, expect, it } from "vitest";
import { readFetchFlagState, writeFetchFlagState, type FetchFlagState } from "./redFlag.fetchStateMarkdown";

const state: FetchFlagState = {
    type: "livesync-fast-setup",
    version: 1,
    stage1: "remote-only",
    stage2: "keep-local",
};

function stateBlock(value: unknown = state): string {
    return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

describe("Fast Setup Markdown state codec", () => {
    it("reads a valid top-level JSON state fence", () => {
        expect(readFetchFlagState(stateBlock())).toEqual(state);
    });

    it("ignores a legacy remote field", () => {
        expect(readFetchFlagState(stateBlock({ ...state, remote: "old-remote-hash" }))).toEqual(state);
    });

    it("creates a Fast Setup note only for an empty or whitespace-only document", () => {
        const markdown = writeFetchFlagState("", state);

        expect(markdown).toContain("# Fast Setup");
        expect(markdown).toContain("This file keeps the Fast Setup choices while the fetch is incomplete.");
        expect(markdown).toContain("It is removed when the fetch completes.");
        expect(readFetchFlagState(markdown)).toEqual(state);

        const whitespace = " \n\t";
        expect(readFetchFlagState(writeFetchFlagState(whitespace, state))).toEqual(state);
        expect(writeFetchFlagState(whitespace, undefined)).toBe(whitespace);
    });

    it("updates one readable state while preserving prose and unrelated code fences", () => {
        const unrelatedFence = '```json\n{\n  "type": "example"\n}\n```';
        const markdown = `Opening note.\n\n${unrelatedFence}\n\n${stateBlock()}\n\nClosing note.`;
        const updated = { ...state, stage1: "new-choice" };

        const result = writeFetchFlagState(markdown, updated);

        expect(result).toContain("Opening note.");
        expect(result).toContain(unrelatedFence);
        expect(result).toContain("Closing note.");
        expect(readFetchFlagState(result)).toEqual(updated);
    });

    it("clears one readable state while preserving surrounding prose", () => {
        const markdown = `Before.\n${stateBlock()}\nAfter.`;

        expect(writeFetchFlagState(markdown, undefined)).toBe("Before.\nAfter.");
    });

    it("does not read or write nested code examples", () => {
        const example = [
            "> Example state:",
            "> ```json",
            `> ${JSON.stringify(state)}`,
            "> ```",
            "",
            "````markdown",
            "```json",
            JSON.stringify(state),
            "```",
            "````",
        ].join("\n");

        expect(readFetchFlagState(example)).toBeUndefined();
        expect(writeFetchFlagState(example, state)).toBe(example);
        expect(writeFetchFlagState(example, undefined)).toBe(example);
    });

    it("does not change plain prose, malformed JSON, or an unsupported version", () => {
        const malformed = '```json\n{"type":"livesync-fast-setup",\n```';
        const unsupportedVersion = stateBlock({ ...state, version: 2 });

        for (const markdown of ["Ordinary prose only.", malformed, unsupportedVersion]) {
            expect(readFetchFlagState(markdown)).toBeUndefined();
            expect(writeFetchFlagState(markdown, state)).toBe(markdown);
            expect(writeFetchFlagState(markdown, undefined)).toBe(markdown);
        }
    });

    it("does not change duplicate state candidates", () => {
        const markdown = `Start.\n\n${stateBlock()}\n\n${stateBlock({ ...state, stage1: "second" })}\n\nEnd.`;
        expect(readFetchFlagState(markdown)).toBeUndefined();
        expect(writeFetchFlagState(markdown, state)).toBe(markdown);
        expect(writeFetchFlagState(markdown, undefined)).toBe(markdown);
    });

    it("does not repair malformed marker blocks", () => {
        const malformed = [
            "Before.",
            "",
            "```json",
            "{",
            '  "type": "livesync-fast-setup",',
            '  "version": 1,',
            '  "remote":',
            "}",
            "```",
            "",
            "After.",
        ].join("\n");

        expect(readFetchFlagState(malformed)).toBeUndefined();
        expect(writeFetchFlagState(malformed, state)).toBe(malformed);
        expect(writeFetchFlagState(malformed, undefined)).toBe(malformed);
    });

    it("does not write state into malformed Markdown without a readable state block", () => {
        const markdown = "Opening note.\n\n```text\nThis note remains inside an unclosed fence.";

        expect(readFetchFlagState(markdown)).toBeUndefined();
        expect(writeFetchFlagState(markdown, state)).toBe(markdown);
    });

    it("does not write when a state block is inside an unclosed fence", () => {
        const markdown = `Opening note.\n\n\`\`\`json\n${JSON.stringify(state)}`;

        expect(readFetchFlagState(markdown)).toBeUndefined();
        expect(writeFetchFlagState(markdown, state)).toBe(markdown);
    });

    it("does not write into unclosed raw HTML comments and blocks", () => {
        const markdownExamples = [
            "Opening note.\n\n<!--\nThis comment remains open.",
            "Opening note.\n\n<script>\nconst rawBlockRemainsOpen = true;",
            `<!--\n${stateBlock()}`,
        ];

        for (const markdown of markdownExamples) {
            expect(readFetchFlagState(markdown)).toBeUndefined();
            expect(writeFetchFlagState(markdown, state)).toBe(markdown);
            expect(writeFetchFlagState(markdown, undefined)).toBe(markdown);
        }
    });

    it("does not treat a marker-like string value as a state candidate", () => {
        const unrelated = '```json\n{"description":"\\\"type\\\":\\\"livesync-fast-setup\\\""}\n```';

        expect(readFetchFlagState(unrelated)).toBeUndefined();
        expect(writeFetchFlagState(unrelated, state)).toBe(unrelated);
    });
});
