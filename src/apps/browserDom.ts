/**
 * Native DOM creation for browser applications which run outside Obsidian.
 *
 * Obsidian adds creation helpers to its own DOM environment. The standalone
 * Webapp and WebPeer hosts do not own those prototype extensions, and the
 * Webapp compatibility layer implements them on top of this native boundary.
 */
type NativeDocumentCreation = Pick<Document, "createElement" | "createDocumentFragment">;

export function createNativeElement<K extends keyof HTMLElementTagNameMap>(
    document: NativeDocumentCreation,
    tag: K
): HTMLElementTagNameMap[K];
export function createNativeElement(document: NativeDocumentCreation, tag: string): HTMLElement;
export function createNativeElement(document: NativeDocumentCreation, tag: string): HTMLElement {
    return document.createElement(tag);
}

export function createNativeFragment(document: NativeDocumentCreation): DocumentFragment {
    return document.createDocumentFragment();
}
