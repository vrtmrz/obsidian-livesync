import { LiveSyncWebApp } from "./main";
import { VaultHistoryStore, type VaultHistoryItem } from "./vaultSelector";
import { compatGlobal, _activeDocument } from "@lib/common/coreEnvFunctions.ts";

const historyStore = new VaultHistoryStore();
let app: LiveSyncWebApp | null = null;

function getRequiredElement<T extends HTMLElement>(id: string): T {
    const element = _activeDocument.getElementById(id);
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

    const historyButtons = _activeDocument.querySelectorAll<HTMLButtonElement>(".vault-item button");
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

    listEl.replaceChildren();
    emptyEl.classList.toggle("is-hidden", items.length > 0);

    for (const item of items) {
        const row = _activeDocument.createElement("div");
        row.className = "vault-item";

        const info = _activeDocument.createElement("div");
        info.className = "vault-item-info";

        const name = _activeDocument.createElement("div");
        name.className = "vault-item-name";
        name.textContent = item.name;

        const meta = _activeDocument.createElement("div");
        meta.className = "vault-item-meta";
        const label = item.id === lastUsedId ? "Last used" : "Used";
        meta.textContent = `${label}: ${formatLastUsed(item.lastUsedAt)}`;

        info.append(name, meta);

        const useButton = _activeDocument.createElement("button");
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

compatGlobal.addEventListener("load", () => {
    initializeVaultSelector().catch((error) => {
        console.error("Failed to initialize vault selector:", error);
        setStatus("error", `Initialization failed: ${String(error)}`);
    });
});

compatGlobal.addEventListener("beforeunload", () => {
    void app?.shutdown();
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- patching
(compatGlobal as any).livesyncApp = {
    getApp: () => app,
    historyStore,
};
