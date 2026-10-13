import { afterEach, describe, expect, it } from "vitest";
import { allMessages } from "./messages/combinedMessages.prod";
import { $msg, setLang } from "./translation";

function interpolationNames(message: string): string[] {
    return [...message.matchAll(/\$\{([^}]+)\}/g)].map((match) => match[1]).sort();
}

describe("Russian catalogue interpolation", () => {
    afterEach(() => setLang("def"));

    it("retains the English interpolation values in each translated message", () => {
        const mismatches = Object.entries(allMessages).flatMap(([key, messages]) => {
            if (!messages.def || !messages.ru) return [];
            const expected = interpolationNames(messages.def);
            const actual = interpolationNames(messages.ru);
            return JSON.stringify(actual) === JSON.stringify(expected) ? [] : [{ key, expected, actual }];
        });

        expect(mismatches).toEqual([]);
    });

    it("renders the generated QR image inside its display container", () => {
        setLang("ru");
        const qrImage = '<img src="data:image/png;base64,cXI=" alt="Fixture QR code">';

        const message = $msg("Setup.QRCode", { qr_image: qrImage });

        expect(message).toContain(`<div class="sls-qr">${qrImage}</div>`);
        expect(message).not.toContain("${qr_image}");
    });

    it("shows both generated keys in their individual and combined copy areas", () => {
        setLang("ru");
        const publicKey = "PUBLIC-KEY-FIXTURE";
        const privateKey = "PRIVATE-KEY-FIXTURE";

        const message = $msg("Setting.GenerateKeyPair.Desc", { public_key: publicKey, private_key: privateKey });

        expect(message.split(publicKey)).toHaveLength(3);
        expect(message.split(privateKey)).toHaveLength(3);
        expect(message).toContain(`${publicKey}\n${privateKey}`);
        expect(message).not.toMatch(/\$\{(?:public_key|private_key)\}/);
    });

    it("keeps the measured and configured database sizes in the comparison table", () => {
        setLang("ru");

        const message = $msg("moduleCheckRemoteSize.msgDatabaseGrowing", {
            estimatedSize: "123 MB",
            maxSize: "456 MB",
        });

        expect(message).toContain("| 123 MB | 456 MB |");
        expect(message).not.toMatch(/\$\{(?:estimatedSize|maxSize)\}/);
    });
});
