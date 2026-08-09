<script lang="ts">
    import type { P2PServerInfo } from "@vrtmrz/livesync-commonlib/compat/replication/trystero/TrysteroReplicatorP2PServer";
    import qrcode from "qrcode-generator";
    import { onDestroy, tick } from "svelte";

    import {
        generateP2PCheckSetup,
        resolveLocalP2PCheckRelayOverride,
        type GeneratedP2PCheckSetup,
        type P2PCheckTarget,
    } from "./P2PCheckSetup";
    import { P2PCheckSession } from "./P2PCheckSession";
    import {
        EMPTY_P2P_CHECK_DIAGNOSTICS,
        P2P_CHECK_OBSERVATION_MILLISECONDS,
        captureP2PAdditionalCheckBaseline,
        countActiveP2PConnections,
        deriveP2PAdditionalCheckProgress,
        deriveP2PCheckOutcome,
        type P2PAdditionalCheckBaseline,
        type P2PAdditionalCheckOutcome,
        type P2PCheckOutcome,
    } from "./P2PCheckState";

    const OUTCOME_COPY: Record<
        P2PCheckOutcome,
        { readonly title: string; readonly body: string; readonly tone: string }
    > = {
        idle: {
            title: "Not monitoring yet",
            body: "Prepare the reference peer, then start monitoring before opening the Setup URI on the target device.",
            tone: "neutral",
        },
        waiting: {
            title: "Waiting for the device",
            body: "The browser reference peer is ready. Keep this page open and complete setup in the empty test Vault.",
            tone: "neutral",
        },
        connecting: {
            title: "Negotiating a connection",
            body: "A WebRTC connection attempt is in progress. The counters can increase more than once during negotiation.",
            tone: "progress",
        },
        retrying: {
            title: "An attempt failed; waiting for a retry",
            body: "A failed attempt is not final. Leave both peers open because a later retry can still succeed.",
            tone: "warning",
        },
        connected: {
            title: "P2P connection observed",
            body: "This browser and the target device established at least one WebRTC connection. This checks connectivity, not note synchronisation.",
            tone: "success",
        },
        inconclusive: {
            title: "No P2P connection observed",
            body: "No successful connection was seen during the observation period. Repeat the check on the networks you intend to use; if it remains unsuccessful, CouchDB is the more predictable choice.",
            tone: "warning",
        },
        error: {
            title: "The browser monitor could not start",
            body: "Check browser support, the secure-context requirement, and access to the signalling relay, then start a fresh check.",
            tone: "error",
        },
    };

    const ADDITIONAL_OUTCOME_COPY: Record<
        P2PAdditionalCheckOutcome,
        { readonly title: string; readonly body: string; readonly tone: string }
    > = {
        waiting: {
            title: "Waiting for another device",
            body: "The same Setup URI is ready. Keep the browser and first device open while another empty Vault joins.",
            tone: "neutral",
        },
        negotiating: {
            title: "New connection activity observed",
            body: "The counters or active connections changed. Waiting for both a new successful state and another simultaneous active connection.",
            tone: "progress",
        },
        connected: {
            title: "An additional connection was observed",
            body: "The browser gained another simultaneous active WebRTC connection after this attempt began.",
            tone: "success",
        },
        inconclusive: {
            title: "Another device was not identified",
            body: "The same-room baseline did not produce both signals during this observation period. Use a fresh check for a clean per-device result.",
            tone: "warning",
        },
    };

    interface AdditionalDeviceAttempt {
        readonly baseline: P2PAdditionalCheckBaseline;
        readonly startedAtElapsedMilliseconds: number;
    }

    let target = $state<P2PCheckTarget>("desktop");
    let setup = $state<GeneratedP2PCheckSetup>();
    let qrDataURL = $state("");
    let preparing = $state(false);
    let preparationError = $state("");
    let monitorStarting = $state(false);
    let monitorActive = $state(false);
    let monitorError = $state("");
    let status = $state<P2PServerInfo>();
    let elapsedMilliseconds = $state(0);
    let copied = $state<"uri" | "passphrase">();
    let copyError = $state("");
    let freshCheckStarting = $state(false);
    let additionalDeviceAttempt = $state<AdditionalDeviceAttempt>();

    let session: P2PCheckSession | undefined;
    let setupCard = $state<HTMLElement>();
    let setupHeading = $state<HTMLHeadingElement>();
    let elapsedTimer: ReturnType<typeof setInterval> | undefined;
    let copyTimer: ReturnType<typeof setTimeout> | undefined;
    let monitorStartedAt = 0;

    let diagnostics = $derived(status?.diag ?? EMPTY_P2P_CHECK_DIAGNOSTICS);
    let outcome = $derived(
        deriveP2PCheckOutcome(
            diagnostics,
            monitorActive,
            elapsedMilliseconds,
            monitorError !== ""
        )
    );
    let outcomeCopy = $derived(OUTCOME_COPY[outcome]);
    let activeConnections = $derived(countActiveP2PConnections(diagnostics));
    let observationSeconds = $derived(
        Math.floor(P2P_CHECK_OBSERVATION_MILLISECONDS / 1_000)
    );
    let elapsedSeconds = $derived(Math.floor(elapsedMilliseconds / 1_000));
    let targetLabel = $derived(target === "desktop" ? "desktop" : "mobile");
    let additionalElapsedMilliseconds = $derived(
        additionalDeviceAttempt
            ? Math.max(
                  0,
                  elapsedMilliseconds -
                      additionalDeviceAttempt.startedAtElapsedMilliseconds
              )
            : 0
    );
    let additionalElapsedSeconds = $derived(
        Math.floor(additionalElapsedMilliseconds / 1_000)
    );
    let additionalProgress = $derived(
        additionalDeviceAttempt
            ? deriveP2PAdditionalCheckProgress(
                  diagnostics,
                  additionalDeviceAttempt.baseline,
                  additionalElapsedMilliseconds
              )
            : undefined
    );
    let additionalOutcomeCopy = $derived(
        additionalProgress
            ? ADDITIONAL_OUTCOME_COPY[additionalProgress.outcome]
            : undefined
    );

    function createQRCodeDataURL(setupURI: string): string {
        const code = qrcode(0, "L");
        code.addData(setupURI);
        code.make();
        return code.createDataURL(4, 4);
    }

    function formatError(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    async function prepareCheck(): Promise<void> {
        preparing = true;
        preparationError = "";
        try {
            const relay = resolveLocalP2PCheckRelayOverride(window.location);
            const generated = await generateP2PCheckSetup(target, { relay });
            qrDataURL = createQRCodeDataURL(generated.setupURI);
            setup = generated;
        } catch (error) {
            preparationError = formatError(error);
        } finally {
            preparing = false;
        }
    }

    function updateElapsedTime(): void {
        elapsedMilliseconds = Date.now() - monitorStartedAt;
    }

    async function startMonitor(): Promise<void> {
        if (!setup || monitorStarting || monitorActive) {
            return;
        }
        monitorStarting = true;
        monitorError = "";
        const newSession = new P2PCheckSession();
        session = newSession;
        try {
            await newSession.start(setup.browserSettings, setup.browserDeviceName, (nextStatus) => {
                status = nextStatus;
            });
            monitorActive = true;
            monitorStartedAt = Date.now();
            elapsedMilliseconds = 0;
            elapsedTimer = setInterval(updateElapsedTime, 250);
        } catch (error) {
            monitorError = formatError(error);
            monitorActive = false;
        } finally {
            monitorStarting = false;
        }
    }

    async function copyText(value: string, kind: "uri" | "passphrase"): Promise<void> {
        copyError = "";
        try {
            await navigator.clipboard.writeText(value);
            copied = kind;
            if (copyTimer !== undefined) {
                clearTimeout(copyTimer);
            }
            copyTimer = setTimeout(() => {
                copied = undefined;
            }, 2_000);
        } catch (error) {
            copyError = `Copying failed: ${formatError(error)}. Select the text and copy it manually.`;
        }
    }

    async function startFreshCheck(): Promise<void> {
        freshCheckStarting = true;
        if (elapsedTimer !== undefined) {
            clearInterval(elapsedTimer);
        }
        await session?.stop();
        window.location.reload();
    }

    function scrollToSetupQRCode(): void {
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        setupCard?.scrollIntoView({
            behavior: reducedMotion ? "auto" : "smooth",
            block: "start",
        });
        setupHeading?.focus({ preventScroll: true });
    }

    async function showSetupQRCode(): Promise<void> {
        await tick();
        scrollToSetupQRCode();
    }

    async function startAdditionalDeviceAttempt(): Promise<void> {
        if (
            !monitorActive ||
            outcome !== "connected" ||
            activeConnections === 0 ||
            additionalDeviceAttempt
        ) {
            return;
        }
        additionalDeviceAttempt = {
            baseline: captureP2PAdditionalCheckBaseline(diagnostics),
            startedAtElapsedMilliseconds: elapsedMilliseconds,
        };
        await showSetupQRCode();
    }

    onDestroy(() => {
        if (elapsedTimer !== undefined) {
            clearInterval(elapsedTimer);
        }
        if (copyTimer !== undefined) {
            clearTimeout(copyTimer);
        }
        void session?.stop();
    });
</script>

<svelte:head>
    <meta name="theme-color" content="#12233f" />
</svelte:head>

<main class="check-shell">
    <header class="hero">
        <a class="eyebrow" href="./index.html">Self-hosted LiveSync · WebPeer</a>
        <h1>P2P connection check</h1>
        <p class="hero-copy">
            See whether one LiveSync device can establish a WebRTC connection to this browser on
            the current network.
        </p>
        <div class="scope-note" role="note">
            <span aria-hidden="true">◇</span>
            <strong>Empty test Vaults only.</strong>
            This is a disposable connectivity check, not a synchronisation or backup test.
        </div>
    </header>

    <section class="step-card" aria-labelledby="choose-target-heading">
        <div class="step-number" aria-hidden="true">1</div>
        <div class="step-content">
            <p class="section-kicker">Choose one target</p>
            <h2 id="choose-target-heading">Which device will connect to this browser?</h2>
            <p class="section-copy">
                Check desktop and mobile separately. A fresh test gives each device its own random
                room and clear diagnostic counters.
            </p>

            <fieldset class="target-picker" disabled={setup !== undefined}>
                <legend class="visually-hidden">Target device</legend>
                <label class:chosen={target === "desktop"} class="target-option">
                    <input type="radio" bind:group={target} value="desktop" />
                    <span class="target-icon" aria-hidden="true">▰</span>
                    <span>
                        <strong>Desktop LiveSync</strong>
                        <small>Browser ↔ desktop plug-in</small>
                    </span>
                </label>
                <label class:chosen={target === "mobile"} class="target-option">
                    <input type="radio" bind:group={target} value="mobile" />
                    <span class="target-icon mobile" aria-hidden="true">▯</span>
                    <span>
                        <strong>Mobile LiveSync</strong>
                        <small>Browser ↔ mobile plug-in</small>
                    </span>
                </label>
            </fieldset>

            <button class="primary-action" type="button" onclick={prepareCheck} disabled={preparing || setup !== undefined}>
                {preparing ? "Preparing locally…" : `Prepare ${targetLabel} check`}
            </button>
            <p class="privacy-line">
                Preparing generates and encrypts everything in this browser. It does not contact
                the signalling relay.
            </p>
            {#if preparationError}
                <p class="inline-error" role="alert">{preparationError}</p>
            {/if}
        </div>
    </section>

    {#if setup}
        <section bind:this={setupCard} class="step-card setup-card" aria-labelledby="setup-heading">
            <div class="step-number" aria-hidden="true">2</div>
            <div class="step-content">
                <p class="section-kicker">Set up the empty Vault</p>
                <h2 bind:this={setupHeading} id="setup-heading" tabindex="-1">
                    {additionalDeviceAttempt
                        ? "Use this same one-off configuration on another device"
                        : `Open this one-off configuration on ${targetLabel}`}
                </h2>
                {#if additionalDeviceAttempt}
                    <p class="section-copy">
                        Keep the browser and first device open. In another new empty Vault, scan
                        this same QR code or open the same Setup URI, then enter the same separate
                        passphrase.
                    </p>
                    <p class="reuse-note" role="note">
                        The room, credentials, connection, and existing counters have not been
                        reset. The additional-device result uses the values recorded when you
                        selected the button.
                    </p>
                {:else}
                    <p class="section-copy">
                        In a new empty Vault with Self-hosted LiveSync installed and enabled, scan
                        the QR code or open the Setup URI. Enter the separate passphrase when
                        prompted.
                    </p>
                {/if}

                <div class="setup-grid">
                    <div class="qr-panel">
                        <img
                            src={qrDataURL}
                            alt={additionalDeviceAttempt
                                ? "Setup URI QR code for another device"
                                : `Setup URI QR code for the ${targetLabel} check`}
                        />
                        <p>
                            {additionalDeviceAttempt
                                ? "This is the original encrypted Setup URI; it was not regenerated."
                                : "QR contains the encrypted Setup URI only."}
                        </p>
                    </div>

                    <div class="credential-panel">
                        <label for="setup-passphrase">Setup URI passphrase</label>
                        <div class="copy-row compact">
                            <input
                                id="setup-passphrase"
                                value={setup.setupPassphrase}
                                autocomplete="off"
                                spellcheck="false"
                                readonly
                            />
                            <button type="button" onclick={() => copyText(setup!.setupPassphrase, "passphrase")}>
                                {copied === "passphrase" ? "Copied" : "Copy"}
                            </button>
                        </div>
                        <p class="field-help">Type this when LiveSync asks to decrypt the Setup URI.</p>

                        <label for="setup-uri">Setup URI</label>
                        <textarea
                            id="setup-uri"
                            rows="4"
                            autocomplete="off"
                            spellcheck="false"
                            readonly
                            value={setup.setupURI}
                        ></textarea>
                        <div class="button-row">
                            <button type="button" onclick={() => copyText(setup!.setupURI, "uri")}>
                                {copied === "uri" ? "Copied URI" : "Copy Setup URI"}
                            </button>
                            <a class="button-link" href={setup.setupURI}>Open in Obsidian</a>
                        </div>
                        {#if copyError}
                            <p class="inline-error" role="alert">{copyError}</p>
                        {/if}
                    </div>
                </div>

                <dl class="session-details">
                    <div>
                        <dt>Target</dt>
                        <dd>{targetLabel}</dd>
                    </div>
                    <div>
                        <dt>Test Group ID</dt>
                        <dd>{setup.groupId}</dd>
                    </div>
                    <div>
                        <dt>Signalling relay</dt>
                        <dd>{setup.relay}</dd>
                    </div>
                </dl>
            </div>
        </section>

        <section class="step-card results-card" aria-labelledby="monitor-heading">
            <div class="step-number" aria-hidden="true">3</div>
            <div class="step-content">
                <p class="section-kicker">Watch the browser diagnostics</p>
                <h2 id="monitor-heading">Start monitoring, then complete setup on {targetLabel}</h2>
                <p class="section-copy">
                    Starting monitoring joins the configured signalling relay. Keep this page and
                    the target Vault open for at least {observationSeconds} seconds.
                </p>

                <button
                    class="primary-action monitor-action"
                    type="button"
                    onclick={startMonitor}
                    disabled={monitorStarting || monitorActive}
                >
                    {monitorStarting ? "Starting browser peer…" : monitorActive ? "Monitoring is active" : "Start connection monitor"}
                </button>

                <div class="outcome" class:success={outcomeCopy.tone === "success"} class:warning={outcomeCopy.tone === "warning"} class:error={outcomeCopy.tone === "error"} class:progress={outcomeCopy.tone === "progress"} aria-live="polite">
                    <div class="outcome-mark" aria-hidden="true">
                        {outcome === "connected" ? "✓" : outcome === "error" ? "!" : outcome === "inconclusive" ? "?" : "•"}
                    </div>
                    <div>
                        <h3>{outcomeCopy.title}</h3>
                        <p>{outcomeCopy.body}</p>
                        {#if monitorActive}
                            <small>{elapsedSeconds}s observed · {activeConnections} currently connected</small>
                        {/if}
                        {#if monitorError}
                            <code>{monitorError}</code>
                        {/if}
                    </div>
                </div>

                <div class="metrics" aria-label="WebRTC diagnostic totals since this page opened">
                    <article>
                        <span>New</span>
                        <strong data-testid="diag-new">{diagnostics.totalNewConnections}</strong>
                        <small>connection states</small>
                    </article>
                    <article class="successful">
                        <span>Successful</span>
                        <strong data-testid="diag-successful">{diagnostics.totalSuccessfulConnections}</strong>
                        <small>connection states</small>
                    </article>
                    <article class="failed">
                        <span>Failed</span>
                        <strong data-testid="diag-failed">{diagnostics.totalFailedConnections}</strong>
                        <small>connection states</small>
                    </article>
                    <article>
                        <span>Closed</span>
                        <strong data-testid="diag-closed">{diagnostics.totalClosedConnections}</strong>
                        <small>connection states</small>
                    </article>
                </div>

                <p class="counter-note">
                    These are negotiation events, not device counts. <strong>Successful &gt; 0</strong>
                    is the connection signal; later failures or closures do not erase it.
                </p>

                {#if additionalProgress && additionalOutcomeCopy}
                    <div
                        class="outcome additional-outcome"
                        class:success={additionalOutcomeCopy.tone === "success"}
                        class:warning={additionalOutcomeCopy.tone === "warning"}
                        class:progress={additionalOutcomeCopy.tone === "progress"}
                        aria-live="polite"
                        data-testid="additional-device-outcome"
                    >
                        <div class="outcome-mark" aria-hidden="true">
                            {additionalProgress.outcome === "connected"
                                ? "✓"
                                : additionalProgress.outcome === "inconclusive"
                                  ? "?"
                                  : "•"}
                        </div>
                        <div>
                            <p class="section-kicker">Another device in this room</p>
                            <h3>{additionalOutcomeCopy.title}</h3>
                            <p>{additionalOutcomeCopy.body}</p>
                            <small>
                                {additionalElapsedSeconds}s observed ·
                                <span data-testid="additional-successful">
                                    +{additionalProgress.successfulConnections} successful
                                </span>
                                ·
                                <span data-testid="additional-active-connections">
                                    +{additionalProgress.activeConnections} active
                                </span>
                            </small>
                        </div>
                    </div>
                    <p class="counter-note additional-caveat">
                        Same-room counters remain cumulative and connections are not device counts.
                        The first device must stay connected; a fresh room remains the clearest
                        per-device comparison.
                    </p>
                {/if}

                <div class="session-actions">
                    <button class="secondary-action" type="button" onclick={showSetupQRCode}>
                        Show the Setup QR again
                    </button>
                    {#if outcome === "connected" && !additionalDeviceAttempt}
                        <button
                            class="primary-action"
                            type="button"
                            onclick={startAdditionalDeviceAttempt}
                            disabled={activeConnections === 0}
                        >
                            {activeConnections === 0
                                ? "Waiting for the first device to reconnect…"
                                : "Try another device without resetting"}
                        </button>
                    {/if}
                    <button
                        class="secondary-action"
                        type="button"
                        onclick={startFreshCheck}
                        disabled={freshCheckStarting}
                    >
                        {freshCheckStarting ? "Closing this check…" : "Start a fresh check for the other device"}
                    </button>
                </div>
            </div>
        </section>

        <aside class="next-step" aria-labelledby="next-step-heading">
            <p class="section-kicker">What this tells you</p>
            <h2 id="next-step-heading">Use the result as a P2P preflight</h2>
            <div class="next-step-grid">
                <div>
                    <h3>If both devices are observed</h3>
                    <p>
                        P2P looks plausible on these networks. Separate fresh checks give the
                        clearest device comparison. For a stronger final check, use two disposable
                        empty Vaults and verify a note round trip directly between your devices.
                    </p>
                </div>
                <div>
                    <h3>If checks repeatedly do not connect</h3>
                    <p>
                        Network policy or NAT may make P2P unreliable. Use CouchDB when you need a
                        predictable synchronisation path across these networks.
                    </p>
                </div>
            </div>
        </aside>
    {/if}

    <footer>
        <p>
            The generated credentials are disposable. Delete the empty test Vault afterwards and
            generate new credentials for any real setup.
        </p>
    </footer>
</main>
