/* eslint-disable @typescript-eslint/no-unsafe-function-type */
export const SettingCache = new Map<any, any>();
//@ts-ignore obsidian global
globalThis.activeDocument = document;

declare const hostPlatform: string | undefined;

// import { interceptFetchForLogging } from "../harness/utils/intercept";
// interceptFetchForLogging();
globalThis.process = {
    platform: (hostPlatform || "win32") as any,
} as any;
console.warn(`[Obsidian Mock] process.platform is set to ${globalThis.process.platform}`);
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

export class EventRef {}

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
    private listeners: Map<string, Set<Function>> = new Map();

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
        let parent = this.getAbstractFileByPath(parentPath);
        if (!parent || !(parent instanceof TFolder)) {
            parent = await this.createFolder(parentPath);
        }

        const file = new TFile(this, path, name, parent as TFolder);
        file.stat.size = typeof data === "string" ? new TextEncoder().encode(data).length : data.byteLength;
        file.stat.ctime = options?.ctime ?? Date.now();
        file.stat.mtime = options?.mtime ?? Date.now();
        this.files.set(path, file);
        this.contents.set(path, data);
        (parent as TFolder).children.push(file);
        // console.dir(this.files);

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
        console.warn(`[Obsidian Mock ${this.vaultName}] Modified file at path: '${file.path}'`);
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
        await Promise.resolve();
        this.files.delete(file.path);
        this.contents.delete(file.path);
        if (file.parent) {
            file.parent.children = file.parent.children.filter((c) => c !== file);
        }
        this.trigger("delete", file);
    }

    async trash(file: TAbstractFile, system: boolean): Promise<void> {
        await Promise.resolve();
        return this.delete(file);
    }

    on(name: string, callback: (...args: any[]) => any, ctx?: any): EventRef {
        if (!this.listeners.has(name)) {
            this.listeners.set(name, new Set());
        }
        const boundCallback = ctx ? callback.bind(ctx) : callback;
        this.listeners.get(name)!.add(boundCallback);
        return { name, callback: boundCallback } as any;
    }

    off(name: string, callback: any) {
        this.listeners.get(name)?.delete(callback);
    }

    offref(ref: EventRef) {
        const { name, callback } = ref as any;
        this.off(name, callback);
    }

    trigger(name: string, ...args: any[]) {
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
        if (file) await this.vault.delete(file);
    }
}

class Events {
    _eventEmitter = new EventTarget();
    _events = new Map<any, any>();
    _eventTarget(cb: any) {
        const x = this._events.get(cb);
        if (x) {
            return x;
        }
        const callback = (evt: any) => {
            x(evt?.detail ?? undefined);
        };
        this._events.set(cb, callback);
        return callback;
    }
    on(name: string, cb: any, ctx?: any) {
        this._eventEmitter.addEventListener(name, this._eventTarget(cb));
    }
    trigger(name: string, args: any) {
        const evt = new CustomEvent(name, {
            detail: args,
        });
        this._eventEmitter.dispatchEvent(evt);
    }
}

class Workspace extends Events {
    getActiveFile() {
        return null;
    }
    getMostRecentLeaf() {
        return null;
    }

    onLayoutReady(cb: any) {
        // cb();
        // console.log("[Obsidian Mock] Workspace onLayoutReady registered");
        // this._eventEmitter.addEventListener("layout-ready", () => {
        // console.log("[Obsidian Mock] Workspace layout-ready event triggered");
        setTimeout(() => {
            cb();
        }, 200);
        // });
    }
    getLeavesOfType() {
        return [];
    }
    getLeaf() {
        return { setViewState: () => Promise.resolve(), revealLeaf: () => Promise.resolve() };
    }
    revealLeaf() {
        return Promise.resolve();
    }
    containerEl: HTMLElement = document.createElement("div");
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
    metadataCache: any = {
        on: (name: string, cb: any, ctx?: any) => {},
        getFileCache: () => null,
    };
}

export class Plugin {
    app: App;
    manifest: any;
    settings: any;
    commands: Map<string, any> = new Map();
    constructor(app: App, manifest: any) {
        this.app = app;
        this.manifest = manifest;
    }
    async loadData(): Promise<any> {
        await Promise.resolve();
        return SettingCache.get(this.app) ?? {};
    }
    async saveData(data: any): Promise<void> {
        await Promise.resolve();
        SettingCache.set(this.app, data);
    }
    onload() {}
    onunload() {}
    addSettingTab(tab: any) {}
    addCommand(command: any) {
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
    registerView(type: string, creator: any) {}
    registerObsidianProtocolHandler(handler: any) {}
    registerEvent(handler: any) {}
    registerDomEvent(target: any, eventName: string, handler: any) {}
}

export class Notice {
    constructor(message: string) {
        console.log("Notice:", message);
    }
}

export class Modal {
    app: App;
    contentEl: HTMLElement;
    titleEl: HTMLElement;
    modalEl: HTMLElement;
    isOpen: boolean = false;

