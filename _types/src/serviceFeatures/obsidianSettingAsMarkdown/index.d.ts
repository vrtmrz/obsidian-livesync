// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import { type ObsidianLiveSyncSettings } from "@lib/common/types.ts";
export declare const SETTING_HEADER = "````yaml:livesync-setting\n";
export declare const SETTING_FOOTER = "\n````";
/**
 * Extracts the YAML settings block from the full text of a markdown file.
 *
 * Returns the preamble (text before the block), the body (YAML content), and
 * the postscript (text after the block). If no block is found, the entire
 * `data` string is returned as the preamble with empty body and postscript.
 */
export declare const extractSettingFromWholeText: (data: string) => {
    preamble: string;
    body: string;
    postscript: string;
};
/**
 * Strips sensitive / internal-only fields from a settings snapshot so that it
 * is safe to serialise into a markdown file.
 *
 * If `keepCredential` is true (or `writeCredentialsForSettingSync` is set on
 * the settings object) the credential fields are retained; otherwise they are
 * removed.
 */
export declare const generateSettingForMarkdownPure: (settings: ObsidianLiveSyncSettings, keepCredential?: boolean) => Partial<ObsidianLiveSyncSettings>;
/**
 * Obsidian Settings as Markdown Feature
 *
 * Allows saving and loading settings to/from a markdown file.
 */
export declare const useObsidianSettingAsMarkdownFeature: import("@/types.ts").ObsidianServiceFeatureFunction<"setting" | "UI" | "appLifecycle" | "API", "storageAccess" | "rebuilder", "plugin", void>;
