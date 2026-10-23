import { createDeletableValueStore, sanitiseValueStoreError, ValueStoreError } from "@vrtmrz/value-store";
import type { ValueDeleter, ValueStore } from "@vrtmrz/value-store";
import { fs as nodeFs, path as nodePath } from "@vrtmrz/livesync-commonlib/node";

type NodeLocalStorage = ValueStore & ValueDeleter;

class JsonFileValueBackend {
    private values: Map<string, string>;

    constructor(private readonly storagePath: string) {
        this.values = this.loadValues();
    }

    get(key: string): string | null {
        return this.values.get(key) ?? null;
    }

    set(key: string, value: string): void {
        const nextValues = new Map(this.values);
        nextValues.set(key, value);
        this.writeValues(nextValues);
        this.values = nextValues;
    }

    delete(key: string): void {
        if (!this.values.has(key)) {
            return;
        }
        const nextValues = new Map(this.values);
        nextValues.delete(key);
        this.writeValues(nextValues);
        this.values = nextValues;
    }

    private loadValues(): Map<string, string> {
        let contents: string;
        try {
            contents = nodeFs.readFileSync(this.storagePath, "utf-8");
        } catch (error) {
            if (isMissingFileError(error)) {
                return new Map();
            }
            throw sanitiseValueStoreError(error);
        }

        let document: unknown;
        try {
            document = JSON.parse(contents);
        } catch {
            throw new ValueStoreError("invalid-data");
        }
        if (document === null || typeof document !== "object" || Array.isArray(document)) {
            throw new ValueStoreError("invalid-data");
        }

        const values = new Map<string, string>();
        for (const [key, value] of Object.entries(document)) {
            if (typeof value !== "string") {
                throw new ValueStoreError("invalid-data");
            }
            values.set(key, value);
        }
        return values;
    }

    private writeValues(values: ReadonlyMap<string, string>): void {
        nodeFs.mkdirSync(nodePath.dirname(this.storagePath), { recursive: true });
        nodeFs.writeFileSync(this.storagePath, JSON.stringify(Object.fromEntries(values), null, 2), "utf-8");
    }
}

function isMissingFileError(error: unknown): boolean {
    if (typeof error !== "object" || error === null) {
        return false;
    }
    try {
        const code = Object.getOwnPropertyDescriptor(error, "code");
        return code !== undefined && Object.prototype.hasOwnProperty.call(code, "value") && code.value === "ENOENT";
    } catch {
        return false;
    }
}

export function createNodeLocalStorage(storagePath: string): NodeLocalStorage {
    return createDeletableValueStore(new JsonFileValueBackend(storagePath));
}
