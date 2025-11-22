/**
 * app.js
 * Posture & Gesture AI - Renderer
 */

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
        minHandSize: 0.05
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
    calibration: null,
    lastPose: null,
    lastHands: null,
    lastGesture: 'None',
    isDragging: false,
    cursorX: 0.5,
    cursorY: 0.5,
    ws: null,
    isWsConnected: false,
    isCursorActive: true,
    lastToggleGesture: null,
    lastToggleTime: 0,
    peaceHoldStart: 0,
    peaceCenterX: null,
    peaceCenterY: null,
    lastGestureChangeTime: 0,
    gestureDebounceMs: 50,
    pinchStartTime: 0,
    hasRecalibrated: false
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
            { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
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
                return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
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
        analyzeGesture(state.lastHands);
    } else {
        state.lastHands = null;
        updateGestureStatus('None', 'No Action');
        if (virtualCursor) virtualCursor.classList.add('hidden');
    }
}

/* =========================
   Gesture analysis + helpers
   ========================= */
function analyzeGesture(landmarks) {
    if (!landmarks || landmarks.length < 21) return;

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
    const timeSinceLastToggle = now - state.lastToggleTime;

    // Fist→Peace gesture to toggle cursor activation/deactivation
    if (isFist && state.lastGesture !== 'Fist') {
        state.lastToggleGesture = 'Fist';
        state.lastToggleTime = now;
        state.peaceHoldStart = 0;
    } else if (isPeace && state.lastToggleGesture === 'Fist' && timeSinceLastToggle < 2000) {
        if (state.peaceHoldStart === 0) state.peaceHoldStart = now;
        const holdDuration = now - state.peaceHoldStart;

        // Toggle activation/deactivation after 500ms hold
        if (holdDuration > 500) {
            if (state.isCursorActive) {
                // Deactivate
                state.isCursorActive = false;
                logCommand('Cursor DEACTIVATED');
                if (virtualCursor) virtualCursor.classList.add('hidden');
            } else {
                // Activate and set initial reference point
                state.isCursorActive = true;
                const midpointX = (indexTip.x + thumbTip.x) / 2;
                const midpointY = (indexTip.y + thumbTip.y) / 2;
                state.peaceCenterX = midpointX;
                state.peaceCenterY = midpointY;
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
        return;
    }

    // Auto-calibrate center on first hand detection after activation (fallback)
    if (!state.peaceCenterX || !state.peaceCenterY) {
        const midpointX = (indexTip.x + thumbTip.x) / 2;
        const midpointY = (indexTip.y + thumbTip.y) / 2;
        state.peaceCenterX = midpointX;
        state.peaceCenterY = midpointY;
        logCommand('Auto-calibrated center on first hand detection');
    }

    // Use peace sign position as center
    const centerRefX = state.peaceCenterX;
    const centerRefY = state.peaceCenterY;

    // Calculate midpoint between index and thumb for cursor position
    const midpointX = (indexTip.x + thumbTip.x) / 2;
    const midpointY = (indexTip.y + thumbTip.y) / 2;

    const rawX = 1 - midpointX;
    const rawY = midpointY;

    // Apply sensitivity amplification relative to peace sign center
    const SENSITIVITY = 7.0;
    const virtualCenterX = 1 - centerRefX;
    const virtualCenterY = centerRefY;

    // Calculate movement from center
    const deltaX = rawX - virtualCenterX;
    const deltaY = rawY - virtualCenterY;

    // Apply deadzone to filter out small hand tremors (0.01 = 1% of screen)
    const DEADZONE = 0.01;
    const filteredDeltaX = Math.abs(deltaX) < DEADZONE ? 0 : deltaX;
    const filteredDeltaY = Math.abs(deltaY) < DEADZONE ? 0 : deltaY;

    // Amplify movement from peace sign center
    const amplifiedX = virtualCenterX + filteredDeltaX * SENSITIVITY;
    const amplifiedY = virtualCenterY + filteredDeltaY * SENSITIVITY;

    // Clamp to valid range
    const clampedX = Math.max(0, Math.min(1, amplifiedX));
    const clampedY = Math.max(0, Math.min(1, amplifiedY));

    const pinchDist = distance(indexTip, thumbTip);
    const isPinching = pinchDist < CONFIG.thresholds.pinchDistance * 0.6;

    // Update cursor position if:
    // - NOT pinching (normal movement), OR
    // - Currently dragging (need to move while dragging)
    // Freeze only during initial pinch detection (before drag starts)
    if (!isPinching || state.isDragging) {
        // Very smooth interpolation (95/5) - minimal jitter
        state.cursorX = state.cursorX * 0.95 + clampedX * 0.05;
        state.cursorY = state.cursorY * 0.95 + clampedY * 0.05;
    }

    updateVirtualCursor(state.cursorX, state.cursorY);
    sendCommand({ type: 'move', x: state.cursorX, y: state.cursorY });

    let currentGesture = 'Open Hand';
    let action = 'Move Cursor';

    const PINCH_HOLD_THRESHOLD = 300; // 300ms to differentiate click from drag

    // PRIORITY 1: Check pinch first (most important for clicking/dragging)
    if (isPinching) {
        currentGesture = 'Pinch';

        // Start tracking pinch time if this is a new pinch
        if (state.pinchStartTime === 0) {
            state.pinchStartTime = now;
        }

        const pinchDuration = now - state.pinchStartTime;

        // If held for 300ms or more, it's a drag
        if (pinchDuration >= PINCH_HOLD_THRESHOLD) {
            action = 'Drag (Hold)';
            virtualCursor.classList.add('clicking');

            if (!state.isDragging) {
                state.isDragging = true;
                sendCommand({ type: 'drag', state: 'start' });
                logCommand('Drag started');
            }
        } else {
            // Still waiting to see if it's a click or drag
            action = 'Pinch (Hold for drag)';
            virtualCursor.classList.add('clicking');
        }
    }
    // PRIORITY 2: Check peace sign (only if not pinching)
    else if (isPeace) {
        currentGesture = 'Peace';
        action = 'Fist→Peace to recalibrate';

        // Pinch was released - check if it was a quick click
        if (state.pinchStartTime > 0) {
            const pinchDuration = now - state.pinchStartTime;

            if (pinchDuration < PINCH_HOLD_THRESHOLD && !state.isDragging) {
                // Quick pinch = single click
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
    // PRIORITY 3: Default open hand
    else {
        // Pinch was released - check if it was a quick click
        if (state.pinchStartTime > 0) {
            const pinchDuration = now - state.pinchStartTime;

            if (pinchDuration < PINCH_HOLD_THRESHOLD && !state.isDragging) {
                // Quick pinch = single click
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

    // Apply gesture debouncing - only update if gesture has been stable for debounce period
    const currentTime = Date.now();
    if (currentGesture !== state.lastGesture) {
        if (currentTime - state.lastGestureChangeTime > state.gestureDebounceMs) {
            state.lastGesture = currentGesture;
            updateGestureStatus(currentGesture, action);
            state.lastGestureChangeTime = currentTime;
        }
    } else {
        // Same gesture, update status immediately
        updateGestureStatus(currentGesture, action);
        state.lastGestureChangeTime = currentTime;
    }
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
    new Notification("Posture AI", { body: "Calibration saved. Sit comfortably!" });
}

/* =========================
   Posture analysis + helpers
   ========================= */
function analyzePosture(pose) {
    if (!pose || !pose.keypoints) {
        updatePostureStatus('Unknown', 0);
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
        updatePostureStatus('Unknown', 0);
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

    const SLOUCH_TOLERANCE = 0.15;
    const TILT_TOLERANCE = 0.05;
    const DISTANCE_TOLERANCE = 0.15;
    const HEIGHT_TOLERANCE = 0.10;

    let newPosture = 'Good Posture';
    let confidence = 100;

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
    if (Notification.permission === 'granted') {
        new Notification(title, { body: body });
    } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                new Notification(title, { body: body });
            }
        });
    }
}

function handleNoPerson() {
    updatePostureStatus('Unknown', 0);
    const timeSinceLastSeen = Date.now() - state.lastPersonDetectedTime;
    if (timeSinceLastSeen > CONFIG.thresholds.absenceTimeout) {
        state.sittingStartTime = Date.now();
        if (timerMessage) timerMessage.textContent = "Timer paused (user away)";
    }
}

/* =========================
   Timer & Alerts
   ========================= */
function updateTimer() {
    const now = Date.now();
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

function pad(num) { return num.toString().padStart(2, '0'); }

function showAlert(msg) {
    if (state.isAlertActive) return;
    if (alertMessage) alertMessage.textContent = msg;
    if (alertOverlay) alertOverlay.classList.remove('hidden');
    state.isAlertActive = true;
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

        if (calibrateBtn) {
            calibrateBtn.addEventListener('click', calibratePosture);
        }

        startLoop();
        setInterval(updateTimer, 1000);

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
