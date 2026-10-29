import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { minify } from "terser";
import { terserOption } from "../../terser.config.mjs";

const fixture = `
    const host = require("obsidian");
    class ModuleLog {
        constructor(configuration) { this.savedSettings = configuration; }
        read(longParameterName) {
            const longIntermediateValue = host.prefix + longParameterName;
            return { savedSettings: this.savedSettings, message: longIntermediateValue };
        }
    }
    function renderMessage(inputValue) { return new ModuleLog({ persistedField: "unchanged" }).read(inputValue); }
    function readWithEval(longEvalParameter) { return eval("longEvalParameter"); }
    function failWithName() { throw new Error("fixture failure"); }
    module.exports = { ModuleLog, renderMessage, readWithEval, failWithName };
`;

describe("production minifier", () => {
    it("shortens local identifiers while preserving host properties, module names, and diagnostics", async () => {
        const result = await minify(fixture, { ...terserOption, sourceMap: false });
        expect(result.code).toBeDefined();
        const sandbox = {
            module: {
                exports: {} as {
                    ModuleLog: { name: string };
                    renderMessage(input: string): unknown;
                    readWithEval(input: string): string;
                    failWithName(): never;
                },
            },
            require: (name: string) => {
                expect(name).toBe("obsidian");
                return { prefix: "host:" };
            },
        };
        runInNewContext(result.code!, sandbox);
        const api = sandbox.module.exports;
        expect(api.ModuleLog.name).toBe("ModuleLog");
        expect(api.renderMessage.name).toBe("renderMessage");
        expect(api.renderMessage("sample")).toEqual({
            savedSettings: { persistedField: "unchanged" },
            message: "host:sample",
        });
        expect(api.readWithEval("evaluated")).toBe("evaluated");
        let failure: Error | undefined;
        try {
            api.failWithName();
        } catch (error) {
            failure = error as Error;
        }
        expect(failure?.stack).toContain("failWithName");
        expect(result.code).not.toContain("longParameterName");
        expect(result.code).not.toContain("longIntermediateValue");
    });
});
