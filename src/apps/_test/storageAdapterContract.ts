import type { IStorageAdapter } from "@vrtmrz/livesync-commonlib/compat/serviceModules/adapters";

/** One platform-neutral storage adapter contract case. */
export interface StorageAdapterContractCase {
    readonly name: string;
    run(adapter: IStorageAdapter): Promise<void>;
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`${message}\nactual=${JSON.stringify(actual)}\nexpected=${JSON.stringify(expected)}`);
    }
}

async function assertRejects(operation: () => Promise<unknown>, message: string): Promise<void> {
    try {
        await operation();
    } catch {
        return;
    }
    throw new Error(message);
}

/** Passing baseline shared by Node, FSAPI, and future storage adapters. */
export const storageAdapterContractCases: readonly StorageAdapterContractCase[] = [
    {
        name: "reports missing paths consistently",
        async run(adapter) {
            assertEqual(await adapter.exists("missing.txt"), false, "missing path should not exist");
            assertEqual(await adapter.stat("missing.txt"), null, "missing stat should be null");
            assertEqual(await adapter.trystat("missing.txt"), null, "missing trystat should be null");
        },
    },
    {
        name: "creates parent directories for nested text writes",
        async run(adapter) {
            await adapter.write("notes/nested/note.md", "hello");
            assertEqual(await adapter.read("notes/nested/note.md"), "hello", "text should round-trip");
            assert(await adapter.exists("notes/nested/note.md"), "written text path should exist");
            assertEqual((await adapter.stat("notes/nested/note.md"))?.type, "file", "written path should be a file");
        },
    },
    {
        name: "round-trips exact binary bytes",
        async run(adapter) {
            const expected = Uint8Array.from([0x00, 0x7f, 0x80, 0xff, 0x42]);
            await adapter.writeBinary("binary/blob.bin", expected.buffer.slice(0));
            const result = await adapter.readBinary("binary/blob.bin");
            assertEqual([...new Uint8Array(result)], [...expected], "binary data should round-trip exactly");
            assertEqual(result.byteLength, expected.byteLength, "binary result should have the exact visible length");
        },
    },
    {
        name: "creates and extends text through append",
        async run(adapter) {
            await adapter.append("logs/events.log", "first");
            await adapter.append("logs/events.log", ":second");
            assertEqual(await adapter.read("logs/events.log"), "first:second", "append should create then extend text");
        },
    },
    {
        name: "lists direct files and folders",
        async run(adapter) {
            await adapter.mkdir("listing/folder");
            await adapter.write("listing/file.txt", "content");
            const listed = await adapter.list("listing");
            assertEqual([...listed.files].sort(), ["listing/file.txt"], "list should contain the direct file");
            assertEqual([...listed.folders].sort(), ["listing/folder"], "list should contain the direct folder");
        },
    },
    {
        name: "removes files and directory trees",
        async run(adapter) {
            await adapter.write("remove/file.txt", "content");
            await adapter.write("remove/folder/nested.txt", "content");
            await adapter.remove("remove/file.txt");
            assertEqual(await adapter.exists("remove/file.txt"), false, "file should be removed");
            await adapter.remove("remove/folder");
            assertEqual(await adapter.exists("remove/folder"), false, "directory tree should be removed");
        },
    },
    {
        name: "keeps operations inside the configured root",
        async run(adapter) {
            await assertRejects(() => adapter.exists("../outside"), "parent traversal should be rejected");
            await assertRejects(() => adapter.write("nested/../outside", "content"), "nested traversal should be rejected");
            await assertRejects(() => adapter.read("/absolute"), "absolute paths should be rejected");
            await assertRejects(() => adapter.read("C:\\absolute"), "drive-qualified paths should be rejected");
            await assertRejects(() => adapter.read("nested\\outside"), "backslash-separated paths should be rejected");
            await assertRejects(() => adapter.remove(""), "removing the configured root should be rejected");
        },
    },
    {
        name: "uses the empty path only for root-safe operations",
        async run(adapter) {
            await adapter.mkdir("");
            assertEqual(await adapter.exists(""), true, "the configured root should exist");
            assertEqual((await adapter.stat(""))?.type, "folder", "the configured root should be a folder");
            assertEqual(await adapter.list(""), { files: [], folders: [] }, "the configured root should be listable");
            await assertRejects(() => adapter.write("", "content"), "writing over the configured root should be rejected");
            await assertRejects(() => adapter.append("", "content"), "appending to the configured root should be rejected");
        },
    },
];
