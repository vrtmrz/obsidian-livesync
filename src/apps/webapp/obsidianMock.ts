/**
 * Legacy Obsidian API compatibility implementation used only by the Webapp build.
 *
 * This file moved from the retired browser test Harness to make its current ownership explicit. It is not a faithful
 * Obsidian mock, and must not become a general test environment for the plug-in. When the Webapp compatibility boundary
 * is redesigned, replace this implementation here rather than extending it as a shared Obsidian simulation.
 */
import { createNativeElement, createNativeFragment } from "@/apps/browserDom";
import type {
    Command,
    DataWriteOptions,
    ListedFiles,
    MarkdownFileInfo,
    PluginManifest,
    RequestUrlParam,
    RequestUrlResponse,
    ValueComponent,
} from "obsidian";

export type {
    DataWriteOptions,
    ListedFiles,
    MarkdownFileInfo,
    PluginManifest,
    RequestUrlParam,
    RequestUrlResponse,
    ValueComponent,
};

type EventCallback = (...args: unknown[]) => unknown;

declare global {
    interface Window {
        activeDocument: Document;
    }
}

export const SettingCache = new Map<object, unknown>();
window.activeDocument = document;

declare const hostPlatform: string | undefined;

Reflect.set(window, "process", {
    platform: hostPlatform || "win32",
});
export class TAbstractFile {
    vault: Vault;
    path: string;
    name: string;
    parent: TFolder | null;

    constructor(vault: Vault, path: string, name: string, parent: TFolder | null) {
        this.vault = vault;
        this.path = path;
        this.name = name;
        this.parent = parent;
    }
}

export class TFile extends TAbstractFile {
    stat: {
        ctime: number;
        mtime: number;
        size: number;
    } = { ctime: Date.now(), mtime: Date.now(), size: 0 };

    get extension(): string {
        return this.name.split(".").pop() || "";
    }

    get basename(): string {
        const parts = this.name.split(".");
        if (parts.length > 1) parts.pop();
        return parts.join(".");
    }
}

export class TFolder extends TAbstractFile {
    children: TAbstractFile[] = [];

    get isRoot(): boolean {
        return this.path === "" || this.path === "/";
    }
}

export class EventRef {
    constructor(
        readonly name: string,
        readonly callback: EventCallback
    ) {}
}

// class StorageMap<T, U> extends Map<T, U> {
//     constructor(saveName?: string) {
//         super();
//         if (saveName) {
//             this.saveName = saveName;
//             void this.restore(saveName);
//         }
//     }
//     private saveName: string = "";
//     async restore(saveName: string) {
//         this.saveName = saveName;
//         const db = await OpenKeyValueDatabase(saveName);
//         const data = await db.get<{ [key: string]: U }>("data");
//         if (data) {
//             for (const key of Object.keys(data)) {
//                 this.set(key as any as T, data[key]);
//             }
//         }
//         db.close();
//         return this;
//     }
//     saving: boolean = false;
//     async save() {
//         if (this.saveName === "") {
//             return;
//         }
//         if (this.saving) {
//             return;
//         }
//         try {
//             this.saving = true;

//             const db = await OpenKeyValueDatabase(this.saveName);
//             const data: { [key: string]: U } = {};
//             for (const [key, value] of this.entries()) {
//                 data[key as any as string] = value;
//             }
//             await db.set("data", data);
//             db.close();
//         } finally {
//             this.saving = false;
//         }
//     }
//     set(key: T, value: U): this {
//         super.set(key, value);
//         void this.save();
//         return this;
//     }

// }

export class Vault {
    adapter: DataAdapter;
    vaultName: string = "MockVault";
    private files: Map<string, TAbstractFile> = new Map();
    private contents: Map<string, string | ArrayBuffer> = new Map();
    private root: TFolder;
    private listeners: Map<string, Set<EventCallback>> = new Map();

    constructor(vaultName?: string) {
        if (vaultName) {
            this.vaultName = vaultName;
        }
        this.files = new Map();
        this.contents = new Map();
        this.adapter = new DataAdapter(this);
        this.root = new TFolder(this, "", "", null);
        this.files.set("", this.root);
    }

    getAbstractFileByPath(path: string): TAbstractFile | null {
        if (path === "/") path = "";
        const file = this.files.get(path);
        return file || null;
    }
    getAbstractFileByPathInsensitive(path: string): TAbstractFile | null {
        const lowerPath = path.toLowerCase();
        for (const [p, file] of this.files.entries()) {
            if (p.toLowerCase() === lowerPath) {
                return file;
            }
        }
        return null;
    }

