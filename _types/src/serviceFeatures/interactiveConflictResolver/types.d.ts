// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import { type NecessaryServices } from "@lib/interfaces/ServiceModule";
/**
 * A union of service keys required by the interactive conflict resolver feature.
 */
export type ConflictResolverServices = "API" | "setting" | "UI" | "database" | "conflict" | "appLifecycle" | "replication" | "path";
/**
 * A union of service module keys required by the interactive conflict resolver feature.
 */
export type ConflictResolverModules = "databaseFileAccess";
/**
 * The host type representing the injected service container with conflict resolution capabilities.
 */
export type ConflictResolverHost = NecessaryServices<ConflictResolverServices, ConflictResolverModules>;
