/* =========================
   State
   ========================= */
export const state = {
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
