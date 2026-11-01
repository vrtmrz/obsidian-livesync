import { describe, expect, it, vi } from "vitest";
import { storageAdapterContractCases } from "@/apps/_test/storageAdapterContract";
import { FSAPIFileSystemAdapter } from "./FSAPIFileSystemAdapter";
import { FileSystemAccessStorageAdapter } from "@vrtmrz/livesync-commonlib/browser";
import { FSAPIVaultAdapter } from "./FSAPIVaultAdapter";
import { LOG_LEVEL_NOTICE } from "@vrtmrz/livesync-commonlib/compat/common/types";

class MemoryFileHandle {
    readonly kind = "file";
    private data = new Uint8Array();

    constructor(
        readonly name: string,
        private readonly shouldFailWrite: () => boolean = () => false
    ) {}

    async getFile(): Promise<File> {
        return new File([this.data], this.name, { lastModified: 1 });
    }

    async createWritable(): Promise<FileSystemWritableFileStream> {
        const handle = this;
        return {
            async write(data: FileSystemWriteChunkType) {
                if (handle.shouldFailWrite()) throw new Error(`write failed: ${handle.name}`);
                if (typeof data === "string") {
                    handle.data = new TextEncoder().encode(data);
                } else if (data instanceof ArrayBuffer) {
                    handle.data = new Uint8Array(data.slice(0));
                } else if (ArrayBuffer.isView(data)) {
                    handle.data = new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
                } else {
                    throw new TypeError("Unsupported in-memory write type");
                }
            },
            async close() {},
        } as FileSystemWritableFileStream;
    }
}

class MemoryDirectoryHandle {
    readonly kind = "directory";
    private readonly children = new Map<string, MemoryDirectoryHandle | MemoryFileHandle>();
    private readonly failedWriteNames = new Set<string>();

    constructor(
        readonly name: string,
        private readonly caseInsensitive = false
    ) {}

    private resolveName(name: string): string {
        if (!this.caseInsensitive || this.children.has(name)) return name;
        return [...this.children.keys()].find((childName) => childName.toLowerCase() === name.toLowerCase()) ?? name;
    }

    async getDirectoryHandle(
        name: string,
        options?: FileSystemGetDirectoryOptions
    ): Promise<FileSystemDirectoryHandle> {
        const resolvedName = this.resolveName(name);
        const existing = this.children.get(resolvedName);
        if (existing instanceof MemoryDirectoryHandle) return existing as unknown as FileSystemDirectoryHandle;
        if (existing !== undefined || !options?.create) throw new DOMException("Directory not found", "NotFoundError");
        const directory = new MemoryDirectoryHandle(name, this.caseInsensitive);
        this.children.set(name, directory);
        return directory as unknown as FileSystemDirectoryHandle;
    }

    async getFileHandle(name: string, options?: FileSystemGetFileOptions): Promise<FileSystemFileHandle> {
        const resolvedName = this.resolveName(name);
        const existing = this.children.get(resolvedName);
        if (existing instanceof MemoryFileHandle) return existing as unknown as FileSystemFileHandle;
        if (existing !== undefined || !options?.create) throw new DOMException("File not found", "NotFoundError");
        const file = new MemoryFileHandle(name, () => this.failedWriteNames.has(name));
        this.children.set(name, file);
        return file as unknown as FileSystemFileHandle;
    }

    async removeEntry(name: string, options?: FileSystemRemoveOptions): Promise<void> {
        const resolvedName = this.resolveName(name);
        const existing = this.children.get(resolvedName);
        if (existing === undefined) throw new DOMException("Entry not found", "NotFoundError");
        if (existing instanceof MemoryDirectoryHandle && !options?.recursive && existing.children.size > 0) {
            throw new DOMException("Directory is not empty", "InvalidModificationError");
        }
        this.children.delete(resolvedName);
    }

    async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
        for (const [name, entry] of this.children) {
            yield [name, entry as unknown as FileSystemHandle];
        }
    }

    names(): string[] {
        return [...this.children.keys()];
    }

    failWritesTo(name: string): void {
        this.failedWriteNames.add(name);
    }
}

describe("FileSystemAccessStorageAdapter", () => {
    for (const contractCase of storageAdapterContractCases) {
        it(contractCase.name, async () => {
            const root = new MemoryDirectoryHandle("root") as unknown as FileSystemDirectoryHandle;
            await contractCase.run(new FileSystemAccessStorageAdapter(root));
        });
    }
});

