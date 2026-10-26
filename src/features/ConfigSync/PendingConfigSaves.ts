import { compatGlobal, type CompatTimeoutHandle } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";

type PendingSave = {
    save: () => Promise<void>;
    completion: Promise<void>;
    resolve: () => void;
    reject: (error: unknown) => void;
    timer?: CompatTimeoutHandle;
    started: boolean;
};

/** Owns the quiet-period delay and completion of coalesced customisation saves. */
export class PendingConfigSaves {
    private readonly pending = new Map<string, PendingSave>();

    enqueue(key: string, save: () => Promise<void>, whenFlushRequested?: Promise<void>): Promise<void> {
        let group = this.pending.get(key);
        if (!group) {
            let resolve!: () => void;
            let reject!: (error: unknown) => void;
            const completion = new Promise<void>((onResolve, onReject) => {
                resolve = onResolve;
                reject = onReject;
            });
            group = { save, completion, resolve, reject, started: false };
            this.pending.set(key, group);
        } else {
            group.save = save;
            if (group.timer !== undefined) compatGlobal.clearTimeout(group.timer);
        }
        const captured = group;
        group.timer = compatGlobal.setTimeout(() => this.run(key, captured), 100);
        // Capture this group: a late flush of an earlier event must not release
        // a newer group which happens to use the same customisation key.
        void whenFlushRequested?.then(
            () => this.run(key, captured),
            () => {}
        );
        return group.completion;
    }

    private run(key: string, group: PendingSave): void {
        if (group.started) return;
        group.started = true;
        if (group.timer !== undefined) compatGlobal.clearTimeout(group.timer);
        this.pending.delete(key);
        void Promise.resolve().then(group.save).then(group.resolve, group.reject);
    }
}
