import { state } from './state.js';
import { CONFIG } from './config.js';
import { logCommand } from './utils.js';
import { wsStatusBadge } from './ui.js';

/* =========================
   WebSocket
   ========================= */

export function connectWebSocket() {
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

export function sendCommand(cmd) {
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
