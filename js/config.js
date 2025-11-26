/* =========================
   Configuration
   ========================= */
export const CONFIG = {
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
