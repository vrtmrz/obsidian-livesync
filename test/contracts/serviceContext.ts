import type { ServiceContextContract } from "@vrtmrz/livesync-commonlib/context";
import type { ServiceHub } from "@vrtmrz/livesync-commonlib/compat/services/ServiceHub";

export const SERVICE_CONTEXT_MEMBERS = [
    "API",
    "path",
    "database",
    "databaseEvents",
    "replicator",
    "fileProcessing",
    "replication",
    "remote",
    "conflict",
    "appLifecycle",
    "setting",
    "tweakValue",
    "vault",
    "test",
    "UI",
    "config",
    "keyValueDB",
    "control",
] as const satisfies readonly Exclude<keyof ServiceHub, "context">[];

export type ServiceContextMember = (typeof SERVICE_CONTEXT_MEMBERS)[number];
type MissingServiceContextMember = Exclude<Exclude<keyof ServiceHub, "context">, ServiceContextMember>;
const serviceContextMembersAreExhaustive: [MissingServiceContextMember] extends [never] ? true : never = true;
void serviceContextMembersAreExhaustive;

export type ServiceContextResult = {
    translation: string;
    receivedEvents: string[];
};

export type ServiceCompositionResult = {
    hubUsesExpectedContext: boolean;
    servicesUsingExpectedContext: Record<ServiceContextMember, boolean>;
};

/**
 * Observe the host-neutral results promised by ServiceContextContract.
 *
 * The caller chooses the translation key because translated text is
 * host-configured. Event delivery itself is shared behaviour.
 */
export function observeServiceContext(context: ServiceContextContract, translationKey: string): ServiceContextResult {
    const receivedEvents: string[] = [];
    const unsubscribe = context.events.onEvent("hello", (value) => receivedEvents.push(value));
    try {
        context.events.emitEvent("hello", "context-contract-event");
    } finally {
        unsubscribe();
    }
    return {
        translation: context.translate(translationKey),
        receivedEvents,
    };
}

/**
 * Inspect whether a Service Hub and all public services preserve one exact
 * context object instead of silently constructing or substituting another.
 */
export function observeServiceComposition(
    hub: { readonly context: ServiceContextContract },
    expectedContext: ServiceContextContract
): ServiceCompositionResult {
    const members = hub as unknown as Record<ServiceContextMember, { readonly context: ServiceContextContract }>;
    return {
        hubUsesExpectedContext: hub.context === expectedContext,
        servicesUsingExpectedContext: Object.fromEntries(
            SERVICE_CONTEXT_MEMBERS.map((member) => [member, members[member].context === expectedContext])
        ) as Record<ServiceContextMember, boolean>,
    };
}