    getFiles(): TFile[] {
        return Array.from(this.files.values()).filter((f) => f instanceof TFile);
    }

    async _adapterRead(path: string): Promise<string | null> {
        await Promise.resolve();
        const file = this.contents.get(path);
        if (typeof file === "string") {
            return file;
        }
        if (file instanceof ArrayBuffer) {
            return new TextDecoder().decode(file);
        }
        return null;
    }

    async _adapterReadBinary(path: string): Promise<ArrayBuffer | null> {
        await Promise.resolve();
        const file = this.contents.get(path);
        if (file instanceof ArrayBuffer) {
            return file;
        }
        if (typeof file === "string") {
            return new TextEncoder().encode(file).buffer;
        }
        return null;
    }

    async read(file: TFile): Promise<string> {
        await Promise.resolve();
        const content = this.contents.get(file.path);
        if (typeof content === "string") return content;
        if (content instanceof ArrayBuffer) {
            return new TextDecoder().decode(content);
        }
        return "";
    }

    async readBinary(file: TFile): Promise<ArrayBuffer> {
        await Promise.resolve();
        const content = this.contents.get(file.path);
        if (content instanceof ArrayBuffer) return content;
        if (typeof content === "string") {
            return new TextEncoder().encode(content).buffer;
        }
        return new ArrayBuffer(0);
    }

    private async _create(path: string, data: string | ArrayBuffer, options?: DataWriteOptions): Promise<TFile> {
        if (this.files.has(path)) throw new Error("File already exists");
        const name = path.split("/").pop() || "";
        const parentPath = path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : "";
        const existingParent = this.getAbstractFileByPath(parentPath);
        const parent = existingParent instanceof TFolder ? existingParent : await this.createFolder(parentPath);

        const file = new TFile(this, path, name, parent);
        file.stat.size = typeof data === "string" ? new TextEncoder().encode(data).length : data.byteLength;
        file.stat.ctime = options?.ctime ?? Date.now();
        file.stat.mtime = options?.mtime ?? Date.now();
        this.files.set(path, file);
        this.contents.set(path, data);
        parent.children.push(file);

        this.trigger("create", file);
        return file;
    }
    async create(path: string, data: string, options?: DataWriteOptions): Promise<TFile> {
        return await this._create(path, data, options);
    }
    async createBinary(path: string, data: ArrayBuffer, options?: DataWriteOptions): Promise<TFile> {
        return await this._create(path, data, options);
    }

    async _modify(file: TFile, data: string | ArrayBuffer, options?: DataWriteOptions): Promise<void> {
        await Promise.resolve();
        this.contents.set(file.path, data);
        file.stat.mtime = options?.mtime ?? Date.now();
        file.stat.ctime = options?.ctime ?? file.stat.ctime ?? Date.now();
        file.stat.size = typeof data === "string" ? data.length : data.byteLength;
        this.files.set(file.path, file);
        this.trigger("modify", file);
    }
    async modify(file: TFile, data: string, options?: DataWriteOptions): Promise<void> {
        return await this._modify(file, data, options);
    }
    async modifyBinary(file: TFile, data: ArrayBuffer, options?: DataWriteOptions): Promise<void> {
        return await this._modify(file, data, options);
    }

    async createFolder(path: string): Promise<TFolder> {
        if (path === "") return this.root;
        if (this.files.has(path)) {
            const f = this.files.get(path);
            if (f instanceof TFolder) return f;
            throw new Error("Path is a file");
        }
        const name = path.split("/").pop() || "";
        const parentPath = path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : "";
        const parent = await this.createFolder(parentPath);
        const folder = new TFolder(this, path, name, parent);
        this.files.set(path, folder);
        parent.children.push(folder);
        return folder;
    }

    async delete(file: TAbstractFile, force?: boolean): Promise<void> {
        return this.removeFile(file);
    }

    async trash(file: TAbstractFile, system: boolean): Promise<void> {
        return this.removeFile(file);
    }

    private async removeFile(file: TAbstractFile): Promise<void> {
        await Promise.resolve();
        this.files.delete(file.path);
        this.contents.delete(file.path);
        if (file.parent) {
            file.parent.children = file.parent.children.filter((c) => c !== file);
        }
        this.trigger("delete", file);
    }

