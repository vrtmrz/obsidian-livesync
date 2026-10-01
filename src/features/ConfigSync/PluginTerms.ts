import type { IPluginDataExDisplay } from "./CmdConfigSync.ts";

export type CanApplyFrom = (
    local: IPluginDataExDisplay | undefined,
    remote: IPluginDataExDisplay | undefined
) => Promise<boolean>;

/**
 * Devices offered as sources for one item in the Customisation Sync dialogue.
 *
 * Maintenance mode lists every device, including this one. Otherwise every other
 * device that has the item is listed; with `hideNotApplicable`, only devices whose
 * copy can actually be applied remain, so an item that is the same everywhere ends
 * up with no source and is shown as "All the same or non-existent".
 */
export async function selectSourceTerms(
    list: IPluginDataExDisplay[],
    thisTerm: string,
    options: { isMaintenanceMode: boolean; hideNotApplicable: boolean },
    canApplyFrom: CanApplyFrom
): Promise<string[]> {
    const terms = [...new Set(list.map((e) => e.term))];
    if (options.isMaintenanceMode) return terms;
    if (!options.hideNotApplicable) return terms.filter((term) => term != thisTerm);
    const local = list.find((e) => e.term == thisTerm);
    const applicable: string[] = [];
    for (const term of terms) {
        const remote = list.find((e) => e.term == term);
        if (await canApplyFrom(local, remote)) applicable.push(term);
    }
    return applicable;
}
