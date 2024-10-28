export interface Confirm {
    askYesNo(message: string): Promise<"yes" | "no">;
    askString(title: string, key: string, placeholder: string, isPassword?: boolean): Promise<string | false>;

    askYesNoDialog(message: string, opt: { title?: string, defaultOption?: "Yes" | "No", timeout?: number }): Promise<"yes" | "no">;

    askSelectString(message: string, items: string[]): Promise<string>

    askSelectStringDialogue(message: string, buttons: string[], opt: { title?: string, defaultAction: (typeof buttons)[number], timeout?: number }): Promise<(typeof buttons)[number] | false>;

    askInPopup(key: string, dialogText: string, anchorCallback: (anchor: HTMLAnchorElement) => void): void;

    confirmWithMessage(title: string, contentMd: string, buttons: string[], defaultAction: (typeof buttons)[number], timeout?: number): Promise<(typeof buttons)[number] | false>;
}