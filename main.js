const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const path = require('path');

let mainWindow;
let tray;

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Someone tried to run a second instance, we should focus our window.
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            if (!mainWindow.isVisible()) mainWindow.show();
            mainWindow.focus();
        }
    });

    app.whenReady().then(() => {
        createWindow();
        createTray();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        title: 'Posture AI',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            backgroundThrottling: false, // CRITICAL: Allows ML to run in background
            webSecurity: false, // Allow loading external resources (CDN) from file://
            devTools: true
        }
    });

    mainWindow.loadFile('index.html');

    // Pipe renderer console logs to terminal
    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
        console.log(`[Renderer]: ${message} (${sourceId}:${line})`);
    });

    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
            if (process.platform === 'win32') {
                // Optional: Show a balloon notification on Windows
                tray.displayBalloon({
                    title: 'Posture AI',
                    content: 'App is running in the background.'
                });
            }
        }
        return false;
    });
}

function createTray() {
    // Create a simple red dot icon using data URL
    const iconData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAABTSURBVDhP7YyxDQAgDAN5/88WCAg0TFFXwZ0uN5c9N5V0Z07tQp+sX4E9Wb8Ce7J+BfZk/QrsyfoV2JP1K7An61dgT9avwJ6sX4E9Wb8Ce7J+BfvKAC11J9qQZc0XAAAAAElFTkSuQmCC';
    const icon = nativeImage.createFromDataURL(iconData);

    tray = new Tray(icon);

    const contextMenu = Menu.buildFromTemplate([
        { label: 'Show App', click: () => mainWindow.show() },
        { type: 'separator' },
        {
            label: 'Quit', click: () => {
                app.isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray.setToolTip('Posture AI - Running');
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
        mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    });
}

// Handle App Exit
app.on('window-all-closed', () => {
    // Do not quit when all windows are closed
    if (process.platform !== 'darwin') {
        // app.quit(); 
    }
});
