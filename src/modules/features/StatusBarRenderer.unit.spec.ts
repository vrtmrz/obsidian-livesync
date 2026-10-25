import { describe, expect, it } from "vitest";

import { createStatusBarRenderer, type StatusBarPart } from "./StatusBarRenderer.ts";

type TestNode = TestElement | TestTextNode;

class TestDocument {
    mutations = 0;

    createElement(tagName: string): TestElement {
        return new TestElement(this, tagName);
    }

    createTextNode(data: string): TestTextNode {
        return new TestTextNode(this, data);
    }
}

class TestTextNode {
    readonly nodeType = 3;
    parentNode: TestElement | undefined;
    private currentData: string;

    constructor(
        private readonly document: TestDocument,
        data: string
    ) {
        this.currentData = data;
    }

    get data(): string {
        return this.currentData;
    }

    set data(value: string) {
        this.document.mutations++;
        this.currentData = value;
    }

    get textContent(): string {
        return this.currentData;
    }
}

class TestStyle {
    private properties = new Map<string, string>();

    constructor(private readonly document: TestDocument) {}

    getPropertyValue(name: string): string {
        return this.properties.get(name) ?? "";
    }

    setProperty(name: string, value: string) {
        this.document.mutations++;
        this.properties.set(name, value);
    }
}

class TestElement {
    readonly nodeType = 1;
    readonly ownerDocument: Document;
    readonly childNodes: TestNode[] = [];
    parentNode: TestElement | undefined;
    readonly style: TestStyle;
    private currentClassName = "";
    private currentHidden = false;
    private currentTitle = "";

    constructor(
        private readonly document: TestDocument,
        readonly tagName: string
    ) {
        this.ownerDocument = document as unknown as Document;
        this.style = new TestStyle(document);
    }

    get className(): string {
        return this.currentClassName;
    }

    set className(value: string) {
        this.document.mutations++;
        this.currentClassName = value;
    }

    get hidden(): boolean {
        return this.currentHidden;
    }

    set hidden(value: boolean) {
        this.document.mutations++;
        this.currentHidden = value;
    }

    get title(): string {
        return this.currentTitle;
    }

    set title(value: string) {
        this.document.mutations++;
        this.currentTitle = value;
    }

    get children(): TestElement[] {
        return this.childNodes.filter((node): node is TestElement => node instanceof TestElement);
    }

    get textContent(): string {
        return this.childNodes.map((node) => node.textContent ?? "").join("");
    }

    createSpan(): TestElement {
        return this.appendChild(this.document.createElement("span"));
    }

    setCssProps(properties: Record<string, string>) {
        for (const [name, value] of Object.entries(properties)) this.style.setProperty(name, value);
    }

    appendChild<T extends TestNode>(node: T): T {
        if (node.parentNode) {
            node.parentNode.removeChild(node);
        }
        this.childNodes.push(node);
        node.parentNode = this;
        this.document.mutations++;
        return node;
    }

    insertBefore<T extends TestNode>(node: T, reference: TestNode | null): T {
        if (node === reference) return node;
        if (node.parentNode) {
            node.parentNode.removeChild(node);
        }
        const index = reference ? this.childNodes.indexOf(reference) : -1;
        if (index < 0) {
            this.childNodes.push(node);
        } else {
            this.childNodes.splice(index, 0, node);
        }
        node.parentNode = this;
        this.document.mutations++;
        return node;
    }

    removeChild<T extends TestNode>(node: T): T {
        const index = this.childNodes.indexOf(node);
        if (index < 0) throw new Error("Node is not a child");
        this.childNodes.splice(index, 1);
        node.parentNode = undefined;
        this.document.mutations++;
        return node;
    }
}

function createFixture() {
    const document = new TestDocument();
    const root = new TestElement(document, "div");
    return { document, root, parent: root as unknown as HTMLElement };
}

function findItem(root: TestElement, key: string): TestElement {
    const item = root.children.find((child) => child.className.split(" ").includes("livesync-stat-" + key));
    if (!item) throw new Error("Missing item: " + key);
    return item;
}

function findValue(item: TestElement): TestElement {
    const value = item.children.find((child) => child.className.split(" ").includes("livesync-stat-value"));
    if (!value) throw new Error("Missing numeric value");
    return value;
}

function visibleItems(root: TestElement): TestElement[] {
    return root.children.filter((child) => !child.hidden && child.className.split(" ").includes("livesync-stat-item"));
}

