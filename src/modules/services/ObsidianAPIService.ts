import { InjectableAPIService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableAPIService";
import type { ObsidianServiceContext } from "@/modules/services/ObsidianServiceContext";
import { Platform, type Command, type ViewCreator } from "@/deps.ts";
import { ObsHttpHandler } from "@/modules/essentialObsidian/APILib/ObsHttpHandler";
import { ObsidianConfirm } from "./ObsidianConfirm";
import type { Confirm } from "@vrtmrz/livesync-commonlib/compat/interfaces/Confirm";
import { requestUrl, type RequestUrlParam } from "@/deps";
import { compatGlobal } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";
// All Services will be migrated to be based on Plain Services, not Injectable Services.
// This is a migration step.

declare module "obsidian" {
    interface App {
        appId?: string;
        isMobile?: boolean;
    }
}

const cacheReuseDirectives = new Set(["max-age", "max-stale", "min-fresh", "only-if-cached"]);

function splitHeaderDirectives(value: string): string[] {
    const directives: string[] = [];
    let start = 0;
    let inQuotes = false;
    let escaped = false;

    for (let index = 0; index < value.length; index++) {
        const character = value[index];
        if (inQuotes && escaped) {
            escaped = false;
            continue;
        }
        if (inQuotes && character === "\\") {
            escaped = true;
            continue;
        }
        if (character === '"') {
            inQuotes = !inQuotes;
        } else if (character === "," && !inQuotes) {
            const directive = value.slice(start, index).trim();
            if (directive) directives.push(directive);
            start = index + 1;
        }
    }

    const lastDirective = value.slice(start).trim();
    if (lastDirective) directives.push(lastDirective);
    return directives;
}

function getDirectiveName(directive: string): string {
    const equalsIndex = directive.indexOf("=");
    return (equalsIndex === -1 ? directive : directive.slice(0, equalsIndex)).trim().toLowerCase();
}

export class ObsidianAPIService extends InjectableAPIService<ObsidianServiceContext> {
    _customHandler: ObsHttpHandler | undefined;
    _confirmInstance: Confirm;
    constructor(context: ObsidianServiceContext) {
        super(context);
        this._confirmInstance = new ObsidianConfirm(context);
    }
    getCustomFetchHandler(): ObsHttpHandler {
        if (!this._customHandler) this._customHandler = new ObsHttpHandler(undefined, undefined);
        return this._customHandler;
    }

    async showWindow(viewType: string): Promise<void> {
        const leaves = this.app.workspace.getLeavesOfType(viewType);
        if (leaves.length == 0) {
            await this.app.workspace.getLeaf(true).setViewState({
                type: viewType,
                active: true,
            });
        } else {
            await leaves[0].setViewState({
                type: viewType,
                active: true,
            });
        }
        if (leaves.length > 0) {
            await this.app.workspace.revealLeaf(leaves[0]);
        }
    }

    override async showWindowOnRight(viewType: string): Promise<void> {
        const existing = this.app.workspace.getLeavesOfType(viewType);
        if (existing.length > 0) {
            await this.app.workspace.revealLeaf(existing[0]);
            return;
        }
        const rightLeaf = this.app.workspace.getRightLeaf(false);
        if (rightLeaf) {
            await rightLeaf.setViewState({
                type: viewType,
                active: false,
            });
            await this.app.workspace.revealLeaf(rightLeaf);
            return;
        }

        await this.showWindow(viewType);
    }

    private get app() {
        return this.context.app;
    }

    override getPlatform(): string {
        if (Platform.isAndroidApp) {
            return "android-app";
        } else if (Platform.isIosApp) {
            return "ios";
        } else if (Platform.isMacOS) {
            return "macos";
        } else if (Platform.isMobileApp) {
            return "mobile-app";
        } else if (Platform.isMobile) {
            return "mobile";
        } else if (Platform.isSafari) {
            return "safari";
        } else if (Platform.isDesktop) {
            return "desktop";
        } else if (Platform.isDesktopApp) {
            return "desktop-app";
        } else {
            return "unknown-obsidian";
        }
    }
    override isMobile(): boolean {
        return "isMobile" in this.app ? !!this.app.isMobile : false;
    }
    override getAppID(): string {
        return `${"appId" in this.app ? this.app.appId : ""}`;
    }

    override getSystemVaultName(): string {
        return this.app.vault.getName();
    }

    override getAppVersion(): string {
        const navigatorString = compatGlobal.navigator?.userAgent ?? "";
        const match = navigatorString.match(/obsidian\/([0-9]+\.[0-9]+\.[0-9]+)/);
        if (match && match.length >= 2) {
            return match[1];
        }
        return "0.0.0";
    }

    override getPluginVersion(): string {
        return this.context.plugin.manifest.version;
    }

    get confirm(): Confirm {
        return this._confirmInstance;
    }

    addCommand<TCommand extends Command>(command: TCommand): TCommand {
        return this.context.plugin.addCommand(command) as TCommand;
    }

    registerWindow<T>(type: string, factory: (leaf: T) => unknown): void {
        return this.context.plugin.registerView(type, factory as ViewCreator);
    }

    addRibbonIcon(icon: string, title: string, callback: (evt: MouseEvent) => unknown): HTMLElement {
        return this.context.plugin.addRibbonIcon(icon, title, callback);
    }

    registerProtocolHandler(action: string, handler: (params: Record<string, string>) => unknown): void {
        return this.context.plugin.registerObsidianProtocolHandler(action, handler);
    }

    /**
     * In Obsidian, we will use the native `requestUrl` function as the default fetch handler,
     * to address unavoidable CORS issues.
     */
    override async nativeFetch(req: string | Request, opts?: RequestInit): Promise<Response> {
        const url = typeof req === "string" ? req : req.url;
        let body: string | ArrayBuffer | undefined = undefined;
        const method =
            typeof opts?.method === "string"
                ? opts.method
                : req instanceof Request && typeof req.method === "string"
                  ? req.method
                  : "GET";
        if (typeof req !== "string") {
            if (opts?.body) {
                body = typeof opts.body === "string" ? opts.body : await new Response(opts.body).arrayBuffer();
            } else if (req.body) {
                body = await new Response(req.body).arrayBuffer();
            }
        } else {
            body = opts?.body as string;
        }
        const reqHeaders = new Headers(req instanceof Request ? req.headers : {});

        const optHeaders = {} as Record<string, string>;
        // Merge headers from the Request object and the options, with options taking precedence
        reqHeaders.forEach((value, key) => {
            optHeaders[key] = value;
        });
        if (opts && "headers" in opts) {
            if (opts.headers instanceof Headers) {
                // For Compatibility, mostly headers.entries() is supported, but not all environments.
                opts.headers.forEach((value, key) => {
                    optHeaders[key] = value;
                });
            } else {
                for (const [key, value] of Object.entries(opts.headers as Record<string, string>)) {
                    optHeaders[key] = value;
                }
            }
        }
        const transformedHeaders = { ...optHeaders };
        // Delete headers that should not be sent by native fetch,
        // they are controlled by the browser and may cause CORS preflight failure if sent manually.
        delete transformedHeaders["host"];
        delete transformedHeaders["Host"];
        delete transformedHeaders["content-length"];
        delete transformedHeaders["Content-Length"];
        const cacheMode = opts?.cache ?? (req instanceof Request ? req.cache : undefined);
        if (cacheMode === "no-store" && ["GET", "HEAD"].includes(method.toUpperCase())) {
            // requestUrl has no cache option; no-store alone can reuse an existing cached response.
            const cacheControlKeys = Object.keys(transformedHeaders).filter(
                (key) => key.toLowerCase() === "cache-control"
            );
            const cacheControlDirectives = cacheControlKeys
                .flatMap((key) => splitHeaderDirectives(transformedHeaders[key]))
                .filter((directive) => {
                    const name = getDirectiveName(directive);
                    return !cacheReuseDirectives.has(name) && name !== "no-cache" && name !== "no-store";
                });
            const cacheControlKey = cacheControlKeys[0] ?? "cache-control";
            for (const key of cacheControlKeys) delete transformedHeaders[key];
            transformedHeaders[cacheControlKey] = [...cacheControlDirectives, "no-cache", "no-store"].join(", ");

            const pragmaKeys = Object.keys(transformedHeaders).filter((key) => key.toLowerCase() === "pragma");
            const pragmaDirectives = pragmaKeys
                .flatMap((key) => splitHeaderDirectives(transformedHeaders[key]))
                .filter((directive) => getDirectiveName(directive) !== "no-cache");
            const pragmaKey = pragmaKeys[0] ?? "pragma";
            for (const key of pragmaKeys) delete transformedHeaders[key];
            transformedHeaders[pragmaKey] = [...pragmaDirectives, "no-cache"].join(", ");
        }
        const contentType =
            transformedHeaders["content-type"] ?? transformedHeaders["Content-Type"] ?? "application/json";
        const requestParam: RequestUrlParam = {
            url,
            method: method,
            body: body,
            headers: transformedHeaders,
            contentType: contentType,
        };
        const r = await requestUrl({ ...requestParam, throw: false });
        return new Response(r.arrayBuffer, {
            headers: r.headers,
            status: r.status,
            statusText: `${r.status}`,
        });
    }

    override addStatusBarItem(): HTMLElement | undefined {
        return this.context.plugin.addStatusBarItem();
    }

    override setInterval(handler: () => void, timeout: number): number {
        const timerId = compatGlobal.setInterval(handler, timeout);
        this.context.plugin.registerInterval(timerId);
        return timerId;
    }

    override getSystemConfigDir() {
        return this.app.vault.configDir;
    }
}
