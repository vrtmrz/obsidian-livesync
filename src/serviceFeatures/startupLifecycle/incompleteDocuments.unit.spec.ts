import { describe, expect, it, vi } from "vitest";
import type { LoadedEntry, MetaEntry, UXFileInfoStub } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { checkIncompleteDocuments, type IncompleteDocumentsDependencies } from "./incompleteDocuments";

vi.mock("@/common/utils", () => ({
    isValidPath: () => true,
}));

type DocumentFixture = {
    meta: MetaEntry;
    loaded: LoadedEntry;
    storage: ArrayBuffer;
    stub: UXFileInfoStub;
};

type FindAllNormalDocs = () => AsyncGenerator<MetaEntry>;

async function* noDocuments(): AsyncGenerator<MetaEntry> {
    return;
}

async function* failedDocumentScan(): AsyncGenerator<MetaEntry> {
    throw new Error("scan failed");
}

function documentFixture(
    path: string,
    options: { recordedSize?: number; storageContent?: string; conflicts?: string[] } = {}
): DocumentFixture {
    const storageContent = options.storageContent ?? "hello";
    const meta = {
        _id: `f:${path}`,
        _rev: "1-test",
        path,
        ctime: 1,
        mtime: 2,
        size: options.recordedSize ?? storageContent.length,
        children: ["h:test"],
        type: "plain",
        eden: {},
        ...(options.conflicts ? { _conflicts: options.conflicts } : {}),
    } as MetaEntry;
    const loaded = {
        ...meta,
        data: "abc",
        datatype: "plain",
    } as LoadedEntry;
    const stub = {
        name: path.split("/").pop() ?? path,
        path,
        stat: {
            ctime: 1,
            mtime: 2,
            size: storageContent.length,
            type: "file",
        },
    } as UXFileInfoStub;
    return {
        meta,
        loaded,
        storage: new TextEncoder().encode(storageContent).buffer as ArrayBuffer,
        stub,
    };
}

function documentsFrom(fixtures: DocumentFixture[]): FindAllNormalDocs {
    return async function* () {
        yield* fixtures.map((fixture) => fixture.meta);
    };
}

function selectButton(index: number) {
    return async (...args: unknown[]): Promise<string | false> => {
        const buttons = args[1] as readonly string[];
        return buttons[index] ?? false;
    };
}

function createDependencies(findAllNormalDocs: FindAllNormalDocs = noDocuments, fixtures: DocumentFixture[] = []) {
    const fixtureByPath = new Map<string, DocumentFixture>(
        fixtures.map((fixture) => [fixture.meta.path as string, fixture])
    );
    const noticeGroups = {
        setItem: vi.fn(),
        finish: vi.fn(),
    };
    const getFixture = (path: string) => fixtureByPath.get(path);
    const getDBEntryFromMeta = vi.fn(async (meta: { path: string }) => getFixture(meta.path)?.loaded);
    const readHiddenFileBinary = vi.fn(async (path: string) => getFixture(path)?.storage ?? new ArrayBuffer(0));
    const getFileStub = vi.fn(async (path: string) => getFixture(path)?.stub ?? null);
    const storeFileToDB = vi.fn(async () => true);
    const askSelectStringDialogue = vi.fn();
    const dependencies = {
        localDatabase: {
            findAllNormalDocs,
            getDBEntryFromMeta,
        },
        getPath: vi.fn((entry: { path: string }) => entry.path),
        isTargetFile: vi.fn(async () => true),
        storageAccess: {
            readHiddenFileBinary,
            getFileStub,
        },
        fileHandler: { storeFileToDB },
        keyValueDB: {
            get: vi.fn(async () => false),
            set: vi.fn(async () => undefined),
        },
        noticeGroups,
        confirm: { askSelectStringDialogue },
        log: vi.fn(),
    } as unknown as IncompleteDocumentsDependencies;
    return {
        askSelectStringDialogue,
        dependencies,
        getFileStub,
        noticeGroups,
        readHiddenFileBinary,
        storeFileToDB,
    };
}

