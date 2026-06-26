import { LOG_LEVEL_NOTICE, type LOG_LEVEL } from "@lib/common/types.ts";
import { MARK_DONE } from "@/modules/features/ModuleLog.ts";
import type { LogFunction } from "@lib/services/lib/logUtils.ts";
import type { DatabaseMaintenanceHost } from "./types.ts";

/**
 * Checks if garbage collection can be performed based on plug-in settings.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 * @returns True if garbage collection is available, false otherwise.
 */
export function isGCAvailable(host: DatabaseMaintenanceHost, log: LogFunction): boolean {
    const settings = host.services.setting.currentSettings();
    if (!settings.doNotUseFixedRevisionForChunks) {
        log("Please enable 'Compute revisions for chunks' in settings to use Garbage Collection.", LOG_LEVEL_NOTICE);
        return false;
    }
    if (settings.readChunksOnline) {
        log("Please disable 'Read chunks online' in settings to use Garbage Collection.", LOG_LEVEL_NOTICE);
        return false;
    }
    return true;
}

/**
 * Shows a confirmation dialogue to the user with customiseable options.
 *
 * @param host - The service container host.
 * @param title - The title of the dialogue.
 * @param message - The body message of the dialogue.
 * @param affirmative - The positive confirmation label.
 * @param negative - The negative cancellation label.
 * @returns A promise resolving to true if approved, false otherwise.
 */
export async function confirmDialogue(
    host: DatabaseMaintenanceHost,
    title: string,
    message: string,
    affirmative: string = "Yes",
    negative: string = "No"
): Promise<boolean> {
    return (
        (await host.services.UI.confirm.askSelectStringDialogue(message, [affirmative, negative], {
            title,
            defaultAction: affirmative,
        })) === affirmative
    );
}

/**
 * Retrieves all chunk information from the local database.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 * @param includeDeleted - Whether to include deleted chunks in the scan.
 * @returns A promise resolving to the retrieved chunk collections.
 */
export async function retrieveAllChunks(
    host: DatabaseMaintenanceHost,
    log: LogFunction,
    includeDeleted: boolean = false
) {
    const progress = createProgressBar(log, "Retrieving chunks informations..");
    try {
        const ret = await host.services.database.localDatabase.allChunks(includeDeleted);
        return ret;
    } finally {
        progress.done();
    }
}

let noticeIndex = 0;

/**
 * Creates a progress bar tracker that logs lifecycle states.
 *
 * @param log - The logger function.
 * @param prefix - A text prefix to prepend to all progress messages.
 * @param level - The log level for progress updates.
 * @returns An object to log, perform once-off updates, or finish the progress.
 */
export function createProgressBar(log: LogFunction, prefix: string = "", level: LOG_LEVEL = LOG_LEVEL_NOTICE) {
    const key = `keepalive-progress-${noticeIndex++}`;
    return {
        log: (msg: string) => {
            log(prefix + msg, level, key);
        },
        once: (msg: string) => {
            log(prefix + msg, level);
        },
        done: (msg: string = "Done") => {
            log(prefix + msg + MARK_DONE, level, key);
        },
    };
}
