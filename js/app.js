import { state } from './state.js';
import { CONFIG } from './config.js';
import { logCommand } from './utils.js';
import { connectWebSocket } from './websocket.js';
import { setupCamera, initDetectors } from './camera.js';
import { analyzePosture, handleNoPerson, calibratePosture } from './posture.js';
import { drawSkeleton, drawHands, video, canvas, ctx, statusBadge, calibrateBtn, timerDisplay, updateTimer, startTimer, stopTimer, updateTimerButtons, hideAlert, resetTimer } from './ui.js';

/* =========================
   Loop control
   ========================= */
let rafId = null;
let hiddenIntervalId = null;
const HIDDEN_LOOP_INTERVAL = 1000;
const FRAME_SKIP = 3; // Process every 3rd frame to reduce CPU usage (~66% reduction)

/* =========================
   Main processing
   ========================= */
let frameCounter = 0;

async function processVideo() {
    if (!state.isCameraReady) return;

    frameCounter++;

    // Skip frames to reduce CPU usage - only process every 3rd frame
    if (frameCounter % FRAME_SKIP !== 0) return;

    const isPostureFrame = frameCounter % 2 === 0;

    try {
        if (isPostureFrame) {
            if (state.postureDetector) {
                const poses = await state.postureDetector.estimatePoses(video, { maxPoses: 1, flipHorizontal: false });
                if (poses && poses.length > 0) {
                    state.lastPose = poses[0];
                    if (state.lastPose.score > CONFIG.thresholds.score) {
                        state.lastPersonDetectedTime = Date.now();
                    }
                    analyzePosture(state.lastPose);
                } else {
                    state.lastPose = null;
                    handleNoPerson();
                }
            }
        } else {
            if (state.handsDetector) {
                try {
                    await state.handsDetector.send({ image: video });
                } catch (e) {
                    console.warn('Hands send error:', e);
                }
            }
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (state.lastPose) {
            drawSkeleton(state.lastPose);
        }

        if (state.lastHands) {
            drawHands(state.lastHands);
        }

    } catch (err) {
        console.error('Frame processing error:', err);
    }
}

function startLoop() {
    stopLoop();
    if (!document.hidden) {
        const loop = async () => {
            await processVideo();
            rafId = requestAnimationFrame(loop);
        };
        loop();
    } else {
        hiddenIntervalId = setInterval(processVideo, HIDDEN_LOOP_INTERVAL);
    }
}

function stopLoop() {
    if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
    if (hiddenIntervalId) {
        clearInterval(hiddenIntervalId);
        hiddenIntervalId = null;
    }
}

document.addEventListener('visibilitychange', () => {
    setTimeout(startLoop, 50);
});

/* =========================
   Initialization
   ========================= */
async function init() {
    try {
        logCommand('Initializing...');
        statusBadge.textContent = 'Loading Models...';
        statusBadge.style.color = 'var(--warning-color)';

        connectWebSocket();
        logCommand("WebSocket connected");

        await setupCamera();
        logCommand("Camera ready");

        await initDetectors();
        logCommand("Init detectors ready");

        // Event Listeners
        if (calibrateBtn) calibrateBtn.addEventListener('click', calibratePosture);

        // Timer control buttons with long-press reset
        const startBtns = [
            document.getElementById('start-timer-btn'),
            document.getElementById('compact-start-btn'),
            document.getElementById('timer-only-start-btn')
        ];

        startBtns.forEach(btn => {
            if (!btn) return;

            let longPressTimer;
            const originalText = btn.textContent;

            btn.addEventListener('click', startTimer);

            btn.addEventListener('mousedown', () => {
                btn.classList.add('reset-pending');
                if (btn.id === 'start-timer-btn') {
                    btn.textContent = 'Reset...';
                } else {
                    btn.textContent = 'Reset';
                    btn.style.fontSize = '10px';
                }

                longPressTimer = setTimeout(() => {
                    resetTimer();
                    btn.classList.remove('reset-pending');
                    btn.textContent = originalText;
                    if (btn.id !== 'start-timer-btn') btn.style.fontSize = '';
                }, 1000);
            });

            const clearResetState = () => {
                clearTimeout(longPressTimer);
                btn.classList.remove('reset-pending');
                btn.textContent = originalText;
                if (btn.id !== 'start-timer-btn') btn.style.fontSize = '';
            };

            btn.addEventListener('mouseup', clearResetState);
            btn.addEventListener('mouseleave', clearResetState);
        });

        document.getElementById('stop-timer-btn')?.addEventListener('click', stopTimer);
        document.getElementById('compact-stop-btn')?.addEventListener('click', stopTimer);
        document.getElementById('timer-only-stop-btn')?.addEventListener('click', stopTimer);
        document.getElementById('timer-only-calibrate-btn')?.addEventListener('click', () => {
            calibratePosture();
        });

        // Window Controls
        const { ipcRenderer } = require('electron');
        document.getElementById('btn-minimize')?.addEventListener('click', () => ipcRenderer.send('window-minimize'));
        document.getElementById('btn-maximize')?.addEventListener('click', () => ipcRenderer.send('window-maximize'));
        document.getElementById('btn-close')?.addEventListener('click', () => ipcRenderer.send('window-close'));

        // Settings Modal
        const settingsModal = document.getElementById('settings-modal');
        document.getElementById('btn-settings')?.addEventListener('click', () => settingsModal.classList.remove('hidden'));
        document.getElementById('btn-close-settings')?.addEventListener('click', () => {
            settingsModal.classList.add('hidden');

            if (isCompactMode) {
                closeCompactSettings();
            }
        });

        // Gesture Toggles
        document.getElementById('toggle-swipe')?.addEventListener('change', (e) => state.enableSwipe = e.target.checked);
        document.getElementById('toggle-volume')?.addEventListener('change', (e) => state.enableVolume = e.target.checked);
        document.getElementById('toggle-tap')?.addEventListener('change', (e) => state.enableTap = e.target.checked);
        document.getElementById('toggle-taskview')?.addEventListener('change', (e) => state.enableTaskView = e.target.checked);

        // Skeleton Toggle
        document.getElementById('toggle-skeleton')?.addEventListener('change', (e) => {
            state.showSkeleton = e.target.checked;
            document.getElementById('compact-toggle-skeleton').checked = e.target.checked;
        });

        // Notification Buttons
        document.getElementById('btn-recalibrate')?.addEventListener('click', () => {
            hideAlert();
            calibratePosture();
        });
        document.getElementById('btn-snooze')?.addEventListener('click', () => {
            hideAlert();
            state.snoozeUntil = Date.now() + 15 * 60 * 1000;
            logCommand('Notifications snoozed for 15m');
        });
        document.getElementById('btn-dismiss')?.addEventListener('click', () => {
            hideAlert();
        });

        // Compact Mode Toggle
        let isCompactMode = localStorage.getItem('compactMode') === 'true';
        let isTimerOnlyMode = false;
        const compactBtn = document.getElementById('btn-compact');
        const timerOnlyBtn = document.getElementById('btn-timer-only');
        const timerOnlyRestoreBtn = document.getElementById('timer-only-restore-btn');
        const compactTimer = document.getElementById('compact-timer');
        const timerOnlyDisplay = document.getElementById('timer-only-display');
        const COMPACT_BASE_HEIGHT = 300;

        // Restore compact mode on startup
        if (isCompactMode) {
            document.body.classList.add('compact-mode');
            ipcRenderer.send('toggle-compact-mode', true);
        }

        compactBtn?.addEventListener('click', () => {
            isCompactMode = !isCompactMode;
            document.body.classList.toggle('compact-mode');
            ipcRenderer.send('toggle-compact-mode', isCompactMode);
            localStorage.setItem('compactMode', isCompactMode);
            logCommand(isCompactMode ? 'Switched to compact mode' : 'Switched to full mode');

            if (isCompactMode) {
                resetCompactInactivityTimer();
                ipcRenderer.send('resize-compact-mode', COMPACT_BASE_HEIGHT);
            } else {
                clearTimeout(compactInactivityTimer);
                document.body.classList.remove('compact-transparent');
                closeCompactSettings();
            }
        });

        // Timer Only Mode Logic
        timerOnlyBtn?.addEventListener('click', () => {
            isTimerOnlyMode = true;
            document.body.classList.add('timer-only-mode');
            ipcRenderer.send('toggle-timer-only-mode', true);
            resetCompactInactivityTimer();
            logCommand('Switched to Timer Only mode');
        });

        timerOnlyRestoreBtn?.addEventListener('click', () => {
            isTimerOnlyMode = false;
            document.body.classList.remove('timer-only-mode');
            ipcRenderer.send('toggle-timer-only-mode', false);
            logCommand('Restored from Timer Only mode');
        });

        // Auto-transparency logic
        let compactInactivityTimer;

        function resetCompactInactivityTimer() {
            if (!isCompactMode && !isTimerOnlyMode) return;

            document.body.classList.remove('compact-transparent');
            document.body.classList.remove('timer-only-transparent');
            clearTimeout(compactInactivityTimer);

            compactInactivityTimer = setTimeout(() => {
                if (!document.body.matches(':hover')) {
                    if (isCompactMode && !isTimerOnlyMode) {
                        document.body.classList.add('compact-transparent');
                    } else if (isTimerOnlyMode) {
                        document.body.classList.add('timer-only-transparent');
                    }
                }
            }, 3000);
        }

        ['mousemove', 'mousedown', 'keydown', 'touchstart'].forEach(event => {
            document.addEventListener(event, resetCompactInactivityTimer);
        });

        if (isCompactMode) {
            resetCompactInactivityTimer();
        }

        // Compact settings dropdown toggle
        const compactSettingsBtn = document.getElementById('compact-settings-btn');
        const compactSettingsDropdown = document.getElementById('compact-settings-dropdown');

        function resizeCompactWindow(targetHeight) {
            if (!isCompactMode || isTimerOnlyMode) return;
            console.log('[Renderer] Resizing compact window to:', targetHeight);
            ipcRenderer.send('resize-compact-mode', targetHeight);
        }

        function closeCompactSettings() {
            if (compactSettingsDropdown?.classList.contains('open')) {
                compactSettingsDropdown.classList.remove('open');
                compactSettingsBtn.classList.remove('active');
                resizeCompactWindow(COMPACT_BASE_HEIGHT);
                console.log('[Renderer] Closed compact settings, shrinking to base height');
            }
        }

        compactSettingsBtn?.addEventListener('click', (e) => {
            e.stopPropagation();

            if (compactSettingsDropdown?.classList.contains('open')) {
                closeCompactSettings();
            } else {
                compactSettingsDropdown?.classList.add('open');
                compactSettingsBtn.classList.add('active');

                const dropdownHeight = compactSettingsDropdown.scrollHeight + 10;
                const expandedHeight = COMPACT_BASE_HEIGHT + dropdownHeight;

                resizeCompactWindow(expandedHeight);
                console.log('[Renderer] Opened compact settings, expanding to:', expandedHeight);
            }
        });

        document.addEventListener('click', (e) => {
            if (isCompactMode &&
                compactSettingsDropdown?.classList.contains('open') &&
                !compactSettingsDropdown.contains(e.target) &&
                e.target !== compactSettingsBtn) {
                closeCompactSettings();
            }
        });

        // Compact mode controls - sync toggles with main settings
        document.getElementById('compact-toggle-swipe')?.addEventListener('change', (e) => {
            state.enableSwipe = e.target.checked;
            document.getElementById('toggle-swipe').checked = e.target.checked;
        });

        document.getElementById('compact-toggle-volume')?.addEventListener('change', (e) => {
            state.enableVolume = e.target.checked;
            document.getElementById('toggle-volume').checked = e.target.checked;
        });

        document.getElementById('compact-toggle-tap')?.addEventListener('change', (e) => {
            state.enableTap = e.target.checked;
            document.getElementById('toggle-tap').checked = e.target.checked;
        });

        document.getElementById('compact-toggle-taskview')?.addEventListener('change', (e) => {
            state.enableTaskView = e.target.checked;
            document.getElementById('toggle-taskview').checked = e.target.checked;
        });

        document.getElementById('compact-toggle-skeleton')?.addEventListener('change', (e) => {
            state.showSkeleton = e.target.checked;
            document.getElementById('toggle-skeleton').checked = e.target.checked;
        });

        document.getElementById('compact-calibrate-btn')?.addEventListener('click', () => {
            calibratePosture();
        });

        // Update compact and timer-only timers
        setInterval(() => {
            if (timerDisplay) {
                const currentTime = timerDisplay.textContent;
                if (isCompactMode && compactTimer) {
                    compactTimer.textContent = currentTime;
                }
                if (isTimerOnlyMode && timerOnlyDisplay) {
                    timerOnlyDisplay.textContent = currentTime;
                }
            }
        }, 1000);

        // IPC Listener for Notification Actions
        ipcRenderer.on('notification-action', (event, action) => {
            if (action === 'recalibrate') {
                calibratePosture();
                logCommand('Recalibrating from notification');
            } else if (action === 'snooze') {
                state.snoozeUntil = Date.now() + 15 * 60 * 1000;
                logCommand('Notifications snoozed for 15m');
            } else if (action === 'dismiss') {
                logCommand('Notification dismissed');
            }
        });

        ipcRenderer.on('compact-resize-confirmed', (event, height) => {
            console.log('[Renderer] Main process confirmed resize to:', height);
        });

        startLoop();
        setInterval(updateTimer, 1000);
        updateTimerButtons();

        statusBadge.textContent = 'Ready';
        statusBadge.style.color = 'var(--success-color)';
        logCommand('Initialization complete.');
    } catch (err) {
        console.error('Initialization error:', err);
        statusBadge.textContent = 'Error';
        statusBadge.style.color = 'var(--danger-color)';
        alert('Failed to initialize. See console for details.');
    }
}

/* =========================
   Start
   ========================= */
init();