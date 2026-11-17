import type { DatabaseProbeCheck, DatabaseProbeEvent, DatabaseProbeFixture } from "./reviewHarnessDatabaseProbe";

export const DATABASE_PROBE_PREFIX = "self-hosted-livesync-review-idb-";
const DOCUMENT_ID = "review-probe";
const FIXTURE_VALUE = "Self-hosted LiveSync disposable IndexedDB connection probe";
const OPERATION_TIMEOUT_MS = 8000;

interface ProbeDocument {
    _id: string;
    _rev?: string;
    owner: string;
    value: string;
}

interface ProbeChanges {
    on(event: string, callback: (...args: unknown[]) => void): ProbeChanges;
    cancel(): void;
}

export interface ProbePouch {
    put(document: ProbeDocument): Promise<{ rev: string }>;
    get(id: string): Promise<ProbeDocument>;
    info(): Promise<unknown>;
    allDocs(): Promise<unknown>;
    close(): Promise<void>;
    changes(options: { since: "now"; live: true }): ProbeChanges;
    on(event: string, callback: () => void): unknown;
    removeListener(event: string, callback: () => void): unknown;
}

export interface ProbePouchConstructor {
    new (name: string, options: { adapter: "idb" | "indexeddb" }): ProbePouch;
    readonly prefix?: string;
}

const ERROR_NAMES = new Set([
    "InvalidStateError",
    "indexed_db_went_bad",
    "AbortError",
    "UnknownError",
    "VersionError",
    "NotFoundError",
    "TimeoutError",
    "SecurityError",
    "QuotaExceededError",
    "Error",
    "not_found",
    "DatabaseProbeCancelled",
]);

/** Copy names from a fixed vocabulary; exception messages may contain private paths. */
export function databaseProbeErrorName(error: unknown): string {
    if (typeof error !== "object" || error === null || !("name" in error)) {
        return "OtherError";
    }
    return typeof error.name === "string" && ERROR_NAMES.has(error.name) ? error.name : "OtherError";
}

/** Arm only this owned native handle and restore every borrowed method after its next read. */
function abortNextFixtureRead(
    database: IDBDatabase,
    onError: (error: unknown) => void
): { injected(): boolean; restore(): void } {
    const removers: (() => void)[] = [];
    let injected = false;
    const restore = () => {
        for (const remove of removers.splice(0).reverse()) {
            remove();
        }
    };
    const borrow = (object: object, key: string, replacement: unknown) => {
        const descriptor = Object.getOwnPropertyDescriptor(object, key);
        Object.defineProperty(object, key, { configurable: true, writable: true, value: replacement });
        removers.push(() => {
            if (Object.getOwnPropertyDescriptor(object, key)?.value !== replacement) {
                return;
            }
            if (descriptor) {
                Object.defineProperty(object, key, descriptor);
            } else {
                Reflect.deleteProperty(object, key);
            }
        });
    };
    const transaction = database.transaction.bind(database);
    try {
        borrow(database, "transaction", function (...args: Parameters<IDBDatabase["transaction"]>) {
            const selected = transaction(...args);
            const objectStore = selected.objectStore.bind(selected);
            borrow(selected, "objectStore", function (name: string) {
                const store = objectStore(name);
                const get = store.get.bind(store);
                borrow(store, "get", function (key: IDBValidKey | IDBKeyRange) {
                    const request = get(key);
                    if (key !== DOCUMENT_ID) {
                        return request;
                    }
                    restore();
                    queueMicrotask(() => {
                        try {
                            selected.abort();
                            injected = true;
                        } catch (error) {
                            onError(error);
                        }
                    });
                    return request;
                });
                return store;
            });
            return selected;
        });
    } catch (error) {
        restore();
        throw error;
    }
    return { injected: () => injected, restore };
}

function operationError(error: unknown): Error {
    const result = new Error("The diagnostic operation did not complete.");
    result.name = databaseProbeErrorName(error);
    return result;
}

