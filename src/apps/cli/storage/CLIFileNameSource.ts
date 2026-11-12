import {
    parseFilePath,
    type FilePath,
    type FileNameLookup,
    type FileNameReadOptions,
    type PathComparisonSettings,
} from "@vrtmrz/livesync-commonlib/storage";
import { path, type UnicodeResolvingNodeStorageAdapter } from "@vrtmrz/livesync-commonlib/node";
import type { IStorageEventWatchHandlers } from "@vrtmrz/livesync-commonlib/compat/managers/adapters";
import type { CliDiagnosticReporter } from "@/apps/cli/cliOutput";
import { findInvalidatedDirectoryScopes } from "./CLIFileNameSource.paths";
import { createInventoryReader } from "./CLIFileNameSource.inventory";
import { createInventoryReconciler } from "./CLIFileNameSource.reconciliation";
import { CLIFileNameSourceWatch } from "./CLIFileNameSource.watch";
import {
    asError,
    parentPath,
    samePolicy,
    type CLIFileNameSourceOptions,
    type FreshValidationFailure,
    type InventoryReader,
    type InventoryReconciler,
    type InventoryState,
    type WatchEventType,
} from "./CLIFileNameSource.state";

export type { CLIFileNameSourceOptions } from "./CLIFileNameSource.state";

/** Only ready owns a published inventory; failed and closed sources cannot serve names. */
type Lifecycle =
    | { readonly kind: "uninitialised" }
    | { readonly kind: "initialising" }
    | { readonly kind: "ready"; readonly inventory: InventoryState }
    | { readonly kind: "failed"; readonly error: Error }
    | { readonly kind: "closed" };

const noDiagnostic: CliDiagnosticReporter = () => undefined;

/**
 * Coordinates the CLI's watched name inventory without owning file metadata.
 *
 * The lifecycle and publication queue stay here. Sidecars own native observation,
 * supported enumeration, and staged directory reconciliation. Name queries become
 * ready before retained sync operations are restored; live sync delivery starts
 * later, so a collision query never waits for its own event-manager activation.
 */
export class CLIFileNameSource implements FileNameLookup {
    private lifecycle: Lifecycle = { kind: "uninitialised" };
    // Retain the shared attempt so concurrent preparation cannot create a second watcher.
    private preparePromise: Promise<void> | undefined;
    private get state(): InventoryState | undefined {
        return this.lifecycle.kind === "ready" ? this.lifecycle.inventory : undefined;
    }
    // A failed replacement scan leaves the previous inventory intact, but its
    // known failing scope must validate again before queries can reuse that view.
    private freshValidationFailure: FreshValidationFailure | undefined;

    // Sequence bounds captured work; directory generations reject stale reads of
    // individual scopes. Neither is an identity-map cache invalidation counter.
    private sequence = 0;
    // Both ends of host-owned I/O advance this revision, fencing fresh full scans.
    private mutationRevision = 0;
    // Earliest unhandled observation per scope: later notifications do not extend
    // a caller's captured work boundary, but do advance that scope's generation.
    private readonly invalidatedDirectories = new Map<string, number>();
    private readonly directoryGenerations = new Map<string, number>();
    // Local I/O may still be changing names after invalidation. Captured readers
    // wait for these completion tokens before they validate the affected scopes.
    private readonly pendingMutations = new Map<
        symbol,
        { readonly sequence: number; readonly completion: Promise<void> }
    >();
    // Coalesce background passes. A request during a pass permits one later pass;
    // unresolved coverage alone does not cause a busy retry loop.
    private reconciliationScheduled = false;
    private reconciliationRequested = false;

    // Only inventory operations enter this queue. Awaiting sync callbacks here
    // would deadlock when their collision checks query the same source again.
    private operationTail: Promise<void> = Promise.resolve();
    private readonly basePath: string;
    private readonly reportDiagnostic: CliDiagnosticReporter;
    private readonly reader: InventoryReader;
    private readonly reconciler: InventoryReconciler;
    private readonly watch: CLIFileNameSourceWatch;

