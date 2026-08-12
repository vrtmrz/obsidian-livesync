import type {
    MetadataDocumentRepairRequest,
    MetadataDocumentRepairResult,
} from "@vrtmrz/livesync-commonlib/compat/serviceFeatures/offlineScanner";
import { MetadataDocumentRepairResults } from "@vrtmrz/livesync-commonlib/compat/serviceFeatures/offlineScanner";

export const MetadataIdentityRepairExecutions = {
    CANCELLED: "cancelled",
    REPAIR_RESULT: "repair-result",
} as const;

export type MetadataIdentityRepairExecution =
    | { status: typeof MetadataIdentityRepairExecutions.CANCELLED }
    | {
          status: typeof MetadataIdentityRepairExecutions.REPAIR_RESULT;
          result: MetadataDocumentRepairResult;
          scanCompleted: boolean;
          scanError?: unknown;
      };

export interface MetadataIdentityRepairDependencies {
    confirm: () => Promise<boolean>;
    repair: (request: MetadataDocumentRepairRequest) => Promise<MetadataDocumentRepairResult>;
    requestOrdinaryScan: () => Promise<boolean>;
}

/**
 * Coordinate one explicitly confirmed Metadata identity repair.
 *
 * This consumer boundary deliberately keeps inspection approval, Commonlib
 * mutation, and the subsequent ordinary Vault scan as separate operations.
 * Cancellation cannot reach the mutation, and only a completed repair hands
 * reconciliation back to the Offline Scanner. Commonlib re-inspects the
 * source and expected ID under the current local path settings immediately
 * before mutation, so remote replication state is not part of this boundary.
 */
export async function executeMetadataIdentityRepair(
    request: MetadataDocumentRepairRequest,
    dependencies: MetadataIdentityRepairDependencies
): Promise<MetadataIdentityRepairExecution> {
    if (!(await dependencies.confirm())) {
        return { status: MetadataIdentityRepairExecutions.CANCELLED };
    }
    const result = await dependencies.repair(request);
    if (result.status !== MetadataDocumentRepairResults.COMPLETED) {
        return {
            status: MetadataIdentityRepairExecutions.REPAIR_RESULT,
            result,
            scanCompleted: false,
        };
    }

    try {
        const scanCompleted = await dependencies.requestOrdinaryScan();
        return {
            status: MetadataIdentityRepairExecutions.REPAIR_RESULT,
            result,
            scanCompleted,
        };
    } catch (scanError) {
        // The Metadata identity mutation has already completed. Preserve that
        // result separately so a follow-up scan failure cannot be mistaken for
        // a failed or rolled-back repair.
        return {
            status: MetadataIdentityRepairExecutions.REPAIR_RESULT,
            result,
            scanCompleted: false,
            scanError,
        };
    }
}
