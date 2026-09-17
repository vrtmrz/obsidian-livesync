const MAX_RECENT_CUSTOMISATION_EVENTS = 100;

/** Keeps the bounded newest-first raw-event keys used by Customisation Sync. */
export class CustomisationSyncRecentEventDeduplicator {
    private keys: string[] = [];

    /**
     * Records a key when it is new and returns whether the caller should act.
     * Native Array#includes is intentional: the old `.contains` extension is
     * not available in every runtime where the feature is exercised.
     */
    admit(key: string): boolean {
        if (this.keys.includes(key)) return false;
        this.keys = [key, ...this.keys].slice(0, MAX_RECENT_CUSTOMISATION_EVENTS);
        return true;
    }
}
