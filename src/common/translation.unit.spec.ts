import { afterEach, describe, expect, it } from "vitest";

import { englishMessageTranslator } from "@vrtmrz/livesync-commonlib/context";
import { $msg, setLang, translateLiveSyncMessage } from "@/common/translation";
import { SUPPORTED_I18N_LANGS } from "@/common/rosetta";

describe("LiveSync-owned translation catalogue", () => {
    afterEach(() => setLang("def"));

    it("selects a translated language without delegating catalogue ownership to Commonlib", () => {
        setLang("es");

        expect(translateLiveSyncMessage("moduleCheckRemoteSize.optionIncreaseLimit", { newMax: "800" })).toBe(
            "aumentar a 800MB"
        );
        expect(SUPPORTED_I18N_LANGS).toContain("es");
    });

    it("retains typed placeholder substitution", () => {
        expect($msg("moduleCheckRemoteSize.optionIncreaseLimit", { newMax: "800" }, "def")).toBe("increase to 800MB");
    });

    it("uses Commonlib's canonical English when the application catalogue has no translation", () => {
        setLang("es");

        expect(translateLiveSyncMessage("Active Remote Type")).toBe(englishMessageTranslator("Active Remote Type"));
    });

    it("uses LiveSync-owned provisional English without extending Commonlib's message contract", () => {
        expect($msg("This file has unresolved conflicts.")).toBe("This file has unresolved conflicts.");
        expect(
            $msg("This file has ${COUNT} unresolved versions. They will be reviewed one pair at a time.", {
                COUNT: "3",
            })
        ).toBe("This file has 3 unresolved versions. They will be reviewed one pair at a time.");
        expect(translateLiveSyncMessage("This file has unresolved conflicts.")).toBe(
            "This file has unresolved conflicts."
        );
    });
});
