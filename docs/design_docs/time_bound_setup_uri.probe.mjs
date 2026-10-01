// Executable design probe; this file is not part of any application bundle.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageDirectory = process.argv[2]
    ? resolve(process.argv[2])
    : fileURLToPath(new URL(".", import.meta.resolve("@vrtmrz/livesync-commonlib/package.json")));
const packageURL = pathToFileURL(`${packageDirectory}/`);
const metadata = JSON.parse(await readFile(new URL("package.json", packageURL), "utf8"));
assert.equal(metadata.version, "0.1.27", "Run against the Commonlib version assessed by this design");
const { encodeSettingsToSetupURI: encodeLegacy, decodeSettingsFromSetupURI: decodeLegacy } = await import(
    new URL("dist/API/processSetting.js", packageURL).href
);
const { configURIBase } = await import(new URL("dist/common/types.js", packageURL).href);

const WEEK_MS = 604_800_000;
const passphrase = "synthetic time-bound URI passphrase";
const settings = {
    couchDB_URI: "https://example.invalid",
    couchDB_USER: "synthetic-user",
    couchDB_PASSWORD: "synthetic-secret",
    isConfigured: true,
};
const midweek = Date.parse("2026-09-28T12:00:00Z");
const slot = (now) => {
    assert.ok(Number.isSafeInteger(now) && now >= 0, "A supported UTC timestamp is required");
    return Math.floor(now / WEEK_MS);
};
const end = (slot(midweek) + 1) * WEEK_MS;
const payloadOf = (uri) => {
    assert.ok(uri.trim().startsWith(configURIBase));
    return decodeURIComponent(uri.trim().slice(configURIBase.length));
};
const wrap = (payload) => configURIBase + encodeURIComponent(payload);
const fixedClock = (now) => () => now;

