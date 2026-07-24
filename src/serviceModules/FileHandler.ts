import { ServiceFileHandlerBase } from "@vrtmrz/livesync-commonlib/compat/serviceModules/ServiceFileHandlerBase";

// markChangesAreSame uses persistent data implicitly, we should refactor it too.
// also, compareFileFreshness depends on marked changes, so we should refactor it as well. For now, to make the refactoring done once, we just use them directly.
// Hence it remains in the plug-in rather than Commonlib. (markChangesAreSame is using indexedDB).
// Refactored: markChangesAreSame, unmarkChanges, compareFileFreshness, isMarkedAsSameChanges are now moved to PathService
export class ServiceFileHandler extends ServiceFileHandlerBase {}
