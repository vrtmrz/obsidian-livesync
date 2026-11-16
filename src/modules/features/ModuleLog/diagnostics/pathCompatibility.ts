import { findPathComponentsExceedingUtf8Limit as findKitPathComponentsExceedingUtf8Limit } from "octagonal-wheels/path";

export const ANDROID_LINUX_PATH_COMPONENT_UTF8_WARNING_BOUNDARY = 255;

export interface OversizedPathComponent {
    component: string;
    utf8Bytes: number;
}

/**
 * Return path components which exceed the conservative Android/Linux
 * compatibility boundary.
 *
 * Obsidian paths use forward slashes. The limit applies to each file or
 * folder name, not to the combined Vault-relative path.
 */
export function findPathComponentsExceedingUtf8Limit(
    path: string,
    maxBytes: number = ANDROID_LINUX_PATH_COMPONENT_UTF8_WARNING_BOUNDARY
): OversizedPathComponent[] {
    return findKitPathComponentsExceedingUtf8Limit(path, maxBytes);
}
