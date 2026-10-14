import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { imageReferences, summariseResults } from "./cli-docker-artifacts.mjs";

const helper = fileURLToPath(new URL("./cli-docker-artifacts.mjs", import.meta.url));
const temporaryDirectories: string[] = [];
const amd64Digest = `sha256:${"a".repeat(64)}`;
const arm64Digest = `sha256:${"b".repeat(64)}`;

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

function makeTemporaryDirectory(): string {
    const directory = mkdtempSync(join(tmpdir(), "livesync-cli-docker-artifacts-"));
    temporaryDirectories.push(directory);
    return directory;
}

function runCli(args: string[]) {
    return spawnSync(process.execPath, [helper, ...args], { encoding: "utf8" });
}

function writeJson(directory: string, name: string, value: unknown): void {
    writeFileSync(join(directory, name), `${JSON.stringify(value)}\n`, "utf8");
}

describe("CLI Docker artifact aggregation", () => {
    it.each([
        [
            [
                { arch: "amd64", e2e_passed: false },
                { arch: "arm64", e2e_passed: true },
            ],
            false,
        ],
        [
            [
                { arch: "arm64", e2e_passed: true },
                { arch: "amd64", e2e_passed: false },
            ],
            false,
        ],
    ])("summarises mixed results independent of record order", (records, expected) => {
        expect(summariseResults(records)).toBe(expected);
    });

    it("reports success only when both architecture results pass", () => {
        expect(
            summariseResults([
                { arch: "amd64", e2e_passed: true },
                { arch: "arm64", e2e_passed: true },
            ])
        ).toBe(true);
    });

    it("rejects malformed, missing, and duplicate result records", () => {
        expect(() =>
            summariseResults([
                { arch: "amd64", e2e_passed: "true" },
                { arch: "arm64", e2e_passed: true },
            ])
        ).toThrow(/boolean/);
        expect(() => summariseResults([{ arch: "amd64", e2e_passed: true }])).toThrow(/Exactly one/);
        expect(() =>
            summariseResults([
                { arch: "amd64", e2e_passed: true },
                { arch: "amd64", e2e_passed: false },
            ])
        ).toThrow(/Duplicate/);
    });

    it("builds deterministic architecture-ordered references and rejects invalid or duplicate digests", () => {
        const records = [
            { arch: "arm64", digest: arm64Digest },
            { arch: "amd64", digest: amd64Digest },
        ];
        expect(imageReferences("ghcr.io/example/cli", records)).toEqual([
            `ghcr.io/example/cli@${amd64Digest}`,
            `ghcr.io/example/cli@${arm64Digest}`,
        ]);
        expect(() =>
            imageReferences("ghcr.io/example/cli", [
                { arch: "amd64", digest: "sha256:BAD" },
                { arch: "arm64", digest: arm64Digest },
            ])
        ).toThrow(/Digest/);
        expect(() =>
            imageReferences("ghcr.io/example/cli", [
                { arch: "amd64", digest: amd64Digest },
                { arch: "arm64", digest: amd64Digest },
            ])
        ).toThrow(/distinct/);
        expect(() => imageReferences("../../escape", records)).toThrow(/canonical image/);
    });

    it("rejects extra JSON files and filenames whose records name another architecture", () => {
        const directory = makeTemporaryDirectory();
        writeJson(directory, "amd64.json", { arch: "amd64", e2e_passed: true });
        writeJson(directory, "arm64.json", { arch: "arm64", e2e_passed: true });
        writeJson(directory, "extra.json", { arch: "arm64", e2e_passed: false });
        expect(runCli(["summary", directory]).status).toBe(1);

        rmSync(join(directory, "extra.json"));
        writeJson(directory, "amd64.json", { arch: "arm64", e2e_passed: true });
        expect(runCli(["summary", directory]).status).toBe(1);
    });

    it("prints a false summary successfully and fails when either result file is missing", () => {
        const directory = makeTemporaryDirectory();
        const results = join(directory, "results");
        expect(runCli(["record-result", "amd64", "failure", results]).status).toBe(0);
        expect(runCli(["record-result", "arm64", "success", results]).status).toBe(0);

        const summary = runCli(["summary", results]);
        expect(summary.status, summary.stderr).toBe(0);
        expect(summary.stdout).toBe("e2e_passed=false\n");

        const missing = join(directory, "missing");
        mkdirSync(missing);
        expect(runCli(["summary", missing]).status).toBe(1);
    });

    it("records results and digests without overwriting and prints references in canonical order", () => {
        const directory = makeTemporaryDirectory();
        const results = join(directory, "results");
        const digests = join(directory, "digests");

        expect(runCli(["record-result", "arm64", "success", results]).status).toBe(0);
        expect(runCli(["record-result", "amd64", "skipped", results]).status).toBe(0);
        expect(runCli(["record-result", "amd64", "success", results]).status).toBe(1);
        expect(JSON.parse(readFileSync(join(results, "amd64.json"), "utf8"))).toEqual({
            arch: "amd64",
            e2e_passed: false,
        });

        expect(runCli(["record-digest", "arm64", arm64Digest, digests]).status).toBe(0);
        expect(runCli(["record-digest", "amd64", amd64Digest, digests]).status).toBe(0);
        const invalid = join(directory, "invalid");
        expect(runCli(["record-digest", "amd64", "sha256:BAD", invalid]).status).toBe(1);
        expect(existsSync(invalid)).toBe(false);

        const references = runCli(["references", "ghcr.io/example/cli", digests]);
        expect(references.status, references.stderr).toBe(0);
        expect(references.stdout).toBe(`ghcr.io/example/cli@${amd64Digest}\nghcr.io/example/cli@${arm64Digest}\n`);

        const traversal = runCli(["record-result", "../escape", "success", join(directory, "nested")]);
        expect(traversal.status).toBe(1);
        expect(readdirSync(directory)).not.toContain("escape.json");
    });
});
