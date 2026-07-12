import { describe, it } from "vitest";
import { storageAdapterContractCases } from "@/apps/storageAdapterContract";
import { FSAPIStorageAdapter } from "./FSAPIStorageAdapter";

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

    constructor(readonly name: string) {}

    async getDirectoryHandle(name: string, options?: FileSystemGetDirectoryOptions): Promise<FileSystemDirectoryHandle> {
        const existing = this.children.get(name);
        if (existing instanceof MemoryDirectoryHandle) return existing as unknown as FileSystemDirectoryHandle;
        if (existing !== undefined || !options?.create) throw new DOMException("Directory not found", "NotFoundError");
        const directory = new MemoryDirectoryHandle(name);
        this.children.set(name, directory);
        return directory as unknown as FileSystemDirectoryHandle;
    }

    async getFileHandle(name: string, options?: FileSystemGetFileOptions): Promise<FileSystemFileHandle> {
        const existing = this.children.get(name);
        if (existing instanceof MemoryFileHandle) return existing as unknown as FileSystemFileHandle;
        if (existing !== undefined || !options?.create) throw new DOMException("File not found", "NotFoundError");
        const file = new MemoryFileHandle(name);
        this.children.set(name, file);
        return file as unknown as FileSystemFileHandle;
    }

    async removeEntry(name: string, options?: FileSystemRemoveOptions): Promise<void> {
        const existing = this.children.get(name);
        if (existing === undefined) throw new DOMException("Entry not found", "NotFoundError");
        if (existing instanceof MemoryDirectoryHandle && !options?.recursive && existing.children.size > 0) {
            throw new DOMException("Directory is not empty", "InvalidModificationError");
        }
        this.children.delete(name);
    }

    async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
        for (const [name, entry] of this.children) {
            yield [name, entry as unknown as FileSystemHandle];
        }
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
