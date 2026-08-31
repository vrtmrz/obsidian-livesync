import type { StandardIo } from "@vrtmrz/livesync-commonlib/context";
import {
    CENTRAL_REMOTE_ADMINISTRATION_ACTIONS,
    CENTRAL_REMOTE_ADMINISTRATION_FAILURE_REASONS,
    CENTRAL_REMOTE_ADMINISTRATION_OBSERVATION_KINDS,
    isCentralRemoteAdministrationVerified,
    type CentralRemoteAdministrationAction,
    type CentralRemoteAdministrationResult,
} from "@vrtmrz/livesync-commonlib/replication";
import { activateRemoteConfiguration } from "@vrtmrz/livesync-commonlib/remote-configurations";
import { writeStderrLine } from "@/apps/cli/cliOutput";
import type { CLICommand, CLICommandContext, CLIOptions } from "./types";

const CENTRAL_REMOTE_ADMINISTRATION_ACTION_BY_COMMAND = Object.freeze({
    "mark-resolved": CENTRAL_REMOTE_ADMINISTRATION_ACTIONS.MARK_RESOLVED,
    "lock-remote": CENTRAL_REMOTE_ADMINISTRATION_ACTIONS.LOCK,
    "unlock-remote": CENTRAL_REMOTE_ADMINISTRATION_ACTIONS.UNLOCK,
} as const satisfies Partial<Record<CLICommand, CentralRemoteAdministrationAction>>);

export type CentralRemoteAdministrationCommand = keyof typeof CENTRAL_REMOTE_ADMINISTRATION_ACTION_BY_COMMAND;

/** Return whether a CLI command belongs to the central-remote administration category. */
export function isCentralRemoteAdministrationCommand(
    command: CLICommand
): command is CentralRemoteAdministrationCommand {
    return Object.prototype.hasOwnProperty.call(CENTRAL_REMOTE_ADMINISTRATION_ACTION_BY_COMMAND, command);
}

function detailMessage(detail: unknown): string {
    return detail instanceof Error ? detail.message : String(detail);
}

function assertNeverCentralRemoteAdministrationFailureReason(reason: never): never {
    throw new Error(`Unexpected central remote administration failure reason: ${String(reason)}`);
}

function reportMilestoneObservation(
    standardIo: StandardIo,
    observation: Extract<
        CentralRemoteAdministrationResult["observation"],
        { kind: typeof CENTRAL_REMOTE_ADMINISTRATION_OBSERVATION_KINDS.MILESTONE }
    >
): void {
    standardIo.writeStderr(`[Verification] Remote Database: ${observation.locked ? "LOCKED" : "UNLOCKED"}\n`);
    standardIo.writeStderr(
        `[Verification] Current Device Node ID (${observation.nodeId}): ${observation.accepted ? "ACCEPTED" : "NOT ACCEPTED"}\n`
    );
}

/** Map typed provider observations to the CLI's established verification output. */
function reportCentralRemoteAdministrationResult(
    standardIo: StandardIo,
    result: CentralRemoteAdministrationResult
): void {
    if (result.observation?.kind === CENTRAL_REMOTE_ADMINISTRATION_OBSERVATION_KINDS.MILESTONE) {
        reportMilestoneObservation(standardIo, result.observation);
        return;
    }
    if (isCentralRemoteAdministrationVerified(result)) {
        return;
    }

    const reason = result.reason;
    switch (reason) {
        case CENTRAL_REMOTE_ADMINISTRATION_FAILURE_REASONS.NO_ACTIVE_REPLICATOR:
            standardIo.writeStderr("[Verification] No active replicator found\n");
            return;
        case CENTRAL_REMOTE_ADMINISTRATION_FAILURE_REASONS.CONNECTION_FAILED:
            standardIo.writeStderr(
                `[Verification] Failed to connect to the configured remote: ${detailMessage(result.detail)}\n`
            );
            return;
        case CENTRAL_REMOTE_ADMINISTRATION_FAILURE_REASONS.ACTIVE_CONFIGURATION_MISMATCH:
            standardIo.writeStderr(
                "[Verification] The active remote configuration changed before remote administration could begin.\n"
            );
            return;
        case CENTRAL_REMOTE_ADMINISTRATION_FAILURE_REASONS.MILESTONE_NOT_FOUND:
            standardIo.writeStderr("[Verification] Milestone document not found on remote.\n");
            return;
        case CENTRAL_REMOTE_ADMINISTRATION_FAILURE_REASONS.MILESTONE_READ_FAILED:
            standardIo.writeStderr(
                `[Verification] Failed to fetch milestone document: ${detailMessage(result.detail)}\n`
            );
            return;
        case CENTRAL_REMOTE_ADMINISTRATION_FAILURE_REASONS.LOCAL_IDENTITY_UNAVAILABLE:
            standardIo.writeStderr("[Verification] Failed to initialise the current device identity.\n");
            return;
        case CENTRAL_REMOTE_ADMINISTRATION_FAILURE_REASONS.CAPABILITY_NOT_IMPLEMENTED:
        case CENTRAL_REMOTE_ADMINISTRATION_FAILURE_REASONS.CAPABILITY_NOT_APPLICABLE:
            standardIo.writeStderr("[Verification] Remote administration is unavailable for this provider.\n");
            return;
        case CENTRAL_REMOTE_ADMINISTRATION_FAILURE_REASONS.POSTCONDITION_MISMATCH:
            standardIo.writeStderr("[Verification] The requested remote state was not observed.\n");
            return;
        default:
            return assertNeverCentralRemoteAdministrationFailureReason(reason);
    }
}

/**
 * Apply one provider-owned mutation and map its typed verification to CLI exit policy.
 * Mutation exceptions deliberately escape this boundary.
 */
export async function runCentralRemoteAdministrationCommand(
    options: CLIOptions,
    context: CLICommandContext,
    command: CentralRemoteAdministrationCommand
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
    const action = CENTRAL_REMOTE_ADMINISTRATION_ACTION_BY_COMMAND[command];
    const result = await context.core.services.replicator.runCentralRemoteAdministration({ action });
    reportCentralRemoteAdministrationResult(context.core.services.context.standardIo, result);
    return isCentralRemoteAdministrationVerified(result) || options.compatRemoteAdminExitZero === true;
}
