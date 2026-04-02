import * as nodeFs from "node:fs";
import * as nodePath from "node:path";

type LocalStorageShape = {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
    clear(): void;
};

class PersistentNodeLocalStorage {
    private storagePath: string | undefined;
    private localStore: Record<string, string> = {};

    configure(storagePath: string) {
        if (this.storagePath === storagePath) {
            return;
        }
        this.storagePath = storagePath;
        this.loadFromFile();
    }

    private loadFromFile() {
        if (!this.storagePath) {
            this.localStore = {};
            return;
        }
        try {
            const loaded = JSON.parse(nodeFs.readFileSync(this.storagePath, "utf-8")) as Record<string, string>;
            this.localStore = { ...loaded };
        } catch {
            this.localStore = {};
        }
    }

    private flushToFile() {
        if (!this.storagePath) {
            return;
        }
        nodeFs.mkdirSync(nodePath.dirname(this.storagePath), { recursive: true });
        nodeFs.writeFileSync(this.storagePath, JSON.stringify(this.localStore, null, 2), "utf-8");
    }

    getItem(key: string): string | null {
        return this.localStore[key] ?? null;
    }

    setItem(key: string, value: string) {
        this.localStore[key] = value;
        this.flushToFile();
    }

    removeItem(key: string) {
        if (!(key in this.localStore)) {
            return;
        }
        delete this.localStore[key];
        this.flushToFile();
    }

    clear() {
        this.localStore = {};
        this.flushToFile();
    }
}

const persistentNodeLocalStorage = new PersistentNodeLocalStorage();

function createNodeLocalStorageShim(): LocalStorageShape {
    return {
        getItem(key: string) {
            return persistentNodeLocalStorage.getItem(key);
        },
        setItem(key: string, value: string) {
            persistentNodeLocalStorage.setItem(key, value);
        },
        removeItem(key: string) {
            persistentNodeLocalStorage.removeItem(key);
        },
        clear() {
            persistentNodeLocalStorage.clear();
        },
    };
}

export function ensureGlobalNodeLocalStorage() {
    if (!("localStorage" in globalThis) || typeof (globalThis as any).localStorage?.getItem !== "function") {
        (globalThis as any).localStorage = createNodeLocalStorageShim();
    }
}

export function configureNodeLocalStorage(storagePath: string) {
    persistentNodeLocalStorage.configure(storagePath);
    ensureGlobalNodeLocalStorage();
}

export function getNodeLocalStorageItem(key: string): string {
    return persistentNodeLocalStorage.getItem(key) ?? "";
}

export function setNodeLocalStorageItem(key: string, value: string) {
    persistentNodeLocalStorage.setItem(key, value);
}

export function deleteNodeLocalStorageItem(key: string) {
    persistentNodeLocalStorage.removeItem(key);
}

export function clearNodeLocalStorage() {
    persistentNodeLocalStorage.clear();
}