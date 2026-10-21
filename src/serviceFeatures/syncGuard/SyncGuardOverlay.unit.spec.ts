import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncGuardOverlay } from "./SyncGuardOverlay";

class FakeDocument {
    activeElement: FakeElement | undefined;
    listeners = new Map<string, (event: KeyboardEvent) => void>();

    addEventListener(type: string, listener: (event: KeyboardEvent) => void): void {
        this.listeners.set(type, listener);
    }

    removeEventListener(type: string): void {
        this.listeners.delete(type);
    }
}

class FakeElement {
    readonly children: FakeElement[] = [];
    readonly handlers = new Map<string, () => void>();
    readonly attributes = new Map<string, string>();
    className = "";
    textContent = "";
    type = "";
    isConnected = true;
    parent: FakeElement | undefined;

    constructor(
        readonly ownerDocument: FakeDocument,
        readonly tagName: string
    ) {}

    createEl(tagName: string, options?: { cls?: string }): FakeElement {
        return this.append(new FakeElement(this.ownerDocument, tagName), options);
    }

    createDiv(options?: { cls?: string }): FakeElement {
        return this.createEl("div", options);
    }

    private append(child: FakeElement, options?: { cls?: string }): FakeElement {
        child.className = options?.cls ?? "";
        child.parent = this;
        this.children.push(child);
        return child;
    }

    setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
    }

    addEventListener(name: string, callback: () => void): void {
        this.handlers.set(name, callback);
    }

    contains(target: FakeElement): boolean {
        return target === this || this.children.some((child) => child.contains(target));
    }

    closest(selector: string): FakeElement | null {
        if (selector !== ".modal-container") return null;
        return this.className === "modal-container" ? this : (this.parent?.closest(selector) ?? null);
    }

    focus(): void {
        this.ownerDocument.activeElement = this;
    }

    remove(): void {
        if (!this.parent) return;
        const index = this.parent.children.indexOf(this);
        if (index >= 0) this.parent.children.splice(index, 1);
        this.isConnected = false;
    }
}

function setup() {
    vi.stubGlobal("HTMLElement", FakeElement);
    vi.stubGlobal("Element", FakeElement);
    vi.stubGlobal("Node", FakeElement);
    const doc = new FakeDocument();
    const workspace = new FakeElement(doc, "workspace");
    const editor = workspace.createEl("textarea");
    editor.focus();
    const bypass = vi.fn();
    const overlay = new SyncGuardOverlay(workspace as unknown as HTMLElement, bypass);
    return { overlay, doc, workspace, editor, bypass };
}

