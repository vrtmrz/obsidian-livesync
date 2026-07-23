import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { ensureLocalDatabaseMaintenancePrerequisites } from "./maintenancePrerequisites";

function createPrerequisites(settingsOverride: Partial<typeof DEFAULT_SETTINGS> = {}) {
    const askSelectStringDialogue = vi.fn(
        async (
            _message: string,
            _buttons: readonly ["Apply and continue", "Cancel"],
            _options: { title: string; defaultAction: "Cancel" }
        ): Promise<"Apply and continue" | "Cancel" | false | undefined> => "Apply and continue"
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
    it("asks to disable on-demand chunk fetching before maintenance actions", async () => {
        const { settings, askSelectStringDialogue, applyPartial } = createPrerequisites();

        const result = await ensureLocalDatabaseMaintenancePrerequisites({
            operationName: "Garbage Collection",
            settings: {
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
                readChunksOnline: false,
            },
            true
        );
        expect(vi.mocked(askSelectStringDialogue).mock.calls[0]?.[0]).not.toContain("Compute revisions for chunks");
    });

    it("cancels maintenance actions when prerequisite changes are rejected", async () => {
        const { settings, askSelectStringDialogue, applyPartial } = createPrerequisites();
        askSelectStringDialogue.mockResolvedValueOnce("Cancel");

        const result = await ensureLocalDatabaseMaintenancePrerequisites({
            operationName: "Garbage Collection",
            settings: {
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
                readChunksOnline: settings.readChunksOnline,
            },
            askSelectStringDialogue,
            applyPartial,
        });

        expect(askSelectStringDialogue).not.toHaveBeenCalled();
        expect(applyPartial).not.toHaveBeenCalled();
    });

    it("retirement guard: ignores the obsolete fixed-revision key as a maintenance prerequisite", async () => {
        const { settings, askSelectStringDialogue, applyPartial } = createPrerequisites({
            doNotUseFixedRevisionForChunks: false,
            readChunksOnline: false,
        });

        const result = await ensureLocalDatabaseMaintenancePrerequisites({
            operationName: "Garbage Collection",
            settings: {
                readChunksOnline: settings.readChunksOnline,
            },
            askSelectStringDialogue,
            applyPartial,
        });

        expect(result).toBe(true);
        expect(askSelectStringDialogue).not.toHaveBeenCalled();
        expect(applyPartial).not.toHaveBeenCalled();
    });
});
