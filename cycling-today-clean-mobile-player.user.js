// ==UserScript==
// @name         Cycling Today 清爽移动播放器
// @namespace    local.codex.cycling-today
// @version      1.4.1
// @description  清除 Cycling Today/播放器广告，并用 iPhone Safari UA 重新获取被 Cloudflare 拦截的播放器及其资源。
// @author       Codex
// @match        https://cycling.today/*
// @match        https://*.cycling.today/*
// @match        https://explicitdevote.net/e/*
// @match        https://*.explicitdevote.net/e/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      explicitdevote.net
// @connect      *
// ==/UserScript==

(function () {
    'use strict';

    const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.4 Mobile/15E148 Safari/604.1';
    const IS_PLAYER = /(^|\.)explicitdevote\.net$/i.test(location.hostname) && /^\/e\//.test(location.pathname);
    const IS_CYCLING = /(^|\.)cycling\.today$/i.test(location.hostname);

    const BLOCKED_URL = /(?:doubleclick\.net|googlesyndication\.com|googleadservices\.com|adtrafficquality\.google|adsco\.re|intellipopup\.com|greatdexchange\.com|clypeiescapes\.com|xstats\.st|tidaiwtfloz\.com|jkksrhdcxhhd\.com|cloudfront\.net\/vqvwB)/i;

    const AD_SELECTORS = [
        'ins.adsbygoogle',
        '.adsbygoogle',
        '.google-auto-placed',
        '.td-a-rec',
        '.td-adspot-title',
        '[data-ad-client]',
        '[data-ad-slot]',
        '[id^="google_ads_iframe"]',
        'iframe[name^="google_ads_iframe"]',
        'iframe[src*="doubleclick.net"]',
        'iframe[src*="googlesyndication.com"]',
        'iframe[src*="googleadservices.com"]',
        'iframe[src*="adtrafficquality.google"]',
        'iframe[src*="adsco.re"]',
        'iframe[src*="intellipopup.com"]',
        'iframe[src*="greatdexchange.com"]',
        'iframe[src*="clypeiescapes.com"]',
        'script[src*="adsco.re"]',
        'script[src*="intellipopup.com"]',
        'script[src*="greatdexchange.com"]',
        'script[src*="xstats.st"]'
    ].join(',');

    function spoofNavigator() {
        const pageWindow = typeof unsafeWindow === 'object' ? unsafeWindow : window;
        const proto = pageWindow.Navigator && pageWindow.Navigator.prototype;
        if (!proto) return;

        const values = {
            userAgent: IOS_UA,
            appVersion: IOS_UA.replace(/^Mozilla\//, ''),
            platform: 'iPhone',
            vendor: 'Apple Computer, Inc.',
            maxTouchPoints: 5
        };

        for (const [key, value] of Object.entries(values)) {
            try {
                Object.defineProperty(proto, key, {
                    configurable: true,
                    get: () => value
                });
            } catch (_) {}
        }

        try {
            Object.defineProperty(proto, 'userAgentData', {
                configurable: true,
                get: () => undefined
            });
        } catch (_) {}
    }

    function disablePopups() {
        const pageWindow = typeof unsafeWindow === 'object' ? unsafeWindow : window;
        try {
            Object.defineProperty(pageWindow, 'open', {
                configurable: true,
                writable: false,
                value: () => null
            });
        } catch (_) {
            try { pageWindow.open = () => null; } catch (_) {}
        }
    }

    function removeAdNode(node) {
        if (!(node instanceof Element)) return;

        if (node.matches(AD_SELECTORS)) {
            node.remove();
            return;
        }

        if (node.matches('iframe,script,img,link')) {
            const url = node.getAttribute('src') || node.getAttribute('href') || '';
            if (BLOCKED_URL.test(url)) {
                node.remove();
                return;
            }
        }

        node.querySelectorAll(AD_SELECTORS).forEach((element) => element.remove());
        node.querySelectorAll('iframe,script,img,link').forEach((element) => {
            const url = element.getAttribute('src') || element.getAttribute('href') || '';
            if (BLOCKED_URL.test(url)) element.remove();
        });
    }

    function installCleaner() {
        const cleanerStyle = document.createElement('style');
        cleanerStyle.textContent = `
            ${AD_SELECTORS} { display: none !important; visibility: hidden !important; width: 0 !important; height: 0 !important; }
            html, body { overflow: auto !important; }
        `;
        (document.head || document.documentElement).appendChild(cleanerStyle);

        const clean = () => removeAdNode(document.documentElement || document.body);
        clean();

        const observer = new MutationObserver((records) => {
            for (const record of records) {
                for (const node of record.addedNodes) removeAdNode(node);
            }
        });

        observer.observe(document.documentElement || document, {
            childList: true,
            subtree: true
        });

        // 部分广告会延迟插入；低频兜底不会影响播放器性能。
        setInterval(clean, 2500);
    }

    function mobileRequest(url, accept = '*/*') {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                headers: {
                    'User-Agent': IOS_UA,
                    'Accept': accept,
                    'Referer': 'https://cycling.today/'
                },
                timeout: 10000,
                onload(response) {
                    if (response.status === 200) {
                        resolve(response.responseText);
                    } else {
                        reject(new Error(`${new URL(url).pathname} 返回 HTTP ${response.status}`));
                    }
                },
                onerror: () => reject(new Error(`${new URL(url).pathname} 请求失败`)),
                ontimeout: () => reject(new Error(`${new URL(url).pathname} 请求超时`))
            });
        });
    }

    function installGmHlsBridge() {
        const pageWindow = typeof unsafeWindow === 'object' ? unsafeWindow : window;

        const request = (options) => new Promise((resolve, reject) => {
            const headers = {
                'User-Agent': IOS_UA,
                'Accept': '*/*',
                'Referer': 'https://explicitdevote.net/'
            };

            // hls.js uses 0/0 for ordinary (non-byte-range) fragments. Sending
            // that pair as `bytes=0--1` makes the media CDN answer HTTP 416.
            if (
                Number.isFinite(options.rangeStart)
                && Number.isFinite(options.rangeEnd)
                && options.rangeStart >= 0
                && options.rangeEnd > options.rangeStart
            ) {
                headers.Range = `bytes=${options.rangeStart}-${options.rangeEnd - 1}`;
            }

            GM_xmlhttpRequest({
                method: 'GET',
                url: options.url,
                headers,
                responseType: options.responseType === 'arraybuffer' ? 'arraybuffer' : 'text',
                timeout: options.timeout || 20000,
                onload(response) {
                    if (response.status >= 200 && response.status < 300) {
                        resolve({
                            data: options.responseType === 'arraybuffer'
                                ? response.response
                                : (response.responseText || response.response),
                            status: response.status,
                            url: response.finalUrl || options.url
                        });
                    } else {
                        reject(new Error(`HLS HTTP ${response.status}: ${new URL(options.url).pathname}`));
                    }
                },
                onerror: () => reject(new Error(`HLS 请求失败: ${new URL(options.url).hostname}`)),
                ontimeout: () => reject(new Error(`HLS 请求超时: ${new URL(options.url).hostname}`))
            });
        });

        try {
            Object.defineProperty(pageWindow, '__ctGmHlsRequest', {
                configurable: true,
                value: request
            });
        } catch (_) {
            pageWindow.__ctGmHlsRequest = request;
        }
    }

    const HLS_LOADER_SOURCE = `
        const __CT_IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.4 Mobile/15E148 Safari/604.1';
        for (const [key, value] of Object.entries({
            userAgent: __CT_IOS_UA,
            appVersion: __CT_IOS_UA.replace(/^Mozilla\\//, ''),
            platform: 'iPhone',
            vendor: 'Apple Computer, Inc.',
            maxTouchPoints: 5
        })) {
            try {
                Object.defineProperty(Navigator.prototype, key, {
                    configurable: true,
                    get: () => value
                });
            } catch (_) {}
        }

        class CTHlsLoader {
            constructor() {
                this.context = null;
                this.callbacks = null;
                this.stats = null;
                this.aborted = false;
            }

            load(context, config, callbacks) {
                const started = performance.now();
                this.context = context;
                this.callbacks = callbacks;
                this.aborted = false;
                this.stats = {
                    aborted: false,
                    loaded: 0,
                    total: 0,
                    retry: 0,
                    chunkCount: 0,
                    bwEstimate: 0,
                    loading: { start: started, first: 0, end: 0 },
                    parsing: { start: 0, end: 0 },
                    buffering: { start: 0, first: 0, end: 0 }
                };

                window.__ctGmHlsRequest({
                    url: context.url,
                    responseType: context.responseType,
                    rangeStart: context.rangeStart,
                    rangeEnd: context.rangeEnd,
                    timeout: Math.max(config.timeout || 0, 20000)
                }).then((result) => {
                    if (this.aborted) return;
                    const ended = performance.now();
                    const size = result.data?.byteLength ?? result.data?.length ?? 0;
                    this.stats.loaded = size;
                    this.stats.total = size;
                    this.stats.loading.first = ended;
                    this.stats.loading.end = ended;
                    callbacks.onSuccess({
                        url: result.url,
                        data: result.data,
                        code: result.status
                    }, this.stats, context, null);
                }).catch((error) => {
                    if (this.aborted) return;
                    callbacks.onError({
                        code: 0,
                        text: String(error?.message || error)
                    }, context, null, this.stats);
                });
            }

            abort() {
                this.aborted = true;
                if (this.stats) this.stats.aborted = true;
            }

            destroy() {
                this.abort();
                this.context = null;
                this.callbacks = null;
            }
        }

        window.__CTHlsLoader = CTHlsLoader;
    `;

    function patchPlayerScript(source) {
        // 播放器自己的配置还会注入全屏点击弹窗、隐藏广告 iframe 和反调试逻辑。
        return source
            .replace(
                /if\(a\)\{if\(document\.querySelector\("#config"\)/,
                'if(a){a.p2p=!1;a.swarmcloud=!1;a.stream_url=a.stream_url_nop2p||a.stream_url;if(document.querySelector("#config")'
            )
            .replace(/void 0!==a\.pops&&0<a\.pops\.length&&/g, 'false&&')
            .replace(/""!=a\.hframes&&/g, 'false&&')
            .replace(/a\.devtools_block&&/g, 'false&&')
            .replace(
                /autoPlay:!1,mute:a\.autoplay,\.\.\.t,disableErrorScreen/,
                'autoPlay:!1,mute:a.autoplay,...t,playback:{...(t.playback||{}),hlsjsConfig:{...((t.playback||{}).hlsjsConfig||{}),loader:window.__CTHlsLoader}},disableErrorScreen'
            );
    }

    function sanitizePlayerHtml(source, streamCss, streamJs) {
        const parsed = new DOMParser().parseFromString(source, 'text/html');

        parsed.querySelectorAll('script').forEach((script) => {
            const src = script.getAttribute('src') || '';
            const keep = script.id === 'config'
                || /cdn\.jsdelivr\.net\/npm\/@clappr\/player/i.test(src)
                || /cdn\.jsdelivr\.net\/npm\/@swarmcloud\/hls\/p2p-engine/i.test(src);

            if (!keep) script.remove();
        });

        parsed.querySelectorAll('iframe,ins').forEach((element) => element.remove());
        parsed.querySelectorAll('img,link').forEach((element) => {
            const url = element.getAttribute('src') || element.getAttribute('href') || '';
            if (BLOCKED_URL.test(url) || /\/assets\/stream\.css(?:\?|$)/i.test(url)) element.remove();
        });

        const style = parsed.createElement('style');
        style.textContent = `${streamCss}\n
            html, body { margin: 0 !important; background: #000 !important; overflow: hidden !important; }
            #player { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; }
            iframe, ins, .adsbygoogle, [id*="ad-container"], [class*="ad-container"] { display: none !important; }
        `;
        parsed.head.appendChild(style);

        const loaderScript = parsed.createElement('script');
        loaderScript.textContent = HLS_LOADER_SOURCE;
        parsed.body.appendChild(loaderScript);

        const playerScript = parsed.createElement('script');
        playerScript.type = 'module';
        playerScript.textContent = patchPlayerScript(streamJs).replace(/<\/script/gi, '<\\/script');
        parsed.body.appendChild(playerScript);

        return '<!doctype html>\n' + parsed.documentElement.outerHTML;
    }

    async function buildMobilePlayer(playerUrl) {
        const playerHtml = await mobileRequest(
            playerUrl,
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        );

        const parsed = new DOMParser().parseFromString(playerHtml, 'text/html');
        const cssPath = parsed.querySelector('link[href*="/assets/stream.css"]')?.getAttribute('href');
        const jsPath = parsed.querySelector('script[src*="/assets/stream.js"]')?.getAttribute('src');
        const valid = /id=["']config["']/.test(playerHtml)
            && !/Sorry, you have been blocked/i.test(playerHtml)
            && cssPath
            && jsPath;

        if (!valid) throw new Error('移动版播放器 HTML 无效或仍被 Cloudflare 拦截');

        const origin = new URL(playerUrl).origin;
        const [streamCss, streamJs] = await Promise.all([
            mobileRequest(new URL(cssPath, origin).href, 'text/css,*/*;q=0.1'),
            mobileRequest(new URL(jsPath, origin).href, 'text/javascript,*/*;q=0.1')
        ]);

        return sanitizePlayerHtml(playerHtml, streamCss, streamJs);
    }

    function writeFrameDocument(frame, html) {
        const pageWindow = typeof unsafeWindow === 'object' ? unsafeWindow : window;
        const frameWindow = frame.contentWindow;
        const frameDocument = frame.contentDocument;
        if (!frameWindow || !frameDocument) throw new Error('无法访问嵌入播放器文档');

        frameWindow.__ctGmHlsRequest = pageWindow.__ctGmHlsRequest;
        frameDocument.open();
        frameDocument.write(html);
        frameDocument.close();
    }

    async function hydrateEmbeddedPlayer(frame, playerUrl) {
        frame.dataset.ctMobilePlayer = 'loading';
        frame.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture');
        frame.setAttribute('allowfullscreen', '');
        frame.src = 'about:blank';

        try {
            writeFrameDocument(frame, `<!doctype html><style>
                html,body{margin:0;width:100%;height:100%;display:grid;place-items:center;background:#000;color:#fff;font:14px -apple-system,BlinkMacSystemFont,sans-serif}
            </style><body>正在加载无广告移动播放器…</body>`);

            const cleanHtml = await buildMobilePlayer(playerUrl);
            if (!frame.isConnected) return;
            writeFrameDocument(frame, cleanHtml);
            frame.dataset.ctMobilePlayer = 'ready';
        } catch (error) {
            if (!frame.isConnected) return;
            const message = String(error?.message || error).replace(/[<>&]/g, '');
            writeFrameDocument(frame, `<!doctype html><style>
                html,body{margin:0;width:100%;height:100%;display:grid;place-items:center;background:#111;color:#fff;font:14px -apple-system,BlinkMacSystemFont,sans-serif}
            </style><body>播放器加载失败：${message}</body>`);
            frame.dataset.ctMobilePlayer = 'error';
        }
    }

    function installEmbeddedPlayerRestorer() {
        const processFrame = (frame) => {
            if (!(frame instanceof HTMLIFrameElement) || frame.dataset.ctMobilePlayer) return;

            let playerUrl;
            try {
                playerUrl = new URL(frame.getAttribute('src') || '', location.href);
            } catch (_) {
                return;
            }

            if (!/(^|\.)explicitdevote\.net$/i.test(playerUrl.hostname) || !/^\/e\//.test(playerUrl.pathname)) return;
            hydrateEmbeddedPlayer(frame, playerUrl.href);
        };

        const scan = (root) => {
            if (!(root instanceof Element)) return;
            if (root instanceof HTMLIFrameElement) processFrame(root);
            root.querySelectorAll('iframe').forEach(processFrame);
        };

        scan(document.documentElement);
        const observer = new MutationObserver((records) => {
            for (const record of records) {
                for (const node of record.addedNodes) scan(node);
            }
        });
        observer.observe(document, { childList: true, subtree: true });
    }

    function showPlayerError(message) {
        document.documentElement.style.visibility = 'visible';
        const banner = document.createElement('div');
        banner.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#111;color:#fff;padding:24px;font:16px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;white-space:pre-wrap';
        banner.textContent = message;
        (document.body || document.documentElement).appendChild(banner);
    }

    async function restoreMobilePlayer() {
        document.documentElement.style.visibility = 'hidden';

        const timeout = setTimeout(() => {
            showPlayerError('移动播放器请求超时。\n请检查 VPN，并在 Tampermonkey 设置中确认“允许脚本修改 HTTP 请求头”为“是”。');
        }, 25000);

        try {
            const cleanHtml = await buildMobilePlayer(location.href);
            clearTimeout(timeout);
            document.open();
            document.write(cleanHtml);
            document.close();
            document.documentElement.style.visibility = 'visible';
            disablePopups();
            installCleaner();
        } catch (error) {
            clearTimeout(timeout);
            showPlayerError(
                `无法获取移动播放器：${error.message}\n` +
                '请确认 VPN 正常，并在 Tampermonkey 设置中允许脚本修改 User-Agent 请求头。'
            );
        }
    }

    spoofNavigator();
    disablePopups();

    if (IS_PLAYER) {
        installGmHlsBridge();
        restoreMobilePlayer();
    } else if (IS_CYCLING) {
        installGmHlsBridge();
        installEmbeddedPlayerRestorer();
        installCleaner();
    }
})();
