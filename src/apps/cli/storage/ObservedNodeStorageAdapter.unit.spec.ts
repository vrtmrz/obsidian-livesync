import { fs, os, path, UnicodeResolvingNodeStorageAdapter } from "@vrtmrz/livesync-commonlib/node";
import { describe, expect, it, vi } from "vitest";
import { ObservedNodeStorageAdapter } from "./ObservedNodeStorageAdapter";

function makeRoot(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "livesync-observed-storage-"));
}

function removeRoot(root: string): void {
    fs.rmSync(root, { recursive: true, force: true });
}

describe("ObservedNodeStorageAdapter", () => {
    it("writes using the default Legacy comparison callbacks", async () => {
        const root = makeRoot();
        const events: string[] = [];
        const storage = new ObservedNodeStorageAdapter(root, undefined, undefined, (paths) => {
            events.push(`start:${paths.join(",")}`);
            return () => events.push("complete");
        });

        try {
            await storage.write("Legacy.md", "legacy contents");

            expect(fs.readFileSync(path.join(root, "Legacy.md"), "utf8")).toBe("legacy contents");
            expect(events).toEqual(["start:Legacy.md", "complete"]);
        } finally {
            removeRoot(root);
        }
    });

    it("writes an NFC name with version 1 and the default case comparison callback", async () => {
        const root = makeRoot();
        const nfcPath = "caf\u00e9.md";
        const events: string[] = [];
        const storage = new ObservedNodeStorageAdapter(
            root,
            () => 1,
            undefined,
            (paths) => {
                events.push(`start:${paths.join(",")}`);
                return () => events.push("complete");
            }
        );

        try {
            await storage.write(nfcPath, "nfc contents");

            expect(fs.readFileSync(path.join(root, nfcPath), "utf8")).toBe("nfc contents");
            expect(events).toEqual([`start:${nfcPath}`, "complete"]);
        } finally {
            removeRoot(root);
        }
    });

    it("preserves successful filesystem writes when observation setup throws", async () => {
        const root = makeRoot();
        const failure = new Error("observation setup failed");
        const onMutation = vi.fn(() => {
            throw failure;
        });
        const storage = new ObservedNodeStorageAdapter(root, undefined, undefined, onMutation);

        try {
            await expect(
                storage.write("observer-start.md", "written despite observer failure")
            ).resolves.toBeUndefined();

            expect(onMutation).toHaveBeenCalledWith(["observer-start.md"]);
            expect(fs.readFileSync(path.join(root, "observer-start.md"), "utf8")).toBe(
                "written despite observer failure"
            );
        } finally {
            removeRoot(root);
        }
    });

    it("preserves successful filesystem writes when invalidation completion throws", async () => {
        const root = makeRoot();
        const failure = new Error("invalidation completion failed");
        const complete = vi.fn(() => {
            throw failure;
        });
        const onMutation = vi.fn(() => complete);
        const storage = new ObservedNodeStorageAdapter(root, undefined, undefined, onMutation);

        try {
            await expect(
                storage.write("observer-complete.md", "written despite completion failure")
            ).resolves.toBeUndefined();

            expect(onMutation).toHaveBeenCalledWith(["observer-complete.md"]);
            expect(complete).toHaveBeenCalledOnce();
            expect(fs.readFileSync(path.join(root, "observer-complete.md"), "utf8")).toBe(
                "written despite completion failure"
            );
        } finally {
            removeRoot(root);
        }
    });

    it("runs invalidation completion and preserves the underlying I/O error", async () => {
        const root = makeRoot();
        const failure = new Error("underlying write failed");
        const complete = vi.fn();
        const onMutation = vi.fn(() => complete);
        const storage = new ObservedNodeStorageAdapter(root, undefined, undefined, onMutation);
        const write = vi.spyOn(UnicodeResolvingNodeStorageAdapter.prototype, "write").mockRejectedValue(failure);

        try {
            await expect(storage.write("failed-write.md", "contents")).rejects.toBe(failure);

            expect(onMutation).toHaveBeenCalledWith(["failed-write.md"]);
            expect(complete).toHaveBeenCalledOnce();
            expect(fs.existsSync(path.join(root, "failed-write.md"))).toBe(false);
        } finally {
            write.mockRestore();
            removeRoot(root);
        }
    });
});
