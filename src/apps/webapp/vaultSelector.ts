const HANDLE_DB_NAME = "livesync-webapp-handles";
const HANDLE_STORE_NAME = "handles";
const LAST_USED_KEY = "meta:lastUsedVaultId";
const VAULT_KEY_PREFIX = "vault:";
const MAX_HISTORY_COUNT = 10;

export type VaultHistoryItem = {
    id: string;
    name: string;
    handle: FileSystemDirectoryHandle;
    lastUsedAt: number;
};

type VaultHistoryValue = VaultHistoryItem;

function makeVaultKey(id: string): string {
    return `${VAULT_KEY_PREFIX}${id}`;
}

function parseVaultId(key: string): string | null {
    if (!key.startsWith(VAULT_KEY_PREFIX)) {
        return null;
    }
    return key.slice(VAULT_KEY_PREFIX.length);
}

function randomId(): string {
    const n = Math.random().toString(36).slice(2, 10);
    return `${Date.now()}-${n}`;
}

async function hasReadWritePermission(handle: FileSystemDirectoryHandle, requestIfNeeded: boolean): Promise<boolean> {
    const h = handle as any;
    if (typeof h.queryPermission === "function") {
        const queried = await h.queryPermission({ mode: "readwrite" });
        if (queried === "granted") {
            return true;
        }
    }
    if (!requestIfNeeded) {
        return false;
    }
    if (typeof h.requestPermission === "function") {
        const requested = await h.requestPermission({ mode: "readwrite" });
        return requested === "granted";
    }
    return true;
}

export class VaultHistoryStore {
    private async openHandleDB(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(HANDLE_DB_NAME, 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(HANDLE_STORE_NAME)) {
                    db.createObjectStore(HANDLE_STORE_NAME);
                }
            };
        });
    }

    private async withStore<T>(mode: IDBTransactionMode, task: (store: IDBObjectStore) => Promise<T>): Promise<T> {
        const db = await this.openHandleDB();
        try {
            const tx = db.transaction([HANDLE_STORE_NAME], mode);
            const store = tx.objectStore(HANDLE_STORE_NAME);
            return await task(store);
        } finally {
            db.close();
        }
    }

    private async requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getLastUsedVaultId(): Promise<string | null> {
        return this.withStore("readonly", async (store) => {
            const value = await this.requestAsPromise(store.get(LAST_USED_KEY));
            return typeof value === "string" ? value : null;
        });
    }

    async getVaultHistory(): Promise<VaultHistoryItem[]> {
        return this.withStore("readonly", async (store) => {
            const keys = (await this.requestAsPromise(store.getAllKeys())) as IDBValidKey[];
            const values = (await this.requestAsPromise(store.getAll())) as unknown[];
            const items: VaultHistoryItem[] = [];
            for (let i = 0; i < keys.length; i++) {
                const key = String(keys[i]);
                const id = parseVaultId(key);
                const value = values[i] as Partial<VaultHistoryValue> | undefined;
                if (!id || !value || !value.handle || !value.name) {
                    continue;
                }
                items.push({
                    id,
                    name: String(value.name),
                    handle: value.handle,
                    lastUsedAt: Number(value.lastUsedAt || 0),
                });
            }
            items.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
            return items;
        });
    }

    async saveSelectedVault(handle: FileSystemDirectoryHandle): Promise<VaultHistoryItem> {
        const now = Date.now();
        const existing = await this.getVaultHistory();

        let matched: VaultHistoryItem | null = null;
        for (const item of existing) {
            try {
                if (await item.handle.isSameEntry(handle)) {
                    matched = item;
                    break;
                }
            } catch {
                // Ignore handles that cannot be compared, keep scanning.
            }
        }

        const item: VaultHistoryItem = {
            id: matched?.id ?? randomId(),
            name: handle.name,
            handle,
            lastUsedAt: now,
        };

        await this.withStore("readwrite", async (store): Promise<void> => {
            await this.requestAsPromise(store.put(item, makeVaultKey(item.id)));
            await this.requestAsPromise(store.put(item.id, LAST_USED_KEY));

            const merged = [...existing.filter((v) => v.id !== item.id), item].sort(
                (a, b) => b.lastUsedAt - a.lastUsedAt
            );
            const stale = merged.slice(MAX_HISTORY_COUNT);
            for (const old of stale) {
                await this.requestAsPromise(store.delete(makeVaultKey(old.id)));
            }
        });

        return item;
    }

    async activateHistoryItem(item: VaultHistoryItem): Promise<FileSystemDirectoryHandle> {
        const granted = await hasReadWritePermission(item.handle, true);
        if (!granted) {
            throw new Error("Vault permissions were not granted");
        }

        const activated: VaultHistoryItem = {
            ...item,
            lastUsedAt: Date.now(),
        };

        await this.withStore("readwrite", async (store): Promise<void> => {
            await this.requestAsPromise(store.put(activated, makeVaultKey(activated.id)));
            await this.requestAsPromise(store.put(activated.id, LAST_USED_KEY));
        });

        return item.handle;
    }

    async pickNewVault(): Promise<FileSystemDirectoryHandle> {
        const picker = (window as any).showDirectoryPicker;
        if (typeof picker !== "function") {
            throw new Error("FileSystem API showDirectoryPicker is not supported in this browser");
        }

        const handle = (await picker({
            mode: "readwrite",
            startIn: "documents",
        })) as FileSystemDirectoryHandle;

        const granted = await hasReadWritePermission(handle, true);
        if (!granted) {
            throw new Error("Vault permissions were not granted");
        }

        await this.saveSelectedVault(handle);
        return handle;
    }
}
