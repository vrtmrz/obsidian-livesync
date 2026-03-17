import { LiveSyncWebApp } from "./main";
import { VaultHistoryStore, type VaultHistoryItem } from "./vaultSelector";

const historyStore = new VaultHistoryStore();
let app: LiveSyncWebApp | null = null;

function getRequiredElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Missing element: #${id}`);
    }
    return element as T;
}

function setStatus(kind: "info" | "warning" | "error" | "success", message: string): void {
    const statusEl = getRequiredElement<HTMLDivElement>("status");
    statusEl.className = kind;
    statusEl.textContent = message;
}

function setBusyState(isBusy: boolean): void {
    const pickNewBtn = getRequiredElement<HTMLButtonElement>("pick-new-vault");
    pickNewBtn.disabled = isBusy;

    const historyButtons = document.querySelectorAll<HTMLButtonElement>(".vault-item button");
    historyButtons.forEach((button) => {
        button.disabled = isBusy;
    });
}

function formatLastUsed(unixMillis: number): string {
    if (!unixMillis) {
        return "unknown";
    }
    return new Date(unixMillis).toLocaleString();
}

async function renderHistoryList(): Promise<VaultHistoryItem[]> {
    const listEl = getRequiredElement<HTMLDivElement>("vault-history-list");
    const emptyEl = getRequiredElement<HTMLParagraphElement>("vault-history-empty");

    const [items, lastUsedId] = await Promise.all([historyStore.getVaultHistory(), historyStore.getLastUsedVaultId()]);

    listEl.innerHTML = "";
    emptyEl.classList.toggle("is-hidden", items.length > 0);

    for (const item of items) {
        const row = document.createElement("div");
        row.className = "vault-item";

        const info = document.createElement("div");
        info.className = "vault-item-info";

        const name = document.createElement("div");
        name.className = "vault-item-name";
        name.textContent = item.name;

        const meta = document.createElement("div");
        meta.className = "vault-item-meta";
        const label = item.id === lastUsedId ? "Last used" : "Used";
        meta.textContent = `${label}: ${formatLastUsed(item.lastUsedAt)}`;

        info.append(name, meta);

        const useButton = document.createElement("button");
        useButton.type = "button";
        useButton.textContent = "Use this vault";
        useButton.addEventListener("click", () => {
            void startWithHistory(item);
        });

        row.append(info, useButton);
        listEl.appendChild(row);
    }

    return items;
}

async function startWithHandle(handle: FileSystemDirectoryHandle): Promise<void> {
    setStatus("info", `Starting LiveSync with vault: ${handle.name}`);
    app = new LiveSyncWebApp(handle);
    await app.initialize();

    const selectorEl = getRequiredElement<HTMLDivElement>("vault-selector");
    selectorEl.classList.add("is-hidden");
}

async function startWithHistory(item: VaultHistoryItem): Promise<void> {
    setBusyState(true);
    try {
        const handle = await historyStore.activateHistoryItem(item);
        await startWithHandle(handle);
    } catch (error) {
        console.error("[Directory] Failed to open history vault:", error);
        setStatus("error", `Failed to open saved vault: ${String(error)}`);
        setBusyState(false);
    }
}

async function startWithNewPicker(): Promise<void> {
    setBusyState(true);
    try {
        const handle = await historyStore.pickNewVault();
        await startWithHandle(handle);
    } catch (error) {
        console.error("[Directory] Failed to pick vault:", error);
        setStatus("warning", `Vault selection was cancelled or failed: ${String(error)}`);
        setBusyState(false);
    }
}

async function initializeVaultSelector(): Promise<void> {
    setStatus("info", "Select a vault folder to start LiveSync.");

    const pickNewBtn = getRequiredElement<HTMLButtonElement>("pick-new-vault");
    pickNewBtn.addEventListener("click", () => {
        void startWithNewPicker();
    });

    await renderHistoryList();
}

window.addEventListener("load", async () => {
    try {
        await initializeVaultSelector();
    } catch (error) {
        console.error("Failed to initialize vault selector:", error);
        setStatus("error", `Initialization failed: ${String(error)}`);
    }
});

window.addEventListener("beforeunload", () => {
    void app?.shutdown();
});

(window as any).livesyncApp = {
    getApp: () => app,
    historyStore,
};