function nativeEventDetail(event: Event): string {
    let errorName = "unavailable";
    try {
        if (event.target && "error" in event.target && event.target.error) {
            errorName = databaseProbeErrorName(event.target.error);
        }
    } catch {
        // Some native error getters are unavailable after the request has retired.
    }
    return `trusted=${String(event.isTrusted)}; errorName=${errorName}`;
}

function scheduleReadDeadline(expired: () => void): () => void {
    if (typeof window !== "undefined") {
        const timer = window.setTimeout(expired, OPERATION_TIMEOUT_MS);
        return () => window.clearTimeout(timer);
    }
    const timers = { setTimeout, clearTimeout };
    const timer = timers.setTimeout(expired, OPERATION_TIMEOUT_MS);
    return () => timers.clearTimeout(timer);
}

export async function awaitDatabaseProbeOperation<T>(operation: PromiseLike<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) {
        throw new DOMException("", "DatabaseProbeCancelled");
    }
    return await new Promise<T>((resolve, reject) => {
        const cleanup = () => {
            cancelDeadline();
            signal?.removeEventListener("abort", abort);
        };
        const abort = () => {
            cleanup();
            reject(new DOMException("", "DatabaseProbeCancelled"));
        };
        const cancelDeadline = scheduleReadDeadline(() => {
            cleanup();
            reject(new DOMException("", "TimeoutError"));
        });
        signal?.addEventListener("abort", abort, { once: true });
        void Promise.resolve(operation).then(
            (value) => {
                cleanup();
                resolve(value);
            },
            (error: unknown) => {
                cleanup();
                reject(operationError(error));
            }
        );
    });
}

export interface DatabaseProbeBrowserOptions {
    readonly factory: IDBFactory;
    readonly PouchDB: ProbePouchConstructor;
    readonly token: string;
    readonly emit: (event: DatabaseProbeEvent) => void;
    readonly signal: AbortSignal;
    readonly adapter?: "idb" | "indexeddb";
}

export interface DatabaseAbortedRead {
    readonly injected: boolean;
    readonly outcome: "fulfilled" | "rejected" | "pending";
    readonly drained: boolean;
    readonly errorName?: string;
}

export interface DatabaseAbortProbeFixture extends DatabaseProbeFixture {
    abortRead(signal: AbortSignal): Promise<DatabaseAbortedRead>;
    verifyContents(signal: AbortSignal): Promise<{ contentMatches: boolean; revisionMatches: boolean }>;
}

/** Capture only this newly created fixture's native connections; never a Vault database. */
export async function createDatabaseProbeFixture(
    options: DatabaseProbeBrowserOptions
): Promise<DatabaseAbortProbeFixture> {
    const fixture = new BrowserDatabaseProbeFixture(options);
    try {
        await fixture.prepare();
        return fixture;
    } catch (error) {
        options.emit({ source: "probe", name: "prepare-error", detail: databaseProbeErrorName(error) });
        try {
            await fixture.cleanup();
        } catch {
            options.emit({
                source: "probe",
                name: "cleanup-error",
                detail: "Disposable fixture cleanup did not complete.",
            });
        }
        throw error;
    }
}

class BrowserDatabaseProbeFixture implements DatabaseAbortProbeFixture {
    private readonly name: string;
    private readonly physicalName: string;
    private owned = false;
    private pouch: ProbePouch | undefined;
    private comparison: ProbePouch | undefined;
    private readonly instances = new Set<ProbePouch>();
    private readonly nativeConnections = new Set<IDBDatabase>();
    private readonly removers: (() => void)[] = [];
    private changes: ProbeChanges | undefined;
    private expectedRevision = "";
    private nativeClosed = false;
    private openCount = 0;
    private retired = false;

    constructor(private readonly options: DatabaseProbeBrowserOptions) {
        if (!/^[a-f0-9-]{16,64}$/u.test(options.token)) {
            throw new Error("Invalid fixture token");
        }
        this.name = DATABASE_PROBE_PREFIX + options.token;
        this.physicalName = (options.PouchDB.prefix ?? "_pouch_") + this.name;
    }