describe("checkIncompleteDocuments", () => {
    it("keeps the check and result in one persistent named group", async () => {
        const { dependencies, noticeGroups } = createDependencies();

        await expect(checkIncompleteDocuments(dependencies)).resolves.toBe(true);

        expect(noticeGroups.setItem).toHaveBeenNthCalledWith(1, "startup-integrity-check", "checking", {
            message: "Checking for incomplete documents...",
        });
        expect(noticeGroups.setItem).toHaveBeenNthCalledWith(2, "startup-integrity-check", "result", {
            message: "No size mismatches found",
        });
        expect(noticeGroups.finish).toHaveBeenCalledWith("startup-integrity-check");
        expect(dependencies.keyValueDB.set).toHaveBeenCalledWith("checkIncompleteDocs", true);
    });

    it("skips the non-forced check after a successful prior scan", async () => {
        const { dependencies, noticeGroups } = createDependencies();
        vi.mocked(dependencies.keyValueDB.get).mockResolvedValue(true);

        await expect(checkIncompleteDocuments(dependencies)).resolves.toBe(true);

        expect(noticeGroups.setItem).not.toHaveBeenCalled();
        expect(noticeGroups.finish).not.toHaveBeenCalled();
    });

    it("finishes the group with a failure result when the scan throws", async () => {
        const { dependencies, noticeGroups } = createDependencies(failedDocumentScan);

        await expect(checkIncompleteDocuments(dependencies)).rejects.toThrow("scan failed");

        expect(noticeGroups.setItem).toHaveBeenLastCalledWith("startup-integrity-check", "result", {
            message: "The incomplete document check could not be completed.",
        });
        expect(noticeGroups.finish).toHaveBeenCalledWith("startup-integrity-check");
    });

    it("repairs a recoverable document when FIX is selected", async () => {
        const recoverable = documentFixture("recoverable.md");
        const fixture = createDependencies(documentsFrom([recoverable]), [recoverable]);
        fixture.askSelectStringDialogue.mockImplementation(selectButton(1));

        await expect(checkIncompleteDocuments(fixture.dependencies)).resolves.toBe(true);

        expect(fixture.askSelectStringDialogue.mock.calls[0]?.[1]).toHaveLength(3);
        expect(fixture.getFileStub).toHaveBeenCalledWith("recoverable.md");
        expect(fixture.storeFileToDB).toHaveBeenCalledWith(recoverable.stub, true, false);
        expect(fixture.dependencies.keyValueDB.set).not.toHaveBeenCalled();
    });

    it("leaves recoverable documents unchanged when CHECK_IT_LATER is selected", async () => {
        const recoverable = documentFixture("recoverable.md");
        const fixture = createDependencies(documentsFrom([recoverable]), [recoverable]);
        fixture.askSelectStringDialogue.mockImplementation(selectButton(0));

        await expect(checkIncompleteDocuments(fixture.dependencies)).resolves.toBe(true);

        expect(fixture.getFileStub).not.toHaveBeenCalled();
        expect(fixture.storeFileToDB).not.toHaveBeenCalled();
        expect(fixture.dependencies.keyValueDB.set).not.toHaveBeenCalled();
    });

    it("records a permanent dismissal of recoverable document warnings", async () => {
        const recoverable = documentFixture("recoverable.md");
        const fixture = createDependencies(documentsFrom([recoverable]), [recoverable]);
        fixture.askSelectStringDialogue.mockImplementation(selectButton(2));

        await expect(checkIncompleteDocuments(fixture.dependencies)).resolves.toBe(true);

        expect(fixture.getFileStub).not.toHaveBeenCalled();
        expect(fixture.storeFileToDB).not.toHaveBeenCalled();
        expect(fixture.dependencies.keyValueDB.set).toHaveBeenCalledWith("checkIncompleteDocs", true);
    });

    it("stores only recoverable, non-conflicted documents from a mixed scan", async () => {
        const recoverable = documentFixture("recoverable.md");
        const unrecoverable = documentFixture("unrecoverable.md", { recordedSize: 4 });
        const conflicted = documentFixture("conflicted.md", { conflicts: ["2-conflict"] });
        const fixture = createDependencies(documentsFrom([recoverable, unrecoverable, conflicted]), [
            recoverable,
            unrecoverable,
            conflicted,
        ]);
        fixture.askSelectStringDialogue.mockImplementation(selectButton(1));

        await expect(checkIncompleteDocuments(fixture.dependencies)).resolves.toBe(true);

        expect(fixture.getFileStub).toHaveBeenCalledTimes(1);
        expect(fixture.getFileStub).toHaveBeenCalledWith("recoverable.md");
        expect(fixture.storeFileToDB).toHaveBeenCalledTimes(1);
        expect(fixture.storeFileToDB).toHaveBeenCalledWith(recoverable.stub, true, false);
        expect(fixture.askSelectStringDialogue.mock.calls[0]?.[0]).toEqual(expect.stringContaining("unrecoverable.md"));
        expect(fixture.askSelectStringDialogue.mock.calls[0]?.[0]).toEqual(expect.stringContaining("conflicted.md"));
    });
});
