/* =========================
   Configuration & State
   ========================= */
const CONFIG = {
    video: { width: 640, height: 480, fps: 30 },
    thresholds: {
        score: 0.3,
        badPostureDuration: 10000,
        absenceTimeout: 20000,
        warningTime1: 30 * 60 * 1000,
        warningTime2: 60 * 60 * 1000,
        pinchDistance: 0.07,
        fistThreshold: 0.1,
        minHandSize: 0.05,
        earTouchDistance: 0.1, // Distance threshold for ear touch detection
        volumeSensitivity: 2.0  // How sensitive the volume control should be
    },
    wsUrl: 'ws://localhost:8765'
};

const state = {
    postureDetector: null,
    handsDetector: null,
    isCameraReady: false,
    lastPersonDetectedTime: Date.now(),
    sittingStartTime: Date.now(),
    badPostureStartTime: null,
    currentPosture: 'Unknown',
    isAlertActive: false,

    // Timer control state
    isTimerRunning: true,
    timerPausedTime: 0,
    standingStartTime: null,
    isStanding: false,
    calibration: null,
    lastPose: null,
    lastHands: null,
    lastGesture: 'None',
    isDragging: false,
    cursorX: 0.5,
    cursorY: 0.5,
    ws: null,
    isWsConnected: false,
    isCursorActive: false,
    lastToggleGesture: null,
    lastToggleTime: 0,
    peaceHoldStart: 0,
    peaceCenterX: null,
    peaceCenterY: null,
    lastGestureChangeTime: 0,
    gestureDebounceMs: 100,
    pinchStartTime: 0,
    hasRecalibrated: false,
    peaceBodyX: null,
    peaceBodyY: null,
    smoothBodyX: null,
    smoothBodyY: null,
    activeHandLabel: null,
    lastSwipeTime: 0,
    openHandHoldStart: 0,
    fistHoldStart: 0,
    lastTaskViewGesture: null,
    lastTaskViewTime: 0,

    // Volume control state
    lastVolumeGestureTime: 0,
    volumeGestureCooldown: 100, // ms between volume changes
    isVolumeControlActive: false,
    lastIndexTipY: null,
    volumeChangeThreshold: 0.002, // Minimum movement to trigger volume change
    currentVolumeLevel: 50, // Track volume level (0-100)
    volumeControlStartTime: 0,

    // UX Settings & Flags
    enableSwipe: true,
    enableVolume: true,
    enableTap: true,
    enableTaskView: true,
    snoozeUntil: 0
};

/* =========================
   DOM elements
   ========================= */
const video = document.getElementById('webcam');
const canvas = document.getElementById('output');
const ctx = canvas.getContext('2d');
const statusBadge = document.getElementById('connection-status');
const wsStatusBadge = document.getElementById('ws-status');
const postureStatus = document.getElementById('posture-status');
const confidenceBar = document.getElementById('confidence-bar');
const gestureStatus = document.getElementById('gesture-status');
const gestureAction = document.getElementById('gesture-action');
const timerDisplay = document.getElementById('timer');
const timerMessage = document.getElementById('timer-message');
const alertOverlay = document.getElementById('alert-overlay');
const alertMessage = document.getElementById('alert-message');
const virtualCursor = document.getElementById('virtual-cursor');
const commandLog = document.getElementById('command-log');
const calibrateBtn = document.getElementById('calibrate-btn');

/* =========================
   Loop control
   ========================= */
let rafId = null;
let hiddenIntervalId = null;
const HIDDEN_LOOP_INTERVAL = 100;

/* =========================
   Helper Functions
   ========================= */
function logCommand(msg) {
    if (!commandLog) return;
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    commandLog.prepend(div);
    if (commandLog.children.length > 40) commandLog.lastChild.remove();
}

function connectWebSocket() {
    try {
        state.ws = new WebSocket(CONFIG.wsUrl);
    } catch (err) {
        console.warn('Failed to create WebSocket:', err);
        return;
    }

    state.ws.onopen = () => {
        state.isWsConnected = true;
        wsStatusBadge.textContent = 'WS: Connected';
        wsStatusBadge.style.color = 'var(--success-color)';
        logCommand('Connected to Desktop Helper');
    };

    state.ws.onclose = () => {
        state.isWsConnected = false;
        wsStatusBadge.textContent = 'WS: Disconnected';
        wsStatusBadge.style.color = 'var(--danger-color)';
        setTimeout(connectWebSocket, 3000);
    };

    state.ws.onerror = (err) => {
        console.error('WebSocket error:', err);
    };

    state.ws.onmessage = (ev) => {
        logCommand(`WS recv: ${ev.data}`);
    };
}