    async removeFromAdapter(file: TAbstractFile): Promise<void> {
        return this.removeFile(file);
    }

    on(name: string, callback: EventCallback, ctx?: object): EventRef {
        const listeners = this.listeners.get(name) ?? new Set<EventCallback>();
        this.listeners.set(name, listeners);
        const boundCallback = ctx ? (...args: unknown[]) => callback.apply(ctx, args) : callback;
        listeners.add(boundCallback);
        return new EventRef(name, boundCallback);
    }

    off(name: string, callback: EventCallback) {
        this.listeners.get(name)?.delete(callback);
    }

    offref(ref: EventRef) {
        this.off(ref.name, ref.callback);
    }

    trigger(name: string, ...args: unknown[]) {
        this.listeners.get(name)?.forEach((cb) => cb(...args));
    }

    getName(): string {
        return this.vaultName;
    }
}

export class DataAdapter {
    vault: Vault;
    constructor(vault: Vault) {
        this.vault = vault;
    }
    stat(path: string): Promise<{ ctime: number; mtime: number; size: number }> {
        const file = this.vault.getAbstractFileByPath(path);
        if (file && file instanceof TFile) {
            return Promise.resolve({
                ctime: file.stat.ctime,
                mtime: file.stat.mtime,
                size: file.stat.size,
            });
        }
        return Promise.reject(new Error("File not found"));
    }
    async list(path: string): Promise<{ files: string[]; folders: string[] }> {
        await Promise.resolve();
        const abstractFile = this.vault.getAbstractFileByPath(path);
        if (abstractFile instanceof TFolder) {
            const files: string[] = [];
            const folders: string[] = [];
            for (const child of abstractFile.children) {
                if (child instanceof TFile) files.push(child.path);
                else if (child instanceof TFolder) folders.push(child.path);
            }
            return { files, folders };
        }
        return { files: [], folders: [] };
    }
    async _write(path: string, data: string | ArrayBuffer, options?: DataWriteOptions): Promise<void> {
        const file = this.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            if (typeof data === "string") {
                await this.vault.modify(file, data, options);
            } else {
                await this.vault.modifyBinary(file, data, options);
            }
        } else {
            if (typeof data === "string") {
                await this.vault.create(path, data, options);
            } else {
                await this.vault.createBinary(path, data, options);
            }
        }
    }
    async write(path: string, data: string, options?: DataWriteOptions): Promise<void> {
        return await this._write(path, data, options);
    }
    async writeBinary(path: string, data: ArrayBuffer, options?: DataWriteOptions): Promise<void> {
        return await this._write(path, data, options);
    }

    async read(path: string): Promise<string> {
        const file = this.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) return await this.vault.read(file);
        throw new Error("File not found");
    }
    async readBinary(path: string): Promise<ArrayBuffer> {
        const file = this.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) return await this.vault.readBinary(file);
        throw new Error("File not found");
    }

    async exists(path: string): Promise<boolean> {
        await Promise.resolve();
        return this.vault.getAbstractFileByPath(path) !== null;
    }
    async mkdir(path: string): Promise<void> {
        await this.vault.createFolder(path);
    }
    async remove(path: string): Promise<void> {
        const file = this.vault.getAbstractFileByPath(path);
        if (file) await this.vault.removeFromAdapter(file);
    }
}

class Events {
    _eventEmitter = new EventTarget();
    _events = new Map<EventCallback, EventListener>();
    _eventTarget(callback: EventCallback): EventListener {
        const registered = this._events.get(callback);
        if (registered) {
            return registered;
        }
        const eventListener = (event: Event) => {
            callback(event instanceof CustomEvent ? event.detail : undefined);
        };
        this._events.set(callback, eventListener);
        return eventListener;
    }
    on(name: string, callback: EventCallback, ctx?: object) {
        const registered = ctx ? (...args: unknown[]) => callback.apply(ctx, args) : callback;
        this._eventEmitter.addEventListener(name, this._eventTarget(registered));
    }
    trigger(name: string, args: unknown) {
        const evt = new CustomEvent(name, {
            detail: args,
        });
        this._eventEmitter.dispatchEvent(evt);
    }
}

class Workspace extends Events {
    getActiveFile(): null {
        return null;
    }
    getMostRecentLeaf(): null {
        return null;
    }

