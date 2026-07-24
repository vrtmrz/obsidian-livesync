import type { LOG_LEVEL } from "@vrtmrz/livesync-commonlib/compat/common/types";

/** Diagnostic output supplied by the Webapp host. */
export type WebAppLog = (message: unknown, level: LOG_LEVEL, key?: string) => void;
