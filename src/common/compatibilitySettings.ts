type LegacyLocalDatabaseSelection = {
    useIndexedDBAdapter: boolean;
};

type LegacyBulkChunkPreSendSettings = {
    sendChunksBulk: boolean;
    sendChunksBulkMaxSize: number;
};

/**
 * Returns whether persisted settings select the legacy PouchDB IndexedDB adapter.
 *
 * New local databases use IDB. Existing devices must retain this operative value until their local database has
 * been explicitly migrated, so compatibility code must not treat the setting as inert.
 */
export function usesLegacyIndexedDBAdapter(settings: LegacyLocalDatabaseSelection): boolean {
    return settings.useIndexedDBAdapter;
}

/**
 * Disables the removed automatic bulk chunk pre-send option in persisted settings.
 *
 * The field remains readable only so older settings and Setup URIs can be migrated to the supported behaviour.
 *
 * @returns `true` when the legacy setting was enabled and has been changed.
 */
export function disableLegacyBulkChunkPreSend(settings: LegacyBulkChunkPreSendSettings): boolean {
    if (!settings.sendChunksBulk) return false;
    settings.sendChunksBulk = false;
    settings.sendChunksBulkMaxSize = 1;
    return true;
}
