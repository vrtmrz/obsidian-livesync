import { describe, expect, it } from "vitest";
import { matchesPlainDatabaseText, type DatabaseTextObservation } from "./localFileRetryAssertions.ts";

const expected = "Rename recovery content\n";

describe("local retry database text assertions", () => {
    it("accepts the exact expected plain database body", () => {
        expect(matchesPlainDatabaseText({ type: "plain", datatype: "plain", body: expected }, expected)).toBe(true);
    });

    it("rejects base64 characters stored as plain text instead of the expected body", () => {
        // This is the same wrong plaintext body accepted by the original in-app predicate.
        expect(matchesPlainDatabaseText({ type: "plain", datatype: "plain", body: btoa(expected) }, expected)).toBe(
            false
        );
    });

    it.each([
        { label: "different text", observation: { type: "plain", datatype: "plain", body: "other text" } },
        { label: "binary Metadata", observation: { type: "newnote", datatype: "plain", body: expected } },
        { label: "binary datatype", observation: { type: "plain", datatype: "newnote", body: expected } },
        { label: "missing type", observation: { datatype: "plain", body: expected } },
        { label: "missing datatype", observation: { type: "plain", body: expected } },
        { label: "unavailable body", observation: { type: "plain", datatype: "plain", body: null } },
        { label: "missing revision", observation: null },
        { label: "unavailable observation", observation: undefined },
    ] satisfies { label: string; observation: DatabaseTextObservation | null | undefined }[])(
        "rejects $label",
        ({ observation }) => {
            expect(matchesPlainDatabaseText(observation, expected)).toBe(false);
        }
    );

    it("preserves exact Unicode text without an encoding fallback", () => {
        const text = "詩 — café\n";
        expect(matchesPlainDatabaseText({ type: "plain", datatype: "plain", body: text }, text)).toBe(true);
    });

    it("uses the same closure-free predicate when injected into Obsidian", () => {
        // The in-app boundary transports source text; evaluate that exact function independently of this module.
        const injected = new Function(
            `return (${matchesPlainDatabaseText.toString()});`
        )() as typeof matchesPlainDatabaseText;
        expect(injected({ type: "plain", datatype: "plain", body: expected }, expected)).toBe(true);
        expect(injected({ type: "plain", datatype: "plain", body: btoa(expected) }, expected)).toBe(false);
        expect(injected({ type: "plain", datatype: "newnote", body: expected }, expected)).toBe(false);
    });
});
