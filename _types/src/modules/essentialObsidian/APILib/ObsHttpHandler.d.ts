// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { FetchHttpHandler, type FetchHttpHandlerOptions } from "@smithy/fetch-http-handler";
import { HttpRequest, HttpResponse, type HttpHandlerOptions } from "@smithy/protocol-http";
/**
 * This is close to origin implementation of FetchHttpHandler
 * https://github.com/aws/aws-sdk-js-v3/blob/main/packages/fetch-http-handler/src/fetch-http-handler.ts
 * that is released under Apache 2 License.
 * But this uses Obsidian requestUrl instead.
 */
export declare class ObsHttpHandler extends FetchHttpHandler {
    requestTimeoutInMs: number | undefined;
    reverseProxyNoSignUrl: string | undefined;
    constructor(options?: FetchHttpHandlerOptions, reverseProxyNoSignUrl?: string);
    handle(request: HttpRequest, { abortSignal }?: HttpHandlerOptions): Promise<{
        response: HttpResponse;
    }>;
}
