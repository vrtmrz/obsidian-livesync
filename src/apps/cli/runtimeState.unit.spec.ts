import { fs, os, path } from "@vrtmrz/livesync-commonlib/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    ReconstructionState,
    inspectLegacyState,
    readOptionalFile,
    runtimeDatabaseDirectory,
    runtimeScopeDirectory,
} from "./runtimeState";

describe("CLI runtime scope compatibility", () => {
    it("retains SHA-256 directory names for database and Unicode Vault paths", () => {
        expect(runtimeScopeDirectory("state", "headless-app", "/vault/日本語😀")).toBe(
            path.join(
                "state",
                ".livesync",
                "runtime",
                "scopes",
                "511afda5613706862fa4add801b3f9b19e0db2acacc07b9218f2d01ff41ca61d",
                "542d31d6918ad8bf915e204e41e479fdbd7251690f182fd802378323b4c6de23"
            )
        );
        expect(path.basename(runtimeDatabaseDirectory("state", ""))).toBe(
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    });
});

describe("CLI reconstruction state", () => {
    let directory: string;
    let settingsPath: string;
    let state: ReconstructionState;

    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), "livesync-reconstruction-"));
        settingsPath = path.join(directory, "settings.json");
        fs.writeFileSync(settingsPath, JSON.stringify({ additionalSuffixOfDatabaseName: "original" }));
        state = new ReconstructionState(directory, path.join(directory, "vault"), settingsPath);
    });

    afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

    it("retains the persisted settings fingerprint across hash implementations", () => {
        state.prepare("fetch", true);
        expect(JSON.parse(fs.readFileSync(state.markerPath, "utf-8"))).toMatchObject({
            settingsBeforeHash: "29e04e3dd1d10b352678a922ff5a03fbe529d3505e9cf46c2ecc860f44478ae8",
        });
    });

    it("persists progress before returning and permits only the matching forced retry", () => {
        state.prepare("fetch", true);
        expect(JSON.parse(fs.readFileSync(state.markerPath, "utf-8"))).toMatchObject({
            phase: "running",
            command: "fetch",
        });
        if (process.platform !== "win32") expect(fs.statSync(state.markerPath).mode & 0o777).toBe(0o600);
        expect(() => state.prepare("sync", false)).toThrow("interrupted fetch");
        expect(() => state.prepare("ls", false, true)).toThrow("interrupted fetch");
        expect(() => state.prepare("fetch", false)).toThrow("interrupted fetch");
        expect(() => state.prepare("rebuild", true)).toThrow("interrupted fetch");
        expect(() =>
            new ReconstructionState(directory, path.join(directory, "other"), settingsPath).prepare("fetch", true)
        ).toThrow("interrupted fetch");
        expect(() =>
            new ReconstructionState(
                directory,
                path.join(directory, "vault"),
                path.join(directory, "other.json")
            ).prepare("fetch", true)
        ).toThrow("interrupted fetch");
        expect(() => state.prepare("ls", false)).not.toThrow();
        expect(() => state.prepare("fetch", true)).not.toThrow();
    });

    it("recovers completed settings before permitting another command", () => {
        state.prepare("fetch", true);
        const completed = JSON.stringify({ additionalSuffixOfDatabaseName: "headless-app", retained: true });
        state.complete(completed);

        new ReconstructionState(directory, path.join(directory, "vault"), settingsPath).prepare("sync", false);

        expect(fs.readFileSync(settingsPath, "utf-8")).toBe(completed);
        expect(readOptionalFile(state.markerPath)).toBeUndefined();
    });

    it.each(["normal completion", "restart"] as const)(
        "preserves user settings changed during reconstruction at %s",
        (phase) => {
            state.prepare("rebuild", true);
            state.complete(JSON.stringify({ additionalSuffixOfDatabaseName: "headless-app" }));
            const edited = JSON.stringify({ additionalSuffixOfDatabaseName: "user-selection", unique: "edit" });
            fs.writeFileSync(settingsPath, edited);

            const commit =
                phase === "restart"
                    ? () =>
                          new ReconstructionState(directory, path.join(directory, "vault"), settingsPath).prepare(
                              "sync",
                              false
                          )
                    : () => state.commit();

            expect(commit).toThrow("settings file changed");
            expect(fs.readFileSync(settingsPath, "utf-8")).toBe(edited);
            expect(JSON.parse(fs.readFileSync(state.markerPath, "utf-8"))).toMatchObject({ phase: "completed" });
        }
    );

    it("clears a completed marker after an interruption following the settings rename", () => {
        state.prepare("fetch", true);
        const completed = JSON.stringify({ additionalSuffixOfDatabaseName: "headless-app" });
        state.complete(completed);
        fs.writeFileSync(settingsPath, completed);
        state.prepare("ls", false);
        expect(readOptionalFile(state.markerPath)).toBeUndefined();
    });

    it.each(["null", "[]", "{}", '{"version":2}', '{"version":1,"phase":"completed"}'])(
        "refuses malformed state %s without clearing it",
        (contents) => {
            fs.mkdirSync(path.dirname(state.markerPath), { recursive: true });
            fs.writeFileSync(state.markerPath, contents);
            expect(() => state.prepare("sync", false)).toThrow("Invalid reconstruction state");
            expect(fs.readFileSync(state.markerPath, "utf-8")).toBe(contents);
        }
    );

    it.each(["null", "[]", '"text"', "{", ""])("reports invalid legacy KV %s without changing it", (contents) => {
        const legacy = path.join(directory, ".livesync/runtime/keyvalue-db.json");
        fs.mkdirSync(path.dirname(legacy), { recursive: true });
        fs.writeFileSync(legacy, contents);
        expect(inspectLegacyState(directory, directory)).toEqual([{ path: legacy, reason: "invalid" }]);
        expect(fs.readFileSync(legacy, "utf-8")).toBe(contents);
    });

    it("reports both unreadable KV and invalid snapshot instead of hiding the second problem", () => {
        const legacy = path.join(directory, ".livesync/runtime/keyvalue-db.json");
        const snapshot = path.join(directory, ".livesync-snapshot.json");
        fs.mkdirSync(legacy, { recursive: true });
        fs.writeFileSync(snapshot, "{}");
        expect(inspectLegacyState(directory, directory)).toEqual([
            { path: legacy, reason: "unreadable" },
            { path: snapshot, reason: "invalid" },
        ]);
        expect(fs.statSync(legacy).isDirectory()).toBe(true);
        expect(fs.readFileSync(snapshot, "utf-8")).toBe("{}");
    });

    it("preserves non-empty unowned legacy state and ignores empty legacy containers", () => {
        const legacy = path.join(directory, ".livesync", "runtime", "keyvalue-db.json");
        fs.mkdirSync(path.dirname(legacy), { recursive: true });
        fs.writeFileSync(legacy, "{}");
        fs.writeFileSync(path.join(directory, ".livesync-snapshot.json"), "[]");
        expect(inspectLegacyState(directory, directory)).toEqual([]);
        const queued = JSON.stringify({ "queued-files": ["unique-edit.md"] });
        fs.writeFileSync(legacy, queued);
        expect(inspectLegacyState(directory, directory)).toEqual([{ path: legacy, reason: "unowned" }]);
        expect(fs.readFileSync(legacy, "utf-8")).toBe(queued);
    });
});
