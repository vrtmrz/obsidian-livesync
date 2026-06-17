import { join } from "@std/path";

/**
 * A temporary directory that cleans itself up via `await using`.
 * Requires TypeScript 5.2+ / Deno 1.40+ for the AsyncDisposable protocol.
 *
 * @example
 * ```ts
 * await using tmp = await TempDir.create();
 * const file = tmp.join("data.json");
 * ```
 */
export class TempDir implements AsyncDisposable {
    readonly path: string;

    private constructor(path: string) {
        this.path = path;
    }

    static async create(prefix = "livesync-deno-test"): Promise<TempDir> {
        const path = await Deno.makeTempDir({ prefix: `${prefix}.` });
        return new TempDir(path);
    }

    /** Return an OS path joined to the temp directory root. */
    join(...parts: string[]): string {
        return join(this.path, ...parts);
    }

    async [Symbol.asyncDispose](): Promise<void> {
        await Deno.remove(this.path, { recursive: true }).catch(() => {});
    }
}
