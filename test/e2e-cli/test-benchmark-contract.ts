import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { join } from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { type BenchmarkCase, buildCases } from "./bench-network-cases.ts";
import { startCouchdbProxy } from "./bench-couchdb.ts";
import {
    parseBenchmarkVerificationMode,
    selectVerificationEntries,
} from "./helpers/benchmarkVerification.ts";
import type { DatasetEntry } from "./helpers/dataset.ts";
import { createCompressionBenchmarkDataset } from "./helpers/compressionDataset.ts";
import { getFreePort } from "./helpers/net.ts";

function assertStringIncludes(actual: string, expected: string, message?: string): void {
    assert.ok(actual.includes(expected), message ?? `Expected ${JSON.stringify(actual)} to include ${JSON.stringify(expected)}`);
}

function getCase(cases: BenchmarkCase[], name: string): BenchmarkCase {
    const found = cases.find((testCase) => testCase.name === name);
    assert(found, `missing benchmark case: ${name}`);
    return found;
}

function parsedLimitations(testCase: BenchmarkCase): string[] {
    const raw = testCase.env.BENCH_LIMITATIONS_JSON;
    assert(
        raw,
        `${testCase.name} must pass BENCH_LIMITATIONS_JSON to benchmark result output`,
    );
    const parsed = JSON.parse(raw);
    assert(
        Array.isArray(parsed),
        `${testCase.name} limitations must be an array`,
    );
    assert(
        parsed.every((item) =>
            typeof item === "string" && item.trim().length > 0
        ),
    );
    return parsed;
}

test("benchmark cases record scope and limitations for paper use", () => {
    const cases = buildCases();
    assert(cases.length > 0);

    for (const testCase of cases) {
        assert(
            testCase.description.trim().length > 0,
            `${testCase.name} must describe the case`,
        );
        assert(
            testCase.dataPath.trim().length > 0,
            `${testCase.name} must describe the data path`,
        );
        assert(
            testCase.trustBoundary.trim().length > 0,
            `${testCase.name} must describe the trust boundary`,
        );
        assert(
            testCase.measurementScope.trim().length > 0,
            `${testCase.name} must describe the measurement scope`,
        );
        assert(
            testCase.limitations.length > 0,
            `${testCase.name} must list limitations`,
        );
        assert.deepStrictEqual(
            testCase.env.BENCH_MEASUREMENT_SCOPE,
            testCase.measurementScope,
        );
        assert.deepStrictEqual(parsedLimitations(testCase), testCase.limitations);
        assert.deepStrictEqual(
            testCase.env.BENCH_VERIFY_MODE,
            "all",
            `${testCase.name} must verify the complete dataset`,
        );
    }
});
test("CouchDB latency proxy applies half the requested RTT in each direction", async () => {
    const backend = createServer((_request, response) => response.end("ok"));
    const backendPort = await new Promise<number>((resolve, reject) => {
        backend.once("error", reject);
        backend.listen(0, "127.0.0.1", () => {
            const address = backend.address();
            if (!address || typeof address === "string") {
                reject(new Error("Could not read the benchmark backend address"));
                return;
            }
            resolve(address.port);
        });
    });
    const proxyPort = await getFreePort();
    const delays: number[] = [];
    const proxy = await startCouchdbProxy({
        backendUri: `http://127.0.0.1:${backendPort}`,
        proxyUri: `http://127.0.0.1:${proxyPort}`,
        requestedRttMs: 20,
        delay: (milliseconds) => {
            delays.push(milliseconds);
            return Promise.resolve();
        },
    });

    try {
        const response = await fetch(`http://127.0.0.1:${proxyPort}/probe`);
        assert.deepStrictEqual(await response.text(), "ok");
        assert.deepStrictEqual(proxy.directionalDelayMs, 10);
        assert.deepStrictEqual(delays, [10, 10]);
        assert.deepStrictEqual(proxy.snapshotCounters(), {
            requestCount: 1,
            requestBodyBytes: 0,
            responseBodyBytes: 2,
        });
        proxy.resetCounters();
        const posted = await fetch(`http://127.0.0.1:${proxyPort}/probe`, {
            method: "POST",
            body: "abc",
        });
        assert.deepStrictEqual(await posted.text(), "ok");
        assert.deepStrictEqual(proxy.snapshotCounters(), {
            requestCount: 1,
            requestBodyBytes: 3,
            responseBodyBytes: 2,
        });
    } finally {
        await proxy.stop();
        await new Promise<void>((resolve, reject) => {
            backend.close((error) => error ? reject(error) : resolve());
        });
    }

    const halfMillisecondProxy = await startCouchdbProxy({
        backendUri: "http://127.0.0.1:1",
        proxyUri: `http://127.0.0.1:${await getFreePort()}`,
        requestedRttMs: 1,
        delay: () => Promise.resolve(),
    });
    try {
        assert.deepStrictEqual(halfMillisecondProxy.directionalDelayMs, 0.5);
    } finally {
        await halfMillisecondProxy.stop();
    }
});

