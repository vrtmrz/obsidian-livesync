import type { StandardIo } from "@vrtmrz/livesync-commonlib/context";
import {
    REMOTE_ADMINISTRATION_ACTIONS,
    REMOTE_ADMINISTRATION_FAILURE_REASONS,
    REMOTE_ADMINISTRATION_OBSERVATION_KINDS,
    isRemoteAdministrationVerified,
    type RemoteAdministrationAction,
    type RemoteAdministrationResult,
} from "@vrtmrz/livesync-commonlib/replication";
import { activateRemoteConfiguration } from "@vrtmrz/livesync-commonlib/remote-configurations";
import { writeStderrLine } from "@/apps/cli/cliOutput";
import type { CLICommand, CLICommandContext, CLIOptions } from "./types";

const REMOTE_ADMINISTRATION_ACTION_BY_COMMAND = Object.freeze({
    "mark-resolved": REMOTE_ADMINISTRATION_ACTIONS.MARK_RESOLVED,
    "lock-remote": REMOTE_ADMINISTRATION_ACTIONS.LOCK,
    "unlock-remote": REMOTE_ADMINISTRATION_ACTIONS.UNLOCK,
} as const satisfies Partial<Record<CLICommand, RemoteAdministrationAction>>);

export type RemoteAdministrationCommand = keyof typeof REMOTE_ADMINISTRATION_ACTION_BY_COMMAND;

/** Return whether a CLI command belongs to the remote-administration category. */
export function isRemoteAdministrationCommand(command: CLICommand): command is RemoteAdministrationCommand {
    return Object.prototype.hasOwnProperty.call(REMOTE_ADMINISTRATION_ACTION_BY_COMMAND, command);
}

function detailMessage(detail: unknown): string {
    return detail instanceof Error ? detail.message : String(detail);
}

function reportMilestoneObservation(
    standardIo: StandardIo,
    observation: Extract<
        RemoteAdministrationResult["observation"],
        { kind: typeof REMOTE_ADMINISTRATION_OBSERVATION_KINDS.MILESTONE }
    >
): void {
    standardIo.writeStderr(`[Verification] Remote Database: ${observation.locked ? "LOCKED" : "UNLOCKED"}\n`);
    standardIo.writeStderr(
        `[Verification] Current Device Node ID (${observation.nodeId}): ${observation.accepted ? "ACCEPTED" : "NOT ACCEPTED"}\n`
    );
}

/** Map typed provider observations to the CLI's established verification output. */
function reportRemoteAdministrationResult(standardIo: StandardIo, result: RemoteAdministrationResult): void {
    if (result.observation?.kind === REMOTE_ADMINISTRATION_OBSERVATION_KINDS.MILESTONE) {
        reportMilestoneObservation(standardIo, result.observation);
        return;
    }
    if (isRemoteAdministrationVerified(result)) {
        return;
    }

    switch (result.reason) {
        case REMOTE_ADMINISTRATION_FAILURE_REASONS.NO_ACTIVE_REPLICATOR:
            standardIo.writeStderr("[Verification] No active replicator found\n");
            return;
        case REMOTE_ADMINISTRATION_FAILURE_REASONS.CONNECTION_FAILED:
            standardIo.writeStderr(
                `[Verification] Failed to connect to remote CouchDB: ${detailMessage(result.detail)}\n`
            );
            return;
        case REMOTE_ADMINISTRATION_FAILURE_REASONS.MILESTONE_NOT_FOUND:
            standardIo.writeStderr("[Verification] Milestone document not found on remote.\n");
            return;
        case REMOTE_ADMINISTRATION_FAILURE_REASONS.MILESTONE_READ_FAILED:
            standardIo.writeStderr(
                `[Verification] Failed to fetch milestone document: ${detailMessage(result.detail)}\n`
            );
            return;
        case REMOTE_ADMINISTRATION_FAILURE_REASONS.LOCAL_IDENTITY_UNAVAILABLE:
            standardIo.writeStderr("[Verification] Failed to initialise the current device identity.\n");
            return;
        case REMOTE_ADMINISTRATION_FAILURE_REASONS.CAPABILITY_NOT_IMPLEMENTED:
        case REMOTE_ADMINISTRATION_FAILURE_REASONS.CAPABILITY_NOT_APPLICABLE:
            standardIo.writeStderr("[Verification] Remote administration is unavailable for this provider.\n");
            return;
        case REMOTE_ADMINISTRATION_FAILURE_REASONS.POSTCONDITION_MISMATCH:
            standardIo.writeStderr("[Verification] The requested remote state was not observed.\n");
            return;
    }
}

/**
 * Apply one provider-owned mutation and map its typed verification to CLI exit policy.
 * Mutation exceptions deliberately escape this boundary.
 */
export async function runRemoteAdministrationCommand(
    options: CLIOptions,
    context: CLICommandContext,
    command: RemoteAdministrationCommand
): Promise<boolean> {
    const id = options.commandArgs[0]?.trim();
    if (id) {
        let switched = false;
        await context.core.services.setting.updateSettings((currentSettings) => {
            const activated = activateRemoteConfiguration(currentSettings, id);
            if (activated) {
                switched = true;
                return activated;
            }
            return currentSettings;
        }, false);

        if (!switched) {
            context.core.services.context.standardIo.writeStderr(
                `[Info] Failed to temporarily activate remote configuration: ${id}\n`
            );
            return false;
        }

        await context.core.services.control.applySettings();
    }

    writeStderrLine(context.core.services.context.standardIo, `[Command] ${command}${id ? ` ${id}` : ""}`);
    const action = REMOTE_ADMINISTRATION_ACTION_BY_COMMAND[command];
    const result = await context.core.services.replicator.runRemoteAdministration({ action });
    reportRemoteAdministrationResult(context.core.services.context.standardIo, result);
    return isRemoteAdministrationVerified(result) || options.compatRemoteAdminExitZero === true;
}