describe("FSAPIVaultAdapter creation", () => {
    it.each(["text", "binary"] as const)(
        "creates nested %s files with exact content and stored metadata",
        async (kind) => {
            const root = new MemoryDirectoryHandle("root") as unknown as FileSystemDirectoryHandle;
            const adapter = new FSAPIVaultAdapter(root);
            const data = new Uint8Array([0, 255, 1, 128, 42]).buffer;
            const path = "/nested//folder/file.dat";
            const file =
                kind === "text" ? await adapter.create(path, "日本語😀") : await adapter.createBinary(path, data);
            const expected = kind === "text" ? new TextEncoder().encode("日本語😀") : new Uint8Array(data);
            const nested = await root.getDirectoryHandle("nested");
            const folder = await nested.getDirectoryHandle("folder");
            const stored = await folder.getFileHandle("file.dat");
            expect(file.path).toBe(path);
            expect(file.handle).toBe(stored);
            expect(new Uint8Array(await adapter.readBinary(file))).toEqual(expected);
            expect(file.stat).toEqual({ size: expected.byteLength, mtime: 1, ctime: 1, type: "file" });
        }
    );

    it.each(["text", "binary"] as const)("waits for the %s writer to close before reading metadata", async (kind) => {
        let releaseClose!: () => void;
        const closed = new Promise<void>((resolve) => {
            releaseClose = resolve;
        });
        const events: string[] = [];
        const getFile = vi.fn(async () => {
            events.push("metadata");
            return new File(["result"], "file.dat", { lastModified: 123 });
        });
        const close = vi.fn(async () => {
            events.push("close-start");
            await closed;
            events.push("closed");
        });
        const write = vi.fn(async () => {
            events.push("write");
        });
        const fileHandle = { createWritable: vi.fn(async () => ({ write, close })), getFile };
        const root = { getFileHandle: vi.fn(async () => fileHandle) } as unknown as FileSystemDirectoryHandle;
        const adapter = new FSAPIVaultAdapter(root);
        const data = new Uint8Array([0, 255]).buffer;
        const pending = kind === "text" ? adapter.create("file.dat", "text") : adapter.createBinary("file.dat", data);
        try {
            await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
            expect(getFile).not.toHaveBeenCalled();
        } finally {
            releaseClose();
        }
        const file = await pending;
        expect(events).toEqual(["write", "close-start", "closed", "metadata"]);
        expect(write).toHaveBeenCalledWith(kind === "text" ? "text" : data);
        expect(file.stat).toEqual({ size: 6, ctime: 123, mtime: 123, type: "file" });
    });

    it.each(["text", "binary"] as const)("propagates a %s write failure without returning metadata", async (kind) => {
        const failure = new Error("fixture write failed");
        const getFile = vi.fn();
        const fileHandle = {
            createWritable: vi.fn(async () => ({
                write: vi.fn(async () => {
                    throw failure;
                }),
                close: vi.fn(),
            })),
            getFile,
        };
        const root = { getFileHandle: vi.fn(async () => fileHandle) } as unknown as FileSystemDirectoryHandle;
        const adapter = new FSAPIVaultAdapter(root);
        const pending =
            kind === "text" ? adapter.create("file.dat", "text") : adapter.createBinary("file.dat", new ArrayBuffer(2));
        await expect(pending).rejects.toBe(failure);
        expect(getFile).not.toHaveBeenCalled();
    });
});

describe("FSAPIVaultAdapter.rename", () => {
    it("moves the file through a temporary copy while preserving content", async () => {
        const memoryRoot = new MemoryDirectoryHandle("root");
        const root = memoryRoot as unknown as FileSystemDirectoryHandle;
        const adapter = new FSAPIVaultAdapter(root);
        const file = await adapter.create("Calculus.md", "content");

        await adapter.rename(file, "calculus.md");

        expect(memoryRoot.names()).toEqual(["calculus.md"]);
        const renamedHandle = await root.getFileHandle("calculus.md");
        expect(await (await renamedHandle.getFile()).text()).toBe("content");
        expect(file.path).toBe("calculus.md");
    });

    it("removes a partially created target before restoring the source", async () => {
        const memoryRoot = new MemoryDirectoryHandle("root");
        const root = memoryRoot as unknown as FileSystemDirectoryHandle;
        const adapter = new FSAPIVaultAdapter(root);
        const file = await adapter.create("Calculus.md", "content");
        memoryRoot.failWritesTo("calculus.md");

        await expect(adapter.rename(file, "calculus.md")).rejects.toThrow("write failed");

        expect(memoryRoot.names()).toEqual(["Calculus.md"]);
        const restoredHandle = await root.getFileHandle("Calculus.md");
        expect(await (await restoredHandle.getFile()).text()).toBe("content");
        expect(file.path).toBe("Calculus.md");
    });
});

