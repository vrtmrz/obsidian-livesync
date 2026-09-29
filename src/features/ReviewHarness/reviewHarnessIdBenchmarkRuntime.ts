import { DEFAULT_SETTINGS, deriveIdKey } from "@vrtmrz/livesync-commonlib/settings";
import { path2id_base } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/path";
import type { FilePath } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { HashManager } from "@vrtmrz/livesync-commonlib/hashing";
import type { IdBenchmarkOperations } from "./reviewHarnessIdBenchmark";

const FIXTURE_PASSPHRASE = "Self-hosted LiveSync ID benchmark passphrase";
const FIXTURE_SOURCE = "Self-hosted LiveSync ID benchmark source";
const FIXTURE_KEY = "ab".repeat(32);

export async function createIdBenchmarkOperations(): Promise<IdBenchmarkOperations> {
    const managers: HashManager[] = [];
    for (const independent of [false, true]) {
        const settings = Object.freeze({
            ...DEFAULT_SETTINGS,
            encrypt: true,
            passphrase: FIXTURE_PASSPHRASE,
            hashAlg: "xxhash64" as const,
            idDerivationVersion: independent ? (1 as const) : (0 as const),
            idDerivationKey: independent ? FIXTURE_KEY : "",
        });
        // HashManager only reads currentSettings; this fixture has no storage or live service access.
        const settingService = { currentSettings: () => settings } as HashManager["options"]["settingService"];
        const manager = new HashManager({ settingService });
        if (!(await manager.initialise())) throw new Error("The benchmark hash manager could not initialise.");
        managers.push(manager);
    }
    return {
        deriveKey: () => deriveIdKey(FIXTURE_SOURCE),
        chunkId: (piece, independent) => managers[independent ? 1 : 0].computeHash(piece),
        // Fixture paths are already normalised; use the same ID calculation as PathService.
        documentId: (path, independent) =>
            path2id_base(path as FilePath, FIXTURE_PASSPHRASE, false, independent ? FIXTURE_KEY : undefined),
    };
}
