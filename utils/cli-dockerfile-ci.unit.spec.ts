import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const dockerfile = readFileSync(new URL("src/apps/cli/Dockerfile", root), "utf8");
const dockerfileLines = dockerfile.split(/\r?\n/);
const gitignoreLines = readFileSync(new URL(".gitignore", root), "utf8").split(/\r?\n/);

function stageLine(stage: string): string | undefined {
    return dockerfileLines.find((line) => /^FROM\b/i.test(line) && new RegExp(`\\bAS\\s+${stage}$`, "i").test(line));
}

describe("CLI Dockerfile bundle stages", () => {
    it("keeps the default build self-contained from source", () => {
        expect(dockerfileLines).toContain("ARG CLI_BUNDLE_STAGE=builder");
        expect(stageLine("builder")).toBe("FROM --platform=$BUILDPLATFORM node:22-slim AS builder");
        expect(dockerfileLines).toContain("COPY . .");
        expect(dockerfileLines).toContain("RUN cd src/apps/cli && npm run build");
        expect(dockerfileLines).toContain("FROM ${CLI_BUNDLE_STAGE} AS cli-bundle");
        expect(dockerfileLines).toContain("COPY --from=cli-bundle /build/src/apps/cli/dist ./dist");
    });

    it("provides an explicit stage for a prebuilt bundle", () => {
        expect(stageLine("prebuilt")).toBe("FROM scratch AS prebuilt");
        expect(dockerfileLines).toContain("COPY _cli-bundle/ /build/src/apps/cli/dist/");
        expect(dockerfileLines).toContain("FROM ${CLI_BUNDLE_STAGE} AS cli-bundle");
    });

    it("builds source on the host platform and native dependencies in the target stages", () => {
        expect(stageLine("runtime-deps")).toBe("FROM node:22-slim AS runtime-deps");
        expect(dockerfileLines).toContain("FROM node:22-slim");
    });

    it("ignores the temporary prebuilt bundle directory", () => {
        expect(gitignoreLines).toContain("_cli-bundle/");
    });
});
