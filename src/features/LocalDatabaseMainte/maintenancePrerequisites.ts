import type { ObsidianLiveSyncSettings } from "@lib/common/types";

type MaintenancePrerequisiteSettings = Pick<
    ObsidianLiveSyncSettings,
    "doNotUseFixedRevisionForChunks" | "readChunksOnline"
>;

type MaintenancePrerequisiteOptions = {
    operationName: string;
    settings: MaintenancePrerequisiteSettings;
    askSelectStringDialogue: (
        message: string,
        buttons: readonly ["Apply and continue", "Cancel"],
        options: { title: string; defaultAction: "Cancel" }
    ) => Promise<"Apply and continue" | "Cancel" | false | undefined>;
    applyPartial: (settings: Partial<ObsidianLiveSyncSettings>, saveImmediately?: boolean) => Promise<void>;
};

export async function ensureLocalDatabaseMaintenancePrerequisites({
    operationName,
    settings,
    askSelectStringDialogue,
    applyPartial,
}: MaintenancePrerequisiteOptions): Promise<boolean> {
    const requiredSettings = {
        doNotUseFixedRevisionForChunks: true,
        readChunksOnline: false,
    } satisfies MaintenancePrerequisiteSettings;

    const missing = [
        ...(settings.doNotUseFixedRevisionForChunks ? [] : ["- Compute revisions for chunks: On (currently Off)"]),
        ...(settings.readChunksOnline ? ["- Fetch chunks on demand: Off (currently On)"] : []),
    ];

    if (missing.length == 0) return true;

    const APPLY = "Apply and continue";
    const CANCEL = "Cancel";
    const result = await askSelectStringDialogue(
        `${operationName} requires the following settings:\n\n${missing.join(
            "\n"
        )}\n\nApply these settings and continue?`,
        [APPLY, CANCEL],
        {
            title: `${operationName} prerequisites`,
            defaultAction: CANCEL,
        }
    );

    if (result !== APPLY) return false;

    await applyPartial(requiredSettings, true);
    return true;
}
