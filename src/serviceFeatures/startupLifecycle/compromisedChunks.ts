import {
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    Logger,
    type LOG_LEVEL,
} from "@vrtmrz/livesync-commonlib/compat/common/logger";
import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { countCompromisedChunks } from "@vrtmrz/livesync-commonlib/compat/pouchdb/negotiation";
import type { Rebuilder } from "@vrtmrz/livesync-commonlib/compat/interfaces/DatabaseRebuilder";
import type { Confirm } from "@vrtmrz/livesync-commonlib/compat/interfaces/Confirm";
import { $msg } from "@/common/translation";

interface CompromisedChunkCounter {
    countCompromisedChunks(): Promise<number | boolean>;
}

/** Focused collaborators for checking and recovering insecure chunks. */
export interface CompromisedChunksDependencies {
    readonly settings: Pick<ObsidianLiveSyncSettings, "encrypt">;
    readonly localDatabase: {
        readonly localDatabase: Parameters<typeof countCompromisedChunks>[0];
    };
    readonly isOnline: boolean | (() => boolean);
    readonly getActiveReplicator: () => object | undefined;
    readonly confirm: Pick<Confirm, "askSelectStringDialogue">;
    readonly rebuilder: Pick<Rebuilder, "scheduleRebuild" | "scheduleFetch">;
    readonly performRestart: () => void;
    readonly log: (message: unknown, level?: LOG_LEVEL) => void;
}

function hasCompromisedChunkCounter(value: object | undefined): value is CompromisedChunkCounter {
    return (
        value !== undefined && "countCompromisedChunks" in value && typeof value.countCompromisedChunks === "function"
    );
}

function readOnline(value: boolean | (() => boolean)): boolean {
    return typeof value === "function" ? value() : value;
}

/**
 * Check local and active-remote databases for insecure chunks and apply the
 * former rebuild, fetch, or dismiss dialogue semantics.
 */
export async function checkCompromisedChunks(dependencies: CompromisedChunksDependencies): Promise<boolean> {
    Logger(`Checking for compromised chunks...`, LOG_LEVEL_VERBOSE);
    if (!dependencies.settings.encrypt) {
        // If not encrypted, we do not need to check for compromised chunks.
        return true;
    }
    // Check local database for compromised chunks
    const localCompromised = await countCompromisedChunks(dependencies.localDatabase.localDatabase);
    const remote = dependencies.getActiveReplicator();
    const remoteCompromised =
        readOnline(dependencies.isOnline) && hasCompromisedChunkCounter(remote)
            ? await remote.countCompromisedChunks()
            : 0;
    if (localCompromised === false) {
        Logger(`Failed to count compromised chunks in local database`, LOG_LEVEL_NOTICE);
        return false;
    }
    if (remoteCompromised === false) {
        Logger(`Failed to count compromised chunks in remote database`, LOG_LEVEL_NOTICE);
        return false;
    }
    if (remoteCompromised === 0 && localCompromised === 0) {
        return true;
    }
    Logger(`Found compromised chunks : ${localCompromised} in local, ${remoteCompromised} in remote`, LOG_LEVEL_NOTICE);
    const title = $msg("moduleMigration.insecureChunkExist.title");
    const msg = $msg("moduleMigration.insecureChunkExist.message");
    const REBUILD = $msg("moduleMigration.insecureChunkExist.buttons.rebuild");
    const FETCH = $msg("moduleMigration.insecureChunkExist.buttons.fetch");
    const DISMISS = $msg("moduleMigration.insecureChunkExist.buttons.later");
    const buttons = [REBUILD, FETCH, DISMISS];
    if (remoteCompromised != 0) {
        buttons.splice(buttons.indexOf(FETCH), 1);
    }
    const result = await dependencies.confirm.askSelectStringDialogue(msg, buttons, {
        title,
        defaultAction: DISMISS,
        timeout: 0,
    });
    if (result === REBUILD) {
        // Rebuild the database
        await dependencies.rebuilder.scheduleRebuild();
        dependencies.performRestart();
        return false;
    } else if (result === FETCH) {
        // Fetch the latest data from remote
        await dependencies.rebuilder.scheduleFetch();
        dependencies.performRestart();
        return false;
    } else {
        // User chose to dismiss the issue
        dependencies.log($msg("moduleMigration.insecureChunkExist.laterMessage"), LOG_LEVEL_NOTICE);
    }
    return true;
}
