import { page } from "vitest/browser";
import { delay } from "@/lib/src/common/utils";

export async function waitForDialogShown(dialogText: string, timeout = 500) {
    const ttl = Date.now() + timeout;
    while (Date.now() < ttl) {
        try {
            await delay(50);
            const dialog = page
                .getByText(dialogText)
                .elements()
                .filter((e) => e.classList.contains("modal-title"))
                .filter((e) => e.checkVisibility());
            if (dialog.length === 0) {
                continue;
            }
            return true;
        } catch (e) {
            // Ignore
        }
    }
    return false;
}
export async function waitForDialogHidden(dialogText: string | RegExp, timeout = 500) {
    const ttl = Date.now() + timeout;
    while (Date.now() < ttl) {
        try {
            await delay(50);
            const dialog = page
                .getByText(dialogText)
                .elements()
                .filter((e) => e.classList.contains("modal-title"))
                .filter((e) => e.checkVisibility());
            if (dialog.length > 0) {
                // console.log(`Still exist ${dialogText.toString()}`);
                continue;
            }
            return true;
        } catch (e) {
            // Ignore
        }
    }
    return false;
}

export async function waitForButtonClick(buttonText: string | RegExp, timeout = 500) {
    const ttl = Date.now() + timeout;
    while (Date.now() < ttl) {
        try {
            await delay(100);
            const buttons = page
                .getByText(buttonText)
                .elements()
                .filter((e) => e.checkVisibility() && e.tagName.toLowerCase() == "button");
            if (buttons.length == 0) {
                // console.log(`Could not found ${buttonText.toString()}`);
                continue;
            }
            console.log(`Button detected: ${buttonText.toString()}`);
            // console.dir(buttons[0])
            await page.elementLocator(buttons[0]).click();
            await delay(100);
            return true;
        } catch (e) {
            console.error(e);
            // Ignore
        }
    }
    return false;
}
