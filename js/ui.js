import { state } from './state.js';
import { CONFIG } from './config.js';
import { logCommand, pad } from './utils.js';

/* =========================
   DOM elements
   ========================= */
export const video = document.getElementById('webcam');
export const canvas = document.getElementById('output');
export const ctx = canvas.getContext('2d');
export const statusBadge = document.getElementById('connection-status');
export const wsStatusBadge = document.getElementById('ws-status');
export const postureStatus = document.getElementById('posture-status');
export const confidenceBar = document.getElementById('confidence-bar');
export const gestureStatus = document.getElementById('gesture-status');
export const gestureAction = document.getElementById('gesture-action');
export const timerDisplay = document.getElementById('timer');
export const timerMessage = document.getElementById('timer-message');
export const alertOverlay = document.getElementById('alert-overlay');
export const alertMessage = document.getElementById('alert-message');
export const virtualCursor = document.getElementById('virtual-cursor');
export const calibrateBtn = document.getElementById('calibrate-btn');

/* =========================
   UI Update Functions
   ========================= */

export function updateVirtualCursor(x, y) {
    if (!virtualCursor || !video) return;
    virtualCursor.classList.remove('hidden');
    const rect = video.getBoundingClientRect();
    virtualCursor.style.left = `${Math.max(0, Math.min(1, x)) * rect.width}px`;
    virtualCursor.style.top = `${Math.max(0, Math.min(1, y)) * rect.height}px`;
}

export function updateGestureStatus(gesture, action) {
    if (gestureStatus) gestureStatus.textContent = gesture;
    if (gestureAction) gestureAction.textContent = action;
}

export function updatePostureStatus(status, confidence) {
    state.currentPosture = status;
    if (postureStatus) {
        postureStatus.textContent = status;
        postureStatus.style.color = status === 'Good Posture' ? 'var(--success-color)' :
            (status === 'Unknown' || status === 'Uncalibrated' ? 'var(--text-secondary)' : 'var(--danger-color)');
    }
    if (confidenceBar) {
        confidenceBar.style.width = `${confidence}%`;
        confidenceBar.style.backgroundColor = status === 'Good Posture' ? 'var(--success-color)' :
            (status === 'Unknown' || status === 'Uncalibrated' ? 'var(--text-secondary)' : 'var(--danger-color)');
    }
}

export function sendNotification(title, body) {
    // Use IPC to show native Windows 11 notification with action buttons
    const { ipcRenderer } = require('electron');
    ipcRenderer.send('show-posture-notification', body);
}

export function updateTimer() {
    const now = Date.now();

    // Only update timer if it's running
    if (!state.isTimerRunning) {
        if (timerMessage) timerMessage.textContent = "Timer paused";
        return;
    }

    if (now - state.lastPersonDetectedTime < CONFIG.thresholds.absenceTimeout) {
        const diff = now - state.sittingStartTime;
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        if (timerDisplay) timerDisplay.textContent = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

        if (diff > CONFIG.thresholds.warningTime2) {
            if (timerMessage) { timerMessage.textContent = "⚠️ Stand up and stretch! (1h+)"; timerMessage.style.color = 'var(--danger-color)'; }
        } else if (diff > CONFIG.thresholds.warningTime1) {
            if (timerMessage) { timerMessage.textContent = "⚠️ Consider taking a break. (30m+)"; timerMessage.style.color = 'var(--warning-color)'; }
        } else {
            if (timerMessage) { timerMessage.textContent = "Keep up the good work!"; timerMessage.style.color = 'var(--text-secondary)'; }
        }
    }
}

export function startTimer() {
    if (!state.isTimerRunning) {
        state.isTimerRunning = true;
        state.sittingStartTime = Date.now() - state.timerPausedTime;
        state.timerPausedTime = 0;
        updateTimerButtons();
        logCommand('Timer started manually');
    }
}

export function stopTimer() {
    if (state.isTimerRunning) {
        state.isTimerRunning = false;
        state.timerPausedTime = Date.now() - state.sittingStartTime;
        updateTimerButtons();
        logCommand('Timer stopped manually');
    }
}

export function updateTimerButtons() {
    const startBtn = document.getElementById('start-timer-btn');
    const stopBtn = document.getElementById('stop-timer-btn');
    const compactStartBtn = document.getElementById('compact-start-btn');
    const compactStopBtn = document.getElementById('compact-stop-btn');

    const isRunning = state.isTimerRunning;

    if (startBtn && stopBtn) {
        startBtn.disabled = isRunning;
        stopBtn.disabled = !isRunning;
    }

    if (compactStartBtn && compactStopBtn) {
        compactStartBtn.disabled = isRunning;
        compactStopBtn.disabled = !isRunning;
    }
}

export function showAlert(msg) {
    if (state.isAlertActive) return;
    if (alertMessage) alertMessage.textContent = msg;
    if (alertOverlay) alertOverlay.classList.remove('hidden');
    state.isAlertActive = true;
}

export function hideAlert() {
    if (!state.isAlertActive) return;
    if (alertOverlay) alertOverlay.classList.add('hidden');
    state.isAlertActive = false;
}

