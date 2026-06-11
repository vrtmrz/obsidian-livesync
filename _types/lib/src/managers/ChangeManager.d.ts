import { FallbackWeakRef } from "octagonal-wheels/common/polyfill";
/**
 * Options for configuring the ChangeManager.
 */
export interface ChangeManagerOptions {
    /**
     * The PouchDB database instance to monitor for changes.
     */
    database: PouchDB.Database;
}
export type ChangeManagerCallback = (change: PouchDB.Core.ChangesResponseChange<object>) => void | Promise<void>;
/**
 * Manages and dispatches changes from a PouchDB database to registered callbacks.
 *
 * @template T The type of documents stored in the PouchDB database.
 */
export declare class ChangeManager<T extends object = object> {
    /**
     * The PouchDB database instance being monitored.
     */
    _database: PouchDB.Database<T>;
    /**
     * Creates a new instance of the ChangeManager.
     *
     * @param options - Configuration options for the ChangeManager.
     */
    constructor(options: ChangeManagerOptions);
    /**
     * A list of registered callbacks wrapped in WeakRefs to avoid memory leaks.
     */
    _callbacks: FallbackWeakRef<ChangeManagerCallback>[];
    /**
     * Registers a new callback to be invoked when a change occurs.
     *
     * @param callback - The callback function to register.
     */
    addCallback(callback: ChangeManagerCallback): () => void;
    removeCallback(callback: ChangeManagerCallback): void;
    /**
     * The PouchDB changes feed instance, if active.
     */
    _changes?: PouchDB.Core.Changes<T>;
    /**
     * Handles a change event from the PouchDB changes feed.
     *
     * @param changeResponse - The change response object from the PouchDB changes feed.
     */
    _onChange(changeResponse: PouchDB.Core.ChangesResponseChange<T>): Promise<void>;
    /**
     * Sets up the PouchDB changes feed listener to monitor for database changes.
     */
    setupListener(): void;
    /**
     * Tears down the PouchDB changes feed listener and cleans up resources.
     */
    teardown(): void;
    /**
     * Restarts the PouchDB changes feed listener.
     */
    restartWatch(): void;
}
