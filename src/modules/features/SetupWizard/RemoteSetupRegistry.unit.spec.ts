import { describe, expect, it, vi } from "vitest";
import { RemoteSetupRegistry, type RemoteSetupProviderDescriptor } from "./RemoteSetupRegistry";

type TestConfiguration =
    | { type: "alpha"; settings: { value: string } }
    | { type: "beta"; settings: { enabled: boolean } };

function alphaProvider(
    open: RemoteSetupProviderDescriptor<Extract<TestConfiguration, { type: "alpha" }>>["open"] = async () => ({
        type: "alpha",
        settings: { value: "configured" },
    })
): RemoteSetupProviderDescriptor<Extract<TestConfiguration, { type: "alpha" }>> {
    return {
        type: "alpha",
        choice: () => ({
            title: "Alpha",
            description: "Alpha description",
            proceedTitle: "Configure Alpha",
        }),
        open,
    };
}

describe("RemoteSetupRegistry", () => {
    it("preserves registration order and dispatches setup through the selected provider", async () => {
        const openAlpha = vi.fn(alphaProvider().open);
        const registry = new RemoteSetupRegistry<TestConfiguration>()
            .register(alphaProvider(openAlpha))
            .register({
                type: "beta",
                choice: () => ({
                    title: "Beta",
                    description: "Beta description",
                    proceedTitle: "Configure Beta",
                }),
                open: async () => ({ type: "beta", settings: { enabled: true } }),
            })
            .freeze();
        const context = {
            dialogManager: { openWithExplicitCancel: vi.fn() },
            intent: "settings" as const,
            settings: {} as never,
        };

        expect(registry.choices().map((choice) => choice.type)).toEqual(["alpha", "beta"]);
        await expect(registry.open("alpha", context)).resolves.toEqual({
            type: "alpha",
            settings: { value: "configured" },
        });
        expect(openAlpha).toHaveBeenCalledWith(context);
    });

    it("rejects duplicate and late registrations", () => {
        const registry = new RemoteSetupRegistry<TestConfiguration>().register(alphaProvider());

        expect(() => registry.register(alphaProvider())).toThrow("already registered");

        registry.freeze();
        expect(registry.isFrozen()).toBe(true);
        expect(() =>
            registry.register({
                type: "beta",
                choice: () => ({ title: "Beta", description: "", proceedTitle: "" }),
                open: async () => "cancelled",
            })
        ).toThrow("frozen");
    });
});
