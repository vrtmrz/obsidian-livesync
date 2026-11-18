import { afterEach, describe, expect, it, vi } from "vitest";
import { StorageEventManagerBase } from "@vrtmrz/livesync-commonlib/compat/managers/StorageEventManager";
import { StorageEventManagerObsidian } from "./StorageEventManagerObsidian";
vi.mock("@/deps", () => ({ TFile: class {}, TFolder: class {} }));

afterEach(() => vi.restoreAllMocks());
describe("Obsidian file-processing failure boundary", () => {
    it("requests an owned database check without awaiting recovery which may drain this file event", async () => {
        const cause = new Error("file processing failed");
        const selected = {};
        const onLocalDatabaseError = vi.fn(() => new Promise<boolean>(() => {}));
        vi.spyOn(StorageEventManagerBase.prototype as any, "handleFileEvent").mockRejectedValue(cause);
        const receiver = { core: { services: { database: { localDatabaseDirect: selected, onLocalDatabaseError } } } };
        const handle = (StorageEventManagerObsidian.prototype as any).handleFileEvent;
        await expect(handle.call(receiver, {})).rejects.toBe(cause);
        expect(onLocalDatabaseError).toHaveBeenCalledWith(selected, cause);
    });
});
