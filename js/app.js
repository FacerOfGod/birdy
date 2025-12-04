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

        // Settings Modal
        const settingsModal = document.getElementById('settings-modal');
        document.getElementById('btn-settings')?.addEventListener('click', () => settingsModal.classList.remove('hidden'));
        document.getElementById('btn-close-settings')?.addEventListener('click', () => {
            settingsModal.classList.add('hidden');

            // If in compact mode, also close compact settings and shrink window
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
                // Ensure window resizes to base height when entering compact mode
                ipcRenderer.send('resize-compact-mode', COMPACT_BASE_HEIGHT);
            } else {
                clearTimeout(compactInactivityTimer);
                document.body.classList.remove('compact-transparent');
                // Close compact settings if open
                closeCompactSettings();
            }
        });

        // Auto-transparency logic
        let compactInactivityTimer;

        function resetCompactInactivityTimer() {
            if (!isCompactMode) return;

            document.body.classList.remove('compact-transparent');
            clearTimeout(compactInactivityTimer);

            compactInactivityTimer = setTimeout(() => {
                if (isCompactMode && !document.body.matches(':hover')) {
                    document.body.classList.add('compact-transparent');
                }
            }, 3000); // 10 seconds
        }

        // Reset timer on user interaction
        ['mousemove', 'mousedown', 'keydown', 'touchstart'].forEach(event => {
            document.addEventListener(event, resetCompactInactivityTimer);
        });

        // Initialize timer if starting in compact mode
        if (isCompactMode) {
            resetCompactInactivityTimer();
        }

        // Compact settings dropdown toggle
        const compactSettingsBtn = document.getElementById('compact-settings-btn');
        const compactSettingsDropdown = document.getElementById('compact-settings-dropdown');

        function resizeCompactWindow(targetHeight) {
            if (!isCompactMode) return;

            console.log('[Renderer] Resizing compact window to:', targetHeight);
            ipcRenderer.send('resize-compact-mode', targetHeight);
        }

        function closeCompactSettings() {
            if (compactSettingsDropdown?.classList.contains('open')) {
                compactSettingsDropdown.classList.remove('open');
                compactSettingsBtn.classList.remove('active');
                // Force shrink to base height
                resizeCompactWindow(COMPACT_BASE_HEIGHT);

                console.log('[Renderer] Closed compact settings, shrinking to base height');
            }
        }

        compactSettingsBtn?.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent triggering document click

            if (compactSettingsDropdown?.classList.contains('open')) {
                // Closing settings - shrink window back to initial size
                closeCompactSettings();
            } else {
                // Opening settings - expand window
                compactSettingsDropdown?.classList.add('open');
                compactSettingsBtn.classList.add('active');

                // Calculate dynamic height based on content
                // Add a small buffer for borders/padding
                const dropdownHeight = compactSettingsDropdown.scrollHeight + 10;
                const expandedHeight = COMPACT_BASE_HEIGHT + dropdownHeight;

                resizeCompactWindow(expandedHeight);
                console.log('[Renderer] Opened compact settings, expanding to:', expandedHeight, '(Dropdown:', dropdownHeight, ')');
            }
        });

        // Close settings when clicking outside
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

        // Debug: Add IPC listener for resize confirmation
        ipcRenderer.on('compact-resize-confirmed', (event, height) => {
            console.log('[Renderer] Main process confirmed resize to:', height);
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