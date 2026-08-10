/**
 * JoyTuneRx - OpenWebRX+ Gamepad Control Plugin v1.9
 * Layout: Cross-Handed Biomechanical Shift Mapping + Momentary Triggers + Click Locks
 * Optimized for: Tablet + gamedeck (or Smartphone + Gamepad)
 * Purpose: Hands-free SWL / SOTA / POTA Field Operations
 * - continuous controls use independent repeat timers, not a shared animation-frame debounce;
 * - L2/R2 are safe when OWRX APIs are unavailable;
 * - momentary overrides are restored on release, disconnect and plugin deactivation;
 * - discrete buttons use rising-edge detection (no repeated toggles while held);
 * - D-pad keeps deliberate auto-repeat;
 * - animation delta is capped and reset on controller connection.
 */

(function() {
    let gamepadIndex = null;
    let loopRunning = false;

    // RAF id for proper cancelation of the loop
    let rafId = null;

    // Глобальный флаг работы плагина (управляется кнопкой START)
    let isPluginActive = true;

    // Блокировка валкодера
    let isVfoLocked = false;

    // Delta Time для VFO; сбрасывается при старте loop
    let lastFrameTime = 0;

    // Независимые таймеры для continuous controls.
    // Это намеренно не один общий debounce: движения разных органов
    // управления не должны блокировать друг друга.
    const controlTimers = {
        filter: 0,
        gain: 0,
        sqGate: 0,
        sqHysteresis: 0,
        nrThreshold: 0,
        nrSmoothing: 0,
        vfoLockNotice: 0,
        zoom: 0,
        dpad: 0
    };

    const REPEAT = {
        filter: 100,
        gain: 150,
        sqGate: 100,
        sqHysteresis: 100,
        nrThreshold: 100,
        nrSmoothing: 100,
        vfoLockNotice: 500,
        zoom: 350
    };

    // Состояние предыдущего кадра для edge-triggered кнопок.
    const previousButtons = new Map();

    // Конфигурация экспоненциального валкодера JoyTuneRx
    const VFO_CONFIG = {
        deadzone: 0.15,
        maxSpeedHz: 250000,
        exponent: 2.5
    };

    const HAM_BANDS = [
        { name: "160m", freq: 1840000 },
        { name: "80m",  freq: 3600000 },
        { name: "40m",  freq: 7100000 },
        { name: "20m",  freq: 14200000 },
        { name: "15m",  freq: 21250000 },
        { name: "10m",  freq: 28400000 },
        { name: "2m",   freq: 145500000 },
        { name: "70cm", freq: 433500000 }
    ];

    const MODULATIONS = ["usb", "lsb", "cw", "am", "nfm"];

    let currentBandIndex = 3;
    let currentModIndex = 0;
    let overlayTimeout = null;

    // Память временных override'ов L2/R2.
    let baseSquelchOpen = null;
    let baseSquelchClose = null;
    let baseNrThreshold = null;
    let baseNrSmoothing = null;

    const overlay = document.createElement('div');
    overlay.id = 'sdr-gamepad-overlay';
    overlay.style = `
        position: fixed; top: 15%; left: 50%; transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.85); color: #00ff00; padding: 15px 40px;
        border-radius: 10px; font-family: monospace; font-size: 26px; font-weight: bold;
        border: 2px solid #00ff00; z-index: 9999; display: none; text-align: center;
        box-shadow: 0 0 20px rgba(0,255,0,0.5); pointer-events: none;
    `;
    document.body.appendChild(overlay);

    window.addEventListener("gamepadconnected", (e) => {
        console.log("JoyTuneRx v1.8 Controller Connected:", e.gamepad.id);
        gamepadIndex = e.gamepad.index;
        previousButtons.clear();
        lastFrameTime = performance.now();
        if (isPluginActive) startGamepadLoop();
    });

    window.addEventListener("gamepaddisconnected", (e) => {
        if (gamepadIndex !== null && e.gamepad.index !== gamepadIndex) return;

        console.log("JoyTuneRx Controller Disconnected");
        restoreMomentaryOverrides();
        gamepadIndex = null;
        loopRunning = false;
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        previousButtons.clear();
    });
    
    window.addEventListener('beforeunload', () => { restoreMomentaryOverrides(); });
    
    function startGamepadLoop() {
        if (loopRunning || gamepadIndex === null) return;

        loopRunning = true;
        lastFrameTime = performance.now();

        rafId = requestAnimationFrame(gamepadLoop);
    }

    function gamepadLoop() {
        // Если цикл остановлен явно — выходим и не планируем следующий кадр.
        if (!loopRunning || gamepadIndex === null) {
            loopRunning = false;
            rafId = null;
            return;
        }

        const gp = navigator.getGamepads()[gamepadIndex];

        if (!gp) {
            loopRunning = false;
            rafId = null;
            return;
        }

        const now = performance.now();

        // Защита от огромного скачка после suspend/background/reconnect.
        const deltaTime = Math.min(
            (now - lastFrameTime) / 1000,
            0.05
        );

        lastFrameTime = now;

        processInput(gp, deltaTime);

        rafId = requestAnimationFrame(gamepadLoop);
    }

    function showOverlay(title, value) {
        overlay.innerHTML =
            `<span style="color:#888; font-size:14px;">${title}</span><br>${value}`;

        overlay.style.display = 'block';

        if (overlayTimeout) {
            clearTimeout(overlayTimeout);
        }

        overlayTimeout = setTimeout(() => {
            overlay.style.display = 'none';
            overlayTimeout = null;
        }, 2200);
    }

    function hideOverlayImmediate() {
        if (overlayTimeout) {
            clearTimeout(overlayTimeout);
            overlayTimeout = null;
        }
        overlay.style.display = 'none';
    }

    function toggleSidebar(show) {
        const rightPanel =
            document.getElementById('openwebrx-side-panel') ||
            document.querySelector('.openwebrx-panel');

        const mainPanel =
            document.getElementById('openwebrx-main-container') ||
            document.querySelector('.openwebrx-main');

        if (rightPanel) {
            rightPanel.style.display = show ? 'block' : 'none';

            if (mainPanel) {
                mainPanel.style.marginRight = show ? '' : '0px';
            }
        }
    }

    function isMethod(name) {
        return (
            typeof window.openwebrx !== 'undefined' &&
            (typeof openwebrx[name] === 'function' || typeof openwebrx[name] !== 'undefined')
        );
    }

    function getGamepadButton(gp, index) {
        return gp.buttons[index] || {
            pressed: false,
            value: 0
        };
    }

    function isPressed(gp, index) {
        return !!getGamepadButton(gp, index).pressed;
    }

    function pressedEdge(gp, index) {
        const pressed = isPressed(gp, index);
        const wasPressed = previousButtons.get(index) === true;

        return pressed && !wasPressed;
    }

    function updateButtonState(gp, index) {
        previousButtons.set(index, isPressed(gp, index));
    }

    function shouldRepeat(name, now, interval) {
        if (now - controlTimers[name] < interval) {
            return false;
        }

        controlTimers[name] = now;
        return true;
    }

    function resetControlTimers() {
        for (const key of Object.keys(controlTimers)) {
            controlTimers[key] = 0;
        }
    }

    // ================================================================
    // MOMENTARY OVERRIDES: L2 / R2
    // ================================================================

    function applyL2Override(l2Value) {
        if (
            !isMethod('getSquelchOpenThreshold') ||
            !isMethod('getSquelchCloseThreshold') ||
            !isMethod('setSquelchThresholds')
        ) {
            return false;
        }

        if (baseSquelchOpen === null) {
            baseSquelchOpen =
                openwebrx.getSquelchOpenThreshold();

            baseSquelchClose =
                openwebrx.getSquelchCloseThreshold();
        }

        const sqDrop = Math.round(l2Value * 30);

        openwebrx.setSquelchThresholds(
            baseSquelchOpen - sqDrop,
            baseSquelchClose - sqDrop
        );

        return true;
    }

    function applyR2Override(r2Value) {
        if (
            !isMethod('getNrThreshold') ||
            !isMethod('getNrSmoothing') ||
            !isMethod('setNrParameters')
        ) {
            return false;
        }

        if (baseNrThreshold === null) {
            baseNrThreshold =
                openwebrx.getNrThreshold();

            baseNrSmoothing =
                openwebrx.getNrSmoothing();
        }

        const nrDrop = Math.round(r2Value * 20);

        openwebrx.setNrParameters(
            Math.max(0, baseNrThreshold - nrDrop),
            baseNrSmoothing
        );

        return true;
    }

    function restoreMomentaryOverrides() {
        if (
            baseSquelchOpen !== null &&
            isMethod('setSquelchThresholds')
        ) {
            openwebrx.setSquelchThresholds(
                baseSquelchOpen,
                baseSquelchClose
            );
        }

        baseSquelchOpen = null;
        baseSquelchClose = null;

        if (
            baseNrThreshold !== null &&
            isMethod('setNrParameters')
        ) {
            openwebrx.setNrParameters(
                baseNrThreshold,
                baseNrSmoothing
            );
        }

        baseNrThreshold = null;
        baseNrSmoothing = null;
    }

    function processMomentaryTriggers(gp) {
        const l2 = getGamepadButton(gp, 6);
        const r2 = getGamepadButton(gp, 7);

        // ------------------------------------------------------------
        // L2 — temporary SQ override
        // ------------------------------------------------------------
        if (l2.value > 0.05) {
            applyL2Override(l2.value);
        } else if (baseSquelchOpen !== null) {
            if (isMethod('setSquelchThresholds')) {
                openwebrx.setSquelchThresholds(
                    baseSquelchOpen,
                    baseSquelchClose
                );
            }

            baseSquelchOpen = null;
            baseSquelchClose = null;
        }

        // ------------------------------------------------------------
        // R2 — temporary NR override
        // ------------------------------------------------------------
        if (r2.value > 0.05) {
            applyR2Override(r2.value);
        } else if (baseNrThreshold !== null) {
            if (isMethod('setNrParameters')) {
                openwebrx.setNrParameters(
                    baseNrThreshold,
                    baseNrSmoothing
                );
            }

            baseNrThreshold = null;
            baseNrSmoothing = null;
        }
    }

    function deactivatePlugin() {
        // Если L2/R2 были удержаны — сначала возвращаем исходное состояние.
        restoreMomentaryOverrides();

        isPluginActive = false;

        // Прекращаем цикл и отменяем rAF
        loopRunning = false;
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }

        toggleSidebar(true);

        // Спрятать оверлей немедленно, чтобы не оставлять UI висеть
        hideOverlayImmediate();

        showOverlay(
            "SYSTEM",
            "<span style='color:#ff0000;'>GAMEPAD PAUSED</span><br>" +
            "<span style='font-size:14px; color:#fff;'>SIDEBAR RESTORED</span>"
        );
    }

    function activatePlugin() {
        isPluginActive = true;

        resetControlTimers();

        toggleSidebar(false);

        showOverlay(
            "SYSTEM",
            "GAMEPAD INTERFACE ACTIVE<br>" +
            "<span style='font-size:14px; color:#ff0;'>" +
            "SIDEBAR HIDDEN</span>"
        );

        // Ensure the loop runs if a controller is connected
        if (gamepadIndex !== null) {
            startGamepadLoop();
        }
    }

    function processInput(gp, deltaTime) {
        const now = performance.now();

        // ============================================================
        // START — rising edge only
        // ============================================================

        if (pressedEdge(gp, 9)) {
            if (isPluginActive) {
                deactivatePlugin();
            } else {
                activatePlugin();
            }
        }

        updateButtonState(gp, 9);

        // Если интерфейс плагина отключен — больше ничего не обрабатываем.
        if (!isPluginActive) {
            return;
        }

        // ============================================================
        // MOMENTARY TRIGGERS
        // ============================================================

        processMomentaryTriggers(gp);

        // ============================================================
        // AXES
        // ============================================================

        const rxStickX = gp.axes[2] || 0;
        const rxStickY = gp.axes[3] || 0;
        const lxStickX = gp.axes[0] || 0;
        const lxStickY = gp.axes[1] || 0;

        // Определяем наличие левого стика.
        // Half-gamepad может иметь только один аналоговый стик.
        const hasRightStick =
            gp.axes.length >= 4;

        // ============================================================
        // BUMPERS
        // ============================================================

        const l1Pressed = isPressed(gp, 4);
        const r1Pressed = isPressed(gp, 5);

        // ============================================================
        // RIGHT STICK — SQ shift or VFO + zoom
        // ============================================================

        if (l1Pressed) {

            // --------------------------------------------------------
            // L1 + Right Stick X — SQ gate
            // --------------------------------------------------------

            if (
                Math.abs(rxStickX) > 0.2 &&
                shouldRepeat('sqGate', now, REPEAT.sqGate)
            ) {
                if (
                    isMethod('getSquelchOpenThreshold') &&
                    isMethod('getSquelchCloseThreshold') &&
                    isMethod('setSquelchThresholds')
                ) {
                    const currentOpen =
                        openwebrx.getSquelchOpenThreshold();

                    const currentClose =
                        openwebrx.getSquelchCloseThreshold();

                    const delta =
                        rxStickX > 0 ? 1 : -1;

                    openwebrx.setSquelchThresholds(
                        currentOpen + delta,
                        currentClose + delta
                    );

                    showOverlay(
                        "BASE SQ GATE",
                        `Open: ${currentOpen + delta}dB | ` +
                        `Close: ${currentClose + delta}dB`
                    );
                }
            }

            // --------------------------------------------------------
            // L1 + Right Stick Y — SQ hysteresis
            // --------------------------------------------------------

            if (
                Math.abs(rxStickY) > 0.3 &&
                shouldRepeat(
                    'sqHysteresis',
                    now,
                    REPEAT.sqHysteresis
                )
            ) {
                if (
                    isMethod('getSquelchOpenThreshold') &&
                    isMethod('getSquelchCloseThreshold') &&
                    isMethod('setSquelchThresholds')
                ) {
                    const currentOpen =
                        openwebrx.getSquelchOpenThreshold();

                    const currentClose =
                        openwebrx.getSquelchCloseThreshold();

                    const direction =
                        rxStickY < 0 ? 1 : -1;

                    const newOpen =
                        currentOpen + direction;

                    if (newOpen > currentClose) {
                        openwebrx.setSquelchThresholds(
                            newOpen,
                            currentClose
                        );

                        showOverlay(
                            "BASE SQ HYSTERESIS",
                            `Width: ${newOpen - currentClose} dB`
                        );
                    }
                }
            }

        } else {

            // --------------------------------------------------------
            // Right Stick X — VFO
            // --------------------------------------------------------

            if (Math.abs(rxStickX) > VFO_CONFIG.deadzone) {

                if (
                    !isVfoLocked &&
                    isMethod('getFrequency') &&
                    isMethod('setFrequency')
                ) {
                    const currentFreq =
                        openwebrx.getFrequency();

                    const sign =
                        Math.sign(rxStickX);

                    const normalizedInput =
                        (
                            Math.abs(rxStickX) -
                            VFO_CONFIG.deadzone
                        ) /
                        (1 - VFO_CONFIG.deadzone);

                    const acceleratedFactor =
                        Math.pow(
                            normalizedInput,
                            VFO_CONFIG.exponent
                        );

                    const freqOffset =
                        Math.round(
                            sign *
                            VFO_CONFIG.maxSpeedHz *
                            acceleratedFactor *
                            deltaTime
                        );

                    if (freqOffset !== 0) {
                        openwebrx.setFrequency(
                            currentFreq + freqOffset
                        );
                    }

                } else if (
                    isVfoLocked &&
                    shouldRepeat(
                        'vfoLockNotice',
                        now,
                        REPEAT.vfoLockNotice
                    )
                ) {
                    showOverlay(
                        "VFO LOCK",
                        "<span style='color:#ff0000;'>" +
                        "DIAL LOCKED!</span>"
                    );
                }
            }

            // --------------------------------------------------------
            // Right Stick Y — waterfall zoom
            // --------------------------------------------------------

            const ZOOM_THRESHOLD = 0.6;

            if (
                Math.abs(rxStickY) > ZOOM_THRESHOLD &&
                shouldRepeat('zoom', now, REPEAT.zoom)
            ) {
                if (
                    rxStickY < -ZOOM_THRESHOLD &&
                    typeof window.ui !== 'undefined' &&
                    typeof ui.zoomIn === "function"
                ) {
                    ui.zoomIn();

                } else if (
                    rxStickY > ZOOM_THRESHOLD &&
                    typeof window.ui !== 'undefined' &&
                    typeof ui.zoomOut === "function"
                ) {
                    ui.zoomOut();
                }
            }
        }

        // ============================================================
        // LEFT STICK — NR shift or filter + RF gain
        // ============================================================

        if (hasRightStick) {

            if (r1Pressed) {

                // ----------------------------------------------------
                // R1 + Left Stick X — NR threshold
                // ----------------------------------------------------

                if (
                    Math.abs(lxStickX) > 0.3 &&
                    shouldRepeat(
                        'nrThreshold',
                        now,
                        REPEAT.nrThreshold
                    )
                ) {
                    if (
                        isMethod('getNrThreshold') &&
                        isMethod('getNrSmoothing') &&
                        isMethod('setNrParameters')
                    ) {
                        const currentNrThresh =
                            openwebrx.getNrThreshold();

                        const currentNrSmooth =
                            openwebrx.getNrSmoothing();

                        const delta =
                            lxStickX > 0 ? 1 : -1;

                        openwebrx.setNrParameters(
                            currentNrThresh + delta,
                            currentNrSmooth
                        );

                        showOverlay(
                            "BASE NR THRESHOLD",
                            `Threshold: ${currentNrThresh + delta} | ` +
                            `Smooth: ${currentNrSmooth}`
                        );
                    }
                }

                // ----------------------------------------------------
                // R1 + Left Stick Y — NR smoothing
                // ----------------------------------------------------

                if (
                    Math.abs(lxStickY) > 0.3 &&
                    shouldRepeat(
                        'nrSmoothing',
                        now,
                        REPEAT.nrSmoothing
                    )
                ) {
                    if (
                        isMethod('getNrThreshold') &&
                        isMethod('getNrSmoothing') &&
                        isMethod('setNrParameters')
                    ) {
                        const currentNrThresh =
                            openwebrx.getNrThreshold();

                        const currentNrSmooth =
                            openwebrx.getNrSmoothing();

                        const direction =
                            lxStickY < 0 ? 1 : -1;

                        const newSmooth =
                            Math.max(
                                0,
                                currentNrSmooth + direction
                            );

                        openwebrx.setNrParameters(
                            currentNrThresh,
                            newSmooth
                        );

                        showOverlay(
                            "BASE NR SMOOTHING",
                            `Smooth Level: ${newSmooth}`
                        );
                    }
                }

            } else {

                // ----------------------------------------------------
                // Left Stick Y — filter high cutoff
                // ----------------------------------------------------

                if (
                    Math.abs(lxStickY) > 0.3 &&
                    shouldRepeat(
                        'filter',
                        now,
                        REPEAT.filter
                    )
                ) {
                    if (
                        isMethod('getFilterLow') &&
                        isMethod('getFilterHigh') &&
                        isMethod('setFilterMargins')
                    ) {
                        const currentLow =
                            openwebrx.getFilterLow();

                        const currentHigh =
                            openwebrx.getFilterHigh();

                        const delta =
                            (lxStickY < 0 ? 1 : -1) * 50;

                        const newHigh =
                            currentHigh + delta;

                        if (
                            newHigh >= 1000 &&
                            newHigh <= 4000
                        ) {
                            openwebrx.setFilterMargins(
                                currentLow,
                                newHigh
                            );

                            showOverlay(
                                "FILTER HIGH CUT",
                                `${newHigh} Hz`
                            );
                        }
                    }
                }

                // ----------------------------------------------------
                // Left Stick X — RF gain
                // ----------------------------------------------------

                if (
                    Math.abs(lxStickX) > 0.4 &&
                    shouldRepeat(
                        'gain',
                        now,
                        REPEAT.gain
                    )
                ) {
                    if (isMethod('setRfGain')) {

                        const currentGain =
                            isMethod('getRfGain')
                                ? openwebrx.getRfGain()
                                : 20;

                        const newGain =
                            currentGain +
                            (lxStickX > 0 ? 1 : -1);

                        openwebrx.setRfGain(newGain);

                        showOverlay(
                            "RF GAIN",
                            `${newGain}`
                        );
                    }
                }
            }
        }

        // ============================================================
        // D-PAD — deliberate auto-repeat
        // ============================================================

        const dpadRepeat = 250;

        if (shouldRepeat('dpad', now, dpadRepeat)) {

            // UP — next band
            if (isPressed(gp, 12)) {

                currentBandIndex =
                    (currentBandIndex + 1) %
                    HAM_BANDS.length;

                const targetBand =
                    HAM_BANDS[currentBandIndex];

                if (isMethod('setFrequency')) {
                    openwebrx.setFrequency(
                        targetBand.freq
                    );
                }

                showOverlay(
                    "RADIO BAND",
                    `${targetBand.name} <br>` +
                    `<span style="color:#fff; font-size:18px;">` +
                    `(${(targetBand.freq / 1000000).toFixed(3)} MHz)` +
                    `</span>`
                );

            // DOWN — previous band
            } else if (isPressed(gp, 13)) {

                currentBandIndex =
                    (
                        currentBandIndex -
                        1 +
                        HAM_BANDS.length
                    ) %
                    HAM_BANDS.length;

                const targetBand =
                    HAM_BANDS[currentBandIndex];

                if (isMethod('setFrequency')) {
                    openwebrx.setFrequency(
                        targetBand.freq
                    );
                }

                showOverlay(
                    "RADIO BAND",
                    `${targetBand.name} <br>` +
                    `<span style="color:#fff; font-size:18px;">` +
                    `(${(targetBand.freq / 1000000).toFixed(3)} MHz)` +
                    `</span>`
                );

            // LEFT — previous modulation
            } else if (isPressed(gp, 14)) {

                currentModIndex =
                    (
                        currentModIndex -
                        1 +
                        MODULATIONS.length
                    ) %
                    MODULATIONS.length;

                if (isMethod('setDemodulator')) {
                    openwebrx.setDemodulator(
                        MODULATIONS[currentModIndex]
                    );
                }

                showOverlay(
                    "DEMODULATOR",
                    MODULATIONS[currentModIndex].toUpperCase()
                );

            // RIGHT — next modulation
            } else if (isPressed(gp, 15)) {

                currentModIndex =
                    (
                        currentModIndex + 1
                    ) %
                    MODULATIONS.length;

                if (isMethod('setDemodulator')) {
                    openwebrx.setDemodulator(
                        MODULATIONS[currentModIndex]
                    );
                }

                showOverlay(
                    "DEMODULATOR",
                    MODULATIONS[currentModIndex].toUpperCase()
                );
            }
        }

        // ============================================================
        // SELECT + A/B/X/Y + L3 + R3 — rising edge only
        // ============================================================

        // SELECT — AGC
        if (pressedEdge(gp, 8)) {
            if (isMethod('toggleAgc')) {
                openwebrx.toggleAgc();

                showOverlay(
                    "RECEIVER AGC",
                    "TOGGLED"
                );
            }
        }

        // A — Squelch
        if (pressedEdge(gp, 0)) {
            if (isMethod('toggleSquelch')) {
                openwebrx.toggleSquelch();
            }

            showOverlay(
                "SQUELCH MUTE",
                "TOGGLED"
            );
        }

        // B — Filter reset
        if (pressedEdge(gp, 1)) {
            if (isMethod('resetFilter')) {
                openwebrx.resetFilter();
            }

            showOverlay(
                "DSP FILTER",
                "RESET TO DEFAULT"
            );
        }

        // X — Center waterfall
        if (pressedEdge(gp, 2)) {
            if (
                typeof window.ui !== 'undefined' &&
                typeof ui.centerWaterfall === "function"
            ) {
                ui.centerWaterfall();
            }

            showOverlay(
                "WATERFALL VIEW",
                "CENTERED"
            );
        }

        // Y — Add bookmark
        if (pressedEdge(gp, 3)) {
            if (
                typeof window.ui !== 'undefined' &&
                typeof ui.addBookmark === "function"
            ) {
                ui.addBookmark();
            }

            showOverlay(
                "BOOKMARK MEMORY",
                "FREQUENCY SAVED"
            );
        }

        // L3 — Left stick click — Notch toggle (rising edge)
        if (pressedEdge(gp, 10)) {
            if (isMethod('toggleNotch')) {
                openwebrx.toggleNotch();
            } else if (isMethod('toggleNotchFilter')) {
                openwebrx.toggleNotchFilter();
            } else {
                console.warn('Notch toggle API not available (toggleNotch / toggleNotchFilter)');
            }

            showOverlay(
                "NOTCH FILTER",
                "TOGGLED"
            );
        }

        // R3 — Right stick click — VFO lock (rising edge)
        if (pressedEdge(gp, 11)) {
            isVfoLocked = !isVfoLocked;

            showOverlay(
                "VFO LOCK",
                isVfoLocked
                    ? "<span style='color:#ff0000;'>LOCKED</span>"
                    : "<span style='color:#00ff00;'>UNLOCKED</span>"
            );
        }

        // Сохраняем состояние дискретных кнопок
        // для следующего кадра.
        [0, 1, 2, 3, 8, 9, 10, 11].forEach(
            index => updateButtonState(gp, index)
        );

        [12, 13, 14, 15].forEach(
            index => updateButtonState(gp, index)
        );
    }

    // Initial scan: if a controller is already connected before script load
    (function initConnectedGamepad() {
        if (!navigator.getGamepads) return;

        const gps = navigator.getGamepads();
        for (let i = 0; i < gps.length; i++) {
            const g = gps[i];
            if (g) {
                console.log("JoyTuneRx found existing controller:", g.id);
                gamepadIndex = g.index;
                previousButtons.clear();
                lastFrameTime = performance.now();
                startGamepadLoop();
                break;
            }
        }
    })();
})();
