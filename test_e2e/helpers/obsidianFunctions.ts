/* eslint-disable no-restricted-globals */
import type { App } from "obsidian";

declare global {
    var app: App & {
        plugins: {
            enabledPlugins: Set<string>;
            enablePlugin: (name: string) => Promise<void>;
        };
    };
}

export const enablePlugin = async (pluginName: string) => {
    return await window.app.plugins.enablePlugin(pluginName);
};

export const isPluginEnabled = (pluginName: string) => {
    return window.app.plugins.enabledPlugins.has(pluginName);
};
