import { state } from './state.js';
import { CONFIG } from './config.js';
import { logCommand, distance, distance2D } from './utils.js';
import { sendCommand } from './websocket.js';
import { updateGestureStatus, updateVirtualCursor, drawVolumeFeedbackWithPosition, video, canvas, virtualCursor } from './ui.js';

/* =========================
   Gesture analysis + helpers
   ========================= */

export function onHandsResults(results) {
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

export function detectVolumeControl(handLandmarks, poseKeypoints, timestamp) {
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

export function analyzeGesture(landmarks, handedness) {
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

            sendCommand({ type: 'drag', state: 'end' });
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


export function getBodyAnchor() {
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

export function checkFist(landmarks) {
    if (!landmarks[8] || !landmarks[6] || !landmarks[12] || !landmarks[10] ||
        !landmarks[16] || !landmarks[14] || !landmarks[20] || !landmarks[18]) {
        return false;
    }
    return landmarks[8].y > landmarks[6].y &&
        landmarks[12].y > landmarks[10].y &&
        landmarks[16].y > landmarks[14].y &&
        landmarks[20].y > landmarks[18].y;
}

export function checkPeace(landmarks) {
    if (!landmarks[8] || !landmarks[6] || !landmarks[12] || !landmarks[10] ||
        !landmarks[16] || !landmarks[14] || !landmarks[20] || !landmarks[18]) {
        return false;
    }
    return landmarks[8].y < landmarks[6].y &&
        landmarks[12].y < landmarks[10].y &&
        landmarks[16].y > landmarks[14].y &&
        landmarks[20].y > landmarks[18].y;
}

export function checkOpenHand(landmarks) {
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
