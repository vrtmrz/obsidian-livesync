import type { Confirm } from "@vrtmrz/livesync-commonlib/compat/interfaces/Confirm";
import {
    ServiceRebuilder,
    type ServiceRebuilderDependencies,
} from "@vrtmrz/livesync-commonlib/compat/serviceModules/Rebuilder";
import { UnsupportedEncryptedDocumentFormatError } from "@vrtmrz/livesync-commonlib/replication";
import { fireAndForget } from "octagonal-wheels/promises";

export class ObsidianRebuilder extends ServiceRebuilder {
    private readonly confirm: Confirm;

    constructor(services: ServiceRebuilderDependencies) {
        super(services);
        this.confirm = services.UI.confirm;
    }

    override $fetchLocal(makeLocalChunkBeforeSync?: boolean, preventMakeLocalFilesBeforeSync?: boolean): Promise<void> {
        return this.reportFetchFailure(super.$fetchLocal(makeLocalChunkBeforeSync, preventMakeLocalFilesBeforeSync));
    }

    override $fetchLocalDBFast(autoResume: boolean): Promise<void> {
        return this.reportFetchFailure(super.$fetchLocalDBFast(autoResume));
    }

    private async reportFetchFailure(fetch: Promise<void>): Promise<void> {
        try {
            await fetch;
        } catch (error) {
            if (UnsupportedEncryptedDocumentFormatError.findIn(error)) {
                this.confirm.askInPopup("fetch-unsupported-e2ee-format", "Fetch stopped. {HERE}", (anchor) => {
                    anchor.textContent = "View recovery steps";
                    anchor.href = "#";
                    anchor.addEventListener("click", (event) => {
                        event.preventDefault();
                        fireAndForget(() =>
                            this.confirm.confirmWithMessage(
                                "Fetch stopped",
                                "The remote database contains data in an unsupported E2EE format.\n\n" +
                                    "1. Confirm that another device's Vault contains all the files and changes you need.\n" +
                                    "2. Please back up the Vaults and the remote database. On that other device, " +
                                    "use **Overwrite Server Data with This Device's Files** to rebuild the remote database.\n" +
                                    "3. Run Fetch again on this device.",
                                ["Close"],
                                "Close"
                            )
                        );
                    });
                });
            }
            throw error;
        }
    }
}
