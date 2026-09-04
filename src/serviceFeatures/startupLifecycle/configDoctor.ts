import { performDoctorConsultation, RebuildOptions } from "@vrtmrz/livesync-commonlib/compat/common/configForDoc";
import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { Confirm } from "@vrtmrz/livesync-commonlib/compat/interfaces/Confirm";
import type { Rebuilder } from "@vrtmrz/livesync-commonlib/compat/interfaces/DatabaseRebuilder";
import type { MessageTranslator } from "@vrtmrz/livesync-commonlib/context";

/** Collaborators required to run one Config Doctor consultation. */
export interface ConfigDoctorDependencies {
    readonly confirm: Confirm;
    readonly translate: MessageTranslator;
    readonly settings: ObsidianLiveSyncSettings;
    readonly setSettings: (settings: ObsidianLiveSyncSettings) => void;
    readonly saveSettings: () => Promise<void>;
    readonly rebuilder: Pick<Rebuilder, "scheduleRebuild" | "scheduleFetch">;
    readonly performRestart: () => void;
}

/**
 * Run Config Doctor and, when requested by its result, reserve the next-start
 * rebuild or fetch operation before restarting the application.
 *
 * The positional arguments retain the established defaults and operation
 * semantics for both start-up and request-event callers.
 */
export async function runConfigDoctor(
    dependencies: ConfigDoctorDependencies,
    skipRebuild: boolean = false,
    activateReason = "updated",
    forceRescan = false
): Promise<boolean> {
    const { shouldRebuild, shouldRebuildLocal, isModified, settings } = await performDoctorConsultation(
        {
            confirm: dependencies.confirm,
            translate: dependencies.translate,
        },
        dependencies.settings,
        {
            localRebuild: skipRebuild ? RebuildOptions.SkipEvenIfRequired : RebuildOptions.AutomaticAcceptable,
            remoteRebuild: skipRebuild ? RebuildOptions.SkipEvenIfRequired : RebuildOptions.AutomaticAcceptable,
            activateReason,
            forceRescan,
        }
    );
    if (isModified) {
        dependencies.setSettings(settings);
        await dependencies.saveSettings();
    }
    if (!skipRebuild) {
        if (shouldRebuild) {
            await dependencies.rebuilder.scheduleRebuild();
            dependencies.performRestart();
            return false;
        } else if (shouldRebuildLocal) {
            await dependencies.rebuilder.scheduleFetch();
            dependencies.performRestart();
            return false;
        }
    }
    return true;
}
