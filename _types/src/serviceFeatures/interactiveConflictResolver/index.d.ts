// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { ConflictResolverServices } from "./types.ts";
/**
 * A service feature hook that initialises and manages the Interactive Conflict Resolver.
 * Registers conflict resolution commands and handles user-interactive resolution flows.
 */
export declare const useInteractiveConflictResolver: import("@/types.ts").ObsidianServiceFeatureFunction<ConflictResolverServices, "databaseFileAccess", "app", void>;