function sendCommand(cmd) {
    try {
        if (state.isWsConnected && state.ws && state.ws.readyState === WebSocket.OPEN) {
            state.ws.send(JSON.stringify(cmd));
            if (cmd.type !== 'move') {
                logCommand(`Sent: ${cmd.type} ${cmd.button || cmd.name || ''}`);
            }
        }
    } catch (err) {
        console.warn('WebSocket send failed:', err);
    }
}

/* =========================
   Camera setup
   ========================= */
async function setupCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: CONFIG.video.width, height: CONFIG.video.height, facingMode: 'user' },
        audio: false
    });

    video.srcObject = stream;
    video.muted = true;

    await video.play().catch(e => console.warn('video.play() failed:', e));

    if (video.readyState >= 1) {
        video.width = video.videoWidth;
        video.height = video.videoHeight;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        state.isCameraReady = true;
        return video;
    }

    return new Promise(resolve => {
        video.onloadedmetadata = () => {
            video.width = video.videoWidth;
            video.height = video.videoHeight;
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            state.isCameraReady = true;
            resolve(video);
        };
    });
}

/* =========================
   Detectors initialization
   ========================= */
async function initDetectors() {
    try {
        if (typeof poseDetection === 'undefined') {
            throw new Error('poseDetection library not found');
        }

        await tf.setBackend('webgl');
        await tf.ready();
        logCommand(`TF Backend: ${tf.getBackend()}`);

        state.postureDetector = await poseDetection.createDetector(
            poseDetection.SupportedModels.MoveNet,
            {
                modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
                modelUrl: './models/model.json'
            }
        );
        logCommand('MoveNet detector initialized.');
    } catch (err) {
        console.error('Failed to init MoveNet:', err);
        state.postureDetector = null;
    }

    try {
        if (typeof Hands === 'undefined') {
            throw new Error('MediaPipe Hands not found');
        }
        state.handsDetector = new Hands({
            locateFile: (file) => {
                // Will fetch the correct file from the CDN
                return `./models/hands/${file}`;
            }
        });

        state.handsDetector.setOptions({
            maxNumHands: 1,
            modelComplexity: 1,
            minDetectionConfidence: 0.6,
            minTrackingConfidence: 0.5
        });

        state.handsDetector.onResults(onHandsResults);
        logCommand('MediaPipe Hands ready.');
    } catch (err) {
        console.error('Failed to init MediaPipe Hands:', err);
        state.handsDetector = null;
    }
}

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
   MediaPipe Hands results callback
   ========================= */
function onHandsResults(results) {
    if (results && results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        state.lastHands = results.multiHandLandmarks[0];
        const handedness = results.multiHandedness && results.multiHandedness.length > 0 ? results.multiHandedness[0] : null;
        analyzeGesture(state.lastHands, handedness);
    } else {
        state.lastHands = null;
        updateGestureStatus('None', 'No Action');
        if (virtualCursor) virtualCursor.classList.add('hidden');
        // Reset volume control state when no hands detected
        if (state.isVolumeControlActive) {
            state.isVolumeControlActive = false;
            state.lastIndexTipY = null;
        }
    }
}

/* =========================
   Volume Control Detection
   ========================= */
