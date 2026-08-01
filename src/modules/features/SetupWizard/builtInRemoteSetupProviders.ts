import type { BucketSyncSetting, P2PSyncSetting } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { BuiltInRemoteConfiguration } from "@vrtmrz/livesync-commonlib/remote-configurations";
import { defaultRemoteProviderRegistry } from "@vrtmrz/livesync-commonlib/remote-configurations";
import { $msg as translateMessage } from "@/common/translation";
import SetupRemoteBucket from "./dialogs/SetupRemoteBucket.svelte";
import SetupRemoteCouchDB from "./dialogs/SetupRemoteCouchDB.svelte";
import SetupRemoteP2P from "./dialogs/SetupRemoteP2P.svelte";
import SetupRemotePostgREST from "./dialogs/SetupRemotePostgREST.svelte";
import SetupRemoteWebDAV from "./dialogs/SetupRemoteWebDAV.svelte";
import type {
    SetupRemoteBucketResultType,
    SetupRemoteCouchDBInitialData,
    SetupRemoteCouchDBResultType,
    SetupRemoteP2PResultType,
    SetupRemotePostgRESTInitialData,
    SetupRemotePostgRESTResultType,
    SetupRemoteWebDAVInitialData,
    SetupRemoteWebDAVResultType,
} from "./dialogs/setupDialogTypes";
import { RemoteSetupRegistry, type RemoteSetupProviderDescriptor } from "./RemoteSetupRegistry";

type ConfigurationOf<TType extends BuiltInRemoteConfiguration["type"]> = Extract<
    BuiltInRemoteConfiguration,
    { type: TType }
>;

function assertSemanticProvider(type: BuiltInRemoteConfiguration["type"]): void {
    const isRegistered = defaultRemoteProviderRegistry.providerSummaries().some((provider) => provider.type === type);
    if (!isRegistered) throw new Error(`Remote setup provider '${type}' has no Commonlib provider`);
}

export function useCouchDBRemoteSetup(
    registry: RemoteSetupRegistry<BuiltInRemoteConfiguration>
): RemoteSetupRegistry<BuiltInRemoteConfiguration> {
    const descriptor: RemoteSetupProviderDescriptor<ConfigurationOf<"couchdb">> = {
        type: "couchdb",
        choice: () => ({
            title: "CouchDB",
            description: translateMessage("Ui.SetupWizard.SetupRemote.CouchDbOptionDesc"),
            proceedTitle: translateMessage("Continue to CouchDB setup"),
        }),
        open: async ({ dialogManager, intent, settings }) => {
            const result = await dialogManager.openWithExplicitCancel<
                SetupRemoteCouchDBResultType,
                SetupRemoteCouchDBInitialData
            >(SetupRemoteCouchDB, { settings, mode: intent });
            return result === "cancelled" ? result : { type: "couchdb", settings: result };
        },
    };
    assertSemanticProvider(descriptor.type);
    return registry.register(descriptor);
}

export function useS3RemoteSetup(
    registry: RemoteSetupRegistry<BuiltInRemoteConfiguration>
): RemoteSetupRegistry<BuiltInRemoteConfiguration> {
    const descriptor: RemoteSetupProviderDescriptor<ConfigurationOf<"s3">> = {
        type: "s3",
        choice: () => ({
            title: translateMessage("Ui.SetupWizard.SetupRemote.BucketOption"),
            description: translateMessage("Ui.SetupWizard.SetupRemote.BucketOptionDesc"),
            proceedTitle: translateMessage("Ui.SetupWizard.SetupRemote.ProceedBucket"),
        }),
        open: async ({ dialogManager, settings }) => {
            const result = await dialogManager.openWithExplicitCancel<SetupRemoteBucketResultType, BucketSyncSetting>(
                SetupRemoteBucket,
                settings
            );
            return result === "cancelled" ? result : { type: "s3", settings: result };
        },
    };
    assertSemanticProvider(descriptor.type);
    return registry.register(descriptor);
}

