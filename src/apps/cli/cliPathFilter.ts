export function isHiddenPath(relativePath: string): boolean {
    return relativePath.split("/").some((part) => part.startsWith("."));
}
