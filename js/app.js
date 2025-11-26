import { state } from './state.js';
import { CONFIG } from './config.js';
import { logCommand } from './utils.js';
import { connectWebSocket } from './websocket.js';
import { setupCamera, initDetectors } from './camera.js';
import { analyzePosture, handleNoPerson, calibratePosture } from './posture.js';
import { drawSkeleton, drawHands, video, canvas, ctx, statusBadge, calibrateBtn, timerDisplay, updateTimer, startTimer, stopTimer, updateTimerButtons, hideAlert } from './ui.js';

/* =========================
   Loop control
   ========================= */
let rafId = null;
let hiddenIntervalId = null;
const HIDDEN_LOOP_INTERVAL = 100;

/* =========================
   Main processing
   ========================= */
let frameCounter = 0;

async function processVideo() {
    if (!state.isCameraReady) return;

    frameCounter++;
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

        // Timer control buttons
        document.getElementById('start-timer-btn')?.addEventListener('click', startTimer);
        document.getElementById('stop-timer-btn')?.addEventListener('click', stopTimer);
        document.getElementById('compact-start-btn')?.addEventListener('click', startTimer);
        document.getElementById('compact-stop-btn')?.addEventListener('click', stopTimer);

        // Window Controls
        const { ipcRenderer } = require('electron');
        document.getElementById('btn-minimize')?.addEventListener('click', () => ipcRenderer.send('window-minimize'));
        document.getElementById('btn-maximize')?.addEventListener('click', () => ipcRenderer.send('window-maximize'));
        document.getElementById('btn-close')?.addEventListener('click', () => ipcRenderer.send('window-close'));

        // Settings Toggle
        const settingsModal = document.getElementById('settings-modal');
        document.getElementById('btn-settings')?.addEventListener('click', () => settingsModal.classList.remove('hidden'));
        document.getElementById('btn-close-settings')?.addEventListener('click', () => settingsModal.classList.add('hidden'));

        // Gesture Toggles
        document.getElementById('toggle-swipe')?.addEventListener('change', (e) => state.enableSwipe = e.target.checked);
        document.getElementById('toggle-volume')?.addEventListener('change', (e) => state.enableVolume = e.target.checked);
        document.getElementById('toggle-tap')?.addEventListener('change', (e) => state.enableTap = e.target.checked);
        document.getElementById('toggle-taskview')?.addEventListener('change', (e) => state.enableTaskView = e.target.checked);

        // Notification Buttons
        document.getElementById('btn-recalibrate')?.addEventListener('click', () => {
            hideAlert();
            calibratePosture();
        });
        document.getElementById('btn-snooze')?.addEventListener('click', () => {
            hideAlert();
            state.snoozeUntil = Date.now() + 15 * 60 * 1000; // 15 minutes
            logCommand('Notifications snoozed for 15m');
        });
        document.getElementById('btn-dismiss')?.addEventListener('click', () => {
            hideAlert();
        });

        // Compact Mode Toggle
        let isCompactMode = localStorage.getItem('compactMode') === 'true';
        const compactBtn = document.getElementById('btn-compact');
        const compactTimer = document.getElementById('compact-timer');


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

        document.getElementById('compact-calibrate-btn')?.addEventListener('click', () => {
            calibratePosture();
        });

        // Update compact timer
        if (compactTimer) {
            setInterval(() => {
                if (isCompactMode && timerDisplay) {
                    compactTimer.textContent = timerDisplay.textContent;
                }
            }, 1000);
        }

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

        startLoop();
        setInterval(updateTimer, 1000);
        updateTimerButtons(); // Initialize button states

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