export function useP2PRemoteSetup(
    registry: RemoteSetupRegistry<BuiltInRemoteConfiguration>
): RemoteSetupRegistry<BuiltInRemoteConfiguration> {
    const descriptor: RemoteSetupProviderDescriptor<ConfigurationOf<"p2p">> = {
        type: "p2p",
        choice: () => ({
            title: translateMessage("Ui.SetupWizard.SetupRemote.P2POption"),
            description: translateMessage(
                "No central data-storage server is required, but a signalling relay is required for peer discovery. Both devices must be online at the same time. Vault data travels through the encrypted P2P connection, not through the signalling relay. Some features may be limited."
            ),
            proceedTitle: translateMessage("Ui.SetupWizard.SetupRemote.ProceedP2P"),
        }),
        open: async ({ dialogManager, settings }) => {
            const result = await dialogManager.openWithExplicitCancel<SetupRemoteP2PResultType, P2PSyncSetting>(
                SetupRemoteP2P,
                settings
            );
            return result === "cancelled" ? result : { type: "p2p", settings: result };
        },
    };
    assertSemanticProvider(descriptor.type);
    return registry.register(descriptor);
}

export function useWebDAVRemoteSetup(
    registry: RemoteSetupRegistry<BuiltInRemoteConfiguration>
): RemoteSetupRegistry<BuiltInRemoteConfiguration> {
    const descriptor: RemoteSetupProviderDescriptor<ConfigurationOf<"webdav">> = {
        type: "webdav",
        choice: () => ({
            title: translateMessage("WebDAV Journal"),
            description: translateMessage(
                "Store Journal data in a dedicated WebDAV collection. Adaptive mode is experimental and requires an endpoint safety check."
            ),
            proceedTitle: translateMessage("Continue to WebDAV setup"),
        }),
        open: async ({ dialogManager, intent, settings }) => {
            const result = await dialogManager.openWithExplicitCancel<
                SetupRemoteWebDAVResultType,
                SetupRemoteWebDAVInitialData
            >(SetupRemoteWebDAV, {
                settings,
                mode: intent === "settings" ? "settings" : "onboarding",
            });
            return result === "cancelled" ? result : { type: "webdav", settings: result };
        },
    };
    assertSemanticProvider(descriptor.type);
    return registry.register(descriptor);
}

export function usePostgRESTRemoteSetup(
    registry: RemoteSetupRegistry<BuiltInRemoteConfiguration>
): RemoteSetupRegistry<BuiltInRemoteConfiguration> {
    const descriptor: RemoteSetupProviderDescriptor<ConfigurationOf<"postgrest">> = {
        type: "postgrest",
        choice: () => ({
            title: translateMessage("PostgREST Journal"),
            description: translateMessage(
                "Store Adaptive Journal records through the packaged PostgREST SQL contract. This experimental provider requires a provisioned Vault credential, and onboarding requires a successful server capability check."
            ),
            proceedTitle: translateMessage("Continue to PostgREST setup"),
        }),
        open: async ({ dialogManager, intent, settings }) => {
            const result = await dialogManager.openWithExplicitCancel<
                SetupRemotePostgRESTResultType,
                SetupRemotePostgRESTInitialData
            >(SetupRemotePostgREST, {
                settings,
                mode: intent === "settings" ? "settings" : "onboarding",
            });
            return result === "cancelled" ? result : { type: "postgrest", settings: result };
        },
    };
    assertSemanticProvider(descriptor.type);
    return registry.register(descriptor);
}

export function createBuiltInRemoteSetupRegistry(): RemoteSetupRegistry<BuiltInRemoteConfiguration> {
    const registry = new RemoteSetupRegistry<BuiltInRemoteConfiguration>();
    useCouchDBRemoteSetup(registry);
    useS3RemoteSetup(registry);
    useWebDAVRemoteSetup(registry);
    usePostgRESTRemoteSetup(registry);
    useP2PRemoteSetup(registry);
    return registry;
}

export const builtInRemoteSetupRegistry = createBuiltInRemoteSetupRegistry().freeze();