    /**
     * Wire the same storage boundary used by file I/O; constructors perform no I/O.
     *
     * @param storage - Host storage with existing path and symlink safeguards.
     * @param getPolicy - Active settings, resolved after configuration has settled.
     * @param options - Root, delivery exclusions, diagnostic, and watcher ports.
     */
    constructor(
        private readonly storage: UnicodeResolvingNodeStorageAdapter,
        private readonly getPolicy: () => PathComparisonSettings,
        options: CLIFileNameSourceOptions
    ) {
        this.basePath = path.resolve(options.basePath);
        this.reportDiagnostic = options.reportDiagnostic ?? noDiagnostic;
        this.reader = createInventoryReader({
            storage: this.storage,
            basePath: this.basePath,
            reportDiagnostic: this.reportDiagnostic,
            markDirectoryDirty: (directory) => this.markDirectoryDirty(directory),
            recordFreshFailure: (state, policy, error) => this.recordFreshFailure(state, policy, error),
        });
        this.reconciler = createInventoryReconciler({
            reader: this.reader,
            basePath: this.basePath,
            reportDiagnostic: this.reportDiagnostic,
            invalidatedDirectories: this.invalidatedDirectories,
            directoryGenerations: this.directoryGenerations,
            getBoundary: () => this.sequence,
            markDirectoryDirty: (directory) => this.markDirectoryDirty(directory),
            assertNotClosed: () => this.assertNotClosed(),
            assertInventoryAvailable: (state, policy) => this.assertNfcInventoryAvailable(state, policy),
            onValidatedDirectories: (policy, directories) => {
                if (
                    this.freshValidationFailure &&
                    samePolicy(this.freshValidationFailure.policy, policy) &&
                    directories.has(this.freshValidationFailure.directory)
                ) {
                    this.freshValidationFailure = undefined;
                }
            },
        });
        this.watch = new CLIFileNameSourceWatch({
            basePath: this.basePath,
            options,
            reportDiagnostic: this.reportDiagnostic,
            canObserve: () => this.lifecycle.kind !== "closed" && this.lifecycle.kind !== "failed",
            canDeliver: () => this.lifecycle.kind === "ready",
            onObservation: (type, filePath) => this.observeChange(type, filePath),
            onInvalidPath: () => this.markPathsDirty([""]),
            onFatalError: (error) => {
                this.lifecycle = { kind: "failed", error };
            },
        });
    }

    /**
     * Start observation and prepare names once, without activating sync delivery.
     *
     * Concurrent calls share preparation. The host calls this after settings are
     * final and before replaying retained operations which can query names.
     */
    prepare(): Promise<void> {
        if (this.lifecycle.kind === "closed") {
            return Promise.reject(new Error("The CLI file-name source is closed"));
        }
        if (this.lifecycle.kind === "failed") {
            return Promise.reject(this.lifecycle.error);
        }
        if (this.lifecycle.kind === "ready") {
            return Promise.resolve();
        }
        if (this.preparePromise) {
            return this.preparePromise;
        }

        this.lifecycle = { kind: "initialising" };
        this.preparePromise = this.prepareInternal();
        return this.preparePromise;
    }

    /**
     * Read names through one captured observation boundary, or perform a fresh scan.
     *
     * Later events remain pending. If a captured scope cannot be published safely,
     * the request fails instead of extending its boundary until the Vault is quiet.
     */
    async getFileNames(options: FileNameReadOptions = {}): Promise<FilePath[]> {
        await this.ensureReady();
        // Reconstruction preflight needs a new listing authority read. Ordinary
        // calls settle only observations captured below and keep watched semantics.
        if (options.fresh) {
            return await this.getFreshFileNames();
        }

        const boundary = this.sequence;
        await this.waitForMutations(boundary);
        return await this.withOperationLock(async () => {
            if (this.hasPendingMutationThrough(boundary)) {
                throw new Error("A local mutation did not settle at the captured file-name boundary");
            }
            const state = this.requireState();
            const policy = this.getPolicy();
            await this.reader.selectPolicy(state, policy);
            const unresolved = await this.reconciler.reconcilePending(state, boundary);
            // A captured scope changed during validation or still needs work.
            // Reject this view instead of silently presenting incomplete coverage.
            if (unresolved.size > 0 || this.hasInvalidationThrough(boundary)) {
                throw new Error("File-name observations changed while reconciling the captured boundary");
            }
            this.assertNfcInventoryAvailable(state, policy);
            this.scheduleReconciliation();
            return state.index.getFileNames();
        });
    }

