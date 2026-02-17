import { markChangesAreSame } from "@/common/utils";
import type { AnyEntry } from "@lib/common/types";

import type { DatabaseFileAccess } from "@lib/interfaces/DatabaseFileAccess.ts";
import { ServiceDatabaseFileAccessBase } from "@lib/serviceModules/ServiceDatabaseFileAccessBase";

// markChangesAreSame uses persistent data implicitly, we should refactor it too.
// For now, to make the refactoring done once, we just use them directly.
// Hence it is not on /src/lib/src/serviceModules. (markChangesAreSame is using indexedDB).
// TODO: REFACTOR
export class ServiceDatabaseFileAccess extends ServiceDatabaseFileAccessBase implements DatabaseFileAccess {
    markChangesAreSame(old: AnyEntry, newMtime: number, oldMtime: number): void {
        markChangesAreSame(old, newMtime, oldMtime);
    }
}