    private emit(name: string, detail?: string): void {
        this.options.emit({ source: "probe", name, ...(detail ? { detail } : {}) });
    }

    private watchNative(database: IDBDatabase): void {
        if (this.nativeConnections.has(database)) {
            return;
        }
        this.nativeConnections.add(database);
        for (const name of ["close", "abort", "error", "versionchange"] as const) {
            const callback = (event: Event) =>
                this.options.emit({
                    source: "fixture-native",
                    name,
                    detail: nativeEventDetail(event),
                });
            database.addEventListener(name, callback);
            this.removers.push(() => database.removeEventListener(name, callback));
            this.options.emit({
                source: "fixture-native",
                name,
                registration: "registered",
                detail: `handlerProperty=${String(`on${name}` in database)}`,
            });
        }
    }

    private watchPouch(pouch: ProbePouch): void {
        for (const name of ["close", "closed"] as const) {
            const callback = () => this.options.emit({ source: "fixture-pouch", name });
            pouch.on(name, callback);
            this.removers.push(() => pouch.removeListener(name, callback));
            this.options.emit({ source: "fixture-pouch", name, registration: "registered" });
        }
    }

    private async open(creating: boolean, signal: AbortSignal): Promise<ProbePouch> {
        const { factory, PouchDB } = this.options;
        const descriptor = Object.getOwnPropertyDescriptor(factory, "open");
        const original = factory.open.bind(factory);
        let captured = false;
        const wrapper: IDBFactory["open"] = (name, version) => {
            const request =
                version === undefined ? original.call(factory, name) : original.call(factory, name, version);
            if (name !== this.physicalName) {
                return request;
            }
            this.openCount++;
            this.emit("native-open", `count=${this.openCount}; creating=${String(creating)}`);
            request.addEventListener("upgradeneeded", (event) => {
                if (creating && event.oldVersion === 0) {
                    this.owned = true;
                } else {
                    request.transaction?.abort();
                }
            });
            request.addEventListener(
                "success",
                () => {
                    if (!this.owned || this.retired || signal.aborted) {
                        request.result.close();
                        return;
                    }
                    captured = true;
                    this.watchNative(request.result);
                    if (signal.aborted) {
                        request.result.close();
                    }
                },
                { once: true }
            );
            for (const eventName of ["blocked", "error"] as const) {
                request.addEventListener(eventName, () => this.emit(`native-open-${eventName}`), { once: true });
            }
            return request;
        };
        try {
            Object.defineProperty(factory, "open", { configurable: true, writable: true, value: wrapper });
            this.options.emit({ source: "probe", name: "native-open-capture", registration: "registered" });
            const pouch = new PouchDB(this.name, { adapter: this.options.adapter ?? "idb" });
            this.instances.add(pouch);
            this.watchPouch(pouch);
            await awaitDatabaseProbeOperation(pouch.info(), signal);
            if (!captured || !this.owned) {
                throw new Error("The fixture's native connection was not captured");
            }
            return pouch;
        } catch (error) {
            this.emit("native-open-capture-error", databaseProbeErrorName(error));
            throw error;
        } finally {
            if (factory.open === wrapper) {
                if (descriptor) {
                    Object.defineProperty(factory, "open", descriptor);
                } else {
                    Reflect.deleteProperty(factory, "open");
                }
                this.emit("native-open-capture-restored");
            }
        }
    }

    async prepare(): Promise<void> {
        this.emit(
            "versions",
            `PouchDB adapter=${this.options.adapter ?? "idb"}; fixture=disposable; no remote replication`
        );
        this.pouch = await this.open(true, this.options.signal);
        const saved = await awaitDatabaseProbeOperation(
            this.pouch.put({
                _id: DOCUMENT_ID,
                owner: this.options.token,
                value: FIXTURE_VALUE,
            }),
            this.options.signal
        );
        this.expectedRevision = saved.rev;
        const initial = await awaitDatabaseProbeOperation(this.pouch.get(DOCUMENT_ID), this.options.signal);
        if (initial.owner !== this.options.token || initial.value !== FIXTURE_VALUE) {
            throw new Error("Invalid fixture contents");
        }
        this.watchChanges();
    }

