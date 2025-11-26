/* =========================
   Helper Functions
   ========================= */

export function logCommand(msg) {
    const commandLog = document.getElementById('command-log');
    if (!commandLog) return;
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    commandLog.prepend(div);
    if (commandLog.children.length > 40) commandLog.lastChild.remove();
}

export function distance2D(p1, p2) {
    if (!p1 || !p2) return Infinity;
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

export function distance(p1, p2) {
    if (!p1 || !p2) return Infinity;
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

export function pad(num) {
    return num.toString().padStart(2, '0');
}
