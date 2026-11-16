import { withOwnedResource, type DisposableResource } from "octagonal-wheels/resource";

/**
 * Run a finite operation with a flow-owned remote resource and release it
 * after either success or failure.
 *
 * Resource implementations make `dispose()` idempotent. This helper makes the
 * caller's ownership boundary explicit and prevents finite flows from leaking
 * a provider-owned resource when their operation rejects.
 */
export function withOwnedRemoteResource<TResource extends DisposableResource & { dispose(): Promise<void> }, TResult>(
    resource: TResource,
    operation: (ownedResource: TResource) => Promise<TResult>
): Promise<TResult> {
    return withOwnedResource(resource, operation);
}