    /**
     * Validate the requested physical branches before selecting identity candidates.
     *
     * Local mutations can require another attempt. Unrelated pending subtrees are
     * reconciled separately; a target query does not recursively scan the Vault.
     */
    async findPathIdentityCandidates(
        pathValue: FilePath,
        policy: PathComparisonSettings
    ): Promise<readonly FilePath[]> {
        await this.ensureReady();
        const target = parseFilePath(pathValue);

        while (true) {
            const mutationBoundary = this.sequence;
            await this.waitForMutations(mutationBoundary);
            const result = await this.withOperationLock(async () => {
                if (this.pendingMutations.size > 0) {
                    return undefined;
                }
                const state = this.requireState();
                // The source selects the policy before reconciliation consumes it
                // from state. A new policy can expose failures in cached spellings;
                // settle those scopes before choosing candidates for this path.
                const policyChanged = !samePolicy(state.policy, policy);
                await this.reader.selectPolicy(state, policy);
                if (policyChanged) {
                    const boundary = this.sequence;
                    const unresolved = await this.reconciler.reconcilePending(state, boundary, false);
                    if (unresolved.size > 0) {
                        return undefined;
                    }
                }
                if (this.pendingMutations.size > 0) {
                    return undefined;
                }
                this.assertNfcInventoryAvailable(state, policy);

                const generations = await this.reconciler.revalidateTargetBranches(state, target);
                // This final cross-branch fence also catches an earlier parent
                // changing while a later parent is read. Retry instead of returning
                // candidates assembled from different observation generations.
                if (!this.reconciler.generationsUnchanged(generations)) {
                    return undefined;
                }
                this.assertNfcInventoryAvailable(state, policy);
                return state.index.findPathIdentityCandidates(target, policy);
            });
            if (result !== undefined) {
                this.scheduleReconciliation();
                return result;
            }
        }
    }

    /**
     * Mark original paths before host-owned I/O and return its completion callback.
     *
     * The storage adapter calls the idempotent callback in finally, including on
     * partial I/O failure. Bookkeeping failure blocks name queries while preserving
     * the filesystem operation's own success or failure result.
     */
    invalidate(paths: readonly string[]): () => void {
        const token = Symbol("storage-mutation");
        let settle!: () => void;
        const pending = new Promise<void>((resolve) => {
            settle = resolve;
        });
        this.mutationRevision++;
        try {
            this.markPathsDirty(paths);
        } catch (error) {
            this.markInventoryUnavailable(error);
        }
        this.pendingMutations.set(token, { sequence: this.sequence, completion: pending });

        let completed = false;
        return () => {
            if (completed) {
                return;
            }
            completed = true;
            this.mutationRevision++;
            try {
                this.markPathsDirty(paths);
            } catch (error) {
                this.markInventoryUnavailable(error);
            } finally {
                this.pendingMutations.delete(token);
                settle();
                this.scheduleReconciliation();
            }
        };
    }

    /** Hand off observed startup events only after retained sync operations have been restored. */
    async beginWatch(handlers: IStorageEventWatchHandlers): Promise<void> {
        await this.ensureReady();
        this.watch.beginDelivery(handlers);
    }

    /** Freeze sync admission while keeping inventory observation available for shutdown work. */
    stopDelivery(): void {
        this.watch.stopDelivery();
    }

    /** Retire observation before waiting for inventory work, preventing late publication. */
    async close(): Promise<void> {
        if (this.lifecycle.kind === "closed") {
            return;
        }
        this.lifecycle = { kind: "closed" };
        this.watch.stopDelivery();
        await this.watch.close();
        await this.operationTail;
        if (this.preparePromise) {
            await this.preparePromise.catch(() => undefined);
        }
    }

