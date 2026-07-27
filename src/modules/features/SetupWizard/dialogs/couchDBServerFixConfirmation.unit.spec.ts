import { describe, expect, it } from "vitest";
import { getCouchDBServerFixConfirmation } from "./couchDBServerFixConfirmation";

describe("CouchDB server requirement fixes", () => {
    it("identifies the exact server setting and value before a fix is applied", () => {
        expect(getCouchDBServerFixConfirmation("chttpd/require_valid_user", "true")).toEqual({
            title: "Change CouchDB server setting",
            message: "Change CouchDB server setting 'chttpd/require_valid_user' to 'true'?",
        });
    });
});
