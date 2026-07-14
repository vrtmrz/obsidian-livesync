import { describe, expect, it } from "vitest";
import { storageAdapterContractCases } from "@/apps/_test/storageAdapterContract";
import { FSAPIFileSystemAdapter } from "./FSAPIFileSystemAdapter";
import { FSAPIStorageAdapter } from "./FSAPIStorageAdapter";
import { FSAPIVaultAdapter } from "./FSAPIVaultAdapter";

class MemoryFileHandle {
    readonly kind = "file";
    private data = new Uint8Array();

    constructor(readonly name: string) {}

    async getFile(): Promise<File> {
        return new File([this.data], this.name, { lastModified: 1 });
    }

    async createWritable(): Promise<FileSystemWritableFileStream> {
        const handle = this;
        return {
            async write(data: FileSystemWriteChunkType) {
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
        const file = new MemoryFileHandle(name);
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
}

describe("FSAPIStorageAdapter", () => {
    for (const contractCase of storageAdapterContractCases) {
        it(contractCase.name, async () => {
            const root = new MemoryDirectoryHandle("root") as unknown as FileSystemDirectoryHandle;
            await contractCase.run(new FSAPIStorageAdapter(root));
        });
    }
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
});

describe("FSAPIFileSystemAdapter path case", () => {
    it("returns the stored path case from a case-insensitive file system", async () => {
        const memoryRoot = new MemoryDirectoryHandle("root", true);
        const root = memoryRoot as unknown as FileSystemDirectoryHandle;
        const vault = new FSAPIVaultAdapter(root);
        await vault.create("Calculus.md", "content");
        const adapter = new FSAPIFileSystemAdapter(root);

        await expect(adapter.getAbstractFileByPath("calculus.md")).resolves.toBeNull();
        await expect(adapter.getAbstractFileByPathInsensitive("calculus.md")).resolves.toEqual(
            expect.objectContaining({ path: "Calculus.md" })
        );
    });
});