async function effectivePassphrase(secret, mode, bucket) {
    if (mode === "persistent") return secret;
    assert.equal(mode, "ephemeral");
    const text = new TextEncoder();
    const keyBytes = await crypto.subtle.digest("SHA-256", text.encode(secret));
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const context = JSON.stringify(["livesync/setup-uri", "tb1", "ephemeral", bucket]);
    const signed = await crypto.subtle.sign("HMAC", key, text.encode(context));
    return Array.from(new Uint8Array(signed), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function encode(mode, clock, secret = passphrase) {
    assert.ok(mode === "ephemeral" || mode === "persistent");
    if (mode === "persistent") {
        return { uri: (await encodeLegacy(settings, secret)).trim(), usableUntil: null };
    }
    const bucket = slot(clock());
    const effective = await effectivePassphrase(secret, mode, bucket);
    const legacy = await encodeLegacy(settings, effective);
    if (mode === "ephemeral" && slot(clock()) !== bucket) throw new Error("Window changed");
    return {
        uri: legacy.trim(),
        usableUntil: (bucket + 1) * WEEK_MS,
    };
}

async function decode(uri, secret, clock, attempts = []) {
    const payload = payloadOf(uri);
    if (!payload.startsWith("%$")) {
        return decodeLegacy(uri.trim(), secret);
    }
    const bucket = slot(clock());
    const authenticated = [];
    for (const mode of ["ephemeral", "persistent"]) {
        const effective = await effectivePassphrase(secret, mode, bucket);
        attempts.push(mode);
        try {
            const value = await decodeLegacy(uri.trim(), effective);
            if (value !== false) authenticated.push({ mode, value });
        } catch {
            // Authentication failures are expected while trying the two candidates.
        }
    }
    const currentBucket = slot(clock());
    const accepted = authenticated.filter(({ mode }) => mode === "persistent" || bucket === currentBucket);
    if (accepted.length !== 1) throw new Error("Cannot open Setup URI");
    return accepted[0].value;
}

const ephemeral = await encode("ephemeral", fixedClock(midweek));
const persistent = await encode("persistent", fixedClock(midweek));

await test("Persistent opens in the unchanged legacy decoder with the entered passphrase", async () => {
    assert.equal((await decodeLegacy(persistent.uri, passphrase)).couchDB_PASSWORD, settings.couchDB_PASSWORD);
});

await test("Web Crypto derivation matches fixed vectors computed through Node HMAC", async () => {
    assert.equal(
        await effectivePassphrase("test-passphrase", "ephemeral", 1234),
        "b39361c51f0b7bd835554db1dffbc9a540fb30789aa62bf53e39e07d1073013b"
    );
    assert.equal(await effectivePassphrase("test-passphrase", "persistent", 1234), "test-passphrase");
});

await test("Ephemeral accepts the entire current UTC bucket, including before creation", async () => {
    for (const now of [slot(midweek) * WEEK_MS, midweek, end - 1]) {
        const attempts = [];
        assert.equal(
            (await decode(ephemeral.uri, passphrase, fixedClock(now), attempts)).couchDB_PASSWORD,
            settings.couchDB_PASSWORD
        );
        assert.deepEqual(attempts, ["ephemeral", "persistent"]);
    }
});

await test("Ephemeral rejects the previous bucket, the exact end, and later buckets", async () => {
    for (const now of [slot(midweek) * WEEK_MS - 1, end, end + WEEK_MS, end + 100 * WEEK_MS]) {
        const attempts = [];
        await assert.rejects(decode(ephemeral.uri, passphrase, fixedClock(now), attempts), /Cannot open/);
        assert.deepEqual(attempts, ["ephemeral", "persistent"]);
    }
});

await test("Persistent accepts distant supported timestamps using the same two attempts", async () => {
    for (const now of [0, midweek, end, end + 100 * WEEK_MS]) {
        const attempts = [];
        assert.equal(
            (await decode(persistent.uri, passphrase, fixedClock(now), attempts)).couchDB_PASSWORD,
            settings.couchDB_PASSWORD
        );
        assert.deepEqual(attempts, ["ephemeral", "persistent"]);
    }
});

await test("Both modes reject an incorrect passphrase with the same final error", async () => {
    for (const generated of [ephemeral, persistent]) {
        await assert.rejects(decode(generated.uri, "incorrect", fixedClock(midweek)), /Cannot open Setup URI/);
    }
});

await test("Generation metadata agrees with the fixed UTC boundary", () => {
    assert.equal(ephemeral.usableUntil, end);
    assert.equal(new Date(end).toISOString(), "2026-10-01T00:00:00.000Z");
    assert.equal(persistent.usableUntil, null);
});

await test("Both modes retain the legacy binary layout without a new marker or timestamp field", () => {
    const binaryLength = (uri) => {
        const payload = payloadOf(uri);
        assert.ok(payload.startsWith("%$"));
        return Buffer.from(payload.slice("%$".length), "base64").length;
    };
    assert.equal(binaryLength(ephemeral.uri), binaryLength(persistent.uri));
});

await test("Repeated generation has different ciphertext without changing the time limit", async () => {
    const again = await encode("ephemeral", fixedClock(midweek));
    assert.notEqual(again.uri, ephemeral.uri);
    assert.equal(again.usableUntil, ephemeral.usableUntil);
});

await test("Old decoder cannot open Ephemeral with the entered passphrase", async () => {
    await assert.rejects(decodeLegacy(ephemeral.uri, passphrase));
});

await test("Legacy URI remains readable without time binding", async () => {
    const legacy = await encodeLegacy(settings, passphrase);
    const attempts = [];
    const value = await decode(legacy, passphrase, fixedClock(end + 100 * WEEK_MS), attempts);
    assert.equal(value.couchDB_PASSWORD, settings.couchDB_PASSWORD);
    assert.deepEqual(attempts, ["ephemeral", "persistent"]);
});

await test("Unsupported prefixes are rejected without time-bound trials", async () => {
    for (const payload of ["tb1:" + payloadOf(ephemeral.uri), "tb2:", "", "unlimited"]) {
        const attempts = [];
        await assert.rejects(decode(wrap(payload), passphrase, fixedClock(midweek), attempts), /format/);
        assert.deepEqual(attempts, []);
    }
});

await test("Missing or truncated legacy-format ciphertext fails both candidates", async () => {
    for (const payload of ["%$", "%$AA=="]) {
        const attempts = [];
        await assert.rejects(decode(wrap(payload), passphrase, fixedClock(midweek), attempts), /Cannot open/);
        assert.deepEqual(attempts, ["ephemeral", "persistent"]);
    }
});

await test("Persistent generation does not consult the clock", async () => {
    const generated = await encode("persistent", () => {
        throw new Error("The Persistent generator must not read time");
    });
    assert.equal(generated.usableUntil, null);
    assert.equal((await decodeLegacy(generated.uri, passphrase)).couchDB_PASSWORD, settings.couchDB_PASSWORD);
});

await test("Changing authenticated ciphertext is rejected", async () => {
    const payload = payloadOf(ephemeral.uri);
    const encoded = payload.slice("%$".length);
    const bytes = Buffer.from(encoded, "base64");
    bytes[bytes.length - 1] ^= 1;
    await assert.rejects(decode(wrap("%$" + bytes.toString("base64")), passphrase, fixedClock(midweek)), /Cannot open/);
});

await test("Protocol query decoding and re-encoding preserve the new payload", async () => {
    for (const generated of [ephemeral, persistent]) {
        const incomingSettings = new URL(generated.uri).searchParams.get("settings");
        const reconstructed = configURIBase + encodeURIComponent(incomingSettings);
        assert.equal(
            (await decode(reconstructed, passphrase, fixedClock(midweek))).couchDB_PASSWORD,
            settings.couchDB_PASSWORD
        );
    }
});

await test("Generation crossing the boundary withholds an Ephemeral result", async () => {
    let reads = 0;
    await assert.rejects(
        encode("ephemeral", () => (reads++ === 0 ? end - 1 : end)),
        /Window changed/
    );
});

await test("Import crossing the boundary withholds Ephemeral settings but accepts Persistent", async () => {
    for (const [generated, succeeds] of [
        [ephemeral, false],
        [persistent, true],
    ]) {
        let reads = 0;
        const result = decode(generated.uri, passphrase, () => (reads++ === 0 ? end - 1 : end));
        if (succeeds) assert.equal((await result).couchDB_PASSWORD, settings.couchDB_PASSWORD);
        else await assert.rejects(result, /Cannot open/);
    }
});

await test("Explicit UTC offsets representing the same instant select the same bucket", async () => {
    for (const date of ["2026-09-28T12:00:00Z", "2026-09-28T21:00:00+09:00", "2026-09-28T05:00:00-07:00"]) {
        assert.equal(
            (await decode(ephemeral.uri, passphrase, fixedClock(Date.parse(date)))).couchDB_PASSWORD,
            settings.couchDB_PASSWORD
        );
    }
});

await test("Passphrase transformation preserves Unicode and supports an empty low-level input", async () => {
    for (const secret of ["", "合言葉🔑é", "e\u0301", " leading and trailing "]) {
        const generated = await encode("ephemeral", fixedClock(midweek), secret);
        assert.equal(
            (await decode(generated.uri, secret, fixedClock(midweek))).couchDB_PASSWORD,
            settings.couchDB_PASSWORD
        );
    }
    assert.notEqual(
        await effectivePassphrase("é", "persistent", 0),
        await effectivePassphrase("e\u0301", "persistent", 0)
    );
});

await test("Ephemeral derivation differs from the raw Persistent passphrase even for bucket zero", async () => {
    assert.notEqual(
        await effectivePassphrase(passphrase, "ephemeral", 0),
        await effectivePassphrase(passphrase, "persistent", 0)
    );
});

await test("Clock rollback reproduces an old Ephemeral key", async () => {
    await assert.rejects(decode(ephemeral.uri, passphrase, fixedClock(end)), /Cannot open/);
    assert.equal(
        (await decode(ephemeral.uri, passphrase, fixedClock(midweek))).couchDB_PASSWORD,
        settings.couchDB_PASSWORD
    );
});
