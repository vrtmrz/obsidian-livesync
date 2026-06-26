// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import type { DocumentHistoryServices } from "./types.ts";
/**
 * A service feature hook that initialises and manages Obsidian Document History commands.
 * Registers ribbon commands and listens to history request events.
 */
export declare const useObsidianDocumentHistory: import("@lib/interfaces/ServiceModule.ts").ServiceFeatureFunction<DocumentHistoryServices, never, void>;
