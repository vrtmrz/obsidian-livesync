import { KeyedNoticeGroupManager } from "@vrtmrz/obsidian-plugin-kit/notice";

export interface ObsidianNoticeGroupItem {
    message: string;
    action?: {
        label: string;
        onSelect: () => void;
    };
}

interface KeyedNoticeGroupDriver {
    setItem(groupKey: string, itemKey: string, item: ObsidianNoticeGroupItem): unknown;
    finish(groupKey: string, options?: { durationMs?: number | false }): boolean;
    removeItem(groupKey: string, itemKey: string): boolean;
    hide(groupKey: string): boolean;
    dispose(): void;
}

/** Obsidian-owned interactive Notice capability exposed through the application Context. */
export interface ObsidianNoticeGroups {
    setItem(groupKey: string, itemKey: string, item: ObsidianNoticeGroupItem): void;
    finish(groupKey: string, options?: { durationMs?: number | false }): boolean;
    removeItem(groupKey: string, itemKey: string): boolean;
    hide(groupKey: string): boolean;
    dispose(): void;
}

/** Adapts Fancy Kit grouped Notices without exposing Obsidian Notice instances to features. */
export class ObsidianNoticeGroupManager implements ObsidianNoticeGroups {
    constructor(private readonly manager: KeyedNoticeGroupDriver = new KeyedNoticeGroupManager()) {}

    setItem(groupKey: string, itemKey: string, item: ObsidianNoticeGroupItem): void {
        this.manager.setItem(groupKey, itemKey, item);
    }

    finish(groupKey: string, options?: { durationMs?: number | false }): boolean {
        return this.manager.finish(groupKey, options);
    }

    removeItem(groupKey: string, itemKey: string): boolean {
        return this.manager.removeItem(groupKey, itemKey);
    }

    hide(groupKey: string): boolean {
        return this.manager.hide(groupKey);
    }

    dispose(): void {
        this.manager.dispose();
    }
}