function detectVolumeControl(handLandmarks, poseKeypoints, timestamp) {
    if (!state.enableVolume) return;

    // Only allow volume control when cursor is NOT active
    if (state.isCursorActive) {
        if (state.isVolumeControlActive) {
            state.isVolumeControlActive = false;
            state.lastIndexTipY = null;
        }
        return;
    }

    if (!handLandmarks || !poseKeypoints) return;

    const indexTip = handLandmarks[8];

    // Create keypoint map for easy access
    const keypointMap = {};
    poseKeypoints.forEach(kp => {
        if (kp.name) keypointMap[kp.name] = kp;
    });

    const leftEar = keypointMap['left_ear'];
    const rightEar = keypointMap['right_ear'];

    // Check if we have valid ear positions
    if ((!leftEar || leftEar.score < CONFIG.thresholds.score) &&
        (!rightEar || rightEar.score < CONFIG.thresholds.score)) {
        if (state.isVolumeControlActive) {
            state.isVolumeControlActive = false;
            state.lastIndexTipY = null;
        }
        return;
    }

    let closestEar = null;
    let minDistance = Infinity;

    // Find which ear is closer to the index finger
    if (leftEar && leftEar.score > CONFIG.thresholds.score) {
        const dist = distance2D(indexTip, { x: leftEar.x / video.width, y: leftEar.y / video.height });
        if (dist < minDistance) {
            minDistance = dist;
            closestEar = leftEar;
        }
    }

    if (rightEar && rightEar.score > CONFIG.thresholds.score) {
        const dist = distance2D(indexTip, { x: rightEar.x / video.width, y: rightEar.y / video.height });
        if (dist < minDistance) {
            minDistance = dist;
            closestEar = rightEar;
        }
    }

    // Check if index finger is close enough to ear for volume control
    if (closestEar && minDistance < CONFIG.thresholds.earTouchDistance) {
        // Check if middle finger is also close (if so, ignore - likely just touching head/hair)
        const middleTip = handLandmarks[12];
        const middleDist = distance2D(middleTip, { x: closestEar.x / video.width, y: closestEar.y / video.height });

        if (middleDist < CONFIG.thresholds.earTouchDistance) {
            if (state.isVolumeControlActive) {
                state.isVolumeControlActive = false;
                state.lastIndexTipY = null;
            }
            return;
        }

        if (!state.isVolumeControlActive) {
            state.isVolumeControlActive = true;
            state.volumeControlStartTime = timestamp;
            logCommand('Volume control activated - position finger above/below ear');
            updateGestureStatus('Volume Control', 'Position above/below ear');
        }

        // Calculate vertical position relative to ear
        const earY = closestEar.y / video.height;
        const indexY = indexTip.y;

        const verticalThreshold = 0.02; // How far above/below ear to trigger volume change
        const volumeChangeInterval = 200; // ms between volume changes for smooth control

        // Check if index finger is above ear (increase volume)
        if (indexY < earY - verticalThreshold) {
            if (timestamp - state.lastVolumeGestureTime > volumeChangeInterval) {
                sendCommand({ type: 'volume', direction: 'up' });
                state.currentVolumeLevel = Math.min(100, state.currentVolumeLevel + 2); // Smaller increments
                logCommand(`Volume increased to ${state.currentVolumeLevel}%`);
                updateGestureStatus('Volume Control', `Volume: ${state.currentVolumeLevel}% ↑`);
                state.lastVolumeGestureTime = timestamp;
            }
        }
        // Check if index finger is below ear (decrease volume)
        else if (indexY > earY + verticalThreshold) {
            if (timestamp - state.lastVolumeGestureTime > volumeChangeInterval) {
                sendCommand({ type: 'volume', direction: 'down' });
                state.currentVolumeLevel = Math.max(0, state.currentVolumeLevel - 2); // Smaller increments
                logCommand(`Volume decreased to ${state.currentVolumeLevel}%`);
                updateGestureStatus('Volume Control', `Volume: ${state.currentVolumeLevel}% ↓`);
                state.lastVolumeGestureTime = timestamp;
            }
        }
        // Finger is at ear level - no volume change
        else {
            updateGestureStatus('Volume Control', 'Hold position at ear level');
        }

        // Draw visual feedback for volume control with position indicator
        drawVolumeFeedbackWithPosition(closestEar, indexTip, earY, indexY);

    } else {
        if (state.isVolumeControlActive) {
            const volumeControlDuration = timestamp - state.volumeControlStartTime;
            if (volumeControlDuration > 1000) { // Only log if it was active for more than 1 second
                logCommand('Volume control deactivated');
            }
            state.isVolumeControlActive = false;
        }
    }
}

