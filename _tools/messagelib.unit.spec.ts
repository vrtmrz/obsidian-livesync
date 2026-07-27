import { describe, expect, it } from "vitest";
import { dottedToObject, objectToDotted } from "./messagelib";

describe("message catalogue conversion", () => {
    it("flattens nested objects while preserving leaf values", () => {
        expect(
            objectToDotted({
                dialogue: {
                    title: "Title",
                    options: ["first", "second"],
                },
                "literal key": "Literal",
            })
        ).toEqual({
            "dialogue.title": "Title",
            "dialogue.options": ["first", "second"],
            "literal key": "Literal",
        });
    });

    it("preserves an existing leaf under _value when a dotted child follows it", () => {
        expect(
            dottedToObject({
                section: "Base value",
                "section.child": "Child value",
                "literal key": "Literal",
            })
        ).toEqual({
            section: {
                _value: "Base value",
                child: "Child value",
            },
            "literal key": "Literal",
        });
    });

    it("rejects non-object catalogue roots", () => {
        expect(() => objectToDotted("not an object")).toThrow("Expected a message catalogue object");
        expect(() => dottedToObject(["not", "an", "object"])).toThrow("Expected a dotted message catalogue object");
    });
});
