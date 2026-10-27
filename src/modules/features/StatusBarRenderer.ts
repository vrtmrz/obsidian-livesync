const INACTIVE_CLASS = "livesync-stat-inactive";

export type StatusBarPart = {
    key: string;
    text: string;
    value?: number;
    suffix?: string;
    title?: string;
};

export type StatusBarRenderer = {
    render(parts: readonly StatusBarPart[]): void;
    dispose(): void;
};

type RenderedItem = {
    element: HTMLSpanElement;
    prefix: Text;
    value: HTMLSpanElement;
    valueText: Text;
    suffix: Text;
    widestValueLength: number;
};

export function createStatusBarRenderer(parent: HTMLElement): StatusBarRenderer {
    const items = new Map<string, RenderedItem>();
    let disposed = false;

    const setText = (node: Text, text: string) => {
        if (node.data !== text) node.data = text;
    };

    const setHidden = (element: HTMLElement, hidden: boolean) => {
        if (element.hidden !== hidden) element.hidden = hidden;
    };

    const setInactive = (element: HTMLElement, inactive: boolean) => {
        if (element.classList.contains(INACTIVE_CLASS) === inactive) return;
        element.classList.toggle(INACTIVE_CLASS, inactive);
        if (inactive) element.setAttribute("aria-hidden", "true");
        else element.removeAttribute("aria-hidden");
    };

    const setWidth = (element: HTMLElement, width: string) => {
        if (element.style.getPropertyValue("--livesync-stat-width") !== width) {
            element.setCssProps({ "--livesync-stat-width": width });
        }
    };

    const createItem = (key: string): RenderedItem => {
        const document = parent.ownerDocument;
        const element = parent.createSpan();
        element.className = "livesync-stat-item livesync-stat-" + key;

        const prefix = document.createTextNode("");
        const value = element.createSpan();
        value.className = "livesync-stat-value";
        const valueText = document.createTextNode("");
        value.appendChild(valueText);
        value.hidden = true;
        const suffix = document.createTextNode("");

        element.appendChild(prefix);
        element.appendChild(value);
        element.appendChild(suffix);

        const item = { element, prefix, value, valueText, suffix, widestValueLength: 0 };
        items.set(key, item);
        return item;
    };

    const updateItem = (item: RenderedItem, part: StatusBarPart) => {
        setText(item.prefix, part.text);
        const title = part.title ?? "";
        if (item.element.title !== title) item.element.title = title;

        if (part.value === undefined) {
            setText(item.valueText, "");
            setText(item.suffix, "");
            setHidden(item.value, true);
            setWidth(item.value, "");
            item.widestValueLength = 0;
            return;
        }

        const formattedValue = String(part.value);
        setText(item.valueText, formattedValue);
        setText(item.suffix, part.suffix ?? "");
        setHidden(item.value, false);

        if (formattedValue.length > item.widestValueLength) {
            item.widestValueLength = formattedValue.length;
            const width = item.widestValueLength + "ch";
            setWidth(item.value, width);
        }
    };

    const reorderIfNeeded = (visibleItems: readonly RenderedItem[]) => {
        const desiredOrder = visibleItems.map((item) => item.element);
        const visibleElements = new Set(desiredOrder);
        const currentOrder = Array.from(parent.childNodes).filter((node): node is HTMLSpanElement =>
            visibleElements.has(node as HTMLSpanElement)
        );
        if (
            currentOrder.length === desiredOrder.length &&
            currentOrder.every((node, index) => node === desiredOrder[index])
        )
            return;

        let reference: ChildNode | null = currentOrder[0] ?? null;
        for (const element of desiredOrder) {
            if (element !== reference) parent.insertBefore(element, reference);
            const childNodes = Array.from(parent.childNodes);
            const elementIndex = childNodes.indexOf(element);
            reference =
                childNodes.slice(elementIndex + 1).find((node) => visibleElements.has(node as HTMLSpanElement)) ?? null;
        }
    };

    return {
        render(parts) {
            if (disposed) return;

            const visibleItems: RenderedItem[] = [];
            const visibleKeys = new Set<string>();
            for (const part of parts) {
                let item = items.get(part.key);
                if (!item) item = createItem(part.key);
                if (item.element.classList.contains(INACTIVE_CLASS)) item.widestValueLength = 0;
                updateItem(item, part);
                setInactive(item.element, false);
                visibleItems.push(item);
                visibleKeys.add(part.key);
            }

            for (const [key, item] of items) {
                if (visibleKeys.has(key)) continue;
                setInactive(item.element, true);
            }

            reorderIfNeeded(visibleItems);
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            for (const item of items.values()) {
                if (item.element.parentNode === parent) parent.removeChild(item.element);
            }
            items.clear();
        },
    };
}