describe("createStatusBarRenderer", () => {
    it("renders complete text safely and gives each item an independent class hook", () => {
        const { root, parent } = createFixture();
        const renderer = createStatusBarRenderer(parent);

        renderer.render([
            { key: "sync", text: "<sync>" },
            { key: "queue", text: " (queued: ", value: 2, suffix: ")" },
        ]);

        const sync = findItem(root, "sync");
        const queue = findItem(root, "queue");
        expect(sync.className.split(" ")).toEqual(["livesync-stat-item", "livesync-stat-sync"]);
        expect(sync.textContent).toBe("<sync>");
        expect(queue.className.split(" ")).toContain("livesync-stat-queue");
        expect(queue.textContent).toBe(" (queued: 2)");
        expect(findValue(queue).className).toBe("livesync-stat-value");

        renderer.render([{ key: "queue", text: " (queued: ", value: 3, suffix: ")" }]);
        expect(sync.hidden).toBe(true);
        expect(queue.hidden).toBe(false);
        expect(queue.textContent).toBe(" (queued: 3)");
        renderer.render([{ key: "queue", text: "Queue idle" }]);
        expect(queue.textContent).toBe("Queue idle");
        expect(findValue(queue).hidden).toBe(true);
        renderer.dispose();
    });

    it("does not mutate the DOM when the same parts are rendered again", () => {
        const { document, parent } = createFixture();
        const renderer = createStatusBarRenderer(parent);
        const parts: StatusBarPart[] = [
            { key: "pending", text: " pending ", value: 7, suffix: " files", title: "Pending" },
        ];

        renderer.render(parts);
        const mutations = document.mutations;
        renderer.render(parts);

        expect(document.mutations).toBe(mutations);
        renderer.dispose();
    });

    it("updates values while retaining the widest visible numeric width", () => {
        const { root, parent } = createFixture();
        const renderer = createStatusBarRenderer(parent);

        renderer.render([{ key: "count", text: "(", value: 9, suffix: ")" }]);
        const item = findItem(root, "count");
        const value = findValue(item);
        expect(item.textContent).toBe("(9)");
        expect(value.style.getPropertyValue("--livesync-stat-width")).toBe("1ch");

        renderer.render([{ key: "count", text: "(", value: 123, suffix: ")" }]);
        expect(value.textContent).toBe("123");
        expect(value.style.getPropertyValue("--livesync-stat-width")).toBe("3ch");

        renderer.render([{ key: "count", text: "(", value: 4, suffix: ")" }]);
        expect(value.textContent).toBe("4");
        expect(value.style.getPropertyValue("--livesync-stat-width")).toBe("3ch");
        renderer.dispose();
    });

    it("resets numeric width while omitted and reuses the same item when it returns", () => {
        const { root, parent } = createFixture();
        const renderer = createStatusBarRenderer(parent);

        renderer.render([{ key: "count", text: " ", value: 1234 }]);
        const item = findItem(root, "count");
        const value = findValue(item);
        expect(value.style.getPropertyValue("--livesync-stat-width")).toBe("4ch");

        renderer.render([]);
        expect(item.hidden).toBe(true);
        expect(value.style.getPropertyValue("--livesync-stat-width")).toBe("");

        renderer.render([{ key: "count", text: " ", value: 5 }]);
        expect(findItem(root, "count")).toBe(item);
        expect(item.hidden).toBe(false);
        expect(value.style.getPropertyValue("--livesync-stat-width")).toBe("1ch");
        renderer.dispose();
    });

    it("reorders existing nodes without replacing them", () => {
        const { root, parent } = createFixture();
        const renderer = createStatusBarRenderer(parent);
        renderer.render([
            { key: "first", text: "first " },
            { key: "second", text: "second " },
        ]);
        const first = findItem(root, "first");
        const second = findItem(root, "second");

        renderer.render([
            { key: "second", text: "second " },
            { key: "first", text: "first " },
        ]);

        expect(visibleItems(root)).toEqual([second, first]);
        expect(findItem(root, "first")).toBe(first);
        expect(findItem(root, "second")).toBe(second);
        renderer.dispose();
    });

    it("removes its nodes on dispose and ignores later renders", () => {
        const { root, parent } = createFixture();
        const externalNode = new TestElement(new TestDocument(), "strong");
        root.appendChild(externalNode);
        const renderer = createStatusBarRenderer(parent);
        renderer.render([{ key: "sync", text: "sync" }]);
        const item = findItem(root, "sync");

        renderer.dispose();
        const childCountAfterDispose = root.childNodes.length;
        renderer.dispose();
        renderer.render([{ key: "later", text: "later" }]);

        expect(item.parentNode).toBeUndefined();
        expect(root.childNodes).toEqual([externalNode]);
        expect(root.childNodes).toHaveLength(childCountAfterDispose);
    });
});
