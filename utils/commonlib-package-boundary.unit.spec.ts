import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type PackageJson = Partial<
    Record<"dependencies" | "devDependencies" | "optionalDependencies" | "peerDependencies", Record<string, string>>
>;

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as PackageJson;

describe("Commonlib package ownership", () => {
    it("does not retain a host-owned Trystero dependency", () => {
        const directDependencies = {
            ...packageJson.dependencies,
            ...packageJson.devDependencies,
            ...packageJson.optionalDependencies,
            ...packageJson.peerDependencies,
        };
        expect(directDependencies).not.toHaveProperty("@trystero-p2p/nostr");
    });
});