    constructor(app: App) {
        this.app = app;
        this.contentEl = document.createElement("div");
        this.contentEl.className = "modal-content";
        this.titleEl = document.createElement("div");
        this.titleEl.className = "modal-title";
        this.modalEl = document.createElement("div");
        this.modalEl.className = "modal";
        this.modalEl.style.display = "none";
        this.modalEl.appendChild(this.titleEl);
        this.modalEl.appendChild(this.contentEl);
    }
    open() {
        this.isOpen = true;
        this.modalEl.style.display = "block";
        if (!this.modalEl.parentElement) {
            document.body.appendChild(this.modalEl);
        }
        this.onOpen();
    }
    close() {
        this.isOpen = false;
        this.modalEl.style.display = "none";
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
        this.containerEl = document.createElement("div");
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
    addItem(cb: (item: MenuItem) => any) {
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
    onClick(cb: (evt: MouseEvent) => any) {
        return this;
    }
}
export class MenuSeparator {}

export class Component {
    load() {}
    unload() {}
}

export class ButtonComponent extends Component {
    buttonEl: HTMLButtonElement = document.createElement("button");
    private clickHandler: ((evt: MouseEvent) => any) | null = null;

    constructor() {
        super();
        this.buttonEl = document.createElement("button");
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

    onClick(cb: (evt: MouseEvent) => any) {
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
    inputEl: HTMLInputElement = document.createElement("input");
    private changeHandler: ((value: string) => any) | null = null;

    constructor() {
        super();
        this.inputEl = document.createElement("input");
        this.inputEl.type = "text";
    }

    onChange(cb: (value: string) => any) {
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
    inputEl: HTMLInputElement = document.createElement("input");
    private changeHandler: ((value: boolean) => any) | null = null;

    constructor() {
        super();
        this.inputEl = document.createElement("input");
        this.inputEl.type = "checkbox";
    }

    onChange(cb: (value: boolean) => any) {
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
    selectEl: HTMLSelectElement = document.createElement("select");
    private changeHandler: ((value: string) => any) | null = null;

    constructor() {
        super();
        this.selectEl = document.createElement("select");
    }

    addOption(v: string, d: string) {
        const option = document.createElement("option");
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

    onChange(cb: (value: string) => any) {
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
    inputEl: HTMLInputElement = document.createElement("input");
    private changeHandler: ((value: number) => any) | null = null;

    constructor() {
        super();
        this.inputEl = document.createElement("input");
        this.inputEl.type = "range";
    }

    onChange(cb: (value: number) => any) {
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
    addText(cb: (text: TextComponent) => any) {
        const component = new TextComponent();
        this.controlEl.appendChild(component.inputEl);
        cb(component);
        return this;
    }
    addToggle(cb: (toggle: ToggleComponent) => any) {
        const component = new ToggleComponent();
        cb(component);
        return this;
    }
    addButton(cb: (btn: ButtonComponent) => any) {
        const btn = new ButtonComponent();
        this.controlEl.appendChild(btn.buttonEl);
        cb(btn);
        return this;
    }
    addDropdown(cb: (dropdown: DropdownComponent) => any) {
        const component = new DropdownComponent();
        cb(component);
        return this;
    }
    addSlider(cb: (slider: SliderComponent) => any) {
        const component = new SliderComponent();
        cb(component);
        return this;
    }
}

// HTMLElement extensions
if (typeof HTMLElement !== "undefined") {
    const proto = HTMLElement.prototype as any;
    proto.createDiv = function (o?: any) {
        const div = document.createElement("div");
        if (o?.cls) div.addClass(o.cls);
        if (o?.text) div.setText(o.text);
        this.appendChild(div);
        return div;
    };
    proto.createEl = function (tag: string, o?: any) {
        const el = document.createElement(tag);
        if (o?.cls) el.addClass(o.cls);
        if (o?.text) el.setText(o.text);
        this.appendChild(el);
        return el;
    };
    proto.createSpan = function (o?: any) {
        return this.createEl("span", o);
    };
    proto.empty = function () {
        this.innerHTML = "";
    };
    proto.setText = function (t: string) {
        this.textContent = t;
    };
    proto.addClass = function (c: string) {
        this.classList.add(c);
    };
    proto.removeClass = function (c: string) {
        this.classList.remove(c);
    };
    proto.toggleClass = function (c: string, b: boolean) {
        this.classList.toggle(c, b);
    };
    proto.hasClass = function (c: string) {
        return this.classList.contains(c);
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
export class MarkdownRenderer {
    static render(app: App, md: string, el: HTMLElement, path: string, component: Component) {
        el.innerHTML = md;
        return Promise.resolve();
    }
}
export class MarkdownView {}
export class TextAreaComponent extends Component {}
export class ItemView {}
export class WorkspaceLeaf {}

export function sanitizeHTMLToDom(html: string) {
    const div = document.createElement("div");
    div.innerHTML = html;
    return div;
}

export function addIcon() {}
export const debounce = (fn: any) => fn;
export async function request(options: any) {
    const result = await requestUrl(options);
    return result.text;
}

export async function requestUrl({
    body,
    headers,
    method,
    url,
    contentType,
}: RequestUrlParam): Promise<RequestUrlResponse> {
    // console.log("[requestUrl] Mock called:", { method, url, contentType });
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
    const result = await fetch(url, {
        method: method,
        headers: {
            ...reqHeadersObj,
        },

        body: body,
    });
    const headersObj: Record<string, string> = {};
    result.headers.forEach((value, key) => {
        headersObj[key] = value;
    });
    let json = undefined;
    let text = undefined;
    let arrayBuffer = undefined;
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
    } catch (e) {
        console.warn("Failed to parse response:", e);
        // ignore
    }
    return {
        status: result.status,
        headers: headersObj,
        text: text,
        json: json,
        arrayBuffer: arrayBuffer,
    };
}
export function stringifyYaml(obj: any) {
    return JSON.stringify(obj);
}
export function parseYaml(s: string) {
    return JSON.parse(s);
}
export function getLanguage() {
    return "en";
}
export function setIcon(el: HTMLElement, icon: string) {}
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer;
}

export type DataWriteOptions = any;
export type PluginManifest = any;
export type RequestUrlParam = any;
export type RequestUrlResponse = any;
export type MarkdownFileInfo = any;
export type ListedFiles = {
    files: string[];
    folders: string[];
};
