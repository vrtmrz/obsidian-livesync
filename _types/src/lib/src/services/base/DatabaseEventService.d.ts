// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { IDatabaseEventService } from "./IService";
import { ServiceBase, type ServiceContext } from "./ServiceBase";
/**
 * The DatabaseEventService provides methods for handling database lifecycle events.
 */
export declare abstract class DatabaseEventService<T extends ServiceContext = ServiceContext> extends ServiceBase<T> implements IDatabaseEventService {
    /**
     * Event triggered when the database is about to be unloaded.
     */
    readonly onUnloadDatabase: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<(db: import("../../pouchdb/LiveSyncLocalDB").LiveSyncLocalDB) => Promise<boolean>>;
    /**
     * Event triggered when the database is about to be closed.
     */
    readonly onCloseDatabase: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<(db: import("../../pouchdb/LiveSyncLocalDB").LiveSyncLocalDB) => Promise<boolean>>;
    /**
     * Event triggered when the database is being initialized.
     */
    readonly onDatabaseInitialisation: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<(db: import("../../pouchdb/LiveSyncLocalDB").LiveSyncLocalDB) => Promise<boolean>>;
    /**
     * Event triggered when the database has been initialized.
     */
    readonly onDatabaseInitialised: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<(showNotice: boolean) => Promise<boolean>>;
    /**
     * Event triggered when the database is being reset.
     */
    readonly onResetDatabase: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<(db: import("../../pouchdb/LiveSyncLocalDB").LiveSyncLocalDB) => Promise<boolean>>;
    /**
     * Event triggered when the database is ready for use.
     */
    readonly onDatabaseHasReady: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<() => Promise<boolean>>;
    /**
     * Initialize the database.
     * @param showingNotice Whether to show a notice to the user.
     * @param reopenDatabase Whether to reopen the database if it is already open.
     * @param ignoreSuspending Whether to ignore any suspending state.
     */
    readonly initialiseDatabase: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<(showingNotice?: boolean, reopenDatabase?: boolean, ignoreSuspending?: boolean) => Promise<boolean>>;
}
