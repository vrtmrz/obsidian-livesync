import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@lib/common/types";
import { ensureLocalDatabaseMaintenancePrerequisites } from "./maintenancePrerequisites";

function createPrerequisites(settingsOverride: Partial<typeof DEFAULT_SETTINGS> = {}) {
    const askSelectStringDialogue = vi.fn<() => Promise<"Apply and continue" | "Cancel" | false | undefined>>(
        async () => "Apply and continue"
    );
    const applyPartial = vi.fn(async () => undefined);
    const settings = {
        ...DEFAULT_SETTINGS,
        doNotUseFixedRevisionForChunks: false,
        readChunksOnline: true,
        ...settingsOverride,
    };

    return { settings, askSelectStringDialogue, applyPartial };
}

describe("LocalDatabaseMaintenance prerequisites", () => {
    it("asks to apply missing prerequisite settings before maintenance actions", async () => {
        const { settings, askSelectStringDialogue, applyPartial } = createPrerequisites();

        const result = await ensureLocalDatabaseMaintenancePrerequisites({
            operationName: "Garbage Collection",
            settings: {
                doNotUseFixedRevisionForChunks: settings.doNotUseFixedRevisionForChunks,
                readChunksOnline: settings.readChunksOnline,
            },
            askSelectStringDialogue,
            applyPartial,
        });

        expect(result).toBe(true);
        expect(askSelectStringDialogue).toHaveBeenCalledWith(
            expect.stringContaining("Garbage Collection requires the following settings"),
            ["Apply and continue", "Cancel"],
            {
                title: "Garbage Collection prerequisites",
                defaultAction: "Cancel",
            }
        );
        expect(applyPartial).toHaveBeenCalledWith(
            {
                doNotUseFixedRevisionForChunks: true,
                readChunksOnline: false,
            },
            true
        );
    });

    it("cancels maintenance actions when prerequisite changes are rejected", async () => {
        const { settings, askSelectStringDialogue, applyPartial } = createPrerequisites();
        askSelectStringDialogue.mockResolvedValueOnce("Cancel");

        const result = await ensureLocalDatabaseMaintenancePrerequisites({
            operationName: "Garbage Collection",
            settings: {
                doNotUseFixedRevisionForChunks: settings.doNotUseFixedRevisionForChunks,
                readChunksOnline: settings.readChunksOnline,
            },
            askSelectStringDialogue,
            applyPartial,
        });

        expect(result).toBe(false);
        expect(applyPartial).not.toHaveBeenCalled();
    });

    it("continues without asking when prerequisite settings already match", async () => {
        const { settings, askSelectStringDialogue, applyPartial } = createPrerequisites({
            doNotUseFixedRevisionForChunks: true,
            readChunksOnline: false,
        });

        const result = await ensureLocalDatabaseMaintenancePrerequisites({
            operationName: "Garbage Collection",
            settings: {
                doNotUseFixedRevisionForChunks: settings.doNotUseFixedRevisionForChunks,
                readChunksOnline: settings.readChunksOnline,
            },
            askSelectStringDialogue,
            applyPartial,
        });

        expect(askSelectStringDialogue).not.toHaveBeenCalled();
        expect(applyPartial).not.toHaveBeenCalled();
    });
});