    onLayoutReady(callback: () => void) {
        // cb();
        // console.log("[Obsidian Mock] Workspace onLayoutReady registered");
        // this._eventEmitter.addEventListener("layout-ready", () => {
        // console.log("[Obsidian Mock] Workspace layout-ready event triggered");
        window.setTimeout(() => {
            callback();
        }, 200);
        // });
    }
    getLeavesOfType(): never[] {
        return [];
    }
    getLeaf() {
        return { setViewState: () => Promise.resolve(), revealLeaf: () => Promise.resolve() };
    }
    revealLeaf() {
        return Promise.resolve();
    }
    containerEl: HTMLElement = createNativeElement(document, "div");
}
export class App {
    vaultName: string = "MockVault";
    constructor(vaultName?: string) {
        if (vaultName) {
            this.vaultName = vaultName;
        }
        this.vault = new Vault(this.vaultName);
    }
    vault: Vault;
    workspace: Workspace = new Workspace();
    metadataCache = {
        on: (name: string, callback: EventCallback, ctx?: object): EventRef => {
            const registered = ctx ? (...args: unknown[]) => callback.apply(ctx, args) : callback;
            return new EventRef(name, registered);
        },
        getFileCache: (): null => null,
    };
}

export class Plugin {
    app: App;
    manifest: PluginManifest;
    settings: unknown;
    commands: Map<string, Command> = new Map();
    constructor(app: App, manifest: PluginManifest) {
        this.app = app;
        this.manifest = manifest;
    }
    async loadData(): Promise<unknown> {
        await Promise.resolve();
        return SettingCache.get(this.app) ?? {};
    }
    async saveData(data: unknown): Promise<void> {
        await Promise.resolve();
        SettingCache.set(this.app, data);
    }
    onload() {}
    onunload() {}
    addSettingTab(tab: PluginSettingTab) {}
    addCommand(command: Command) {
        this.commands.set(command.id, command);
    }
    addStatusBarItem() {
        return {
            setText: () => {},
            setClass: () => {},
            addClass: () => {},
        };
    }
    addRibbonIcon() {
        const icon = {
            setAttribute: () => icon,
            addClass: () => icon,
            onclick: () => {},
        };
        return icon;
    }
    registerView(type: string, creator: () => ItemView) {}
    registerObsidianProtocolHandler(handler: (params: Record<string, string>) => unknown) {}
    registerEvent(handler: EventRef) {}
    registerDomEvent<K extends keyof HTMLElementEventMap>(
        target: HTMLElement,
        eventName: K,
        handler: (event: HTMLElementEventMap[K]) => unknown
    ) {}
}

export class Notice {
    private _key: number;
    private static _counter = 0;
    constructor(message: string) {
        this._key = Notice._counter++;
    }
    setMessage(message: string) {}
}

export class Modal {
    app: App;
    contentEl: HTMLElement;
    titleEl: HTMLElement;
    modalEl: HTMLElement;
    isOpen: boolean = false;

    constructor(app: App) {
        this.app = app;
        this.contentEl = createNativeElement(document, "div");
        this.contentEl.className = "modal-content";
        this.titleEl = createNativeElement(document, "div");
        this.titleEl.className = "modal-title";
        this.modalEl = createNativeElement(document, "div");
        this.modalEl.className = "modal";
        this.modalEl.hidden = true;
        this.modalEl.appendChild(this.titleEl);
        this.modalEl.appendChild(this.contentEl);
    }
    open() {
        this.isOpen = true;
        this.modalEl.hidden = false;
        if (!this.modalEl.parentElement) {
            document.body.appendChild(this.modalEl);
        }
        this.onOpen();
    }
    close() {
        this.isOpen = false;
        this.modalEl.hidden = true;
        this.onClose();
    }
    onOpen() {}
    onClose() {}
    setPlaceholder(p: string) {}
    setTitle(t: string) {
        this.titleEl.textContent = t;
    }
}

export class PluginSettingTab {
    app: App;
    plugin: Plugin;
    containerEl: HTMLElement;
    constructor(app: App, plugin: Plugin) {
        this.app = app;
        this.plugin = plugin;
        this.containerEl = createNativeElement(document, "div");
    }
    display() {}
}