    private watchChanges(): void {
        this.changes?.cancel();
        this.changes = this.pouch!.changes({ since: "now", live: true });
        for (const name of ["change", "error", "complete"] as const) {
            this.changes.on(name, (...args) =>
                this.options.emit({
                    source: "fixture-changes",
                    name,
                    ...(name === "error" ? { detail: databaseProbeErrorName(args[0]) } : {}),
                })
            );
            this.options.emit({ source: "fixture-changes", name, registration: "registered" });
        }
    }

    /** Observe the real read promise and drain separately from the diagnostic deadline. */
    async abortRead(signal: AbortSignal): Promise<DatabaseAbortedRead> {
        this.changes?.cancel();
        const connections = [...this.nativeConnections];
        const native = connections[connections.length - 1];
        if (!native || !this.pouch) {
            throw new Error("The disposable native connection is unavailable.");
        }
        const hook = abortNextFixtureRead(native, (error) =>
            this.emit("transaction-abort-injection-error", databaseProbeErrorName(error))
        );
        const result: { outcome: DatabaseAbortedRead["outcome"]; drained: boolean; errorName?: string } = {
            outcome: "pending",
            drained: false,
        };
        this.emit("transaction-abort-requested", "Only the disposable fixture read is aborted.");
        try {
            const read = this.pouch.get(DOCUMENT_ID);
            const finished = read.then(
                () => {
                    result.outcome = "fulfilled";
                },
                (error: unknown) => {
                    result.outcome = "rejected";
                    result.errorName = databaseProbeErrorName(error);
                }
            );
            const drained = Promise.allSettled([read]).then(() => {
                result.drained = true;
            });
            try {
                await awaitDatabaseProbeOperation(finished, signal);
                await drained;
            } catch (error) {
                if (signal.aborted) {
                    throw error;
                }
                this.emit("transaction-abort-deadline", databaseProbeErrorName(error));
            }
            return { injected: hook.injected(), ...result };
        } finally {
            hook.restore();
        }
    }

    /** Read fixed fixture contents and the original revision without modifying the document. */
    async verifyContents(signal: AbortSignal): Promise<{ contentMatches: boolean; revisionMatches: boolean }> {
        if (!this.pouch) {
            throw new Error("The disposable Pouch is unavailable.");
        }
        const document = await awaitDatabaseProbeOperation(this.pouch.get(DOCUMENT_ID), signal);
        return {
            contentMatches: document.owner === this.options.token && document.value === FIXTURE_VALUE,
            revisionMatches: document._rev === this.expectedRevision,
        };
    }

    closeNative(): void {
        this.emit("native-close-requested", "Explicit native close does not dispatch a native close event.");
        for (const connection of this.nativeConnections) {
            connection.close();
        }
        this.nativeClosed = true;
    }

    async check(signal: AbortSignal): Promise<DatabaseProbeCheck> {
        const observations: string[] = [];
        let connectionFailure = false;
        const inspect = async (pouch: ProbePouch, target: string) => {
            for (const operation of ["get", "allDocs", "info"] as const) {
                try {
                    const value = await awaitDatabaseProbeOperation(
                        operation === "get"
                            ? pouch.get(DOCUMENT_ID)
                            : operation === "allDocs"
                              ? pouch.allDocs()
                              : pouch.info(),
                        signal
                    );
                    let detail = "ok";
                    if (operation === "get") {
                        const document = value as ProbeDocument;
                        detail += `; contentMatches=${String(document.value === FIXTURE_VALUE && document.owner === this.options.token)}; revisionMatches=${String(document._rev === this.expectedRevision)}`;
                    }
                    observations.push(`${target}.${operation}=${detail}`);
                    this.emit(`${target}-${operation}`, detail);
                } catch (error) {
                    if (signal.aborted) {
                        throw error;
                    }
                    const name = databaseProbeErrorName(error);
                    connectionFailure ||= name === "InvalidStateError" || name === "UnknownError";
                    observations.push(`${target}.${operation}=error; name=${name}`);
                    this.emit(`${target}-${operation}`, `error=${name}`);
                }
            }
        };
        await inspect(this.pouch!, "retained");
        if (this.nativeClosed) {
            if (!this.comparison) {
                this.comparison = new this.options.PouchDB(this.name, { adapter: this.options.adapter ?? "idb" });
                this.instances.add(this.comparison);
                this.watchPouch(this.comparison);
            }
            await inspect(this.comparison, "same-name-instance");
        }
        observations.push(`fixture.nativeOpenCount=${this.openCount}`);
        return { observations, connectionFailure };
    }