test("compression benchmark dataset covers representative file kinds deterministically", async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "livesync-compression-contract-"));
    const repositoryRoot = `${fixtureRoot}/repository`;
    const vaultA = `${fixtureRoot}/vault-a`;
    const vaultB = `${fixtureRoot}/vault-b`;
    const repositoryFiles = [
        "docs/settings.md",
        "docs/quick_setup.md",
        "updates.md",
        "instruction_images/cloudant_1.png",
        "images/quick-setup/guide-quick-setup-first-setup-uri.png",
        "package.json",
        "manifest.json",
        "src/serviceFeatures/replication/index.ts",
        "src/serviceFeatures/replication/ReplicateResultProcessor.ts",
    ];
    try {
        for (const [index, relativePath] of repositoryFiles.entries()) {
            const absolutePath = `${repositoryRoot}/${relativePath}`;
            await mkdir(
                absolutePath.slice(0, absolutePath.lastIndexOf("/")),
                { recursive: true },
            );
            await writeFile(
                absolutePath,
                new TextEncoder().encode(
                    `fixture-${index}-${relativePath}\n`.repeat(20),
                ),
            );
        }
        await mkdir(vaultA, { recursive: true });
        await mkdir(vaultB, { recursive: true });
        const jpegEncoder = async (_input: string, output: string) => {
            await writeFile(
                output,
                new Uint8Array([
                    0xff,
                    0xd8,
                    0xff,
                    0xdb,
                    0,
                    1,
                    2,
                    3,
                    0xff,
                    0xd9,
                ]),
            );
            return "contract JPEG encoder";
        };
        const first = await createCompressionBenchmarkDataset({
            rootDir: vaultA,
            repositoryRoot,
            seed: "contract-seed",
            jpegEncoder,
        });
        const second = await createCompressionBenchmarkDataset({
            rootDir: vaultB,
            repositoryRoot,
            seed: "contract-seed",
            jpegEncoder,
        });

        assert.deepStrictEqual(first.filesByKind, {
            md: 3,
            jpg: 2,
            png: 2,
            json: 2,
            ts: 2,
            gz: 1,
            bin: 1,
        });
        assert.deepStrictEqual(first.totalFiles, 13);
        assert.deepStrictEqual(first.jpegGenerator, "contract JPEG encoder");
        assert.deepStrictEqual(
            first.entries.map((entry) => [
                entry.kind,
                entry.relativePath,
                entry.size,
            ]),
            second.entries.map((entry) => [
                entry.kind,
                entry.relativePath,
                entry.size,
            ]),
        );
        assert(first.entries.every((entry) => entry.size > 0));
    } finally {
        await rm(fixtureRoot, { recursive: true }).catch(() => {});
    }
});

