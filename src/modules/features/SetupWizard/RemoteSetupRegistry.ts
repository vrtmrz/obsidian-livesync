import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type {
    BuiltInRemoteConfiguration,
    RemoteProviderConfiguration,
} from "@vrtmrz/livesync-commonlib/remote-configurations";
import type { ComponentHasResult } from "@/modules/services/LiveSyncUI/svelteDialog";

export type RemoteSetupIntent = "create-or-connect" | "connect-existing" | "settings";

export interface RemoteSetupDialogManager {
    openWithExplicitCancel<TResult, TInitial = TResult>(
        component: ComponentHasResult<TResult, TInitial>,
        initialData?: TInitial
    ): Promise<TResult>;
}

export interface RemoteSetupContext {
    readonly dialogManager: RemoteSetupDialogManager;
    readonly intent: RemoteSetupIntent;
    readonly settings: ObsidianLiveSyncSettings;
}

export interface RemoteSetupChoice<TType extends string = string> {
    readonly description: string;
    readonly proceedTitle: string;
    readonly title: string;
    readonly type: TType;
}

export interface RemoteSetupProviderDescriptor<
    TConfiguration extends RemoteProviderConfiguration = RemoteProviderConfiguration,
> {
    readonly type: TConfiguration["type"];
    choice(): Omit<RemoteSetupChoice<TConfiguration["type"]>, "type">;
    open(context: RemoteSetupContext): Promise<TConfiguration | "cancelled">;
}

/**
 * Host-side presentation for the remote providers compiled into this plug-in.
 *
 * Connection semantics remain in Commonlib's remote provider registry. This registry only owns
 * the Obsidian-specific choice text and setup dialogue for each provider.
 */
export class RemoteSetupRegistry<TConfiguration extends RemoteProviderConfiguration = BuiltInRemoteConfiguration> {
    private readonly providersByType = new Map<string, RemoteSetupProviderDescriptor<TConfiguration>>();
    private frozen = false;

    register<TProviderConfiguration extends TConfiguration>(
        descriptor: RemoteSetupProviderDescriptor<TProviderConfiguration>
    ): this {
        if (this.frozen) throw new Error("The remote setup registry is frozen");
        if (this.providersByType.has(descriptor.type)) {
            throw new Error(`Remote setup provider '${descriptor.type}' is already registered`);
        }
        this.providersByType.set(descriptor.type, descriptor);
        return this;
    }

    freeze(): this {
        this.frozen = true;
        return this;
    }

    isFrozen(): boolean {
        return this.frozen;
    }

    choices(): RemoteSetupChoice<TConfiguration["type"]>[] {
        return [...this.providersByType.values()].map((provider) => ({
            ...provider.choice(),
            type: provider.type,
        }));
    }

    has(type: string): type is TConfiguration["type"] {
        return this.providersByType.has(type);
    }

    open(type: TConfiguration["type"], context: RemoteSetupContext): Promise<TConfiguration | "cancelled"> {
        const provider = this.providersByType.get(type);
        if (!provider) throw new Error(`Unsupported remote setup provider: ${type}`);
        return provider.open(context);
    }
}