/* =========================
   Drawing helpers
   ========================= */
export function drawSkeleton(pose) {
    if (!pose || !pose.keypoints) return;
    const keypoints = pose.keypoints;
    ctx.fillStyle = '#3b82f6';
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;

    keypoints.forEach(kp => {
        if (kp.score > CONFIG.thresholds.score) {
            // Highlight ears if volume control might be active
            if ((kp.name === 'left_ear' || kp.name === 'right_ear') && state.isVolumeControlActive) {
                ctx.fillStyle = '#FFD700'; // Gold for active volume control
            } else {
                ctx.fillStyle = '#3b82f6'; // Normal blue
            }

            ctx.beginPath();
            ctx.arc(kp.x, kp.y, 5, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();
        }
    });

    try {
        const adjacentPairs = poseDetection.util.getAdjacentPairs(poseDetection.SupportedModels.MoveNet);
        ctx.strokeStyle = '#10b981';
        adjacentPairs.forEach(([i, j]) => {
            const kp1 = keypoints[i];
            const kp2 = keypoints[j];
            if (kp1 && kp2 && kp1.score > CONFIG.thresholds.score && kp2.score > CONFIG.thresholds.score) {
                ctx.beginPath();
                ctx.moveTo(kp1.x, kp1.y);
                ctx.lineTo(kp2.x, kp2.y);
                ctx.stroke();
            }
        });
    } catch (e) {
        // ignore
    }
}

export function drawHands(landmarks) {
    try {
        if (typeof drawConnectors !== 'undefined' && typeof drawLandmarks !== 'undefined' && typeof HAND_CONNECTIONS !== 'undefined') {
            drawConnectors(ctx, landmarks, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 2 });
            drawLandmarks(ctx, landmarks, { color: '#FF0000', lineWidth: 1 });
        } else {
            landmarks.forEach(lm => {
                ctx.beginPath();
                ctx.arc(lm.x * canvas.width, lm.y * canvas.height, 3, 0, 2 * Math.PI);
                ctx.fillStyle = '#ff0000';
                ctx.fill();
            });
        }
    } catch (e) {
        console.warn('drawHands error:', e);
    }
}

// Enhanced visual feedback showing position relative to ear
export function drawVolumeFeedbackWithPosition(ear, indexTip, earY, indexY) {
    if (!ctx) return;

    // Draw connection line between ear and index finger
    ctx.strokeStyle = '#FFD700'; // Gold color for volume control
    ctx.lineWidth = 3;
    ctx.setLineDash([5, 5]); // Dashed line

    ctx.beginPath();
    ctx.moveTo(ear.x, ear.y);
    ctx.lineTo(indexTip.x * canvas.width, indexTip.y * canvas.height);
    ctx.stroke();

    ctx.setLineDash([]); // Reset to solid line

    // Draw circle around ear with position indicators
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 2;

    // Main ear circle
    ctx.beginPath();
    ctx.arc(ear.x, ear.y, 30, 0, 2 * Math.PI);
    ctx.stroke();

    // Draw position indicator lines
    const indicatorLength = 50;
    ctx.strokeStyle = indexY < earY ? '#00FF00' : '#FF4444'; // Green for above, Red for below

    // Horizontal line through ear
    ctx.beginPath();
    ctx.moveTo(ear.x - indicatorLength, ear.y);
    ctx.lineTo(ear.x + indicatorLength, ear.y);
    ctx.stroke();

    // Draw arrow indicating direction
    ctx.fillStyle = indexY < earY ? '#00FF00' : '#FF4444';
    if (indexY < earY) {
        // Up arrow (volume increasing)
        ctx.beginPath();
        ctx.moveTo(ear.x, ear.y - 40);
        ctx.lineTo(ear.x - 10, ear.y - 20);
        ctx.lineTo(ear.x + 10, ear.y - 20);
        ctx.closePath();
        ctx.fill();
    } else if (indexY > earY) {
        // Down arrow (volume decreasing)
        ctx.beginPath();
        ctx.moveTo(ear.x, ear.y + 40);
        ctx.lineTo(ear.x - 10, ear.y + 20);
        ctx.lineTo(ear.x + 10, ear.y + 20);
        ctx.closePath();
        ctx.fill();
    }

    // Draw volume level indicator
    ctx.fillStyle = 'rgba(255, 215, 0, 0.3)';
    ctx.fillRect(10, 10, 20, 100);

    ctx.fillStyle = '#FFD700';
    const volumeHeight = (state.currentVolumeLevel / 100) * 100;
    ctx.fillRect(10, 10 + (100 - volumeHeight), 20, volumeHeight);

    // Volume percentage text with direction indicator
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '14px Arial';
    ctx.fillText(`${state.currentVolumeLevel}%`, 35, 60);

    // Position indicator text
    ctx.fillStyle = indexY < earY ? '#00FF00' : (indexY > earY ? '#FF4444' : '#FFFFFF');
    const positionText = indexY < earY ? "↑ Increasing" : (indexY > earY ? "↓ Decreasing" : "● At Ear Level");
    ctx.fillText(positionText, 35, 80);
}
