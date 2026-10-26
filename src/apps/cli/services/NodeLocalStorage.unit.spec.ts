import { fs, os, path } from "@vrtmrz/livesync-commonlib/node";
import { ValueStoreError } from "@vrtmrz/value-store";
import { afterEach, describe, expect, it } from "vitest";
import { createNodeLocalStorage } from "./NodeLocalStorage";

describe("NodeLocalStorage", () => {
    const tempDirs: string[] = [];

    afterEach(() => {
        for (const tempDir of tempDirs.splice(0)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it("loads and preserves legacy flat string data, including empty values and exact keys", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "livesync-node-local-storage-"));
        tempDirs.push(tempDir);
        const storagePath = path.join(tempDir, "runtime", "local-storage.json");
        const specialKey = "__proto__";
        const specialValue = "line one\n雪";

        fs.mkdirSync(path.dirname(storagePath), { recursive: true });
        fs.writeFileSync(storagePath, JSON.stringify({ [specialKey]: specialValue, empty: "" }), "utf-8");

        const store = createNodeLocalStorage(storagePath);

        await expect(store.getValue(specialKey)).resolves.toBe(specialValue);
        await expect(store.getValue("empty", "default")).resolves.toBe("");
        const saved = JSON.parse(fs.readFileSync(storagePath, "utf-8")) as Record<string, string>;
        expect(saved[specialKey]).toBe(specialValue);
        expect(saved.empty).toBe("");
    });

    it("persists strings and objects, reloads them, and deletes keys", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "livesync-node-local-storage-"));
        tempDirs.push(tempDir);
        const storagePath = path.join(tempDir, "runtime", "local-storage.json");
        const store = createNodeLocalStorage(storagePath);
        const object = { enabled: false, entries: ["value", null, 0] };

        await store.setValue("empty", "");
        await store.setValue("text", "stored value");
        await store.setObject("object", object);

        const reloaded = createNodeLocalStorage(storagePath);
        await expect(reloaded.getValue("empty", "default")).resolves.toBe("");
        await expect(reloaded.getValue("text")).resolves.toBe("stored value");
        await expect(reloaded.getObject("object")).resolves.toEqual(object);

        await reloaded.delete("text");
        await expect(reloaded.getValue("text")).resolves.toBeNull();
        const saved = JSON.parse(fs.readFileSync(storagePath, "utf-8")) as Record<string, string>;
        expect(saved.text).toBeUndefined();
        expect(saved.object).toBe(JSON.stringify(object));
    });

    it("treats a missing file as empty and creates its parent on the first write", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "livesync-node-local-storage-"));
        tempDirs.push(tempDir);
        const storagePath = path.join(tempDir, "runtime", "local-storage.json");
        const store = createNodeLocalStorage(storagePath);

        await expect(store.getValue("absent")).resolves.toBeNull();
        expect(fs.existsSync(storagePath)).toBe(false);
        await store.setValue("created", "value");
        expect(fs.existsSync(storagePath)).toBe(true);
    });

    it("keeps separate store instances isolated by their file paths", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "livesync-node-local-storage-"));
        tempDirs.push(tempDir);
        const first = createNodeLocalStorage(path.join(tempDir, "first", "local-storage.json"));
        const second = createNodeLocalStorage(path.join(tempDir, "second", "local-storage.json"));

        await first.setValue("shared-key", "first");
        await second.setValue("shared-key", "second");

        await expect(first.getValue("shared-key")).resolves.toBe("first");
        await expect(second.getValue("shared-key")).resolves.toBe("second");
    });

    it("surfaces malformed and unreadable files as sanitised value-store errors", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "livesync-node-local-storage-"));
        tempDirs.push(tempDir);
        const malformedPath = path.join(tempDir, "malformed.json");
        fs.writeFileSync(malformedPath, "{ malformed", "utf-8");

        let malformedError: unknown;
        try {
            createNodeLocalStorage(malformedPath);
        } catch (error) {
            malformedError = error;
        }
        expect(malformedError).toBeInstanceOf(ValueStoreError);
        expect(malformedError).toMatchObject({ code: "invalid-data" });
        expect(fs.readFileSync(malformedPath, "utf-8")).toBe("{ malformed");

        const unreadablePath = path.join(tempDir, "unreadable.json");
        fs.mkdirSync(unreadablePath);
        expect(() => createNodeLocalStorage(unreadablePath)).toThrowError(ValueStoreError);
    });

    it("does not change its visible values when a write fails", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "livesync-node-local-storage-"));
        tempDirs.push(tempDir);
        const storagePath = path.join(tempDir, "runtime", "local-storage.json");
        const store = createNodeLocalStorage(storagePath);
        await store.setValue("retained", "before failure");

        fs.rmSync(storagePath);
        fs.mkdirSync(storagePath);

        await expect(store.setValue("new", "write fails")).rejects.toBeInstanceOf(ValueStoreError);
        await expect(store.getValue("retained")).resolves.toBe("before failure");
        await expect(store.getValue("new")).resolves.toBeNull();
    });

    it("does not install or modify a global localStorage value", () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "livesync-node-local-storage-"));
        tempDirs.push(tempDir);
        const before = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

        createNodeLocalStorage(path.join(tempDir, "runtime", "local-storage.json"));

        expect(Object.getOwnPropertyDescriptor(globalThis, "localStorage")).toEqual(before);
    });
});
