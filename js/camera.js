import { state } from './state.js';
import { CONFIG } from './config.js';
import { logCommand } from './utils.js';
import { video, canvas } from './ui.js';
import { onHandsResults } from './gestures.js';

/* =========================
   Camera setup
   ========================= */
export async function setupCamera() {
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
export async function initDetectors() {
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