test("benchmark verification mode selects either all files or a labelled sample", () => {
    const entries: DatasetEntry[] = [
        { kind: "md", relativePath: "a.md", absolutePath: "/a", size: 1 },
        { kind: "md", relativePath: "b.md", absolutePath: "/b", size: 1 },
        { kind: "bin", relativePath: "c.bin", absolutePath: "/c", size: 1 },
        { kind: "md", relativePath: "d.md", absolutePath: "/d", size: 1 },
        { kind: "bin", relativePath: "e.bin", absolutePath: "/e", size: 1 },
    ];

    assert.deepStrictEqual(parseBenchmarkVerificationMode("ALL"), "all");
    assert.deepStrictEqual(selectVerificationEntries(entries, "all").length, entries.length);
    const sample = selectVerificationEntries(entries, "sample");
    assert(sample.length > 0 && sample.length < entries.length);
    assert(sample.some((entry) => entry.kind === "md"));
    assert(sample.some((entry) => entry.kind === "bin"));
});

test("P2P signalling-shim cases do not claim to shape the note-data path", () => {
    const cases = buildCases();
    for (
        const name of [
            "p2p-signalling-netem-home-wifi",
            "p2p-signalling-netem-tethering-vpn",
        ]
    ) {
        const testCase = getCase(cases, name);
        assert.deepStrictEqual(testCase.runner, "p2p");
        assert.deepStrictEqual(testCase.env.BENCH_TURN_SERVERS, "");
        assert.deepStrictEqual(testCase.env.BENCH_SIMULATION_TIER, "2");
        assert.deepStrictEqual(
            testCase.env.BENCH_NETWORK_MODEL,
            "compose-netem-signalling-shim",
        );
        assertStringIncludes(testCase.dataPath, "WebRTC DataChannel");
        assertStringIncludes(testCase.dataPath, "Nostr signalling");
        assertStringIncludes(testCase.measurementScope, "fresh CLI p2p-sync");
        assert(
            testCase.limitations.some((limitation) =>
                limitation.includes("connection establishment")
            ),
            `${name} must state that connection establishment is timed`,
        );
        assert(
            testCase.limitations.some((limitation) =>
                limitation.includes("does not shape the selected WebRTC")
            ),
            `${name} must avoid claiming that the P2P note-data path was shaped`,
        );
    }
});

test("placeholder and TURN cases are clearly non-evidence for broad P2P performance", () => {
    const cases = buildCases();

    const smartphone = getCase(cases, "p2p-smartphone-vpn-direct");
    assert.deepStrictEqual(smartphone.env.BENCH_SIMULATION_TIER, "unmeasured");
    assert.deepStrictEqual(smartphone.env.BENCH_NETWORK_MODEL, "local-runner-no-netem");
    assert(
        smartphone.limitations.some((limitation) =>
            limitation.includes("must not be reported as smartphone")
        ),
        "smartphone/VPN placeholder must not be usable as field evidence by accident",
    );

    const turn = getCase(cases, "p2p-user-turn");
    assertStringIncludes(turn.env.BENCH_TURN_SERVERS, "turn:");
    assert(
        turn.limitations.some((limitation) =>
            limitation.includes(
                "does not prove that the selected ICE path was relayed",
            )
        ),
        "TURN case must require selected ICE candidate interpretation",
    );
});

test("CouchDB netem cases are marked as remote-store baselines", () => {
    const cases = buildCases();
    for (
        const name of ["couchdb-netem-home-wifi", "couchdb-netem-tethering-vpn"]
    ) {
        const testCase = getCase(cases, name);
        assert.deepStrictEqual(testCase.runner, "couchdb");
        assert.deepStrictEqual(testCase.env.BENCH_SIMULATION_TIER, "2");
        assert.deepStrictEqual(
            testCase.env.BENCH_NETWORK_MODEL,
            "compose-netem-tcp-shim",
        );
        assertStringIncludes(testCase.measurementScope, "CouchDB");
        assert(
            testCase.limitations.some((limitation) =>
                limitation.includes("not the WebRTC P2P data path")
            ),
            `${name} must remain scoped to the CouchDB remote-store path`,
        );
    }
});