describe("FSAPIFileSystemAdapter path case", () => {
    it("returns an exact path without scanning the directory", async () => {
        const root = new MemoryDirectoryHandle("root") as unknown as FileSystemDirectoryHandle;
        const vault = new FSAPIVaultAdapter(root);
        await vault.create("Calculus.md", "content");
        const adapter = new FSAPIFileSystemAdapter(root, vi.fn());
        const scanDirectory = vi.spyOn(adapter, "scanDirectory");

        await expect(adapter.getAbstractFileByPathInsensitive("Calculus.md")).resolves.toMatchObject({
            path: "Calculus.md",
        });

        expect(scanDirectory).not.toHaveBeenCalled();
    });

    it("returns the stored path case from a case-insensitive file system", async () => {
        const memoryRoot = new MemoryDirectoryHandle("root", true);
        const root = memoryRoot as unknown as FileSystemDirectoryHandle;
        const vault = new FSAPIVaultAdapter(root);
        await vault.create("Calculus.md", "content");
        const adapter = new FSAPIFileSystemAdapter(root, vi.fn());

        await expect(adapter.getAbstractFileByPath("calculus.md")).resolves.toBeNull();
        await expect(adapter.getAbstractFileByPathInsensitive("calculus.md")).resolves.toEqual(
            expect.objectContaining({ path: "Calculus.md" })
        );
    });

    it("returns a cached case-insensitive match without rescanning", async () => {
        const root = new MemoryDirectoryHandle("root") as unknown as FileSystemDirectoryHandle;
        const vault = new FSAPIVaultAdapter(root);
        await vault.create("Calculus.md", "content");
        const adapter = new FSAPIFileSystemAdapter(root, vi.fn());
        await adapter.scanDirectory();
        const scanDirectory = vi.spyOn(adapter, "scanDirectory");

        await expect(adapter.getAbstractFileByPathInsensitive("calculus.md")).resolves.toMatchObject({
            path: "Calculus.md",
        });

        expect(scanDirectory).not.toHaveBeenCalled();
    });

    it("rescans once and returns a newly cached case-insensitive match", async () => {
        const root = new MemoryDirectoryHandle("root") as unknown as FileSystemDirectoryHandle;
        const vault = new FSAPIVaultAdapter(root);
        await vault.create("Calculus.md", "content");
        const adapter = new FSAPIFileSystemAdapter(root, vi.fn());
        const scanDirectory = vi.spyOn(adapter, "scanDirectory");

        await expect(adapter.getAbstractFileByPathInsensitive("calculus.md")).resolves.toMatchObject({
            path: "Calculus.md",
        });

        expect(scanDirectory).toHaveBeenCalledOnce();
        await expect(adapter.getAbstractFileByPath("Calculus.md")).resolves.toMatchObject({ path: "Calculus.md" });
    });

    it("returns null after one scan when no cached path matches", async () => {
        const root = new MemoryDirectoryHandle("root") as unknown as FileSystemDirectoryHandle;
        const vault = new FSAPIVaultAdapter(root);
        await vault.create("other.md", "content");
        const adapter = new FSAPIFileSystemAdapter(root, vi.fn());
        const scanDirectory = vi.spyOn(adapter, "scanDirectory");

        await expect(adapter.getAbstractFileByPathInsensitive("missing.md")).resolves.toBeNull();

        expect(scanDirectory).toHaveBeenCalledOnce();
    });

    it("reports scan failures through the injected Webapp log", async () => {
        const root = {
            name: "root",
            async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
                throw new Error("scan failed");
            },
        } as unknown as FileSystemDirectoryHandle;
        const addLog = vi.fn();
        const adapter = new FSAPIFileSystemAdapter(root, addLog);

        await adapter.scanDirectory();

        expect(addLog).toHaveBeenCalledWith(
            "Error scanning directory '.': Error: scan failed",
            LOG_LEVEL_NOTICE,
            "fsapi-scan"
        );
    });

    it("returns null and reports scan failure during case-insensitive lookup", async () => {
        const root = {
            name: "root",
            async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
                throw new Error("scan failed");
            },
        } as unknown as FileSystemDirectoryHandle;
        const addLog = vi.fn();
        const adapter = new FSAPIFileSystemAdapter(root, addLog);
        const scanDirectory = vi.spyOn(adapter, "scanDirectory");

        await expect(adapter.getAbstractFileByPathInsensitive("missing.md")).resolves.toBeNull();

        expect(scanDirectory).toHaveBeenCalledOnce();
        expect(addLog).toHaveBeenCalledWith(
            "Error scanning directory '.': Error: scan failed",
            LOG_LEVEL_NOTICE,
            "fsapi-scan"
        );
    });
});
