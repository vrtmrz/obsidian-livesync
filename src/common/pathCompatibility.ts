export const ANDROID_LINUX_PATH_COMPONENT_UTF8_WARNING_BOUNDARY = 255;

export interface OversizedPathComponent {
    component: string;
    utf8Bytes: number;
}

const utf8Encoder = new TextEncoder();

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
    return path
        .split("/")
        .filter((component) => component.length > 0)
        .map((component) => ({ component, utf8Bytes: utf8Encoder.encode(component).byteLength }))
        .filter(({ utf8Bytes }) => utf8Bytes > maxBytes);
}
