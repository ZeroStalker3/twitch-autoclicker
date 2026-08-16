// ==UserScript==
// @name         Twitch Auto Bonus Clicker
// @namespace    https://github.com/ZeroStalker3/twitch-autoclicker
// @version      3.1.0
// @description  Автоматический сбор бонусов на Twitch с GUI, логированием и имитацией поведения
// @author       ZeroYz
// @match        *://*.twitch.tv/*
// @run-at       document-idle
// @license      MIT
// @grant        GM_info
// @supportURL   https://github.com/ZeroStalker3/twitch-autoclicker/issues
// @updateURL    https://github.com/ZeroStalker3/twitch-autoclicker/releases/latest/download/twitch-autoclicker.min.user.js
// @downloadURL  https://github.com/ZeroStalker3/twitch-autoclicker/releases/latest/download/twitch-autoclicker.min.user.js
// @icon         https://assets.twitch.tv/assets/favicon-32-e29e246c157142c94346.png
// ==/UserScript==

(function() {
    'use strict';

    if (window.__TWITCHY_RUNNING__) {
        console.log("Already running");
        return;
    }
    window.__TWITCHY_RUNNING__ = true;

    const CONFIG = {
        TICK_INTERVAL: 1500,             // единый цикл проверки
        BALANCE_CHECK_EVERY: 50,         // каждые N тиков (~65-125 сек)
        CYCLE_EVERY: 30,                 // каждые N тиков (~35-65 сек)
        UI_UPDATE_INTERVAL: 1000,
        UI_UPDATE_THROTTLE: 100,
        MAX_LOG_ENTRIES: 50,
        HUMAN_BEHAVIOR_CHANCE: 0.08,     // снижено: имитация реже
        IDLE_BEHAVIOR_CHANCE: 0.03,
        IDLE_DURATION: { min: 10000, max: 30000 },
        HUMAN_PAUSE_DURATION: { min: 1000, max: 3000 },
        NETWORK_RETRY_COOLDOWN: 8000,
        NETWORK_MAX_ATTEMPTS: 3,
        SELECTORS: {
            CLAIM: '[data-test-selector="claim-button"], ' +
                   'button[aria-label="Claim Bonus"], ' +
                   'button[aria-label="Получить бонус"]',
            BALANCE: '[data-test-selector="copo-balance-string"] span[class*="ScAnimatedNumber"]',
            REWARD_POPUP: '[class*="rewards-popover"], [id*="channel-points-reward-center"]',
            BUTTON_LABEL: '[data-a-target="tw-core-button-label-text"]'
        }
    };

    // Кэш DOM-ссылок (заполняется при старте)
    const domCache = {
        clicksEl: null,
        balanceEl: null,
        cyclesEl: null,
        uptimeEl: null,
        statusText: null,
        toggleBtn: null,
        log: null,
        gui: null,
        header: null
    };

    let state = {
        isRunning: false,
        clicks: 0,
        checks: 0,
        balance: '0',
        cycles: 0,
        startTime: null,
        tickCounter: 0,
        lastUIUpdate: 0,
        logQueue: [],
        isProcessingLogs: false,
        isDragging: false,
        dragOffset: { x: 0, y: 0 },
        mainLoopTimeout: null,
        uiUpdateTimeout: null,
        idleTimeout: null,
        humanTimeout: null,
        frameObserver: null,
        bonusObserver: null,
        claimButtonCache: {
            nodes: [],
            lastUpdate: 0,
            valid: false
        },
        network: {
            attempts: 0,
            lastClick: 0,
            lastStrongCheck: 0,
            lastStrongResult: false
        },
        pendingClick: false
    };

    // === Стили ===
    const style = document.createElement('style');
    style.textContent = `
        #Twitchy-autoclicker {
            position: fixed;
            top: 20px;
            right: 20px;
            width: 400px;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            border: 1px solid #2d4059;
            border-radius: 12px;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            color: #fff;
            z-index: 999999;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
            overflow: hidden;
        }
        #Twitchy-header {
            background: linear-gradient(90deg, #5f3570 0%, #8e44ad 100%);
            padding: 12px 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: move;
            user-select: none;
        }
        #Twitchy-title {
            display: flex;
            align-items: center;
            gap: 8px;
            font-weight: 600;
            font-size: 14px;
        }
        #Twitchy-logo {
            width: 20px;
            height: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
        }
        #Twitchy-version {
            font-size: 10px;
            color: rgba(255,255,255,0.7);
            margin-left: 4px;
        }
        #Twitchy-controls { display: flex; gap: 8px; }
        .Twitchy-btn {
            padding: 6px 16px;
            border: none;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        #Twitchy-toggle { background: #27ae60; color: white; }
        #Twitchy-toggle:hover { background: #229954; transform: translateY(-1px); }
        #Twitchy-toggle.running { background: #e74c3c; }
        #Twitchy-toggle.running:hover { background: #c0392b; }
        #Twitchy-hide, #Twitchy-minimize {
            background: transparent;
            color: white;
            border: 1px solid rgba(255,255,255,0.3);
            padding: 6px 12px;
        }
        #Twitchy-hide:hover, #Twitchy-minimize:hover { background: rgba(255,255,255,0.1); }
        #Twitchy-minimize { padding: 6px 10px; font-size: 16px; line-height: 1; }
        #Twitchy-content { padding: 16px; }
        #Twitchy-status {
            background: rgba(255,255,255,0.05);
            border-radius: 8px;
            padding: 12px;
            margin-bottom: 12px;
            font-size: 13px;
            text-align: center;
        }
        #Twitchy-status-text { color: #95a5a6; }
        #Twitchy-status-text.active { color: #2ecc71; font-weight: 600; }
        #Twitchy-stats {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 10px;
            margin-bottom: 12px;
        }
        .Twitchy-stat {
            background: rgba(255,255,255,0.05);
            border-radius: 8px;
            padding: 10px;
            text-align: center;
        }
        .Twitchy-stat-label {
            font-size: 10px;
            color: #95a5a6;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 4px;
        }
        .Twitchy-stat-value {
            font-size: 20px;
            font-weight: 700;
            color: #fff;
        }
        #Twitchy-log {
            background: rgba(0,0,0,0.3);
            border-radius: 8px;
            padding: 12px;
            height: 180px;
            overflow-y: auto;
            font-size: 11px;
            font-family: 'Consolas', 'Monaco', monospace;
        }
        .Twitchy-log-entry {
            padding: 4px 0;
            border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .Twitchy-log-entry:last-child { border-bottom: none; }
        .Twitchy-log-time { color: #95a5a6; margin-right: 8px; }
        .Twitchy-log-success { color: #2ecc71; }
        .Twitchy-log-info { color: #3498db; }
        .Twitchy-log-warning { color: #f39c12; }
        .Twitchy-log-cycle { color: #e67e22; }
        #Twitchy-footer {
            padding: 12px 16px;
            background: rgba(0,0,0,0.2);
            text-align: center;
            font-size: 10px;
            color: #95a5a6;
        }
        #Twitchy-footer a { color: #9b59b6; text-decoration: none; }
        #Twitchy-log::-webkit-scrollbar { width: 6px; }
        #Twitchy-log::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); border-radius: 3px; }
        #Twitchy-log::-webkit-scrollbar-thumb { background: rgba(155, 89, 182, 0.5); border-radius: 3px; }
        #Twitchy-log::-webkit-scrollbar-thumb:hover { background: rgba(155, 89, 182, 0.8); }
        #Twitchy-autoclicker.minimized { width: auto; }
        #Twitchy-autoclicker.minimized #Twitchy-content,
        #Twitchy-autoclicker.minimized #Twitchy-footer { display: none; }
        #Twitchy-uptime { font-size: 11px; color: #95a5a6; margin-top: 4px; }
    `;

    // === GUI ===
    const gui = document.createElement('div');
    gui.id = 'Twitchy-autoclicker';
    gui.innerHTML = `
        <div id="Twitchy-header">
            <div id="Twitchy-title">
                <div id="Twitchy-logo">🎁</div>
                <span>Twitch AutoClicker</span>
                <span id="Twitchy-version">v...</span>
            </div>
            <div id="Twitchy-controls">
                <button id="Twitchy-toggle" class="Twitchy-btn">START</button>
                <button id="Twitchy-hide" class="Twitchy-btn">HIDE</button>
                <button id="Twitchy-minimize" class="Twitchy-btn">−</button>
            </div>
        </div>
        <div id="Twitchy-content">
            <div id="Twitchy-status">
                <div id="Twitchy-status-text">Ready to start...</div>
                <div id="Twitchy-uptime">Uptime: 00:00:00</div>
            </div>
            <div id="Twitchy-stats">
                <div class="Twitchy-stat">
                    <div class="Twitchy-stat-label">Bonuses Claim</div>
                    <div class="Twitchy-stat-value" id="Twitchy-clicks">0</div>
                </div>
                <div class="Twitchy-stat">
                    <div class="Twitchy-stat-label">Cycles</div>
                    <div class="Twitchy-stat-value" id="Twitchy-cycles">0</div>
                </div>
                <div class="Twitchy-stat">
                    <div class="Twitchy-stat-label">Balance</div>
                    <div class="Twitchy-stat-value" id="Twitchy-balance">0</div>
                </div>
            </div>
            <div id="Twitchy-log"></div>
        </div>
        <div id="Twitchy-footer">
            Developed by <a href="https://github.com/ZeroStalker3" target="_blank">Z̶e̶r̶o̶Y̶z̶</a>
        </div>
    `;

    document.head.appendChild(style);
    document.body.appendChild(gui);

    // === Кэш DOM-ссылок (один раз) ===
    function initDOMCache() {
        domCache.clicksEl = document.getElementById('Twitchy-clicks');
        domCache.balanceEl = document.getElementById('Twitchy-balance');
        domCache.cyclesEl = document.getElementById('Twitchy-cycles');
        domCache.uptimeEl = document.getElementById('Twitchy-uptime');
        domCache.statusText = document.getElementById('Twitchy-status-text');
        domCache.toggleBtn = document.getElementById('Twitchy-toggle');
        domCache.log = document.getElementById('Twitchy-log');
        domCache.gui = document.getElementById('Twitchy-autoclicker');
        domCache.header = document.getElementById('Twitchy-header');
    }
    initDOMCache();

    requestAnimationFrame(() => {
        const versionEl = document.getElementById('Twitchy-version');
        if (versionEl) {
            const ver = (typeof GM_info !== 'undefined') ? GM_info.script.version : null;
            versionEl.textContent = ver ? `v${ver}` : '';
        }
    });

    // === Утилиты ===
    function rand(min, max) {
        return Math.floor(Math.random() * (max - min) + min);
    }

    function formatTime(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    }

    // requestIdleCallback с fallback
    const scheduleIdle = window.requestIdleCallback 
        ? (cb) => requestIdleCallback(cb, { timeout: 1000 })
        : (cb) => setTimeout(cb, 50);

    // === Система логирования ===
    function addLog(message, type = 'info') {
        state.logQueue.push({
            message,
            type,
            time: new Date().toLocaleTimeString('ru-RU', { hour12: false })
        });
        if (!state.isProcessingLogs) {
            state.isProcessingLogs = true;
            scheduleIdle(processLogs);
        }
    }

    function processLogs() {
        if (!domCache.log || state.logQueue.length === 0) {
            state.isProcessingLogs = false;
            return;
        }

        const fragment = document.createDocumentFragment();
        while (state.logQueue.length > 0) {
            const { message, type, time } = state.logQueue.shift();
            const entry = document.createElement('div');
            entry.className = 'Twitchy-log-entry';

            const timeSpan = document.createElement('span');
            timeSpan.className = 'Twitchy-log-time';
            timeSpan.textContent = time;

            const msgSpan = document.createElement('span');
            msgSpan.className = `Twitchy-log-${type}`;
            msgSpan.textContent = message;

            entry.append(timeSpan, msgSpan);
            fragment.insertBefore(entry, fragment.firstChild);
        }

        domCache.log.insertBefore(fragment, domCache.log.firstChild);
        while (domCache.log.children.length > CONFIG.MAX_LOG_ENTRIES) {
            domCache.log.removeChild(domCache.log.lastChild);
        }
        state.isProcessingLogs = false;
    }

    // === Обновление UI (кэш + throttle) ===
    function updateUI() {
        const now = Date.now();
        if (now - state.lastUIUpdate < CONFIG.UI_UPDATE_THROTTLE) return;
        state.lastUIUpdate = now;

        requestAnimationFrame(() => {
            if (domCache.clicksEl) domCache.clicksEl.textContent = state.clicks;
            if (domCache.balanceEl) domCache.balanceEl.textContent = state.balance;
            if (domCache.cyclesEl) domCache.cyclesEl.textContent = state.cycles;

            if (domCache.uptimeEl) {
                const uptime = state.startTime ? Date.now() - state.startTime : 0;
                domCache.uptimeEl.textContent = `Uptime: ${formatTime(uptime)}`;
            }

            if (domCache.statusText && domCache.toggleBtn) {
                if (state.isRunning) {
                    domCache.statusText.textContent = '🟢 Active | Waiting...';
                    domCache.statusText.className = 'active';
                    domCache.toggleBtn.textContent = 'STOP';
                    domCache.toggleBtn.className = 'Twitchy-btn running';
                } else {
                    domCache.statusText.textContent = '🔴 Stopped';
                    domCache.statusText.className = '';
                    domCache.toggleBtn.textContent = 'START';
                    domCache.toggleBtn.className = 'Twitchy-btn';
                }
            }
        });
    }

    function scheduleUIUpdate() {
        if (!state.isRunning) return;
        state.uiUpdateTimeout = setTimeout(() => {
            updateUI();
            scheduleUIUpdate();
        }, CONFIG.UI_UPDATE_INTERVAL);
    }

    function isVisible(el) {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 2 && r.height > 2;
    }

    function simulateClick(el) {
        const r = el.getBoundingClientRect();
        const opts = {
            bubbles: true, cancelable: true, view: window,
            clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
            button: 0
        };
        el.dispatchEvent(new PointerEvent('pointerdown', opts));
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new PointerEvent('pointerup', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.dispatchEvent(new MouseEvent('click', opts));
    }

    // === Проверка ошибки сети (с кэшем) ===
    function checkNetworkError() {
        try {
            const now = Date.now();

            // Кэш strong-элементов на 2 секунды
            if (now - state.network.lastStrongCheck > 2000) {
                state.network.lastStrongResult = false;
                const strongs = document.querySelectorAll('strong');
                for (const s of strongs) {
                    const t = (s.textContent || '').toLowerCase();
                    if (t.includes('ошибка сети') || t.includes('network error') || /#\s*\d{4}/.test(t)) {
                        state.network.lastStrongResult = true;
                        break;
                    }
                }
                state.network.lastStrongCheck = now;
            }

            if (!state.network.lastStrongResult) {
                state.network.attempts = 0;
                return false;
            }

            if (now - state.network.lastClick < CONFIG.NETWORK_RETRY_COOLDOWN) return true;

            let btn = null;
            const labels = document.querySelectorAll(CONFIG.SELECTORS.BUTTON_LABEL);
            for (const label of labels) {
                const t = (label.textContent || '').toLowerCase();
                if (t.includes('перезагрузить') || t.includes('refresh') || t.includes('reload')) {
                    const b = label.closest('button');
                    if (isVisible(b)) { btn = b; break; }
                }
            }
            if (!btn) return true;

            simulateClick(btn);
            state.network.lastClick = now;
            state.network.attempts++;
            addLog(`🔄 Network error! Refresh attempt ${state.network.attempts}...`, 'warning');

            if (state.network.attempts >= CONFIG.NETWORK_MAX_ATTEMPTS) {
                addLog('⚠️ Refresh failed. Reloading page...', 'warning');
                sessionStorage.setItem('TwitchyAutoStart', '1');
                setTimeout(() => location.reload(), 1000);
            }
            return true;
        } catch (e) {
            console.error('Error checking network overlay:', e);
        }
        return false;
    }

    // === Валидация кнопки сбора ===
    function isClaimButton(button) {
        if (button.closest(CONFIG.SELECTORS.REWARD_POPUP)) {
            return false;
        }
        const label = (button.getAttribute('aria-label') || '').toLowerCase();
        return !(
            label.includes('узнайте больше') || label.includes('learn more') ||
            label.includes('другие параметры') || label.includes('other options') ||
            label.includes('закрыть') || label.includes('close')
        );
    }

    // === Обновление кэша кнопок (вызывается MutationObserver) ===
    function updateClaimButtonsCache() {
        state.claimButtonCache.nodes = Array.from(document.querySelectorAll(CONFIG.SELECTORS.CLAIM));
        state.claimButtonCache.valid = true;
        state.claimButtonCache.lastUpdate = Date.now();
    }

    // === Основная логика ===
    function tryClickBonus() {
        if (!state.claimButtonCache.valid || state.claimButtonCache.nodes.length === 0) {
            return false;
        }

        for (const button of state.claimButtonCache.nodes) {
            // Проверяем, что кнопка ещё в DOM
            if (!button.isConnected) continue;

            const isHidden = button.getAttribute('aria-hidden') === 'true' ||
                             button.closest('[aria-hidden="true"]');

            if (!isHidden && isClaimButton(button)) {
                state.clicks++;
                button.click();
                const timeSinceStart = state.startTime ? Math.floor((Date.now() - state.startTime) / 1000) : 0;
                addLog(`✅ Bonus received! (Total: ${state.clicks}, Time: ${timeSinceStart}s)`, 'success');
                state.claimButtonCache.valid = false;
                return true;
            }
        }
        return false;
    }

    function checkBalance() {
        const blE = document.querySelector(CONFIG.SELECTORS.BALANCE);
        if (blE) {
            const rawValue = blE.textContent || '0';
            state.balance = rawValue.replace(/[\s\u00A0]/g, '');
            addLog(`💰 Balance updated: ${state.balance}`, 'info');
        }
    }

    function startNewCycle() {
        state.cycles++;
        addLog(`🔄 Starting cycle #${state.cycles}...`, 'cycle');
    }

    // === Имитация поведения ===
    function humanBehavior() {
        const r = Math.random();
        if (r < 0.3) {
            window.scrollBy({ top: Math.random() * 300 - 150, behavior: 'smooth' });
        } else if (r < 0.5) {
            document.dispatchEvent(new MouseEvent('mousemove', {
                clientX: Math.random() * window.innerWidth,
                clientY: Math.random() * window.innerHeight,
                bubbles: true
            }));
        } else if (r < 0.6) {
            state.humanTimeout = setTimeout(() => {
                state.humanTimeout = null;
            }, rand(CONFIG.HUMAN_PAUSE_DURATION.min, CONFIG.HUMAN_PAUSE_DURATION.max));
        }
    }

    function randomIdle() {
        const pause = rand(CONFIG.IDLE_DURATION.min, CONFIG.IDLE_DURATION.max);
        addLog(`😴 Idle for ${Math.floor(pause / 1000)}s`, 'warning');
        state.idleTimeout = setTimeout(() => {
            state.idleTimeout = null;
        }, pause);
    }

    // === Единый основной цикл ===
    function mainLoop() {
        if (!state.isRunning) return;

        state.tickCounter++;

        // 1. Проверяем ошибку сети (приоритет)
        if (checkNetworkError()) {
            state.mainLoopTimeout = setTimeout(mainLoop, CONFIG.TICK_INTERVAL);
            return;
        }

        // 2. Пытаемся кликнуть бонус (только если кэш валиден)
        if (state.claimButtonCache.valid && !state.idleTimeout && !state.humanTimeout) {
            tryClickBonus();
            state.checks++;
        }

        // 3. Периодические задачи
        if (state.tickCounter % CONFIG.BALANCE_CHECK_EVERY === 0) {
            checkBalance();
            updateUI();
        }

        if (state.tickCounter % CONFIG.CYCLE_EVERY === 0) {
            startNewCycle();
            updateUI();
        }

        // 4. Обновление UI каждые ~10 тиков
        if (state.tickCounter % 10 === 0) {
            updateUI();
        }

        // 5. Имитация поведения (редко)
        const behaviorChance = Math.random();
        if (!state.idleTimeout && !state.humanTimeout) {
            if (behaviorChance < CONFIG.IDLE_BEHAVIOR_CHANCE) {
                randomIdle();
            } else if (behaviorChance < CONFIG.HUMAN_BEHAVIOR_CHANCE) {
                humanBehavior();
            }
        }

        state.mainLoopTimeout = setTimeout(mainLoop, CONFIG.TICK_INTERVAL);
    }

    // === MutationObserver для кнопки бонуса ===
    function setupBonusObserver() {
        if (state.bonusObserver) {
            state.bonusObserver.disconnect();
        }

        state.bonusObserver = new MutationObserver((mutations) => {
            // Проверяем, появились ли новые кнопки или исчезли старые
            let shouldUpdate = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (node.matches?.(CONFIG.SELECTORS.CLAIM) || 
                                node.querySelector?.(CONFIG.SELECTORS.CLAIM)) {
                                shouldUpdate = true;
                                break;
                            }
                        }
                    }
                    if (shouldUpdate) break;
                    
                    for (const node of mutation.removedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (node.matches?.(CONFIG.SELECTORS.CLAIM) ||
                                node.querySelector?.(CONFIG.SELECTORS.CLAIM)) {
                                shouldUpdate = true;
                                break;
                            }
                        }
                    }
                    if (shouldUpdate) break;
                }
            }

            if (shouldUpdate || !state.claimButtonCache.valid) {
                // Debounce: обновляем не чаще раза в 500мс
                if (!updateClaimButtonsCache._timer) {
                    updateClaimButtonsCache._timer = setTimeout(() => {
                        updateClaimButtonsCache();
                        updateClaimButtonsCache._timer = null;
                    }, 500);
                }
            }
        });

        state.bonusObserver.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Начальное заполнение кэша
        updateClaimButtonsCache();
    }

    // === Управление жизненным циклом ===
    function start() {
        if (state.isRunning) return;

        state.isRunning = true;
        state.startTime = Date.now();
        state.tickCounter = 0;
        addLog('⚡ Initializing system...', 'info');

        setupBonusObserver();
        scheduleUIUpdate();
        mainLoop();

        updateUI();

        setTimeout(() => {
            addLog('✔️ System ready. Waiting for bonuses...', 'info');
        }, 1000);
    }

    function stop() {
        if (!state.isRunning) return;

        state.isRunning = false;
        clearTimeout(state.mainLoopTimeout);
        clearTimeout(state.uiUpdateTimeout);
        clearTimeout(state.idleTimeout);
        clearTimeout(state.humanTimeout);
        state.mainLoopTimeout = null;
        state.uiUpdateTimeout = null;
        state.idleTimeout = null;
        state.humanTimeout = null;

        if (state.bonusObserver) {
            state.bonusObserver.disconnect();
            state.bonusObserver = null;
        }

        const runtime = state.startTime ? Math.floor((Date.now() - state.startTime) / 1000) : 0;
        addLog(`⏸️ Script stopped. Time: ${runtime}s, Bonuses: ${state.clicks}`, 'warning');

        state.startTime = null;
        updateUI();
    }

    function destroy() {
        stop();
        if (domCache.gui && domCache.gui.parentNode) domCache.gui.parentNode.removeChild(domCache.gui);
        if (style && style.parentNode) style.parentNode.removeChild(style);

        window.removeEventListener("keydown", keyHandler, true);

        try {
            document.querySelectorAll('iframe').forEach(frame => {
                try { frame.contentWindow?.removeEventListener("keydown", keyHandler, true); } catch(e) {}
            });
        } catch(e) {}

        if (state.frameObserver) {
            state.frameObserver.disconnect();
            state.frameObserver = null;
        }

        document.removeEventListener("mousemove", mousemoveHandler);
        document.removeEventListener("mouseup", mouseupHandler);
        document.removeEventListener('dblclick', dblclickHandler);

        if (domCache.header) domCache.header.removeEventListener("mousedown", mousedownHandler);

        delete window.__TWITCHY_RUNNING__;
        console.log("❌ Script fully destroyed");
    }

    function keyHandler(event) {
        if (event.ctrlKey && event.code === 'KeyX') {
            event.preventDefault();
            event.stopImmediatePropagation();
            destroy();
        }
    }

    window.addEventListener("keydown", keyHandler, true);

    function attachKeyHandlerToFrames() {
        try {
            document.querySelectorAll('iframe').forEach(frame => {
                try {
                    frame.contentWindow?.addEventListener("keydown", keyHandler, true);
                } catch (e) { }
            });
        } catch (e) { }
    }

    attachKeyHandlerToFrames();

    let attachTimer = null;
    state.frameObserver = new MutationObserver((mutations) => {
        const hasNewNode = mutations.some(m => m.addedNodes.length > 0);
        if (!hasNewNode) return;
        
        if (attachTimer) return;
        attachTimer = setTimeout(() => {
            attachTimer = null;
            attachKeyHandlerToFrames();
        }, 2000);
    });
    state.frameObserver.observe(document.body, { childList: true, subtree: true });

    function mousedownHandler(e) {
        if (e.target.tagName === 'BUTTON') return;
        state.isDragging = true;
        state.dragOffset.x = e.clientX - domCache.gui.offsetLeft;
        state.dragOffset.y = e.clientY - domCache.gui.offsetTop;
    }

    function mousemoveHandler(e) {
        if (state.isDragging) {
            e.preventDefault();
            domCache.gui.style.left = (e.clientX - state.dragOffset.x) + 'px';
            domCache.gui.style.top = (e.clientY - state.dragOffset.y) + 'px';
            domCache.gui.style.right = 'auto';
        }
    }

    function mouseupHandler() {
        state.isDragging = false;
    }

    function dblclickHandler(e) {
        if (e.ctrlKey && domCache.gui.style.display === 'none') {
            domCache.gui.style.display = 'block';
        }
    }

    document.getElementById('Twitchy-toggle').addEventListener('click', () => {
        state.isRunning ? stop() : start();
    });

    document.getElementById('Twitchy-hide').addEventListener('click', () => {
        domCache.gui.style.display = 'none';
    });

    document.getElementById('Twitchy-minimize').addEventListener('click', () => {
        domCache.gui.classList.toggle('minimized');
        const btn = document.getElementById('Twitchy-minimize');
        btn.textContent = domCache.gui.classList.contains('minimized') ? '+' : '−';
    });

    domCache.header.addEventListener('mousedown', mousedownHandler);
    document.addEventListener('mousemove', mousemoveHandler);
    document.addEventListener('mouseup', mouseupHandler);
    document.addEventListener('dblclick', dblclickHandler);

    addLog('💻 System loaded', 'info');
    addLog('📡 Waiting for start...', 'info');
    updateUI();

    console.log(`🎁 Twitch AutoClicker GUI loaded! (v${(typeof GM_info !== 'undefined') ? GM_info.script.version : '3.1.0'})`);
    console.log('💡 Click START to begin working');
    console.log('❗ Ctrl + X ends the scripts');
    if (sessionStorage.getItem('TwitchyAutoStart') === '1') {
        sessionStorage.removeItem('TwitchyAutoStart');
        addLog('♻️ Auto-restart after reload...', 'cycle');
        setTimeout(start, 4000);
    }
})();