    private async prepareInternal(): Promise<void> {
        try {
            // Observe first: changes during seeding must reach both name invalidation
            // and the finite startup delivery buffer.
            await this.watch.startObservation();
            this.assertNotClosed();
            const mutationBoundary = this.sequence;
            await this.waitForMutations(mutationBoundary);
            const policy = this.getPolicy();
            const candidate = await this.reader.enumerate(policy);
            const boundary = this.sequence;
            await this.reconciler.reconcilePending(candidate, boundary);
            const finalPolicy = this.getPolicy();
            await this.reader.selectPolicy(candidate, finalPolicy);
            await this.reconciler.reconcilePending(candidate, this.sequence);
            this.assertNfcInventoryAvailable(candidate, finalPolicy);
            this.assertNotClosed();
            this.lifecycle = { kind: "ready", inventory: candidate };
            this.scheduleReconciliation();
        } catch (error) {
            const failure = asError(error);
            if (this.lifecycle.kind !== "closed") {
                this.lifecycle = { kind: "failed", error: failure };
            }
            await this.watch.close().catch(() => undefined);
            throw failure;
        }
    }

    /** This synchronous port runs before the watcher applies any sync-only exclusion. */
    private observeChange(type: WatchEventType, filePath: FilePath): void {
        this.markPathsDirty([filePath]);
        if (type === "addDir" || type === "unlinkDir") {
            this.markDirectoryDirty(String(filePath));
        }
        this.scheduleReconciliation();
    }

    private async ensureReady(): Promise<void> {
        if (this.lifecycle.kind === "ready") {
            return;
        }
        if (this.lifecycle.kind === "initialising" && this.preparePromise) {
            await this.preparePromise;
            return;
        }
        if (this.lifecycle.kind === "failed") {
            throw this.lifecycle.error;
        }
        if (this.lifecycle.kind === "closed") {
            throw new Error("The CLI file-name source is closed");
        }
        throw new Error("The CLI file-name source has not been prepared");
    }

    private requireState(): InventoryState {
        if (!this.state || this.lifecycle.kind !== "ready") {
            if (this.lifecycle.kind === "failed") {
                throw this.lifecycle.error;
            }
            throw new Error("The CLI file-name inventory is unavailable");
        }
        return this.state;
    }

    private assertNotClosed(): void {
        if (this.lifecycle.kind === "closed") {
            throw new Error("The CLI file-name source is closed");
        }
    }

    private async waitForMutations(boundary = Number.POSITIVE_INFINITY): Promise<void> {
        while (true) {
            const pending = Array.from(this.pendingMutations.values())
                .filter((mutation) => mutation.sequence <= boundary)
                .map((mutation) => mutation.completion);
            if (pending.length === 0) {
                return;
            }
            await Promise.all(pending);
        }
    }

    private hasPendingMutationThrough(boundary: number): boolean {
        return Array.from(this.pendingMutations.values()).some((mutation) => mutation.sequence <= boundary);
    }

    /** Serialise inventory work and always release the queue after a failed read. */
    private async withOperationLock<T>(operation: () => Promise<T>): Promise<T> {
        const previous = this.operationTail;
        let release!: () => void;
        this.operationTail = new Promise<void>((resolve) => {
            release = resolve;
        });
        await previous;
        try {
            return await operation();
        } finally {
            release();
        }
    }

