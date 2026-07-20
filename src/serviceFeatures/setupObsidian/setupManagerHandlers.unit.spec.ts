import { describe, expect, it, vi, afterEach } from "vitest";
import {
    EVENT_REQUEST_OPEN_P2P_SETTINGS,
    EVENT_REQUEST_OPEN_SETUP_URI,
} from "@vrtmrz/livesync-commonlib/compat/events/coreEvents";
import {
    openOnboarding,
    openP2PSettings,
    openSetupURI,
    showOnboardingInvitation,
    useSetupManagerHandlersFeature,
} from "./setupManagerHandlers";

vi.mock("@/modules/features/SetupManager", () => {
    return {
        UserMode: {
            Unknown: "unknown",
            Update: "unknown",
        },
    };
});

describe("setupObsidian/setupManagerHandlers", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it("openSetupURI should delegate to SetupManager.onUseSetupURI", async () => {
        const setupManager = {
            onUseSetupURI: vi.fn(async () => await Promise.resolve(true)),
        } as any;

        await openSetupURI(setupManager);
        expect(setupManager.onUseSetupURI).toHaveBeenCalledWith("unknown");
    });

    it("openP2PSettings should delegate to SetupManager.onP2PManualSetup", async () => {
        const settings = { x: 1 };
        const host = {
            services: {
                setting: {
                    currentSettings: vi.fn(() => settings),
                },
            },
        } as any;
        const setupManager = {
            onP2PManualSetup: vi.fn(async () => await Promise.resolve(true)),
        } as any;

        await openP2PSettings(host, setupManager);
        expect(setupManager.onP2PManualSetup).toHaveBeenCalledWith("unknown", settings, false);
    });

    it("openOnboarding should delegate to SetupManager.startOnBoarding", async () => {
        const setupManager = {
            startOnBoarding: vi.fn(async () => await Promise.resolve(false)),
        } as any;

        await openOnboarding(setupManager);

        expect(setupManager.startOnBoarding).toHaveBeenCalledOnce();
    });

    it("showOnboardingInvitation should wait for its fixed action link before opening onboarding", async () => {
        let configureAnchor: ((anchor: HTMLAnchorElement) => void) | undefined;
        const askInPopup = vi.fn(
            (_key: string, _text: string, callback: (anchor: HTMLAnchorElement) => void, _durationMs?: number) => {
                configureAnchor = callback;
            }
        );
        const host = {
            services: {
                UI: { confirm: { askInPopup } },
            },
        } as any;
        const setupManager = {
            startOnBoarding: vi.fn(async () => await Promise.resolve(false)),
        } as any;

        showOnboardingInvitation(host, setupManager);

        expect(setupManager.startOnBoarding).not.toHaveBeenCalled();
        expect(askInPopup).toHaveBeenCalledWith(
            "initial-onboarding",
            expect.stringContaining("{HERE}"),
            expect.any(Function),
            60_000
        );

        let click: ((event: { preventDefault(): void }) => void) | undefined;
        const addClass = vi.fn();
        const anchor = {
            href: "",
            textContent: "",
            classList: { add: addClass },
            addEventListener: vi.fn((_name: string, listener: typeof click) => {
                click = listener;
            }),
        } as unknown as HTMLAnchorElement;
        configureAnchor!(anchor);

        expect(anchor.href).toBe("#");
        expect(anchor.textContent).toBe("Start setup");
        expect(addClass).toHaveBeenCalledWith("sls-onboarding-invitation-action");
        const preventDefault = vi.fn();
        click!({ preventDefault });
        await vi.waitFor(() => expect(setupManager.startOnBoarding).toHaveBeenCalledOnce());
        expect(preventDefault).toHaveBeenCalledOnce();
    });

    it("useSetupManagerHandlersFeature should register onLoaded handler that wires command and events", async () => {
        const addHandler = vi.fn();
        const addCommand = vi.fn();
        const events = { onEvent: vi.fn() };

        const host = {
            services: {
                context: { events },
                API: {
                    addCommand,
                },
                UI: {
                    confirm: {
                        askInPopup: vi.fn(),
                    },
                },
                appLifecycle: {
                    onLoaded: {
                        addHandler,
                    },
                },
                setting: {
                    currentSettings: vi.fn(() => ({ x: 1 })),
                },
            },
        } as any;
        const setupManager = {
            startOnBoarding: vi.fn(async () => await Promise.resolve(false)),
            onUseSetupURI: vi.fn(async () => await Promise.resolve(true)),
            onP2PManualSetup: vi.fn(async () => await Promise.resolve(true)),
        } as any;

        useSetupManagerHandlersFeature(host, setupManager);
        expect(addHandler).toHaveBeenCalledTimes(1);

        const loadedHandler = addHandler.mock.calls[0][0] as () => Promise<boolean>;
        await loadedHandler();

        expect(addCommand).toHaveBeenCalledWith(
            expect.objectContaining({
                id: "livesync-open-onboarding",
                name: "Open onboarding wizard",
            })
        );
        expect(addCommand).toHaveBeenCalledWith(
            expect.objectContaining({
                id: "livesync-opensetupuri",
                name: "Use the copied setup URI (Formerly Open setup URI)",
            })
        );
        expect(events.onEvent).toHaveBeenCalledWith(EVENT_REQUEST_OPEN_SETUP_URI, expect.any(Function));
        expect(events.onEvent).toHaveBeenCalledWith(EVENT_REQUEST_OPEN_P2P_SETTINGS, expect.any(Function));
    });
});