// Helper function for 2D distance calculation
function distance2D(p1, p2) {
    if (!p1 || !p2) return Infinity;
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

// Enhanced visual feedback showing position relative to ear
function drawVolumeFeedbackWithPosition(ear, indexTip, earY, indexY) {
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

/* =========================
   Gesture analysis + helpers
   ========================= */
function analyzeGesture(landmarks, handedness) {
    if (!landmarks || landmarks.length < 21) return;

    if (handedness && handedness.label) {
        if (state.activeHandLabel && state.activeHandLabel !== handedness.label) {
            logCommand(`Hand swapped: ${state.activeHandLabel} -> ${handedness.label}. Recalibrating...`);
            state.peaceCenterX = null;
            state.peaceCenterY = null;
            state.peaceBodyX = null;
            state.smoothBodyX = null;
            state.smoothBodyY = null;
        }
        state.activeHandLabel = handedness.label;
    }

    const indexTip = landmarks[8];
    const thumbTip = landmarks[4];
    const wrist = landmarks[0];
    const middleTip = landmarks[12];

    if (!indexTip || !thumbTip || !wrist || !middleTip) {
        console.warn('Missing hand landmarks');
        return;
    }

    const handSize = Math.sqrt(
        Math.pow(middleTip.x - wrist.x, 2) +
        Math.pow(middleTip.y - wrist.y, 2)
    );

    if (handSize < CONFIG.thresholds.minHandSize) {
        updateGestureStatus('Hand Too Far', 'Move closer');
        if (virtualCursor) virtualCursor.classList.add('hidden');
        state.lastGesture = 'None';
        state.lastHands = null;
        return;
    }

    const isFist = checkFist(landmarks);
    const isPeace = checkPeace(landmarks);

    const now = Date.now();

    if (state.enableVolume && !state.isCursorActive && state.lastPose && state.lastPose.keypoints) {
        detectVolumeControl(landmarks, state.lastPose.keypoints, now);
    }

    if (state.isVolumeControlActive) return;

    const timeSinceLastToggle = now - state.lastToggleTime;

    const bodyAnchor = getBodyAnchor();
    let currentBodyX = bodyAnchor ? (1 - bodyAnchor.x) : (state.peaceBodyX || 0.5);
    let currentBodyY = bodyAnchor ? bodyAnchor.y : (state.peaceBodyY || 0.5);

    if (state.smoothBodyX === null) {
        state.smoothBodyX = currentBodyX;
        state.smoothBodyY = currentBodyY;
    } else {
        state.smoothBodyX = state.smoothBodyX * 0.90 + currentBodyX * 0.10;
        state.smoothBodyY = state.smoothBodyY * 0.90 + currentBodyY * 0.10;
        currentBodyX = state.smoothBodyX;
        currentBodyY = state.smoothBodyY;
    }

    if (isFist && state.lastGesture !== 'Fist') {
        state.lastToggleGesture = 'Fist';
        state.lastToggleTime = now;
        state.peaceHoldStart = 0;
    } else if (isPeace && state.lastToggleGesture === 'Fist' && timeSinceLastToggle < 2000) {
        if (state.peaceHoldStart === 0) state.peaceHoldStart = now;
        const holdDuration = now - state.peaceHoldStart;

        if (holdDuration > 300) {
            if (state.isCursorActive) {
                state.isCursorActive = false;
                logCommand('Cursor DEACTIVATED');
                if (virtualCursor) virtualCursor.classList.add('hidden');
            } else {
                state.isCursorActive = true;
                const midpointX = (indexTip.x + thumbTip.x) / 2;
                const midpointY = (indexTip.y + thumbTip.y) / 2;
                state.peaceCenterX = midpointX;
                state.peaceCenterY = midpointY;
                state.peaceBodyX = currentBodyX;
                state.peaceBodyY = currentBodyY;
                state.cursorX = 0.5;
                state.cursorY = 0.5;
                logCommand('Cursor ACTIVATED');
                if (virtualCursor) virtualCursor.style.border = '3px solid #00ff00';
            }
            state.lastToggleGesture = null;
            state.peaceHoldStart = 0;
            state.hasRecalibrated = false;
        }
    } else if (!isFist && !isPeace) {
        state.lastToggleGesture = null;
        state.peaceHoldStart = 0;
    }

    if (!state.isCursorActive) {
        updateGestureStatus('Cursor Inactive', 'Fist→Peace(hold) to activate');
        if (virtualCursor) virtualCursor.classList.add('hidden');
        state.lastGesture = isFist ? 'Fist' : (isPeace ? 'Peace' : 'Open Hand');

        if (state.enableSwipe && !isFist && !isPeace) {
            let virtualCenterX;
            let bodyRefX;

            if (state.peaceCenterX) {
                virtualCenterX = 1 - state.peaceCenterX;
                bodyRefX = (state.peaceBodyX !== null) ? state.peaceBodyX : currentBodyX;
            } else {
                const bodyX = (state.smoothBodyX !== null) ? state.smoothBodyX : 0.5;
                const HAND_OFFSET = 0.15;
                const offset = (state.activeHandLabel === 'Right') ? -HAND_OFFSET :
                    (state.activeHandLabel === 'Left') ? HAND_OFFSET : 0;
                virtualCenterX = bodyX + offset;
                bodyRefX = currentBodyX;
            }

            const midpointX = (indexTip.x + thumbTip.x) / 2;
            const rawX = 1 - midpointX;

            let deltaX = rawX - virtualCenterX;
            const bodyDeltaX = currentBodyX - bodyRefX;
            deltaX -= bodyDeltaX;

            const SWIPE_THRESHOLD = 0.27;
            const SWIPE_COOLDOWN = 500;

            if (now - state.lastSwipeTime > SWIPE_COOLDOWN) {
                if (deltaX > SWIPE_THRESHOLD) {
                    sendCommand({ type: 'switch_desktop', direction: 'right' });
                    logCommand('Swipe Right -> Next Desktop');
                    state.lastSwipeTime = now;
                    updateGestureStatus('Swipe Right', 'Next Desktop');
                } else if (deltaX < -SWIPE_THRESHOLD) {
                    sendCommand({ type: 'switch_desktop', direction: 'left' });
                    logCommand('Swipe Left -> Prev Desktop');
                    state.lastSwipeTime = now;
                    updateGestureStatus('Swipe Left', 'Prev Desktop');
                }
            }
        }

        if (state.enableTaskView) {
            const isOpenHand = checkOpenHand(landmarks);
            const TASK_VIEW_HOLD_THRESHOLD = 500;
            const TASK_VIEW_COOLDOWN = 100;

            if (isFist && state.lastTaskViewGesture !== 'Fist') {
                state.lastTaskViewGesture = 'Fist';
                state.openHandHoldStart = 0;
                state.fistHoldStart = 0;
            } else if (isOpenHand && state.lastTaskViewGesture === 'Fist') {
                if (state.openHandHoldStart === 0) state.openHandHoldStart = now;
                const holdDuration = now - state.openHandHoldStart;

                if (holdDuration > TASK_VIEW_HOLD_THRESHOLD && now - state.lastTaskViewTime > TASK_VIEW_COOLDOWN) {
                    sendCommand({ type: 'task_view', action: 'open' });
                    logCommand('Task View Opened (Fist→Open Hand hold)');
                    updateGestureStatus('Open Hand Hold', 'Task View Opened');
                    state.lastTaskViewTime = now;
                    state.lastTaskViewGesture = null;
                    state.openHandHoldStart = 0;
                }
            } else if (isOpenHand && state.lastTaskViewGesture !== 'OpenHand' && !isFist) {
                state.lastTaskViewGesture = 'OpenHand';
                state.fistHoldStart = 0;
                state.openHandHoldStart = 0;
            } else if (isFist && state.lastTaskViewGesture === 'OpenHand') {
                if (state.fistHoldStart === 0) state.fistHoldStart = now;
                const holdDuration = now - state.fistHoldStart;

                if (holdDuration > TASK_VIEW_HOLD_THRESHOLD && now - state.lastTaskViewTime > TASK_VIEW_COOLDOWN) {
                    sendCommand({ type: 'task_view', action: 'close' });
                    logCommand('Task View Closed (Open Hand→Fist hold)');
                    updateGestureStatus('Fist Hold', 'Task View Closed');
                    state.lastTaskViewTime = now;
                    state.lastTaskViewGesture = null;
                    state.fistHoldStart = 0;
                }
            } else if (!isFist && !isOpenHand) {
                state.lastTaskViewGesture = null;
                state.openHandHoldStart = 0;
                state.fistHoldStart = 0;
            }
        }

        return;
    }

    if (!state.peaceCenterX || !state.peaceCenterY) {
        const midpointX = (indexTip.x + thumbTip.x) / 2;
        const midpointY = (indexTip.y + thumbTip.y) / 2;
        state.peaceCenterX = midpointX;
        state.peaceCenterY = midpointY;
        state.peaceBodyX = currentBodyX;
        state.peaceBodyY = currentBodyY;
        logCommand('Auto-calibrated center on first hand detection');
    }

    const centerRefX = state.peaceCenterX;
    const centerRefY = state.peaceCenterY;

    if (state.peaceBodyX === null && currentBodyX !== null) {
        state.peaceBodyX = currentBodyX;
        state.peaceBodyY = currentBodyY;
    }

    const bodyRefX = (state.peaceBodyX !== null) ? state.peaceBodyX : currentBodyX;
    const bodyRefY = (state.peaceBodyY !== null) ? state.peaceBodyY : currentBodyY;

    const midpointX = (indexTip.x + thumbTip.x) / 2;
    const midpointY = (indexTip.y + thumbTip.y) / 2;

    const rawX = 1 - midpointX;
    const rawY = midpointY;

    const SENSITIVITY = 8.0;
    const virtualCenterX = 1 - centerRefX;
    const virtualCenterY = centerRefY;

    let deltaX = rawX - virtualCenterX;
    let deltaY = rawY - virtualCenterY;

    const bodyDeltaX = currentBodyX - bodyRefX;
    const bodyDeltaY = currentBodyY - bodyRefY;

    deltaX -= bodyDeltaX;
    deltaY -= bodyDeltaY;

    const DEADZONE = 0.01;
    const filteredDeltaX = Math.abs(deltaX) < DEADZONE ? 0 : deltaX;
    const filteredDeltaY = Math.abs(deltaY) < DEADZONE ? 0 : deltaY;

    const amplifiedX = virtualCenterX + filteredDeltaX * SENSITIVITY;
    const amplifiedY = virtualCenterY + filteredDeltaY * SENSITIVITY;

    const clampedX = Math.max(0, Math.min(1, amplifiedX));
    const clampedY = Math.max(0, Math.min(1, amplifiedY));

    const pinchDist = distance(indexTip, thumbTip);
    const isPinching = pinchDist < CONFIG.thresholds.pinchDistance * 0.6;

    if (!isPinching || state.isDragging) {
        state.cursorX = state.cursorX * 0.85 + clampedX * 0.15;
        state.cursorY = state.cursorY * 0.85 + clampedY * 0.15;
    }

    updateVirtualCursor(state.cursorX, state.cursorY);
    sendCommand({ type: 'move', x: state.cursorX, y: state.cursorY });

    let currentGesture = 'Open Hand';
    let action = 'Move Cursor';

    const PINCH_HOLD_THRESHOLD = 300;

    if (isPinching) {
        currentGesture = 'Pinch';

        if (state.pinchStartTime === 0) {
            state.pinchStartTime = now;
        }

        const pinchDuration = now - state.pinchStartTime;

        if (pinchDuration >= PINCH_HOLD_THRESHOLD) {
            action = 'Drag (Hold)';
            virtualCursor.classList.add('clicking');

            if (!state.isDragging) {
                state.isDragging = true;
                sendCommand({ type: 'drag', state: 'start' });
                logCommand('Drag started');
            }
        } else {
            action = 'Pinch (Hold for drag)';
            virtualCursor.classList.add('clicking');
        }
    }

    else if (isPeace) {
        currentGesture = 'Peace';
        action = 'Fist→Peace to recalibrate';

        if (state.enableTap && state.pinchStartTime > 0) {
            const pinchDuration = now - state.pinchStartTime;

            if (pinchDuration < PINCH_HOLD_THRESHOLD && !state.isDragging) {
                sendCommand({ type: 'click', button: 'left' });
                logCommand('Single click');
            }

            state.pinchStartTime = 0;
        }

        if (state.isDragging) {
            state.isDragging = false;
            sendCommand({ type: 'drag', state: 'end' });
            logCommand('Drag ended');
        }
        virtualCursor.classList.remove('clicking');
    }

    else {

        if (state.enableTap && state.pinchStartTime > 0) {
            const pinchDuration = now - state.pinchStartTime;

            if (pinchDuration < PINCH_HOLD_THRESHOLD && !state.isDragging) {
                sendCommand({ type: 'click', button: 'left' });
                logCommand('Single click');
            }

            state.pinchStartTime = 0;
        }

        if (state.isDragging) {
            state.isDragging = false;

            sendCommand({ type: 'drag', state: 'end' });   // ← FIX
            logCommand('Drag ended');
            virtualCursor.classList.remove('clicking');

            state.lastGesture = currentGesture;
            updateGestureStatus(currentGesture, action);
            state.lastGestureChangeTime = now;
        }
    }

    if (currentGesture !== state.lastGesture) {
        if (now - state.lastGestureChangeTime > state.gestureDebounceMs) {
            state.lastGesture = currentGesture;
            updateGestureStatus(currentGesture, action);
            state.lastGestureChangeTime = now;
        }
    } else {
        updateGestureStatus(currentGesture, action);
        state.lastGestureChangeTime = now;
    }
}


function getBodyAnchor() {
    if (!state.lastPose || !state.lastPose.keypoints) return null;

    const keypoints = state.lastPose.keypoints;
    const keypointMap = {};
    keypoints.forEach(kp => keypointMap[kp.name] = kp);

    const leftShoulder = keypointMap['left_shoulder'];
    const rightShoulder = keypointMap['right_shoulder'];

    if (leftShoulder && rightShoulder &&
        leftShoulder.score > CONFIG.thresholds.score &&
        rightShoulder.score > CONFIG.thresholds.score) {

        // Calculate midpoint
        const midX = (leftShoulder.x + rightShoulder.x) / 2;
        const midY = (leftShoulder.y + rightShoulder.y) / 2;

        // Normalize
        if (video.width && video.height) {
            return {
                x: midX / video.width,
                y: midY / video.height
            };
        }
    }
    return null;
}

function checkFist(landmarks) {
    if (!landmarks[8] || !landmarks[6] || !landmarks[12] || !landmarks[10] ||
        !landmarks[16] || !landmarks[14] || !landmarks[20] || !landmarks[18]) {
        return false;
    }
    return landmarks[8].y > landmarks[6].y &&
        landmarks[12].y > landmarks[10].y &&
        landmarks[16].y > landmarks[14].y &&
        landmarks[20].y > landmarks[18].y;
}

function checkPeace(landmarks) {
    if (!landmarks[8] || !landmarks[6] || !landmarks[12] || !landmarks[10] ||
        !landmarks[16] || !landmarks[14] || !landmarks[20] || !landmarks[18]) {
        return false;
    }
    return landmarks[8].y < landmarks[6].y &&
        landmarks[12].y < landmarks[10].y &&
        landmarks[16].y > landmarks[14].y &&
        landmarks[20].y > landmarks[18].y;
}

function checkOpenHand(landmarks) {
    if (!landmarks[8] || !landmarks[6] || !landmarks[12] || !landmarks[10] ||
        !landmarks[16] || !landmarks[14] || !landmarks[20] || !landmarks[18] ||
        !landmarks[4] || !landmarks[3] || !landmarks[2]) {
        return false;
    }

    // Fingers 2-5 extended (y-axis check for upright hand)
    const fingersExtended = landmarks[8].y < landmarks[6].y &&
        landmarks[12].y < landmarks[10].y &&
        landmarks[16].y < landmarks[14].y &&
        landmarks[20].y < landmarks[18].y;

    if (!fingersExtended) return false;

    // Thumb extended check (straightness)
    // Dist(MCP, Tip) should be close to Dist(MCP, IP) + Dist(IP, Tip)
    const thumbLen = distance(landmarks[2], landmarks[4]);
    const thumbSegs = distance(landmarks[2], landmarks[3]) + distance(landmarks[3], landmarks[4]);

    return thumbLen > 0.9 * thumbSegs;
}

function distance(p1, p2) {
    if (!p1 || !p2) return Infinity;
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

function updateVirtualCursor(x, y) {
    if (!virtualCursor || !video) return;
    virtualCursor.classList.remove('hidden');
    const rect = video.getBoundingClientRect();
    virtualCursor.style.left = `${Math.max(0, Math.min(1, x)) * rect.width}px`;
    virtualCursor.style.top = `${Math.max(0, Math.min(1, y)) * rect.height}px`;
}

function updateGestureStatus(gesture, action) {
    if (gestureStatus) gestureStatus.textContent = gesture;
    if (gestureAction) gestureAction.textContent = action;
}

/* =========================
   Calibration Logic
   ========================= */
function calibratePosture() {
    if (!state.lastPose) {
        alert("No person detected. Please sit in front of the camera.");
        return;
    }

    const keypoints = state.lastPose.keypoints;
    const keypointMap = {};
    keypoints.forEach(kp => keypointMap[kp.name] = kp);

    const leftShoulder = keypointMap['left_shoulder'];
    const rightShoulder = keypointMap['right_shoulder'];
    const leftEar = keypointMap['left_ear'];
    const rightEar = keypointMap['right_ear'];
    const nose = keypointMap['nose'];

    if (!leftShoulder || !rightShoulder || !leftEar || !rightEar) {
        alert("Cannot see all required body parts (shoulders and ears).");
        return;
    }

    const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x);
    const shoulderMidY = (leftShoulder.y + rightShoulder.y) / 2;
    const earMidY = (leftEar.y + rightEar.y) / 2;

    const verticalGap = shoulderMidY - earMidY;
    const normalizedVerticalGap = verticalGap / shoulderWidth;
    const tilt = Math.abs(leftShoulder.y - rightShoulder.y) / shoulderWidth;

    state.calibration = {
        verticalGapRatio: normalizedVerticalGap,
        tiltRatio: tilt,
        shoulderWidth: shoulderWidth,
        noseY: nose.y
    };

    logCommand("Posture Calibrated!");
    updatePostureStatus("Good Posture", 100);
    new Notification("Birdy", { body: "Calibration saved. Sit comfortably!" });
}

/* =========================
   Posture analysis + helpers
   ========================= */

function handleUnknownPosture() {
    updatePostureStatus('Unknown', 0);

    // Treat Unknown as "Standing/Away" state to enable auto-resume
    if (!state.isStanding) {
        state.isStanding = true;
        state.standingStartTime = Date.now();
    }

    // Stop timer immediately if running
    if (state.isTimerRunning) {
        stopTimer();
        logCommand('Timer auto-stopped: posture unknown');
    }
}

function analyzePosture(pose) {
    if (!pose || !pose.keypoints) {
        handleUnknownPosture();
        return;
    }

    const keypoints = pose.keypoints;
    const keypointMap = {};
    keypoints.forEach(kp => keypointMap[kp.name] = kp);

    const criticalPoints = ['nose', 'left_ear', 'right_ear', 'left_shoulder', 'right_shoulder'];
    const isReliable = criticalPoints.every(name =>
        keypointMap[name] && keypointMap[name].score > CONFIG.thresholds.score
    );

    if (!isReliable) {
        handleUnknownPosture();
        return;
    }

    if (!state.calibration) {
        updatePostureStatus('Uncalibrated', 0);
        return;
    }

    const leftShoulder = keypointMap['left_shoulder'];
    const rightShoulder = keypointMap['right_shoulder'];
    const leftEar = keypointMap['left_ear'];
    const rightEar = keypointMap['right_ear'];
    const nose = keypointMap['nose'];

    const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x);
    const shoulderMidY = (leftShoulder.y + rightShoulder.y) / 2;
    const earMidY = (leftEar.y + rightEar.y) / 2;

    const currentVerticalGapRatio = (shoulderMidY - earMidY) / shoulderWidth;
    const currentTiltRatio = Math.abs(leftShoulder.y - rightShoulder.y) / shoulderWidth;

    const SLOUCH_TOLERANCE = 15;
    const TILT_TOLERANCE = 5;
    const DISTANCE_TOLERANCE = 15;
    const HEIGHT_TOLERANCE = 10;
    const STANDING_HEIGHT_THRESHOLD = 50; // Threshold to detect standing

    let newPosture = 'Good Posture';
    let confidence = 100;
    let isUserStanding = false;

    const widthRatio = shoulderWidth / state.calibration.shoulderWidth;
    if (widthRatio < (1 - DISTANCE_TOLERANCE)) {
        newPosture = 'Too Far';
        confidence = 80;
    } else if (widthRatio > (1 + DISTANCE_TOLERANCE)) {
        newPosture = 'Too Close';
        confidence = 80;
    } else if (nose.y > state.calibration.noseY + HEIGHT_TOLERANCE) {
        newPosture = 'Sit Up (Height)';
        confidence = 75;
    } else if (nose.y < state.calibration.noseY - STANDING_HEIGHT_THRESHOLD) {
        // User is standing up
        newPosture = 'Standing';
        confidence = 90;
        isUserStanding = true;
    } else if (nose.y < state.calibration.noseY - HEIGHT_TOLERANCE) {
        newPosture = 'Sit Down (Height)';
        confidence = 75;
    } else if (currentVerticalGapRatio < state.calibration.verticalGapRatio - SLOUCH_TOLERANCE) {
        newPosture = 'Slouching';
        confidence = 70;
    } else if (Math.abs(currentTiltRatio - state.calibration.tiltRatio) > TILT_TOLERANCE) {
        newPosture = 'Shoulder Tilt';
        confidence = 80;
    }

    // Handle standing/sitting detection for timer control
    const now = Date.now();
    const STANDING_DURATION_THRESHOLD = 2000; // 15 seconds

    if (isUserStanding) {
        if (!state.isStanding) {
            // Just started standing
            state.isStanding = true;
            state.standingStartTime = now;
            logCommand('User stood up');
        } else {
            // Check if standing for more than 15 seconds
            const standingDuration = now - state.standingStartTime;
            if (standingDuration > STANDING_DURATION_THRESHOLD && state.isTimerRunning) {
                stopTimer();
                logCommand('Timer auto-stopped: standing for 15+ seconds');
            }
        }
    } else {
        if (state.isStanding) {
            // Just sat down
            state.isStanding = false;
            state.standingStartTime = null;
            if (!state.isTimerRunning) {
                startTimer();
                logCommand('Timer auto-started: user sat down');
            }
        }
    }

    updatePostureStatus(newPosture, confidence);
    checkBadPostureDuration(newPosture);
}

function updatePostureStatus(status, confidence) {
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

function checkBadPostureDuration(status) {
    if (state.snoozeUntil > Date.now()) {
        hideAlert();
        return;
    }

    if (status !== 'Good Posture' && status !== 'Unknown' && status !== 'Uncalibrated') {
        if (!state.badPostureStartTime) state.badPostureStartTime = Date.now();
        else {
            const duration = Date.now() - state.badPostureStartTime;
            if (duration > CONFIG.thresholds.badPostureDuration) {
                showAlert(`Bad posture detected: ${status}`);
                sendNotification(`Bad Posture: ${status}`, "Please sit up straight to match your calibrated pose.");
                state.badPostureStartTime = Date.now() + 5000;
            }
        }
    } else {
        state.badPostureStartTime = null;
        hideAlert();
    }
}

function sendNotification(title, body) {
    // Use IPC to show native Windows 11 notification with action buttons
    const { ipcRenderer } = require('electron');
    ipcRenderer.send('show-posture-notification', body);
}

function handleNoPerson() {
    handleUnknownPosture();
}

function updateTimer() {
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

function startTimer() {
    if (!state.isTimerRunning) {
        state.isTimerRunning = true;
        state.sittingStartTime = Date.now() - state.timerPausedTime;
        state.timerPausedTime = 0;
        updateTimerButtons();
        logCommand('Timer started manually');
    }
}

function stopTimer() {
    if (state.isTimerRunning) {
        state.isTimerRunning = false;
        state.timerPausedTime = Date.now() - state.sittingStartTime;
        updateTimerButtons();
        logCommand('Timer stopped manually');
    }
}

function updateTimerButtons() {
    const startBtn = document.getElementById('start-timer-btn');
    const stopBtn = document.getElementById('stop-timer-btn');

    if (startBtn && stopBtn) {
        if (state.isTimerRunning) {
            startBtn.disabled = true;
            stopBtn.disabled = false;
        } else {
            startBtn.disabled = false;
            stopBtn.disabled = true;
        }
    }
}

function pad(num) { return num.toString().padStart(2, '0'); }

function showAlert(msg) {
    if (state.isAlertActive) return;
    if (alertMessage) alertMessage.textContent = msg;
    if (alertOverlay) alertOverlay.classList.remove('hidden');
    state.isAlertActive = true; // Fixed: should be true when showing
}

function hideAlert() {
    if (!state.isAlertActive) return;
    if (alertOverlay) alertOverlay.classList.add('hidden');
    state.isAlertActive = false;
}

/* =========================
   Drawing helpers
   ========================= */
function drawSkeleton(pose) {
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

function drawHands(landmarks) {
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