    /** Build privately, fence overlapping local I/O, and replace only a validated full view. */
    private async getFreshFileNames(): Promise<FilePath[]> {
        const boundary = this.sequence;
        await this.waitForMutations(boundary);
        const startRevision = this.mutationRevision;
        return await this.withOperationLock(async () => {
            if (this.hasPendingMutationThrough(boundary)) {
                throw new Error("A local mutation did not settle at the captured fresh file-name boundary");
            }
            this.assertNotClosed();
            // Waiting for the queue may have overlapped a completed local write.
            // Its changed revision prevents this fresh scan from replacing newer work.
            this.assertFreshReadUnchanged(startRevision);
            // Candidate reconciliation can acknowledge shared observations before
            // publication. Retain their earliest boundary until the candidate commits,
            // so a later rejection cannot hide work from the still-published inventory.
            const retainedObservations = new Map<string, number>();
            this.retainPendingObservations(retainedObservations);
            try {
                const policy = this.getPolicy();
                const candidate = await this.reader.enumerate(policy, true);
                this.assertFreshReadUnchanged(startRevision);
                const scanBoundary = this.sequence;
                this.retainPendingObservations(retainedObservations);
                const unresolved = await this.reconciler.reconcilePending(candidate, scanBoundary);
                // Host-owned I/O at either end of enumeration invalidates this candidate,
                // even if delayed watcher notifications have not advanced any scope yet.
                this.assertFreshReadUnchanged(startRevision);
                if (unresolved.size > 0 || this.hasInvalidationThrough(scanBoundary)) {
                    throw new Error("File-name observations changed during fresh enumeration");
                }
                const finalPolicy = this.getPolicy();
                await this.reader.selectPolicy(candidate, finalPolicy);
                const finalBoundary = this.sequence;
                this.retainPendingObservations(retainedObservations);
                const finalUnresolved = await this.reconciler.reconcilePending(candidate, finalBoundary);
                // Policy selection can await directory reads too. Apply the same
                // publication fences after its final pass, before exposing names.
                this.assertFreshReadUnchanged(startRevision);
                if (finalUnresolved.size > 0 || this.hasInvalidationThrough(finalBoundary)) {
                    throw new Error("File-name observations changed during fresh enumeration");
                }
                this.freshValidationFailure = undefined;
                try {
                    this.assertNfcInventoryAvailable(candidate, finalPolicy);
                } catch (error) {
                    this.recordFreshFailure(candidate, finalPolicy, error);
                    throw error;
                }
                this.assertNotClosed();
                this.lifecycle = { kind: "ready", inventory: candidate };
                return candidate.index.getFileNames();
            } catch (error) {
                this.restorePendingObservations(retainedObservations);
                throw error;
            }
        });
    }

    /** Host I/O which starts or completes during a fresh read prevents publication. */
    private assertFreshReadUnchanged(startRevision: number): void {
        if (this.mutationRevision !== startRevision || this.pendingMutations.size > 0) {
            throw new Error("A local storage mutation overlapped fresh file-name enumeration");
        }
    }

    /** Remember each scope's first pending sequence before a private reconciliation pass. */
    private retainPendingObservations(retained: Map<string, number>): void {
        for (const [directory, sequence] of this.invalidatedDirectories) {
            if (!retained.has(directory)) {
                retained.set(directory, sequence);
            }
        }
    }

    /** A rejected candidate must leave its acknowledged work pending for the published view. */
    private restorePendingObservations(retained: ReadonlyMap<string, number>): void {
        for (const [directory, sequence] of retained) {
            const pendingSequence = this.invalidatedDirectories.get(directory);
            if (pendingSequence === undefined || sequence < pendingSequence) {
                this.markDirectoryDirty(directory, sequence);
            }
        }
    }

    /** Run one captured background pass; only newly requested work schedules another pass. */
    private scheduleReconciliation(): void {
        if (this.reconciliationScheduled) {
            this.reconciliationRequested = true;
            return;
        }
        if (this.lifecycle.kind !== "ready" || this.invalidatedDirectories.size === 0) {
            return;
        }
        this.reconciliationScheduled = true;
        const boundary = this.sequence;
        void Promise.resolve()
            .then(async () => {
                await this.waitForMutations(boundary);
                await this.withOperationLock(async () => {
                    if (this.lifecycle.kind !== "ready" || this.pendingMutations.size > 0) {
                        return;
                    }
                    const state = this.requireState();
                    await this.reconciler.reconcilePending(state, boundary);
                });
            })
            .catch((error: unknown) => {
                this.reportDiagnostic("[CLIFileNameSource] Background name reconciliation failed:", error);
            })
            .finally(() => {
                this.reconciliationScheduled = false;
                const requested = this.reconciliationRequested;
                this.reconciliationRequested = false;
                if (requested && this.lifecycle.kind === "ready" && this.invalidatedDirectories.size > 0) {
                    this.scheduleReconciliation();
                }
            });
    }