export function normalizePath(path: string): string {
    return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

export const Platform = {
    isDesktop: true,
    isMobile: false,
};

export class Menu {
    addItem(cb: (item: MenuItem) => unknown) {
        cb(new MenuItem());
        return this;
    }
    showAtMouseEvent(evt: MouseEvent) {}
}
export class MenuItem {
    setTitle(title: string) {
        return this;
    }
    setIcon(icon: string) {
        return this;
    }
    onClick(cb: (evt: MouseEvent) => unknown) {
        return this;
    }
}
export class MenuSeparator {}

export class Component {
    load() {}
    unload() {}
}

export class ButtonComponent extends Component {
    buttonEl: HTMLButtonElement = createNativeElement(document, "button");
    private clickHandler: ((evt: MouseEvent) => unknown) | null = null;

    constructor() {
        super();
        this.buttonEl = createNativeElement(document, "button");
        this.buttonEl.type = "button";
    }

    setButtonText(text: string) {
        this.buttonEl.textContent = text;
        return this;
    }

    setCta() {
        this.buttonEl.classList.add("mod-cta");
        return this;
    }

    onClick(cb: (evt: MouseEvent) => unknown) {
        this.clickHandler = cb;
        this.buttonEl.removeEventListener("click", this.clickHandler);
        this.buttonEl.addEventListener("click", (evt) => cb(evt as MouseEvent));
        return this;
    }

    setClass(c: string) {
        this.buttonEl.classList.add(c);
        return this;
    }

    setTooltip(tooltip: string) {
        this.buttonEl.title = tooltip;
        return this;
    }

    setDisabled(disabled: boolean) {
        this.buttonEl.disabled = disabled;
        return this;
    }
}

export class TextComponent extends Component {
    inputEl: HTMLInputElement = createNativeElement(document, "input");
    private changeHandler: ((value: string) => unknown) | null = null;

    constructor() {
        super();
        this.inputEl = createNativeElement(document, "input");
        this.inputEl.type = "text";
    }

    onChange(cb: (value: string) => unknown) {
        this.changeHandler = cb;
        this.inputEl.removeEventListener("change", this.handleChange);
        this.inputEl.addEventListener("change", this.handleChange);
        this.inputEl.addEventListener("input", (evt) => {
            const target = evt.target as HTMLInputElement;
            cb(target.value);
        });
        return this;
    }

    private handleChange = (evt: Event) => {
        if (this.changeHandler) {
            const target = evt.target as HTMLInputElement;
            this.changeHandler(target.value);
        }
    };

    setValue(v: string) {
        this.inputEl.value = v;
        return this;
    }

    setPlaceholder(p: string) {
        this.inputEl.placeholder = p;
        return this;
    }

    setDisabled(disabled: boolean) {
        this.inputEl.disabled = disabled;
        return this;
    }
}

export class ToggleComponent extends Component {
    inputEl: HTMLInputElement = createNativeElement(document, "input");
    private changeHandler: ((value: boolean) => unknown) | null = null;

    constructor() {
        super();
        this.inputEl = createNativeElement(document, "input");
        this.inputEl.type = "checkbox";
    }

    onChange(cb: (value: boolean) => unknown) {
        this.changeHandler = cb;
        this.inputEl.addEventListener("change", (evt) => {
            const target = evt.target as HTMLInputElement;
            cb(target.checked);
        });
        return this;
    }

    setValue(v: boolean) {
        this.inputEl.checked = v;
        return this;
    }

    setDisabled(disabled: boolean) {
        this.inputEl.disabled = disabled;
        return this;
    }
}

export class DropdownComponent extends Component {
    selectEl: HTMLSelectElement = createNativeElement(document, "select");
    private changeHandler: ((value: string) => unknown) | null = null;

    constructor() {
        super();
        this.selectEl = createNativeElement(document, "select");
    }

    addOption(v: string, d: string) {
        const option = createNativeElement(document, "option");
        option.value = v;
        option.textContent = d;
        this.selectEl.appendChild(option);
        return this;
    }

    addOptions(o: Record<string, string>) {
        for (const [value, display] of Object.entries(o)) {
            this.addOption(value, display);
        }
        return this;
    }

    onChange(cb: (value: string) => unknown) {
        this.changeHandler = cb;
        this.selectEl.addEventListener("change", (evt) => {
            const target = evt.target as HTMLSelectElement;
            cb(target.value);
        });
        return this;
    }

    setValue(v: string) {
        this.selectEl.value = v;
        return this;
    }

    setDisabled(disabled: boolean) {
        this.selectEl.disabled = disabled;
        return this;
    }
}

export class SliderComponent extends Component {
    inputEl: HTMLInputElement = createNativeElement(document, "input");
    private changeHandler: ((value: number) => unknown) | null = null;

    constructor() {
        super();
        this.inputEl = createNativeElement(document, "input");
        this.inputEl.type = "range";
    }

    onChange(cb: (value: number) => unknown) {
        this.changeHandler = cb;
        this.inputEl.addEventListener("change", (evt) => {
            const target = evt.target as HTMLInputElement;
            cb(parseFloat(target.value));
        });
        this.inputEl.addEventListener("input", (evt) => {
            const target = evt.target as HTMLInputElement;
            cb(parseFloat(target.value));
        });
        return this;
    }

    setValue(v: number) {
        this.inputEl.value = String(v);
        return this;
    }

    setMin(min: number) {
        this.inputEl.min = String(min);
        return this;
    }

    setMax(max: number) {
        this.inputEl.max = String(max);
        return this;
    }

    setStep(step: number) {
        this.inputEl.step = String(step);
        return this;
    }

    setDisabled(disabled: boolean) {
        this.inputEl.disabled = disabled;
        return this;
    }
}

export class Setting {
    nameEl: HTMLElement;
    descEl: HTMLElement;
    controlEl: HTMLElement;
    infoEl: HTMLElement;

    constructor(containerEl: HTMLElement) {
        this.nameEl = containerEl.createDiv();
        this.descEl = containerEl.createDiv();
        this.controlEl = containerEl.createDiv();
        this.infoEl = containerEl.createDiv();
    }
    setName(name: string) {
        this.nameEl.setText(name);
        return this;
    }
    setDesc(desc: string) {
        this.descEl.setText(desc);
        return this;
    }
    setClass(c: string) {
        this.controlEl.addClass(c);
        return this;
    }
    addText(cb: (text: TextComponent) => unknown) {
        const component = new TextComponent();
        this.controlEl.appendChild(component.inputEl);
        cb(component);
        return this;
    }
    addToggle(cb: (toggle: ToggleComponent) => unknown) {
        const component = new ToggleComponent();
        cb(component);
        return this;
    }
    addButton(cb: (btn: ButtonComponent) => unknown) {
        const btn = new ButtonComponent();
        this.controlEl.appendChild(btn.buttonEl);
        cb(btn);
        return this;
    }
    addDropdown(cb: (dropdown: DropdownComponent) => unknown) {
        const component = new DropdownComponent();
        cb(component);
        return this;
    }
    addSlider(cb: (slider: SliderComponent) => unknown) {
        const component = new SliderComponent();
        cb(component);
        return this;
    }
}

function applyDomElementInfo(element: HTMLElement, info?: DomElementInfo | string): void {
    if (typeof info === "string") {
        element.textContent = info;
        return;
    }
    if (!info) return;
    if (info.cls) {
        const classes = Array.isArray(info.cls) ? info.cls : info.cls.split(" ");
        element.classList.add(...classes.filter((className) => className !== ""));
    }
    if (info.text !== undefined) {
        element.replaceChildren(info.text);
    }
    if (info.attr) {
        for (const [name, value] of Object.entries(info.attr)) {
            if (value === null) element.removeAttribute(name);
            else element.setAttribute(name, String(value));
        }
    }
    if (info.title !== undefined) element.title = info.title;
    if (info.value !== undefined && "value" in element) element.value = info.value;
    if (info.type !== undefined && "type" in element) element.type = info.type;
    if (info.placeholder !== undefined && "placeholder" in element) element.placeholder = info.placeholder;
    if (info.href !== undefined) element.setAttribute("href", info.href);
}

// HTMLElement extensions used by the Webapp compatibility implementation.
if (typeof HTMLElement !== "undefined") {
    const proto = HTMLElement.prototype;
    proto.createDiv = function (
        this: HTMLElement,
        info?: DomElementInfo | string,
        callback?: (element: HTMLDivElement) => void
    ): HTMLDivElement {
        const element = createNativeElement(document, "div");
        applyDomElementInfo(element, info);
        this.appendChild(element);
        callback?.(element);
        return element;
    };
    proto.createEl = function <K extends keyof HTMLElementTagNameMap>(
        this: HTMLElement,
        tag: K,
        info?: DomElementInfo | string,
        callback?: (element: HTMLElementTagNameMap[K]) => void
    ): HTMLElementTagNameMap[K] {
        const element = createNativeElement(document, tag);
        applyDomElementInfo(element, info);
        this.appendChild(element);
        callback?.(element);
        return element;
    };
    proto.createSpan = function (
        this: HTMLElement,
        info?: DomElementInfo | string,
        callback?: (element: HTMLSpanElement) => void
    ): HTMLSpanElement {
        const element = createNativeElement(document, "span");
        applyDomElementInfo(element, info);
        this.appendChild(element);
        callback?.(element);
        return element;
    };
    proto.empty = function (this: HTMLElement): void {
        this.replaceChildren();
    };
    proto.setText = function (this: HTMLElement, text: string): void {
        this.textContent = text;
    };
    proto.addClass = function (this: HTMLElement, className: string): void {
        this.classList.add(className);
    };
    proto.removeClass = function (this: HTMLElement, className: string): void {
        this.classList.remove(className);
    };
    proto.toggleClass = function (this: HTMLElement, className: string, value: boolean): void {
        this.classList.toggle(className, value);
    };
    proto.hasClass = function (this: HTMLElement, className: string): boolean {
        return this.classList.contains(className);
    };
}

export class Editor {}

export class FuzzySuggestModal<T> {
    constructor(app: App) {}
    setPlaceholder(p: string) {}
    open() {}
    close() {}
    private __dummy(_: T): never {
        throw new Error("Not implemented.");
    }
}

function parseHtmlFragment(html: string): DocumentFragment {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const fragment = createNativeFragment(document);
    for (const child of [...parsed.body.childNodes]) {
        fragment.appendChild(document.importNode(child, true));
    }
    return fragment;
}

export class MarkdownRenderer {
    static render(app: App, md: string, el: HTMLElement, path: string, component: Component) {
        el.replaceChildren(parseHtmlFragment(md));
        return Promise.resolve();
    }
}
export class MarkdownView {}
export class TextAreaComponent extends Component {}
export class ItemView {}
export class WorkspaceLeaf {}

export function sanitizeHTMLToDom(html: string) {
    const div = createNativeElement(document, "div");
    div.appendChild(parseHtmlFragment(html));
    return div;
}

export function addIcon() {}
export function debounce<Arguments extends unknown[], Result>(
    fn: (...args: Arguments) => Result
): (...args: Arguments) => Result {
    return fn;
}
export async function request(options: RequestUrlParam | string): Promise<string> {
    const result = await requestUrl(options);
    return result.text;
}

export async function requestUrl(options: RequestUrlParam | string): Promise<RequestUrlResponse> {
    const { body, headers, method, url, contentType } = typeof options === "string" ? { url: options } : options;
    const reqHeadersObj: Record<string, string> = {};
    for (const key of Object.keys(headers || {})) {
        reqHeadersObj[key.toLowerCase()] = headers[key];
    }
    if (contentType) {
        reqHeadersObj["content-type"] = contentType;
    }
    reqHeadersObj["Cache-Control"] = "no-cache, no-store, must-revalidate";
    reqHeadersObj["Pragma"] = "no-cache";
    reqHeadersObj["Expires"] = "0";
    const result = await window.fetch(url, {
        method,
        headers: {
            ...reqHeadersObj,
        },

        body,
    });
    const headersObj: Record<string, string> = {};
    result.headers.forEach((value, key) => {
        headersObj[key] = value;
    });
    let json: unknown;
    let text = "";
    let arrayBuffer = new ArrayBuffer(0);
    try {
        const isJson = result.headers.get("content-type")?.includes("application/json");
        arrayBuffer = await result.arrayBuffer();
        const isText = result.headers.get("content-type")?.startsWith("text/");
        if (isText || isJson) {
            text = new TextDecoder().decode(arrayBuffer);
        }
        if (isJson) {
            json = await JSON.parse(text || "{}");
        }
    } catch {
        json = undefined;
    }
    return {
        status: result.status,
        headers: headersObj,
        text: text,
        json: json,
        arrayBuffer: arrayBuffer,
    };
}
export function stringifyYaml(obj: unknown): string {
    return JSON.stringify(obj);
}
export function parseYaml(s: string): unknown {
    const parsed: unknown = JSON.parse(s);
    return parsed;
}
export function getLanguage() {
    return "en";
}
/** The mock does not implement APIs gated by an Obsidian application version. */
export function requireApiVersion(_version: string): boolean {
    return false;
}
export function setIcon(el: HTMLElement, icon: string) {}
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer;
}
