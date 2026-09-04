import { describe, expect, it, vi } from "vitest";
import { migrateBulkSendSetting, type BulkSettingMigrationDependencies } from "./bulkSettingMigration";

function createDependencies(settings: { sendChunksBulk: boolean; sendChunksBulkMaxSize: number }) {
    const dependencies: BulkSettingMigrationDependencies = {
        settings,
        log: vi.fn(),
        saveSettings: vi.fn(async () => undefined),
    };
    return dependencies;
}

describe("migrateBulkSendSetting", () => {
    it("disables and persists an enabled obsolete bulk-send setting", async () => {
        const dependencies = createDependencies({ sendChunksBulk: true, sendChunksBulkMaxSize: 16 });

        await migrateBulkSendSetting(dependencies);

        expect(dependencies.settings).toEqual({ sendChunksBulk: false, sendChunksBulkMaxSize: 1 });
        expect(dependencies.log).toHaveBeenCalledWith(expect.any(String), expect.anything());
        expect(dependencies.saveSettings).toHaveBeenCalledOnce();
    });

    it("does not persist an already disabled obsolete setting", async () => {
        const dependencies = createDependencies({ sendChunksBulk: false, sendChunksBulkMaxSize: 16 });

        await migrateBulkSendSetting(dependencies);

        expect(dependencies.settings).toEqual({ sendChunksBulk: false, sendChunksBulkMaxSize: 16 });
        expect(dependencies.log).not.toHaveBeenCalled();
        expect(dependencies.saveSettings).not.toHaveBeenCalled();
    });
});