    async reopen(signal: AbortSignal): Promise<DatabaseProbeCheck> {
        this.emit("explicit-reopen-requested", "Diagnostic action; not automatic LiveSync recovery.");
        this.changes?.cancel();
        for (const pouch of this.instances) {
            try {
                await awaitDatabaseProbeOperation(pouch.close(), signal);
            } catch (error) {
                if (signal.aborted) {
                    throw error;
                }
                this.emit("pouch-close-error", databaseProbeErrorName(error));
            }
        }
        this.instances.clear();
        this.comparison = undefined;
        this.pouch = await this.open(false, signal);
        this.nativeClosed = false;
        this.watchChanges();
        return await this.check(signal);
    }

    async cleanup(): Promise<void> {
        this.retired = true;
        this.changes?.cancel();
        for (const pouch of this.instances) {
            try {
                await awaitDatabaseProbeOperation(pouch.close());
            } catch (error) {
                this.emit("cleanup-close-error", databaseProbeErrorName(error));
            }
        }
        this.instances.clear();
        for (const connection of this.nativeConnections) {
            connection.close();
        }
        try {
            if (this.owned) {
                const request = this.options.factory.deleteDatabase(this.physicalName);
                await awaitDatabaseProbeOperation(
                    new Promise<void>((resolve, reject) => {
                        request.onsuccess = () => resolve();
                        request.onerror = () => reject(operationError(request.error));
                        request.onblocked = () => this.emit("cleanup-blocked");
                    })
                );
                this.owned = false;
                this.emit("fixture-deleted");
            }
        } finally {
            for (const remove of this.removers.splice(0)) {
                remove();
            }
            this.nativeConnections.clear();
        }
    }
}

/** Listen without changing visibility, holding a wake lock, or polling in the background. */
export function observeDatabaseProbeBrowserEvents(
    document: Document,
    window: Window,
    emit: (event: DatabaseProbeEvent) => void
): () => void {
    const removers: (() => void)[] = [];
    for (const name of ["visibilitychange", "freeze", "resume"] as const) {
        const callback = (event: Event) =>
            emit({
                source: "document",
                name,
                detail: `visibility=${document.visibilityState}; trusted=${String(event.isTrusted)}`,
            });
        document.addEventListener(name, callback);
        removers.push(() => document.removeEventListener(name, callback));
        emit({
            source: "document",
            name,
            registration: "registered",
            detail: `handlerProperty=${String(`on${name}` in document)}`,
        });
    }
    for (const name of ["focus", "blur", "pageshow", "pagehide", "online", "offline"] as const) {
        const callback = (event: Event) =>
            emit({ source: "window", name, detail: `trusted=${String(event.isTrusted)}` });
        window.addEventListener(name, callback);
        removers.push(() => window.removeEventListener(name, callback));
        emit({
            source: "window",
            name,
            registration: "registered",
            detail: `handlerProperty=${String(`on${name}` in window)}`,
        });
    }
    emit({ source: "document", name: "initial-state", detail: `visibility=${document.visibilityState}` });
    return () => {
        for (const remove of removers) {
            remove();
        }
    };
}
