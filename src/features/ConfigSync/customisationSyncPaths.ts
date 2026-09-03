import { ICXHeader } from "@/common/types.ts";
import type { FilePathWithPrefix } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { stripAllPrefixes } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/path";

export type CustomisationSyncFileCategory =
    | "CONFIG"
    | "THEME"
    | "SNIPPET"
    | "PLUGIN_MAIN"
    | "PLUGIN_ETC"
    | "PLUGIN_DATA"
    | "";

export type CustomisationSyncPathOptions = {
    configDir: string;
    useV2: boolean;
    usePluginEtc: boolean;
};

export function getCustomisationSyncFileCategory(
    filePath: string,
    options: CustomisationSyncPathOptions
): CustomisationSyncFileCategory {
    if (filePath.split("/").length == 2 && filePath.endsWith(".json")) return "CONFIG";
    if (filePath.split("/").length == 4 && filePath.startsWith(`${options.configDir}/themes/`)) return "THEME";
    if (filePath.startsWith(`${options.configDir}/snippets/`) && filePath.endsWith(".css")) return "SNIPPET";
    if (filePath.startsWith(`${options.configDir}/plugins/`)) {
        if (filePath.endsWith("/styles.css") || filePath.endsWith("/manifest.json") || filePath.endsWith("/main.js")) {
            return "PLUGIN_MAIN";
        }
        if (filePath.endsWith("/data.json")) {
            return "PLUGIN_DATA";
        }
        return options.useV2 && options.usePluginEtc ? "PLUGIN_ETC" : "";
    }
    return "";
}

export function isCustomisationSyncTargetPath(filePath: string, options: CustomisationSyncPathOptions): boolean {
    if (!filePath.startsWith(options.configDir)) return false;
    return getCustomisationSyncFileCategory(filePath, options) != "";
}

export function getCustomisationSyncSettingKey(
    filePath: string,
    options: CustomisationSyncPathOptions
): string | undefined {
    if (!isCustomisationSyncTargetPath(filePath, options)) return undefined;
    const category = getCustomisationSyncFileCategory(filePath, options);
    const name =
        category == "CONFIG" || category == "SNIPPET"
            ? filePath.split("/").slice(-1)[0]
            : filePath.split("/").slice(-2)[0];
    return name ? `${category}/${name}` : undefined;
}

export function getCustomisationSyncSettingKeyFromDocumentPath(documentPath: FilePathWithPrefix): string | undefined {
    const [, category, ...rest] = stripAllPrefixes(documentPath).split("/");
    if (!category || rest.length == 0) return undefined;
    if (!["CONFIG", "THEME", "SNIPPET", "PLUGIN_MAIN", "PLUGIN_ETC", "PLUGIN_DATA"].includes(category)) {
        return undefined;
    }
    const encodedName = category == "CONFIG" || category == "SNIPPET" ? rest.join("/") : rest[0];
    const name = encodedName.split("%")[0].replace(/\.md$/, "");
    return name ? `${category}/${name}` : undefined;
}

export function createCustomisationSyncV1DocumentPath(
    filePath: string,
    device: string,
    options: CustomisationSyncPathOptions
): FilePathWithPrefix {
    const category = getCustomisationSyncFileCategory(filePath, options);
    const name =
        category == "CONFIG" || category == "SNIPPET"
            ? filePath.split("/").slice(-1)[0]
            : category == "PLUGIN_ETC"
              ? filePath.split("/").slice(-2).join("/")
              : filePath.split("/").slice(-2)[0];
    return `${ICXHeader}${device}/${category}/${name}.md` as FilePathWithPrefix;
}

export function createCustomisationSyncV2DocumentPath(
    filePath: string,
    device: string,
    options: CustomisationSyncPathOptions
): FilePathWithPrefix {
    const category = getCustomisationSyncFileCategory(filePath, options);
    const name =
        category == "CONFIG" || category == "SNIPPET"
            ? filePath.split("/").slice(-1)[0]
            : filePath.split("/").slice(-2)[0];
    const baseName = category == "CONFIG" || category == "SNIPPET" ? name : filePath.split("/").slice(3).join("/");
    return `${ICXHeader}${device}/${category}/${name}%${baseName}` as FilePathWithPrefix;
}

export function createCustomisationSyncDevicePrefix(device: string): FilePathWithPrefix {
    return `${ICXHeader}${device}/` as FilePathWithPrefix;
}

export function parseCustomisationSyncV2DocumentPath(unifiedPath: FilePathWithPrefix): {
    category: string;
    device: string;
    key: string;
    filename: string;
    pathV1: FilePathWithPrefix;
} {
    const [device, category, ...rest] = stripAllPrefixes(unifiedPath).split("/");
    const relativePath = rest.join("/");
    const [key, filename] = relativePath.split("%");
    const pathV1 = (unifiedPath.split("%")[0] + ".md") as FilePathWithPrefix;
    return { device, category, key, filename, pathV1 };
}
