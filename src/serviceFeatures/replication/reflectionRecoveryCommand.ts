import { declareUICommand } from "@vrtmrz/livesync-commonlib/ui-commands";

export const OPEN_REFLECTION_RECOVERY_REVIEW = declareUICommand<void, "closed" | "already-open" | "unavailable">(
    "livesync:reflection-recovery-review"
);