    /** Known failed coverage stays visible until its scope and policy validate again. */
    private assertNfcInventoryAvailable(state: InventoryState, policy: PathComparisonSettings): void {
        // A failed fresh scan is stronger evidence than the previous successful view.
        if (this.freshValidationFailure && samePolicy(this.freshValidationFailure.policy, policy)) {
            throw this.freshValidationFailure.error;
        }
        const rootError = state.readErrors.get("");
        if (rootError) {
            throw rootError;
        }
        // Legacy mode tolerates unreadable non-root scopes. NFC identity checks
        // require all known scopes to be unambiguous and readable, even off-path.
        if (policy.pathNormalizationVersion !== 1) {
            return;
        }
        const error = state.aliasErrors.values().next().value ?? state.readErrors.values().next().value;
        if (error) {
            throw error;
        }
    }

    private hasInvalidationThrough(boundary: number): boolean {
        return Array.from(this.invalidatedDirectories.values()).some((sequence) => sequence <= boundary);
    }

    /** Keep the earliest pending sequence, while advancing every affected directory's generation. */
    private markPathsDirty(paths: readonly string[]): void {
        const sequence = ++this.sequence;
        const directories = new Set<string>();
        for (const rawPath of paths) {
            const trimmed = rawPath.replace(/\/+$/u, "");
            let parsed: FilePath;
            try {
                parsed = parseFilePath(trimmed);
            } catch {
                directories.add("");
                continue;
            }
            const value = String(parsed);
            const state = this.state;
            const parent = parentPath(value);
            if (value !== "" && state?.directories.has(value)) {
                directories.add(value);
            }
            let current = parent;
            while (current !== "" && !state?.directories.has(current)) {
                directories.add(current);
                current = parentPath(current);
            }
            directories.add(current);
        }
        const state = this.state;
        if (state) {
            // I/O accepts logical NFC spellings, while coverage and generations
            // use physical names. Fence known equivalent parents synchronously,
            // before an in-flight read could publish their old membership.
            const policy = this.getPolicy();
            for (const directory of [...directories]) {
                for (const physicalDirectory of findInvalidatedDirectoryScopes(state.directories, directory, policy)) {
                    directories.add(physicalDirectory);
                }
            }
        }
        for (const directory of directories) {
            this.markDirectoryDirty(directory, sequence);
        }
    }

    private markInventoryUnavailable(error: unknown): void {
        const failure = asError(error);
        if (this.lifecycle.kind !== "closed") {
            this.lifecycle = { kind: "failed", error: failure };
        }
        this.reportDiagnostic(
            "[CLIFileNameSource] Inventory invalidation failed; name queries are unavailable:",
            failure
        );
    }

    private markDirectoryDirty(directory: string, sequence = this.sequence + 1): void {
        // Keep the latest observation comparable with a read boundary, while
        // the pending entry retains its earliest unhandled observation.
        const generation = ++this.sequence;
        const pendingSequence = this.invalidatedDirectories.get(directory);
        // Failed private candidates can restore an earlier observation than a
        // notification received after that candidate acknowledged the scope.
        if (pendingSequence === undefined || sequence < pendingSequence) {
            this.invalidatedDirectories.set(directory, sequence);
        }
        this.directoryGenerations.set(directory, generation);
    }

    /** Record a failed fresh scan without replacing the last validated inventory. */
    private recordFreshFailure(state: InventoryState, policy: PathComparisonSettings, error: unknown): void {
        const directory = state.aliasErrors.keys().next().value ?? state.readErrors.keys().next().value ?? "";
        this.freshValidationFailure = { policy: { ...policy }, directory, error: asError(error) };
        this.reportDiagnostic("[CLIFileNameSource] Fresh inventory validation failed:", error);
    }
}