describe("SyncGuardOverlay", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("covers only the workspace, exposes a keyboard-operable bypass, and restores focus", () => {
        const { overlay, doc, workspace, editor, bypass } = setup();
        overlay.update({ phase: "observing", receivedFiles: 0 });
        expect(workspace.children).toHaveLength(1);
        overlay.update({ phase: "transferring", receivedFiles: 20 });
        const root = workspace.children[1];
        const panel = root.children[0];
        const button = panel.children[3];
        expect(root.attributes.get("role")).toBe("region");
        expect(button.tagName).toBe("button");
        expect(button.type).toBe("button");
        expect(doc.activeElement).toBe(button);
        expect(panel.children[2].textContent).toContain("20 changed files");
        button.handlers.get("click")?.();
        expect(bypass).toHaveBeenCalledOnce();
        overlay.update({ phase: "idle", receivedFiles: 20 });
        expect(workspace.children).toHaveLength(1);
        expect(doc.activeElement).toBe(editor);
        expect(doc.listeners.size).toBe(0);
    });

    it("prevents editor keyboard shortcuts while allowing navigation inside the guard", () => {
        const { overlay, doc, editor, workspace } = setup();
        overlay.update({ phase: "applying", receivedFiles: 25 });
        const button = workspace.children[1].children[0].children[3];
        const block = doc.listeners.get("keydown");
        const preventDefault = vi.fn();
        const stopImmediatePropagation = vi.fn();
        block?.({ target: editor, key: "x", preventDefault, stopImmediatePropagation } as unknown as KeyboardEvent);
        expect(preventDefault).toHaveBeenCalledOnce();
        expect(stopImmediatePropagation).toHaveBeenCalledOnce();
        block?.({ target: button, key: "Enter", preventDefault, stopImmediatePropagation } as unknown as KeyboardEvent);
        expect(preventDefault).toHaveBeenCalledOnce();
        overlay.dispose();
        expect(doc.listeners.size).toBe(0);
    });

    it("presents a safe offline bypass when the catch-up is interrupted", () => {
        const { overlay, workspace } = setup();
        overlay.update({ phase: "interrupted", receivedFiles: 30 });
        const panel = workspace.children[1].children[0];
        expect(panel.children[1].textContent).toContain("some notes may be out of date");
        overlay.dispose();
    });

    it("does not steal focus from an existing Obsidian dialogue", () => {
        const { overlay, doc, workspace } = setup();
        const modal = new FakeElement(doc, "div");
        modal.className = "modal-container";
        const modalInput = modal.createEl("input");
        modalInput.focus();
        overlay.update({ phase: "transferring", receivedFiles: 20 });
        expect(doc.activeElement).toBe(modalInput);
        const preventDefault = vi.fn();
        const stopImmediatePropagation = vi.fn();
        doc.listeners.get("keydown")?.({
            target: modalInput, key: "Escape", preventDefault, stopImmediatePropagation,
        } as unknown as KeyboardEvent);
        expect(preventDefault).not.toHaveBeenCalled();
        expect(stopImmediatePropagation).not.toHaveBeenCalled();
        overlay.dispose();
        expect(workspace.children).toHaveLength(1);
        expect(doc.activeElement).toBe(modalInput);
    });

    it("does not restore editor focus if a dialogue opened while the guard was active", () => {
        const { overlay, doc } = setup();
        overlay.update({ phase: "transferring", receivedFiles: 20 });
        const modal = new FakeElement(doc, "div");
        modal.className = "modal-container";
        const input = modal.createEl("input");
        input.focus();
        overlay.update({ phase: "idle", receivedFiles: 20 });
        expect(doc.activeElement).toBe(input);
    });

    it("keeps Tab and Shift+Tab on the bypass button rather than an editor behind the guard", () => {
        const { overlay, doc, workspace, editor } = setup();
        overlay.update({ phase: "transferring", receivedFiles: 20 });
        const button = workspace.children[1].children[0].children[3];
        for (const shiftKey of [false, true]) {
            const preventDefault = vi.fn();
            const stopImmediatePropagation = vi.fn();
            doc.listeners.get("keydown")?.({
                target: button, key: "Tab", shiftKey, preventDefault, stopImmediatePropagation,
            } as unknown as KeyboardEvent);
            expect(preventDefault).toHaveBeenCalledOnce();
            expect(stopImmediatePropagation).toHaveBeenCalledOnce();
            expect(doc.activeElement).toBe(button);
        }
        const preventDefault = vi.fn();
        const stopImmediatePropagation = vi.fn();
        doc.listeners.get("keydown")?.({
            target: editor, key: "Tab", preventDefault, stopImmediatePropagation,
        } as unknown as KeyboardEvent);
        expect(preventDefault).toHaveBeenCalledOnce();
        expect(doc.activeElement).toBe(button);
        overlay.dispose();
    });

    it("blocks mobile beforeinput and paste into hidden editors but permits input in Obsidian dialogues", () => {
        const { overlay, doc, editor } = setup();
        overlay.update({ phase: "transferring", receivedFiles: 30 });
        const modal = new FakeElement(doc, "div");
        modal.className = "modal-container";
        const input = modal.createEl("input");
        for (const eventType of ["beforeinput", "paste", "drop"]) {
            const preventDefault = vi.fn();
            const stopImmediatePropagation = vi.fn();
            doc.listeners.get(eventType)?.({
                target: editor, preventDefault, stopImmediatePropagation,
            } as unknown as KeyboardEvent);
            expect(preventDefault).toHaveBeenCalledOnce();
            expect(stopImmediatePropagation).toHaveBeenCalledOnce();

            doc.listeners.get(eventType)?.({
                target: input, preventDefault, stopImmediatePropagation,
            } as unknown as KeyboardEvent);
            expect(preventDefault).toHaveBeenCalledOnce();
        }
        overlay.dispose();
        expect(doc.listeners.size).toBe(0);
    });
});
