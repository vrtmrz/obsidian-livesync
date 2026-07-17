import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { type BenchmarkCase, buildCases } from "./bench-network-cases.ts";
import { startCouchdbProxy } from "./bench-couchdb.ts";
import { parseBenchmarkVerificationMode, selectVerificationEntries } from "./helpers/benchmarkVerification.ts";
import type { DatasetEntry } from "./helpers/dataset.ts";

function getFreePort(): number {
    const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
    try {
        return (listener.addr as Deno.NetAddr).port;
    } finally {
        listener.close();
    }
}

function getCase(cases: BenchmarkCase[], name: string): BenchmarkCase {
    const found = cases.find((testCase) => testCase.name === name);
    assert(found, `missing benchmark case: ${name}`);
    return found;
}

function parsedLimitations(testCase: BenchmarkCase): string[] {
    const raw = testCase.env.BENCH_LIMITATIONS_JSON;
    assert(raw, `${testCase.name} must pass BENCH_LIMITATIONS_JSON to benchmark result output`);
    const parsed = JSON.parse(raw);
    assert(Array.isArray(parsed), `${testCase.name} limitations must be an array`);
    assert(parsed.every((item) => typeof item === "string" && item.trim().length > 0));
    return parsed;
}

Deno.test("benchmark cases record scope and limitations for paper use", () => {
    const cases = buildCases();
    assert(cases.length > 0);

    for (const testCase of cases) {
        assert(testCase.description.trim().length > 0, `${testCase.name} must describe the case`);
        assert(testCase.dataPath.trim().length > 0, `${testCase.name} must describe the data path`);
        assert(testCase.trustBoundary.trim().length > 0, `${testCase.name} must describe the trust boundary`);
        assert(testCase.measurementScope.trim().length > 0, `${testCase.name} must describe the measurement scope`);
        assert(testCase.limitations.length > 0, `${testCase.name} must list limitations`);
        assertEquals(testCase.env.BENCH_MEASUREMENT_SCOPE, testCase.measurementScope);
        assertEquals(parsedLimitations(testCase), testCase.limitations);
        assertEquals(testCase.env.BENCH_VERIFY_MODE, "all", `${testCase.name} must verify the complete dataset`);
    }
});

Deno.test("CouchDB latency proxy applies half the requested RTT in each direction", async () => {
    const backendPort = getFreePort();
    const proxyPort = getFreePort();
    const delays: number[] = [];
    const backend = Deno.serve(
        {
            hostname: "127.0.0.1",
            port: backendPort,
            onListen() {},
        },
        () => new Response("ok")
    );
    const proxy = startCouchdbProxy({
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
        assertEquals(await response.text(), "ok");
        assertEquals(proxy.directionalDelayMs, 10);
        assertEquals(delays, [10, 10]);
    } finally {
        await proxy.stop();
        await backend.shutdown();
    }

    const halfMillisecondProxy = startCouchdbProxy({
        backendUri: "http://127.0.0.1:1",
        proxyUri: `http://127.0.0.1:${getFreePort()}`,
        requestedRttMs: 1,
        delay: () => Promise.resolve(),
    });
    try {
        assertEquals(halfMillisecondProxy.directionalDelayMs, 0.5);
    } finally {
        await halfMillisecondProxy.stop();
    }
});

Deno.test("benchmark verification mode selects either all files or a labelled sample", () => {
    const entries: DatasetEntry[] = [
        { kind: "md", relativePath: "a.md", absolutePath: "/a", size: 1 },
        { kind: "md", relativePath: "b.md", absolutePath: "/b", size: 1 },
        { kind: "bin", relativePath: "c.bin", absolutePath: "/c", size: 1 },
        { kind: "md", relativePath: "d.md", absolutePath: "/d", size: 1 },
        { kind: "bin", relativePath: "e.bin", absolutePath: "/e", size: 1 },
    ];

    assertEquals(parseBenchmarkVerificationMode("ALL"), "all");
    assertEquals(selectVerificationEntries(entries, "all").length, entries.length);
    const sample = selectVerificationEntries(entries, "sample");
    assert(sample.length > 0 && sample.length < entries.length);
    assert(sample.some((entry) => entry.kind === "md"));
    assert(sample.some((entry) => entry.kind === "bin"));
});

Deno.test("P2P signalling-shim cases do not claim to shape the note-data path", () => {
    const cases = buildCases();
    for (const name of ["p2p-signalling-netem-home-wifi", "p2p-signalling-netem-tethering-vpn"]) {
        const testCase = getCase(cases, name);
        assertEquals(testCase.runner, "p2p");
        assertEquals(testCase.env.BENCH_TURN_SERVERS, "");
        assertEquals(testCase.env.BENCH_SIMULATION_TIER, "2");
        assertEquals(testCase.env.BENCH_NETWORK_MODEL, "compose-netem-signalling-shim");
        assertStringIncludes(testCase.dataPath, "WebRTC DataChannel");
        assertStringIncludes(testCase.dataPath, "Nostr signalling");
        assertStringIncludes(testCase.measurementScope, "fresh CLI p2p-sync");
        assert(
            testCase.limitations.some((limitation) => limitation.includes("connection establishment")),
            `${name} must state that connection establishment is timed`
        );
        assert(
            testCase.limitations.some((limitation) => limitation.includes("does not shape the selected WebRTC")),
            `${name} must avoid claiming that the P2P note-data path was shaped`
        );
    }
});

Deno.test("placeholder and TURN cases are clearly non-evidence for broad P2P performance", () => {
    const cases = buildCases();

    const smartphone = getCase(cases, "p2p-smartphone-vpn-direct");
    assertEquals(smartphone.env.BENCH_SIMULATION_TIER, "unmeasured");
    assertEquals(smartphone.env.BENCH_NETWORK_MODEL, "local-runner-no-netem");
    assert(
        smartphone.limitations.some((limitation) => limitation.includes("must not be reported as smartphone")),
        "smartphone/VPN placeholder must not be usable as field evidence by accident"
    );

    const turn = getCase(cases, "p2p-user-turn");
    assertStringIncludes(turn.env.BENCH_TURN_SERVERS, "turn:");
    assert(
        turn.limitations.some((limitation) =>
            limitation.includes("does not prove that the selected ICE path was relayed")
        ),
        "TURN case must require selected ICE candidate interpretation"
    );
});

Deno.test("CouchDB netem cases are marked as remote-store baselines", () => {
    const cases = buildCases();
    for (const name of ["couchdb-netem-home-wifi", "couchdb-netem-tethering-vpn"]) {
        const testCase = getCase(cases, name);
        assertEquals(testCase.runner, "couchdb");
        assertEquals(testCase.env.BENCH_SIMULATION_TIER, "2");
        assertEquals(testCase.env.BENCH_NETWORK_MODEL, "compose-netem-tcp-shim");
        assertStringIncludes(testCase.measurementScope, "CouchDB");
        assert(
            testCase.limitations.some((limitation) => limitation.includes("not the WebRTC P2P data path")),
            `${name} must remain scoped to the CouchDB remote-store path`
        );
    }
});
