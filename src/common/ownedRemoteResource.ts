/**
 * Run a finite operation with a flow-owned remote resource and release it
 * after either success or failure.
 *
 * Resource implementations make `dispose()` idempotent. This helper makes the
 * caller's ownership boundary explicit and prevents finite flows from leaking
 * a provider-owned resource when their operation rejects.
 */
export async function withOwnedRemoteResource<TResource extends { dispose(): Promise<void> }, TResult>(
    resource: TResource,
    operation: (ownedResource: TResource) => Promise<TResult>
): Promise<TResult> {
    try {
        return await operation(resource);
    } finally {
        await resource.dispose();
    }
}
