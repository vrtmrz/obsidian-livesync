import type { App } from "@/deps.ts";

function getSettingsManager(app: App): Record<string, unknown> {
    const manager: unknown = Reflect.get(app, "setting");
    if (typeof manager !== "object" || manager === null) {
        throw new TypeError("Obsidian does not expose the settings manager");
    }
    return manager as Record<string, unknown>;
}

function invokeSettingsMethod(app: App, methodName: string, args: unknown[] = []): void {
    const manager = getSettingsManager(app);
    const method = manager[methodName];
    if (typeof method !== "function") {
        throw new TypeError(`Obsidian does not expose settings.${methodName}`);
    }
    Reflect.apply(method, manager, args);
}

export function openObsidianSettings(app: App, tabId: string): void {
    invokeSettingsMethod(app, "open");
    invokeSettingsMethod(app, "openTabById", [tabId]);
}

export function closeObsidianSettings(app: App): void {
    invokeSettingsMethod(app, "close");
}
