import { stepCyclicIndex } from "octagonal-wheels/collection";

export function navigateDiffNodes(
    root: ParentNode,
    selector: string,
    navigation: {
        currentDiffIndex: number;
        diffNavIndicator: { setText(text: string): void };
    },
    direction: "prev" | "next"
): void {
    const diffElements = root.querySelectorAll<HTMLElement>(selector);
    if (diffElements.length === 0) return;

    const previousFocused = root.querySelector(".diff-focused");
    if (previousFocused) {
        previousFocused.classList.remove("diff-focused");
    }

    navigation.currentDiffIndex = stepCyclicIndex(navigation.currentDiffIndex, diffElements.length, direction);
    const target = diffElements[navigation.currentDiffIndex];
    target.classList.add("diff-focused");
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    navigation.diffNavIndicator.setText(`${navigation.currentDiffIndex + 1}/${diffElements.length}`);
}
