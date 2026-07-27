import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const setupPutCatHelper = readFileSync(new URL("./test/test-setup-put-cat-linux.sh", import.meta.url), "utf8");

describe("CLI setup URI E2E helper", () => {
    it("evaluates Commonlib package imports as ESM", () => {
        expect(setupPutCatHelper).toContain("node --input-type=module -e");
        expect(setupPutCatHelper).not.toContain("npx tsx -e");
    });
});
