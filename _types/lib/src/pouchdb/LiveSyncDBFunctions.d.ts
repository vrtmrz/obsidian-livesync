import type { EntryDoc, EntryMilestoneInfo, DeviceInfo } from "@lib/common/models/db.definition";
import type { RemoteDBSettings } from "@lib/common/models/setting.type";
import type { ChunkVersionRange } from "@lib/common/models/db.type";
import type { TweakValues } from "@lib/common/models/tweak.definition";
export type ENSURE_DB_RESULT = "OK" | "INCOMPATIBLE" | "LOCKED" | "NODE_LOCKED" | "NODE_CLEANED" | ["MISMATCHED", TweakValues];
/**
 * Ensures that the remote database is compatible with the current device.
 *
 * @param infoSrc - The information about the remote database (which retrieved from the remote).
 * @param setting - The current settings.
 * @param deviceNodeID - The ID of the current device node.
 * @param currentVersionRange - The current version range of the database.
 * @param updateCallback - The callback function to update the remote milestone.
 * @returns A promise that resolves to the result of ensuring compatibility.
 */
export declare function ensureRemoteIsCompatible(infoSrc: EntryMilestoneInfo | false, setting: RemoteDBSettings, deviceNodeID: string, currentVersionRange: ChunkVersionRange, nodeDeviceInfo: DeviceInfo, updateCallback: (info: EntryMilestoneInfo) => Promise<void>): Promise<ENSURE_DB_RESULT>;
export declare function ensureDatabaseIsCompatible(db: PouchDB.Database<EntryDoc>, setting: RemoteDBSettings, deviceNodeID: string, currentVersionRange: ChunkVersionRange, nodeDeviceInfo: DeviceInfo): Promise<ENSURE_DB_RESULT>;
