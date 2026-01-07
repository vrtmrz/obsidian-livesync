export function interceptFetchForLogging() {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (...params: any[]) => {
        const paramObj = params[0];
        const initObj = params[1];
        const url = typeof paramObj === "string" ? paramObj : paramObj.url;
        const method = initObj?.method || "GET";
        const headers = initObj?.headers || {};
        const body = initObj?.body || null;
        const headersObj: Record<string, string> = {};
        if (headers instanceof Headers) {
            headers.forEach((value, key) => {
                headersObj[key] = value;
            });
        }
        console.dir({
            mockedFetch: {
                url,
                method,
                headers: headersObj,
            },
        });
        try {
            const res = await originalFetch(...params);
            console.log(`[Obsidian Mock] Fetch response: ${res.status} ${res.statusText} for ${method} ${url}`);
            const resClone = res.clone();
            const contentType = resClone.headers.get("content-type") || "";
            const isJson = contentType.includes("application/json");
            if (isJson) {
                const data = await resClone.json();
                console.dir({ mockedFetchResponseJson: data });
            } else {
                const ab = await resClone.arrayBuffer();
                const text = new TextDecoder().decode(ab);
                const isText = /^text\//.test(contentType);
                if (isText) {
                    console.dir({
                        mockedFetchResponseText: ab.byteLength < 1000 ? text : text.slice(0, 1000) + "...(truncated)",
                    });
                } else {
                    console.log(`[Obsidian Mock] Fetch response is of content-type ${contentType}, not logging body.`);
                }
            }
            return res;
        } catch (e) {
            // console.error("[Obsidian Mock] Fetch error:", e);
            console.error(`[Obsidian Mock] Fetch failed for ${method} ${url}, error:`, e);
            throw e;
        }
    };
}
