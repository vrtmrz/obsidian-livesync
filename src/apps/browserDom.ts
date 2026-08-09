/**
 * Native DOM creation for browser applications which run outside Obsidian.
 *
 * Obsidian adds creation helpers to its own DOM environment. The standalone
 * WebApp and WebPeer hosts use this native boundary instead of installing
 * Obsidian-shaped prototype extensions.
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
