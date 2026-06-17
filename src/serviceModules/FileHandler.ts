import { ServiceFileHandlerBase } from "@lib/serviceModules/ServiceFileHandlerBase";

// markChangesAreSame uses persistent data implicitly, we should refactor it too.
// also, compareFileFreshness depends on marked changes, so we should refactor it as well. For now, to make the refactoring done once, we just use them directly.
// Hence it is not on /src/lib/src/serviceModules. (markChangesAreSame is using indexedDB).
// Refactored: markChangesAreSame, unmarkChanges, compareFileFreshness, isMarkedAsSameChanges are now moved to PathService
export class ServiceFileHandler extends ServiceFileHandlerBase {}
