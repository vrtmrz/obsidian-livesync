import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A temporary directory which is removed when its `await using` scope ends. */
export class TempDir implements AsyncDisposable {
    readonly path: string;
    private constructor(path: string) {
        this.path = path;
    }
    static async create(prefix = "livesync-node-test"): Promise<TempDir> {
        return new TempDir(await mkdtemp(join(tmpdir(), `${prefix}.`)));
    }
    join(...parts: string[]): string {
        return join(this.path, ...parts);
    }
    async [Symbol.asyncDispose](): Promise<void> {
        await rm(this.path, { recursive: true, force: true }).catch(() => {});
    }
}
