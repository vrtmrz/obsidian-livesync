import { describe, expect, it, vi } from "vitest";
import type { IPluginDataExDisplay } from "./CmdConfigSync.ts";
import { selectSourceTerms } from "./PluginTerms.ts";

const copyOn = (term: string) => ({ term, files: [] }) as unknown as IPluginDataExDisplay;
const list = [copyOn("desktop"), copyOn("phone"), copyOn("tablet")];
const differsOn =
    (...terms: string[]) =>
    (_local: IPluginDataExDisplay | undefined, remote: IPluginDataExDisplay | undefined) =>
        Promise.resolve(terms.includes(remote?.term ?? ""));

describe("selectSourceTerms", () => {
    it("offers every other device without comparing copies by default", async () => {
        const canApplyFrom = vi.fn(differsOn());
        const terms = await selectSourceTerms(
            list,
            "desktop",
            { isMaintenanceMode: false, hideNotApplicable: false },
            canApplyFrom
        );
        expect(terms).toEqual(["phone", "tablet"]);
        expect(canApplyFrom).not.toHaveBeenCalled();
    });

    it("offers every device, including this one, in maintenance mode", async () => {
        const terms = await selectSourceTerms(
            list,
            "desktop",
            { isMaintenanceMode: true, hideNotApplicable: true },
            differsOn()
        );
        expect(terms).toEqual(["desktop", "phone", "tablet"]);
    });

    it("leaves out devices whose copy is the same when hiding items that are not applicable", async () => {
        const terms = await selectSourceTerms(
            list,
            "desktop",
            { isMaintenanceMode: false, hideNotApplicable: true },
            differsOn("tablet")
        );
        expect(terms).toEqual(["tablet"]);
    });

    it("offers no source for an item that is the same on every device", async () => {
        const terms = await selectSourceTerms(
            list,
            "desktop",
            { isMaintenanceMode: false, hideNotApplicable: true },
            differsOn()
        );
        expect(terms).toEqual([]);
    });
});
