import { state } from './state.js';
import { CONFIG } from './config.js';
import { logCommand } from './utils.js';
import { updatePostureStatus, sendNotification, showAlert, hideAlert, stopTimer, startTimer } from './ui.js';

/* =========================
   Calibration Logic
   ========================= */
export function calibratePosture() {
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

export function handleUnknownPosture() {
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

export function analyzePosture(pose) {
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

export function checkBadPostureDuration(status) {
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

export function handleNoPerson() {
    handleUnknownPosture();
}
