import type { DatabaseFileAccess } from "@lib/interfaces/DatabaseFileAccess.ts";
import { ServiceDatabaseFileAccessBase } from "@lib/serviceModules/ServiceDatabaseFileAccessBase";

// markChangesAreSame uses persistent data implicitly, we should refactor it too.
// For now, to make the refactoring done once, we just use them directly.
// Hence it is not on /src/lib/src/serviceModules. (markChangesAreSame is using indexedDB).
// Refactored, now migrating...
export class ServiceDatabaseFileAccess extends ServiceDatabaseFileAccessBase implements DatabaseFileAccess {}
