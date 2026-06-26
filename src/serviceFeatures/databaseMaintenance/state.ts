/**
 * Represents the runtime state of the database maintenance feature.
 */
export type DatabaseMaintenanceState = Record<string, never>;

/**
 * Creates and initialises a new database maintenance state object.
 *
 * @returns A freshly initialised {@link DatabaseMaintenanceState} object.
 */
export function createDatabaseMaintenanceState(): DatabaseMaintenanceState {
    return {};
}
