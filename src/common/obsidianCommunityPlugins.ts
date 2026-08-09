import type { App, PluginManifest } from "@/deps.ts";

export interface ObsidianCommunityPluginManager {
    enabledPlugins: ReadonlySet<string>;
    manifests: PluginManifest[];
    loadPlugin(pluginId: string): Promise<void>;
    unloadPlugin(pluginId: string): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isPluginManifest(value: unknown): value is PluginManifest {
    return (
        isRecord(value) &&
        typeof value.id === "string" &&
        typeof value.name === "string" &&
        (value.dir === undefined || typeof value.dir === "string")
    );
}

function isStringSet(value: unknown): value is ReadonlySet<string> {
    if (!(value instanceof Set)) {
        return false;
    }
    const entries = value as ReadonlySet<unknown>;
    for (const entry of entries) {
        if (typeof entry !== "string") {
            return false;
        }
    }
    return true;
}

async function invokeLifecycleMethod(
    manager: Record<string, unknown>,
    methodName: "loadPlugin" | "unloadPlugin",
    pluginId: string
): Promise<void> {
    const method = manager[methodName];
    if (typeof method !== "function") {
        throw new TypeError(`Obsidian does not expose ${methodName}`);
    }
    const result: unknown = Reflect.apply(method, manager, [pluginId]);
    await result;
}

export function getObsidianCommunityPluginManager(app: App): ObsidianCommunityPluginManager {
    const managerValue: unknown = Reflect.get(app, "plugins");
    if (!isRecord(managerValue) || !isRecord(managerValue.manifests) || !isStringSet(managerValue.enabledPlugins)) {
        throw new TypeError("Obsidian does not expose the community plug-in manager");
    }

    const manifests = Object.values(managerValue.manifests).filter(isPluginManifest);
    return {
        enabledPlugins: managerValue.enabledPlugins,
        manifests,
        loadPlugin: async (pluginId) => await invokeLifecycleMethod(managerValue, "loadPlugin", pluginId),
        unloadPlugin: async (pluginId) => await invokeLifecycleMethod(managerValue, "unloadPlugin", pluginId),
    };
}
