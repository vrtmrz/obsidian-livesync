export function hasExactCaseOnlyRename(entries: readonly string[], oldName: string, newName: string): boolean {
    return entries.includes(newName) && !entries.includes(oldName);
}
