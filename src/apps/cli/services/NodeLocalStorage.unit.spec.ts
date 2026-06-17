import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
    clearNodeLocalStorage,
    configureNodeLocalStorage,
    ensureGlobalNodeLocalStorage,
    getNodeLocalStorageItem,
    setNodeLocalStorageItem,
} from "./NodeLocalStorage";

describe("NodeLocalStorage", () => {
    const tempDirs: string[] = [];

    afterEach(() => {
        clearNodeLocalStorage();
        for (const tempDir of tempDirs.splice(0)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it("persists values to the configured file", () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "livesync-node-local-storage-"));
        tempDirs.push(tempDir);
        const storagePath = path.join(tempDir, "runtime", "local-storage.json");

        configureNodeLocalStorage(storagePath);
        setNodeLocalStorageItem("checkpoint", "42");

        const saved = JSON.parse(fs.readFileSync(storagePath, "utf-8")) as Record<string, string>;
        expect(saved.checkpoint).toBe("42");
    });

    it("reloads persisted values when configured again", () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "livesync-node-local-storage-"));
        tempDirs.push(tempDir);
        const storagePath = path.join(tempDir, "runtime", "local-storage.json");

        fs.mkdirSync(path.dirname(storagePath), { recursive: true });
        fs.writeFileSync(storagePath, JSON.stringify({ persisted: "value" }, null, 2), "utf-8");

        configureNodeLocalStorage(storagePath);

        expect(getNodeLocalStorageItem("persisted")).toBe("value");
    });

    it("installs a global localStorage shim backed by the same store", () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "livesync-node-local-storage-"));
        tempDirs.push(tempDir);
        const storagePath = path.join(tempDir, "runtime", "local-storage.json");

        configureNodeLocalStorage(storagePath);
        ensureGlobalNodeLocalStorage();

        globalThis.localStorage.setItem("shared", "state");

        expect(getNodeLocalStorageItem("shared")).toBe("state");
    });
});
