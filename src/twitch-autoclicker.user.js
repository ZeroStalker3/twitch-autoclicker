// ==UserScript==
// @name         Twitch Auto Bonus Clicker
// @namespace    https://github.com/ZeroStalker3/twitch-autoclicker
// @version      2.5.8
// @description  Автоматический сбор бонусов на Twitch с GUI, логированием и имитацией поведения
// @author       ZeroYz
// @match        *://*.twitch.tv/*
// @run-at       document-idle
// @license      MIT
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
        CLICK_DELAY: { min: 1500, max: 3500 },
        BALANCE_CHECK_DELAY: { min: 65000, max: 125000 },
        CYCLE_DELAY: { min: 35000, max: 65000 },
        UI_UPDATE_INTERVAL: 1000,
        UI_UPDATE_THROTTLE: 100,
        MAX_LOG_ENTRIES: 50,
        HUMAN_BEHAVIOR_CHANCE: 0.15,
        IDLE_BEHAVIOR_CHANCE: 0.05,
        IDLE_DURATION: { min: 10000, max: 30000 },
        HUMAN_PAUSE_DURATION: { min: 1000, max: 3000 }
    };

    let state = {
        isRunning: false,
        clicks: 0,
        checks: 0,
        balance: 0,
        cycles: 0,
        startTime: null,
        isChecking: false,
        lastUIUpdate: 0,
        logQueue: [],
        isProcessingLogs: false,
        isDragging: false,
        dragOffset: { x: 0, y: 0 },
        clickTimeout: null,
        balanceTimeout: null,
        cycleTimeout: null,
        uiUpdateTimeout: null,
        idleTimeout: null,
        humanTimeout: null,
        observer: null,
        frameObserver: null
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
                <span id="Twitchy-version">v2.5.5</span>
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

    // === Система логирования ===
    function addLog(message, type = 'info') {
        state.logQueue.push({
            message,
            type,
            time: new Date().toLocaleTimeString('ru-RU', { hour12: false })
        });
        if (!state.isProcessingLogs) {
            requestAnimationFrame(processLogs);
        }
    }

    function processLogs() {
        const log = document.getElementById('Twitchy-log');
        if (!log || state.logQueue.length === 0) {
            state.isProcessingLogs = false;
            return;
        }
        state.isProcessingLogs = true;

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

        log.insertBefore(fragment, log.firstChild);
        while (log.children.length > CONFIG.MAX_LOG_ENTRIES) {
            log.removeChild(log.lastChild);
        }
        state.isProcessingLogs = false;
    }

    // === Обновление UI ===
    function updateUI() {
        const now = Date.now();
        if (now - state.lastUIUpdate < CONFIG.UI_UPDATE_THROTTLE) return;
        state.lastUIUpdate = now;

        requestAnimationFrame(() => {
            const clicksEl = document.getElementById('Twitchy-clicks');
            const balanceEl = document.getElementById('Twitchy-balance');
            const cyclesEl = document.getElementById('Twitchy-cycles');
            const uptimeEl = document.getElementById('Twitchy-uptime');
            const statusText = document.getElementById('Twitchy-status-text');
            const toggleBtn = document.getElementById('Twitchy-toggle');

            if (clicksEl) clicksEl.textContent = state.clicks;
            if (balanceEl) balanceEl.textContent = state.balance;
            if (cyclesEl) cyclesEl.textContent = state.cycles;

            if (uptimeEl) {
                const uptime = state.startTime ? Date.now() - state.startTime : 0;
                uptimeEl.textContent = `Uptime: ${formatTime(uptime)}`;
            }

            if (statusText && toggleBtn) {
                if (state.isRunning) {
                    statusText.textContent = '🟢 Active | Waiting...';
                    statusText.className = 'active';
                    toggleBtn.textContent = 'STOP';
                    toggleBtn.className = 'Twitchy-btn running';
                } else {
                    statusText.textContent = '🔴 Stopped';
                    statusText.className = '';
                    toggleBtn.textContent = 'START';
                    toggleBtn.className = 'Twitchy-btn';
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

    // === Основная логика ===
    function clickBonusButton() {
        if (state.isChecking) return false;
        state.isChecking = true;
        state.checks++;

        try {
            const buttons = document.querySelectorAll(
                'button[aria-label*="бонус"], button[aria-label*="Bonus"], ' +
                '[data-test-selector="claim-button"], button[aria-label="Claim Bonus"], ' +
                'button[aria-label="Получить бонус"]'
            );

            for (const button of buttons) {
                const isHidden = button.getAttribute('aria-hidden') === 'true' ||
                                 button.closest('[aria-hidden="true"]');
                if (!isHidden) {
                    state.clicks++;
                    button.click();
                    const timeSinceStart = state.startTime ? Math.floor((Date.now() - state.startTime) / 1000) : 0;
                    addLog(`✅ Bonus received! (Total: ${state.clicks}, Time: ${timeSinceStart}s)`, 'success');
                    updateUI();
                    return true;
                }
            }
            if (state.checks % 100 === 0) updateUI();
        } finally {
            state.isChecking = false;
        }
        return false;
    }

    function checkBalance() {
        const blE = document.querySelector('[data-test-selector="copo-balance-string"] span[class*="ScAnimatedNumber"]');
        if (blE) {
            const rawValue = blE.textContent || '0';
            state.balance = rawValue.replace(/[\s\u00A0]/g, '');
            addLog(`💰 Balance updated: ${state.balance}`, 'info');
            updateUI();
        }
    }

    function startNewCycle() {
        state.cycles++;
        addLog(`🔄 Starting cycle #${state.cycles}...`, 'cycle');
        updateUI();
    }

    // === Планировщики ===
    function scheduleClick() {
        if (!state.isRunning) return;
        state.clickTimeout = setTimeout(() => {
            if (state.isRunning && !state.isChecking) {
                clickBonusButton();
                const behaviorChance = Math.random();
                if (behaviorChance < CONFIG.IDLE_BEHAVIOR_CHANCE) {
                    randomIdle();
                } else if (behaviorChance < CONFIG.HUMAN_BEHAVIOR_CHANCE) {
                    humanBehavior();
                }
            }
            scheduleClick();
        }, rand(CONFIG.CLICK_DELAY.min, CONFIG.CLICK_DELAY.max));
    }

    function scheduleBalanceCheck() {
        if (!state.isRunning) return;
        state.balanceTimeout = setTimeout(() => {
            if (state.isRunning) checkBalance();
            scheduleBalanceCheck();
        }, rand(CONFIG.BALANCE_CHECK_DELAY.min, CONFIG.BALANCE_CHECK_DELAY.max));
    }

    function scheduleCycle() {
        if (!state.isRunning) return;
        state.cycleTimeout = setTimeout(() => {
            if (state.isRunning) startNewCycle();
            scheduleCycle();
        }, rand(CONFIG.CYCLE_DELAY.min, CONFIG.CYCLE_DELAY.max));
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
            state.isChecking = true;
            state.humanTimeout = setTimeout(() => {
                state.isChecking = false;
                state.humanTimeout = null;
            }, rand(CONFIG.HUMAN_PAUSE_DURATION.min, CONFIG.HUMAN_PAUSE_DURATION.max));
        }
    }

    function randomIdle() {
        const pause = rand(CONFIG.IDLE_DURATION.min, CONFIG.IDLE_DURATION.max);
        addLog(`😴 Idle for ${Math.floor(pause / 1000)}s`, 'warning');
        state.isChecking = true;
        state.idleTimeout = setTimeout(() => {
            state.isChecking = false;
            state.idleTimeout = null;
        }, pause);
    }

    // === Управление жизненным циклом ===
    function start() {
        if (state.isRunning) return;
        state.isRunning = true;
        state.startTime = Date.now();
        addLog('⚡ Initializing system...', 'info');
        setTimeout(() => startNewCycle(), 500);
        scheduleClick();
        scheduleBalanceCheck();
        scheduleCycle();
        scheduleUIUpdate();
        updateUI();
        setTimeout(() => addLog('✔️ System ready. Waiting for bonuses...', 'info'), 1000);
    }

    function stop() {
        if (!state.isRunning) return;
        state.isRunning = false;
        clearTimeout(state.clickTimeout);
        clearTimeout(state.balanceTimeout);
        clearTimeout(state.cycleTimeout);
        clearTimeout(state.uiUpdateTimeout);
        clearTimeout(state.idleTimeout);
        clearTimeout(state.humanTimeout);
        state.clickTimeout = null;
        state.balanceTimeout = null;
        state.cycleTimeout = null;
        state.uiUpdateTimeout = null;
        state.idleTimeout = null;
        state.humanTimeout = null;
        if (state.observer) {
            state.observer.disconnect();
            state.observer = null;
        }
        const runtime = state.startTime ? Math.floor((Date.now() - state.startTime) / 1000) : 0;
        addLog(`⏸️ Script stopped. Time: ${runtime}s, Bonuses: ${state.clicks}`, 'warning');
        state.startTime = null;
        state.isChecking = false;
        updateUI();
    }

    function destroy() {
        stop();
        if (gui && gui.parentNode) gui.parentNode.removeChild(gui);
        if (style && style.parentNode) style.parentNode.removeChild(style);

        // Снимаем глобальный обработчик
        window.removeEventListener("keydown", keyHandler, true);

        // Снимаем обработчики со всех iframe
        try {
            document.querySelectorAll('iframe').forEach(frame => {
                try { frame.contentWindow?.removeEventListener("keydown", keyHandler, true); } catch(e) {}
            });
        } catch(e) {}

        // Останавливаем наблюдатель за фреймами
        if (state.frameObserver) {
            state.frameObserver.disconnect();
            state.frameObserver = null;
        }

        document.removeEventListener("mousemove", mousemoveHandler);
        document.removeEventListener("mouseup", mouseupHandler);
        document.removeEventListener('dblclick', dblclickHandler);

        const header = document.getElementById('Twitchy-header');
        if (header) header.removeEventListener("mousedown", mousedownHandler);

        delete window.__TWITCHY_RUNNING__;
        console.log("❌ Script fully destroyed");
    }

    // === Глобальный обработчик Ctrl+X (работает в iframe и после HIDE) ===
    function keyHandler(event) {
        if (event.ctrlKey && event.code === 'KeyX') {
            event.preventDefault();
            event.stopImmediatePropagation();
            destroy();
        }
    }

    // Регистрируем на window (основной документ)
    window.addEventListener("keydown", keyHandler, true);

    // Инъекция в iframe для перехвата событий внутри чата/плеера
    function attachKeyHandlerToFrames() {
        try {
            document.querySelectorAll('iframe').forEach(frame => {
                try {
                    frame.contentWindow?.addEventListener("keydown", keyHandler, true);
                } catch (e) { /* cross-origin iframe — игнорируем */ }
            });
        } catch (e) { /* ignore */ }
    }

    attachKeyHandlerToFrames();

    // Наблюдаем за динамическим появлением новых iframe
    state.frameObserver = new MutationObserver(() => attachKeyHandlerToFrames());
    state.frameObserver.observe(document.body, { childList: true, subtree: true });

    // === Обработчики GUI ===
    function mousedownHandler(e) {
        if (e.target.tagName === 'BUTTON') return;
        state.isDragging = true;
        state.dragOffset.x = e.clientX - gui.offsetLeft;
        state.dragOffset.y = e.clientY - gui.offsetTop;
    }

    function mousemoveHandler(e) {
        if (state.isDragging) {
            e.preventDefault();
            gui.style.left = (e.clientX - state.dragOffset.x) + 'px';
            gui.style.top = (e.clientY - state.dragOffset.y) + 'px';
            gui.style.right = 'auto';
        }
    }

    function mouseupHandler() {
        state.isDragging = false;
    }

    function dblclickHandler(e) {
        if (e.ctrlKey && gui.style.display === 'none') {
            gui.style.display = 'block';
        }
    }

    // === Инициализация ===
    document.getElementById('Twitchy-toggle').addEventListener('click', () => {
        state.isRunning ? stop() : start();
    });

    document.getElementById('Twitchy-hide').addEventListener('click', () => {
        gui.style.display = 'none';
    });

    document.getElementById('Twitchy-minimize').addEventListener('click', () => {
        gui.classList.toggle('minimized');
        const btn = document.getElementById('Twitchy-minimize');
        btn.textContent = gui.classList.contains('minimized') ? '+' : '−';
    });

    const header = document.getElementById('Twitchy-header');
    header.addEventListener('mousedown', mousedownHandler);
    document.addEventListener('mousemove', mousemoveHandler);
    document.addEventListener('mouseup', mouseupHandler);
    document.addEventListener('dblclick', dblclickHandler);

    addLog('💻 System loaded', 'info');
    addLog('📡 Waiting for start...', 'info');
    updateUI();

    console.log('🎁 Twitch AutoClicker GUI loaded! (v2.5.5)');
    console.log('💡 Click START to begin working');
    console.log('❗ Ctrl + X ends the scripts');
})();
