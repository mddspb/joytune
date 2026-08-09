/**
 * JoyTuneRx - OpenWebRX+ Gamepad Control Plugin v1.7
 * Layout: Cross-Handed Biomechanical Shift Mapping + Analog Triggers + Click Locks
 * Optimized for: Tablet + iPega PG-9023 (or Smartphone + Half-Gamepad)
 * Purpose: Hands-free SWL / SOTA / POTA Field Operations
 */

(function() {
    let gamepadIndex = null;
    let lastActiveTime = 0;
    let lastZoomTime = 0;
    
    // Глобальный флаг работы плагина (управляется кнопкой START)
    let isPluginActive = true; 

    // Новые флаги блокировок и фильтров (v1.7)
    let isVfoLocked = false;

    // Списки для циклического перебора D-Pad
    const HAM_BANDS =; 
    const MODULATIONS = ["usb", "lsb", "cw", "am", "nfm"];
    
    let currentBandIndex = 3; // Старт по умолчанию с 14 МГц (20 метров)
    let currentModIndex = 0;  // Старт по умолчанию с USB

    let overlayTimeout = null;

    // Переменные памяти для возврата порогов после отпускания курков
    let baseSquelchOpen = null;
    let baseSquelchClose = null;
    let baseNrThreshold = null;
    let baseNrSmoothing = null;

    // --- Инициализация HTML-оверлеев (HUD) в DOM ---
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
        console.log("SDR v1.7 Controller Connected:", e.gamepad.id);
        gamepadIndex = e.gamepad.index;
        startGamepadLoop();
    });

    window.addEventListener("gamepaddisconnected", () => {
        console.log("SDR Controller Disconnected");
        gamepadIndex = null;
    });

    function startGamepadLoop() {
        if (gamepadIndex === null) return;
        const gp = navigator.getGamepads()[gamepadIndex];
        if (!gp) return;

        processInput(gp);
        requestAnimationFrame(startGamepadLoop);
    }

    // Всплывающее HUD-уведомление по центру экрана
    function showOverlay(title, value) {
        overlay.innerHTML = `<span style="color:#888; font-size:14px;">${title}</span><br>${value}`;
        overlay.style.display = 'block';
        
        if (overlayTimeout) clearTimeout(overlayTimeout);
        overlayTimeout = setTimeout(() => {
            overlay.style.display = 'none';
        }, 2200);
    }

    // Сворачивание и разворачивание правой панели OpenWebRX+
    function toggleSidebar(show) {
        const rightPanel = document.getElementById('openwebrx-side-panel') || document.querySelector('.openwebrx-panel');
        const mainPanel = document.getElementById('openwebrx-main-container') || document.querySelector('.openwebrx-main');
        
        if (rightPanel) {
            if (show) {
                rightPanel.style.display = 'block';
                if (mainPanel) mainPanel.style.marginRight = ''; 
            } else {
                rightPanel.style.display = 'none';
                if (mainPanel) mainPanel.style.marginRight = '0px'; 
            }
        }
    }

    function processInput(gp) {
        const now = Date.now();

        // =================================================================
        // КНОПКА START (ID 9): Глобальный переключатель UI / Пауза плагина
        // =================================================================
        if (gp.buttons[9]?.pressed && (now - lastActiveTime > 400)) {
            isPluginActive = !isPluginActive;
            
            if (isPluginActive) {
                toggleSidebar(false); 
                showOverlay("SYSTEM", "GAMEPAD INTERFACE ACTIVE<br><span style='font-size:14px; color:#ff0;'>SIDEBAR HIDDEN</span>");
            } else {
                toggleSidebar(true);  
                showOverlay("SYSTEM", "<span style='color:#ff0000;'>GAMEPAD PAUSED</span><br><span style='font-size:14px; color:#fff;'>SIDEBAR RESTORED</span>");
            }
            lastActiveTime = now;
        }

        // Если плагин временно деактивирован — блокируем чтение остальных кнопок
        if (!isPluginActive) return;

        // Модификаторы перекрестной логики (Бамперы и аналоговые Курки)
        const l1Pressed = gp.buttons[4]?.pressed; // Левый бампер (L1)
        const r1Pressed = gp.buttons[5]?.pressed; // Правый бампер (R1)
        
        const l2Button = gp.buttons[6]; // Левый курок (L2) - SQ Педаль
        const r2Button = gp.buttons[7]; // Правый курок (R2) - NR Педаль

        // Клики по стикам (v1.7)
        const l3Pressed = gp.buttons[10]?.pressed; // Клик по левому стику
        const r3Pressed = gp.buttons[11]?.pressed; // Клик по правому стику

        // Чтение аналоговых осей
        const rxStickX = gp.axes[2] !== undefined ? gp.axes[2] : gp.axes[0]; // Правый стик
        const rxStickY = gp.axes[3] !== undefined ? gp.axes[3] : gp.axes[1];
        
        const hasRightStick = gp.axes[2] !== undefined && gp.axes[3] !== undefined;
        const lxStickX = hasRightStick ? gp.axes[0] : 0; // Левый стик
        const lxStickY = hasRightStick ? gp.axes[1] : 0;

        // =================================================================
        // АНАЛОГОВЫЕ КУРКИ (ПЕДАЛИ МГНОВЕННОГО ОТКРЫТИЯ ТРАКТА)
        // =================================================================
        
        // 1. ЛЕВЫЙ КУРОК (L2): Временное понижение порогов SQ (Открытие эфира)
        if (l2Button && l2Button.value > 0.05) {
            if (baseSquelchOpen === null) {
                baseSquelchOpen = openwebrx.getSquelchOpenThreshold();
                baseSquelchClose = openwebrx.getSquelchCloseThreshold();
            }
            let sqDrop = Math.round(l2Button.value * 30); 
            if (typeof openwebrx.setSquelchThresholds === "function") {
                openwebrx.setSquelchThresholds(baseSquelchOpen - sqDrop, baseSquelchClose - sqDrop);
            }
        } else if (baseSquelchOpen !== null) {
            if (typeof openwebrx.setSquelchThresholds === "function") {
                openwebrx.setSquelchThresholds(baseSquelchOpen, baseSquelchClose);
            }
            baseSquelchOpen = null; baseSquelchClose = null;
        }

        // 2. ПРАВЫЙ КУРОК (R2): Временное понижение агрессивности NR
        if (r2Button && r2Button.value > 0.05) {
            if (baseNrThreshold === null) {
                baseNrThreshold = openwebrx.getNrThreshold();
                baseNrSmoothing = openwebrx.getNrSmoothing();
            }
            let nrDrop = Math.round(r2Button.value * 20); 
            if (typeof openwebrx.setNrParameters === "function") {
                openwebrx.setNrParameters(Math.max(0, baseNrThreshold - nrDrop), baseNrSmoothing);
            }
        } else if (baseNrThreshold !== null) {
            if (typeof openwebrx.setNrParameters === "function") {
                openwebrx.setNrParameters(baseNrThreshold, baseNrSmoothing);
            }
            baseNrThreshold = null; baseNrSmoothing = null;
        }

        // =================================================================
        // КЛИКИ ПО СТИКАМ (VFO LOCK & NOTCH FILTER) (v1.7)
        // =================================================================
        if (now - lastActiveTime > 300) {
            // Клик по правому стику (R3) -> Переключение блокировки валкодера частоты
            if (r3Pressed) {
                isVfoLocked = !isVfoLocked;
                showOverlay("VFO DIAL", isVfoLocked ? "<span style='color:#ff0000;'>LOCKED</span>" : "<span style='color:#00ff00;'>UNLOCKED</span>");
                lastActiveTime = now;
            }

            // Клик по левому стику (L3) -> Включение/Выключение режекторного (Notch) фильтра
            if (l3Pressed && hasRightStick) {
                if (typeof openwebrx.toggleNotchFilter === "function") {
                    openwebrx.toggleNotchFilter();
                    showOverlay("NOTCH FILTER", "TOGGLED");
                } else {
                    showOverlay("NOTCH FILTER", "<span style='color:#ffaa00;'>NOT SUPPORTED BY SDR</span>");
                }
                lastActiveTime = now;
            }
        }

        // =================================================================
        // БЛОК ПРАВОГО СТИКА (НАВИГАЦИЯ ИЛИ УПРАВЛЕНИЕ SQUELCH / SQ)
        // =================================================================
        if (l1Pressed) {
            // [SHIFT] Левая рука держит L1 -> Правая рука настраивает БАЗОВЫЙ ШУМОДАВ SQ
            if (Math.abs(rxStickX) > 0.2 && (now - lastActiveTime > 100)) {
                let currentOpen = openwebrx.getSquelchOpenThreshold();
                let currentClose = openwebrx.getSquelchCloseThreshold();
                const delta = (rxStickX > 0 ? 1 : -1) * 1;
                if (typeof openwebrx.setSquelchThresholds === "function") {
                    openwebrx.setSquelchThresholds(currentOpen + delta, currentClose + delta);
                    showOverlay("BASE SQ GATE", `Open: ${currentOpen + delta}dB | Close: ${currentClose + delta}dB`);
                }
                lastActiveTime = now;
            }
            if (Math.abs(rxStickY) > 0.3 && (now - lastActiveTime > 100)) {
                let currentOpen = openwebrx.getSquelchOpenThreshold();
                let currentClose = openwebrx.getSquelchCloseThreshold();
                const direction = rxStickY < 0 ? 1 : -1;
                let newOpen = currentOpen + direction;
                if (newOpen > currentClose && typeof openwebrx.setSquelchThresholds === "function") {
                    openwebrx.setSquelchThresholds(newOpen, currentClose);
                    showOverlay("BASE SQ HYSTERESIS", `Width: ${newOpen - currentClose} dB`);
                }
                lastActiveTime = now;
            }
        } else {
            // [NORMAL] Обычный режим: ВАЛКОДЕР + ZOOM ВОДОПАДА
            
            // ↔ Влево/Вправо: Валкодер (Изменение частоты разрешено только если VFO не заблокирован!)
            if (Math.abs(rxStickX) > 0.15) {
                if (!isVfoLocked) {
                    const currentFreq = openwebrx.getFrequency();
                    const currentStep = openwebrx.getStep() || 100;
                    const speedFactor = Math.pow(Math.abs(rxStickX), 2) * 6;
                    const freqOffset = Math.round((rxStickX > 0 ? 1 : -1) * currentStep * speedFactor);
                    if (freqOffset !== 0 && typeof openwebrx.setFrequency === "function") {
                        openwebrx.setFrequency(currentFreq + freqOffset);
                    }
                } else if (now - lastActiveTime > 500) {
                    showOverlay("VFO LOCK", "<span style='color:#ff0000;'>DIAL LOCKED!</span>");
                    lastActiveTime = now;
                }
            }
            // ↕ Вверх/Вниз: Масштаб водопада (Zoom работает независимо от VFO Lock)
            if (Math.abs(rxStickY) > 0.6 && (now - lastZoomTime > 400)) {
                if (rxStickY < -0.6 && typeof ui.zoomIn === "function") ui.zoomIn();
                if (rxStickY > 0.6 && typeof ui.zoomOut === "function") ui.zoomOut();
                lastZoomTime = now;
            }
        }

        // =================================================================
        // БЛОК ЛЕВОГО СТИКА (ФИЛЬТРЫ ИЛИ УПРАВЛЕНИЕ DIGITAL NR)
        // =================================================================
        if (hasRightStick) {
            if (r1Pressed) {
                // [SHIFT] Правая рука держит R1 -> Левая рука настраивает БАЗОВЫЙ DIGITAL NR
                if (Math.abs(lxStickX) > 0.3 && (now - lastActiveTime > 100)) {
                    let currentNrThresh = openwebrx.getNrThreshold();
                    let currentNrSmooth = openwebrx.getNrSmoothing();
                    const delta = (lxStickX > 0 ? 1 : -1) * 1;
                    if (typeof openwebrx.setNrParameters === "function") {
                        openwebrx.setNrParameters(currentNrThresh + delta, currentNrSmooth);
                        showOverlay("BASE NR THRESHOLD", `Threshold: ${currentNrThresh + delta} | Smooth: ${currentNrSmooth}`);
                    }
                    lastActiveTime = now;
                }
                if (Math.abs(lxStickY) > 0.3 && (now - lastActiveTime > 100)) {
                    let currentNrThresh = openwebrx.getNrThreshold();
                    let currentNrSmooth = openwebrx.getNrSmoothing();
                    const direction = lxStickY < 0 ? 1 : -1;
                    let newSmooth = Math.max(0, currentNrSmooth + direction);
                    if (typeof openwebrx.setNrParameters === "function") {
                        openwebrx.setNrParameters(currentNrThresh, newSmooth);
                        showOverlay("BASE NR SMOOTHING", `Smooth Level: ${newSmooth}`);
                    }
                    lastActiveTime = now;
                }
            } else {
                // [NORMAL] Обычный режим: ПОЛОСА ФИЛЬТРА + РЧ-УСИЛЕНИЕ (RF GAIN)
                if (Math.abs(lxStickY) > 0.3 && (now - lastActiveTime > 100)) {
                    let currentLow = openwebrx.getFilterLow(); let currentHigh = openwebrx.getFilterHigh();
                    const delta = (lxStickY < 0 ? 1 : -1) * 50; let newHigh = currentHigh + delta;
                    if (newHigh >= 1000 && newHigh <= 4000 && typeof openwebrx.setFilterMargins === "function") {
                        openwebrx.setFilterMargins(currentLow, newHigh);
                    }
                }
                if (Math.abs(lxStickX) > 0.4 && (now - lastActiveTime > 150)) {
                    let currentGain = openwebrx.getRfGain ? openwebrx.getRfGain() : 20;
                    let newGain = currentGain + (lxStickX > 0 ? 1 : -1);
                    if (typeof openwebrx.setRfGain === "function") openwebrx.setRfGain(newGain);
                }
            }
        }

        // =================================================================
        // ДИСКРЕТНЫЕ ОПЕРАЦИИ (Крестовина и кнопки A, B, X, Y)
        // =================================================================
        if (now - lastActiveTime > 250) {

            // КРЕСТОВИНА D-PAD: Переключение диапазонов и модуляций
            if (gp.buttons[12]?.pressed) { // D-Pad Вверх
                currentBandIndex = (currentBandIndex + 1) % HAM_BANDS.length;
                if (typeof openwebrx.setFrequency === "function") openwebrx.setFrequency(HAM_BANDS[currentBandIndex]);
                showOverlay("RADIO BAND", `${HAM_BANDS[currentBandIndex] / 1000000} MHz`);
                lastActiveTime = now;
            }
            if (gp.buttons[13]?.pressed) { // D-Pad Вниз
                currentBandIndex = (currentBandIndex - 1 + HAM_BANDS.length) % HAM_BANDS.length;
                if (typeof openwebrx.setFrequency === "function") openwebrx.setFrequency(HAM_BANDS[currentBandIndex]);
                showOverlay("RADIO BAND", `${HAM_BANDS[currentBandIndex] / 1000000} MHz`);
                lastActiveTime = now;
            }
            if (gp.buttons[14]?.pressed) { // D-Pad Влево
                currentModIndex = (currentModIndex - 1 + MODULATIONS.length) % MODULATIONS.length;
                if (typeof openwebrx.setDemodulator === "function") openwebrx.setDemodulator(MODULATIONS[currentModIndex]);
                showOverlay("DEMODULATOR", MODULATIONS[currentModIndex].toUpperCase());
                lastActiveTime = now;
            }
            if (gp.buttons[15]?.pressed) { // D-Pad Вправо
                currentModIndex = (currentModIndex + 1) % MODULATIONS.length;
                if (typeof openwebrx.setDemodulator === "function") openwebrx.setDemodulator(MODULATIONS[currentModIndex]);
                showOverlay("DEMODULATOR", MODULATIONS[currentModIndex].toUpperCase());
                lastActiveTime = now;
            }

            // КНОПКА SELECT (ID 8): Переключение режима AGC
            if (gp.buttons[8]?.pressed) {
                if (typeof openwebrx.toggleAgc === "function") {
                    openwebrx.toggleAgc();
                    showOverlay("RECEIVER AGC", "TOGGLED");
                }
                lastActiveTime = now;
            }

            // ФРОНТАЛЬНЫЕ КНОПКИ ДЕЙСТВИЯ (A, B, X, Y)
            if (gp.buttons[0]?.pressed) { // Кнопка A
                if (typeof openwebrx.toggleSquelch === "function") openwebrx.toggleSquelch();
                showOverlay("SQUELCH MUTE", "TOGGLED"); lastActiveTime = now;
            }
            if (gp.buttons[1]?.pressed) { // Кнопка B
                if (typeof openwebrx.resetFilter === "function") openwebrx.resetFilter();
                showOverlay("DSP FILTER", "RESET TO DEFAULT"); lastActiveTime = now;
            }
            if (gp.buttons[2]?.pressed) { // Кнопка X
                if (typeof ui.centerWaterfall === "function") ui.centerWaterfall();
                showOverlay("WATERFALL VIEW", "CENTERED"); lastActiveTime = now;
            }
            if (gp.buttons[3]?.pressed) { // Кнопка Y
                if (typeof ui.addBookmark === "function") ui.addBookmark();
                showOverlay("BOOKMARK MEMORY", "FREQUENCY SAVED"); lastActiveTime = now;
            }
        }
    }
})();
