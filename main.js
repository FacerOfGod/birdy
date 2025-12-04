// main.js
const { app, BrowserWindow, Tray, Menu, nativeImage, Notification, ipcMain, screen } = require('electron');
const path = require('path');
const { execFile } = require('child_process');

// Constants
const APP_CONFIG = {
    name: 'Birdy',
    appUserModelId: 'com.birdy.app',
    version: '1.0.0'
};

const WINDOW_CONFIG = {
    normal: {
        width: 1280,
        height: 800,
        minWidth: 800,
        minHeight: 600
    },
    compact: {
        width: 220,
        height: 300,
        minWidth: 220,
        minHeight: 200,
        maxHeight: 500
    },
    timerOnly: {
        width: 220,
        height: 90,
        minWidth: 150,
        minHeight: 60
    },
    splash: {
        width: 500,
        height: 700
    }
};

const TIMING_CONFIG = {
    splashDelay: 6500
};

const PATHS = {
    images: {
        logo: 'images/logo.png'
    },
    server: '/dist/server.exe'
};

const TRAY_CONFIG = {
    iconSize: { width: 16, height: 16 }
};

const NOTIFICATION_CONFIG = {
    title: 'Birdy - Posture Alert',
    balloon: {
        title: 'Birdy',
        content: 'App is running in the background.'
    }
};

const SVG_ICONS = {
    fallbackApp: `
    <svg width="64" height="64" xmlns="http://www.w3.org/2000/svg">
      <circle cx="32" cy="32" r="28" fill="#3b82f6"/>
      <text x="32" y="40" text-anchor="middle" fill="white" font-family="Arial" font-size="20">B</text>
    </svg>
  `,
    fallbackNotification: `
    <svg width="64" height="64" xmlns="http://www.w3.org/2000/svg">
      <circle cx="32" cy="32" r="30" fill="#3b82f6"/>
      <text x="32" y="42" text-anchor="middle" fill="white" font-family="Arial" font-size="24" font-weight="bold">B</text>
    </svg>
  `,
    fallbackTray: `
    <svg width="16" height="16" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="7" fill="#3b82f6"/>
      <text x="8" y="11" text-anchor="middle" fill="white" font-family="Arial" font-size="8" font-weight="bold">B</text>
    </svg>
  `
};

// App state
let serverProcess;
let mainWindow;
let tray;
let isCompactMode = false;
let isTimerOnlyMode = false;
let normalBounds = {
    width: WINDOW_CONFIG.normal.width,
    height: WINDOW_CONFIG.normal.height,
    x: undefined,
    y: undefined
};
let compactBounds = {
    width: WINDOW_CONFIG.compact.width,
    height: WINDOW_CONFIG.compact.height,
    x: undefined,
    y: undefined
};
let timerOnlyBounds = {
    width: WINDOW_CONFIG.timerOnly.width,
    height: WINDOW_CONFIG.timerOnly.height,
    x: undefined,
    y: undefined
};

// App initialization
app.setAppUserModelId(APP_CONFIG.appUserModelId);
app.name = APP_CONFIG.name;

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            if (!mainWindow.isVisible()) mainWindow.show();
            mainWindow.focus();
        }
    });

    app.whenReady().then(() => {
        startPythonServer();
        createWindow();
        createTray();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    });
}

// Server management
function startPythonServer() {
    const serverPath = path.join(__dirname, PATHS.server);
    try {
        serverProcess = execFile(serverPath, (error, stdout, stderr) => {
            if (error) console.error('Server error:', error);
            if (stdout) console.log(stdout.toString());
            if (stderr) console.error(stderr.toString());
        });
        console.log('Python server started at', serverPath);
    } catch (e) {
        console.error('Failed to start Python server:', e);
    }
}

function stopPythonServer() {
    if (serverProcess) {
        try {
            serverProcess.kill('SIGTERM');
            console.log('Python server stopped');
        } catch (e) {
            console.error('Error stopping Python server:', e);
        }
        serverProcess = null;
    }
}

// Icon management
function createAppIcon() {
    try {
        const iconPath = path.join(__dirname, PATHS.images.logo);
        let icon = nativeImage.createFromPath(iconPath);

        if (icon.isEmpty()) {
            console.warn('App icon not found at', PATHS.images.logo, ', using fallback icon');
            icon = nativeImage.createFromBuffer(Buffer.from(SVG_ICONS.fallbackApp));
        }

        return icon;
    } catch (e) {
        console.warn('Failed to create app icon:', e);
        return nativeImage.createFromBuffer(Buffer.from(SVG_ICONS.fallbackApp));
    }
}

function createNotificationIcon() {
    try {
        const iconPath = path.join(__dirname, PATHS.images.logo);
        let icon = nativeImage.createFromPath(iconPath);

        if (icon.isEmpty()) {
            icon = nativeImage.createFromBuffer(Buffer.from(SVG_ICONS.fallbackNotification));
        }

        return icon;
    } catch (error) {
        try {
            return nativeImage.createFromBuffer(Buffer.from(SVG_ICONS.fallbackNotification));
        } catch (e) {
            return undefined;
        }
    }
}

function createTrayIcon() {
    try {
        const iconPath = path.join(__dirname, PATHS.images.logo);
        let trayIcon = nativeImage.createFromPath(iconPath);
        trayIcon = trayIcon.resize(TRAY_CONFIG.iconSize);
        return trayIcon;
    } catch (error) {
        console.warn('Could not load tray icon, using fallback', error);
        return nativeImage.createFromBuffer(Buffer.from(SVG_ICONS.fallbackTray));
    }
}

// Window management
function createWindow() {
    const appIcon = createAppIcon();

    mainWindow = new BrowserWindow({
        width: WINDOW_CONFIG.splash.width,
        height: WINDOW_CONFIG.splash.height,
        title: `${APP_CONFIG.name} - AI Posture & Gesture Control`,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        roundedCorners: true,
        icon: appIcon,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            backgroundThrottling: false,
            devTools: true
        }
    });

    // Initialize stored normal bounds
    normalBounds = {
        width: WINDOW_CONFIG.normal.width,
        height: WINDOW_CONFIG.normal.height,
        x: undefined,
        y: undefined
    };

    // Load UI - start with splash screen
    mainWindow.loadFile('splash.html');
    mainWindow.setTitle(`${APP_CONFIG.name} - AI Posture & Gesture Control`);

    // Resize to main app size after splash delay
    setTimeout(() => {
        if (mainWindow) {
            mainWindow.setSize(WINDOW_CONFIG.normal.width, WINDOW_CONFIG.normal.height);
            mainWindow.center();
            // Update normalBounds with new centered position
            try {
                const bounds = mainWindow.getBounds();
                normalBounds.x = bounds.x;
                normalBounds.y = bounds.y;
            } catch (e) { /* ignore */ }
        }
    }, TIMING_CONFIG.splashDelay);

    // Forward renderer console logs to main process console
    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
        console.log(`[Renderer]: ${message} (${sourceId}:${line})`);
    });

    setupWindowControls();
    setupNotificationHandler();
    setupCompactModeHandler();
    setupWindowEvents();
}

function setupWindowControls() {
    // IPC window controls
    ipcMain.on('window-minimize', () => mainWindow.minimize());

    ipcMain.on('window-maximize', () => {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    });

    ipcMain.on('window-close', () => {
        if (!app.isQuitting) {
            mainWindow.hide();
            if (process.platform === 'win32' && tray) {
                try {
                    tray.displayBalloon(NOTIFICATION_CONFIG.balloon);
                } catch (e) { /* displayBalloon may fail on some Windows versions, ignore */ }
            }
        } else {
            mainWindow.close();
        }
    });
}

function setupNotificationHandler() {
    ipcMain.on('show-posture-notification', (event, message) => {
        if (Notification.isSupported()) {
            const notificationIcon = createNotificationIcon();

            const notification = new Notification({
                title: NOTIFICATION_CONFIG.title,
                body: message,
                icon: notificationIcon,
                urgency: 'normal',
                timeoutType: 'default'
            });

            notification.on('click', () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                    mainWindow.webContents.send('notification-action', 'show');
                }
            });

            notification.show();
            console.log('Notification sent:', message);
        } else {
            console.warn('Notifications not supported on this system');
        }
    });

    ipcMain.on('notification-action', (event, action) => {
        console.log('Notification action received:', action);
        if (mainWindow) mainWindow.webContents.send('notification-action', action);
    });
}

function setupCompactModeHandler() {
    ipcMain.on('toggle-compact-mode', (event, compact) => {
        isCompactMode = !!compact;
        isTimerOnlyMode = false; // Reset timer only mode when switching compact mode

        if (!mainWindow) return;

        if (isCompactMode) {
            enterCompactMode();
        } else {
            exitCompactMode();
        }
    });

    ipcMain.on('toggle-timer-only-mode', (event, timerOnly) => {
        isTimerOnlyMode = !!timerOnly;

        if (!mainWindow) return;

        if (isTimerOnlyMode) {
            enterTimerOnlyMode();
        } else {
            exitTimerOnlyMode();
        }
    });

    // Handle dynamic resizing of compact window
    ipcMain.on('resize-compact-mode', (event, height) => {
        if (!mainWindow || !isCompactMode || isTimerOnlyMode) return;

        try {
            // Clamp height to reasonable bounds
            const minHeight = WINDOW_CONFIG.compact.minHeight;
            const maxHeight = WINDOW_CONFIG.compact.maxHeight;
            const clampedHeight = Math.max(minHeight, Math.min(maxHeight, height));

            const bounds = mainWindow.getBounds();
            const currentWidth = bounds.width;

            console.log(`[Main] Resizing compact window from ${bounds.height}px to ${clampedHeight}px (requested: ${height}px)`);

            // Temporarily disable alwaysOnTop during resize (this is key!)
            mainWindow.setAlwaysOnTop(false);

            // Resize the window - use setBounds to maintain position
            const newBounds = {
                x: bounds.x,
                y: bounds.y,
                width: currentWidth,
                height: clampedHeight
            };
            mainWindow.setBounds(newBounds, false); // false = no animation

            // Re-enable alwaysOnTop
            mainWindow.setAlwaysOnTop(true, 'screen-saver');

            // Update stored compact bounds
            compactBounds = {
                width: currentWidth,
                height: clampedHeight,
                x: bounds.x,
                y: bounds.y
            };

            // Send confirmation back to renderer
            event.sender.send('compact-resize-confirmed', clampedHeight);

            console.log(`[Main] Window resized successfully to ${currentWidth}x${clampedHeight}`);
        } catch (e) {
            console.error('Failed to resize compact window:', e);
        }
    });
}

function enterCompactMode() {
    // Save the current full bounds BEFORE shrinking
    try {
        const bounds = mainWindow.getBounds();
        normalBounds = {
            width: bounds.width,
            height: bounds.height,
            x: bounds.x,
            y: bounds.y
        };
    } catch (e) {
        // Keep existing normalBounds if getBounds fails
    }

    // Calculate target bounds for compact mode
    const targetBounds = calculateCompactBounds();

    // Apply compact bounds
    mainWindow.setBounds(targetBounds, true);
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mainWindow.show();
    mainWindow.focus();

    console.log(`[Main] Entered compact mode at ${targetBounds.width}x${targetBounds.height}`);
}

function exitCompactMode() {
    // Save current compact position/size
    try {
        const bounds = mainWindow.getBounds();
        compactBounds = {
            width: bounds.width,
            height: bounds.height,
            x: bounds.x,
            y: bounds.y
        };
    } catch (e) {
        // ignore
    }

    // Restore normal bounds
    const targetBounds = calculateNormalBounds();

    mainWindow.setAlwaysOnTop(false); // Disable alwaysOnTop first
    mainWindow.setVisibleOnAllWorkspaces(false);

    if (typeof targetBounds.x === 'undefined' || typeof targetBounds.y === 'undefined') {
        mainWindow.setSize(targetBounds.width, targetBounds.height);
        mainWindow.center();
    } else {
        mainWindow.setBounds(targetBounds, true);
    }

    mainWindow.show();
    mainWindow.focus();

    console.log(`[Main] Exited compact mode, restored to ${targetBounds.width}x${targetBounds.height}`);
}

function enterTimerOnlyMode() {
    // Save current bounds (could be normal or compact)
    try {
        const bounds = mainWindow.getBounds();
        if (isCompactMode) {
            compactBounds = { ...bounds };
        } else {
            normalBounds = { ...bounds };
        }
    } catch (e) { /* ignore */ }

    // Calculate target bounds for timer only mode
    const targetBounds = calculateTimerOnlyBounds();

    // Apply timer only bounds
    mainWindow.setBounds(targetBounds, true);
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mainWindow.show();
    mainWindow.focus();

    console.log(`[Main] Entered timer only mode at ${targetBounds.width}x${targetBounds.height}`);
}

function exitTimerOnlyMode() {
    // Save current timer only position
    try {
        const bounds = mainWindow.getBounds();
        timerOnlyBounds = { ...bounds };
    } catch (e) { /* ignore */ }

    // Restore previous mode bounds
    let targetBounds;
    if (isCompactMode) {
        targetBounds = calculateCompactBounds();
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
        mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } else {
        targetBounds = calculateNormalBounds();
        mainWindow.setAlwaysOnTop(false);
        mainWindow.setVisibleOnAllWorkspaces(false);
    }

    if (typeof targetBounds.x === 'undefined' || typeof targetBounds.y === 'undefined') {
        mainWindow.setSize(targetBounds.width, targetBounds.height);
        mainWindow.center();
    } else {
        mainWindow.setBounds(targetBounds, true);
    }

    mainWindow.show();
    mainWindow.focus();

    console.log(`[Main] Exited timer only mode, restored to ${targetBounds.width}x${targetBounds.height}`);
}

function calculateCompactBounds() {
    if (compactBounds && compactBounds.width && compactBounds.height && typeof compactBounds.x !== 'undefined') {
        return { ...compactBounds };
    } else {
        // Center default compact size
        const display = screen.getPrimaryDisplay();
        const { width: screenWidth, height: screenHeight } = display.workAreaSize;
        const width = WINDOW_CONFIG.compact.width;
        const height = WINDOW_CONFIG.compact.height;
        const x = Math.round((screenWidth - width) / 2) + display.workArea.x;
        const y = Math.round((screenHeight - height) / 2) + display.workArea.y;
        const calculatedBounds = { width, height, x, y };
        compactBounds = { ...calculatedBounds };
        return calculatedBounds;
    }
}

function calculateTimerOnlyBounds() {
    if (timerOnlyBounds && timerOnlyBounds.width && timerOnlyBounds.height && typeof timerOnlyBounds.x !== 'undefined') {
        // Ensure bounds are within screen limits
        const display = screen.getPrimaryDisplay();
        const { width: screenWidth, height: screenHeight } = display.workAreaSize;

        let x = timerOnlyBounds.x;
        let y = timerOnlyBounds.y;

        // Reset if off-screen
        if (x < 0 || x > screenWidth || y < 0 || y > screenHeight) {
            x = screenWidth - WINDOW_CONFIG.timerOnly.width - 20;
            y = screenHeight - WINDOW_CONFIG.timerOnly.height - 20;
        }

        return { ...timerOnlyBounds, x, y };
    } else {
        // Position at bottom right by default
        const display = screen.getPrimaryDisplay();
        const { width: screenWidth, height: screenHeight } = display.workAreaSize;
        const width = WINDOW_CONFIG.timerOnly.width;
        const height = WINDOW_CONFIG.timerOnly.height;
        const x = screenWidth - width - 20;
        const y = screenHeight - height - 20;
        const calculatedBounds = { width, height, x, y };
        timerOnlyBounds = { ...calculatedBounds };
        return calculatedBounds;
    }
}

function calculateNormalBounds() {
    return {
        width: normalBounds.width || WINDOW_CONFIG.normal.width,
        height: normalBounds.height || WINDOW_CONFIG.normal.height,
        x: typeof normalBounds.x !== 'undefined' ? normalBounds.x : undefined,
        y: typeof normalBounds.y !== 'undefined' ? normalBounds.y : undefined
    };
}

function setupWindowEvents() {
    // When restored from minimized: reapply mode-specific bounds
    mainWindow.on('restore', () => {
        reapplyWindowBounds();
    });

    // When showing (e.g. from tray) ensure proper size/position for current mode
    mainWindow.on('show', () => {
        reapplyWindowBounds();
    });

    // Keep track of bounds when user moves/resizes
    mainWindow.on('move', () => {
        updateStoredBounds();
    });

    mainWindow.on('resize', () => {
        updateStoredBounds();
    });

    // Prevent window from closing (hide to tray instead) unless quitting
    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
            if (process.platform === 'win32' && tray) {
                try {
                    tray.displayBalloon(NOTIFICATION_CONFIG.balloon);
                } catch (e) { /* ignore */ }
            }
        } else {
            mainWindow.close();
        }
    });
}

function reapplyWindowBounds() {
    if (!mainWindow) return;

    try {
        if (isTimerOnlyMode && timerOnlyBounds && typeof timerOnlyBounds.width !== 'undefined') {
            mainWindow.setAlwaysOnTop(true, 'screen-saver');
            mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
            mainWindow.setBounds(timerOnlyBounds, true);
            console.log(`[Main] Reapplied timer only bounds: ${timerOnlyBounds.width}x${timerOnlyBounds.height}`);
        } else if (isCompactMode && compactBounds && typeof compactBounds.width !== 'undefined') {
            mainWindow.setAlwaysOnTop(true, 'screen-saver');
            mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
            mainWindow.setBounds(compactBounds, true);
            console.log(`[Main] Reapplied compact bounds: ${compactBounds.width}x${compactBounds.height}`);
        } else if (!isCompactMode && !isTimerOnlyMode && normalBounds && typeof normalBounds.width !== 'undefined') {
            mainWindow.setAlwaysOnTop(false);
            mainWindow.setVisibleOnAllWorkspaces(false);
            const targetBounds = calculateNormalBounds();

            if (typeof targetBounds.x === 'undefined' || typeof targetBounds.y === 'undefined') {
                mainWindow.setSize(targetBounds.width, targetBounds.height);
                mainWindow.center();
            } else {
                mainWindow.setBounds(targetBounds, true);
            }
            console.log(`[Main] Reapplied normal bounds: ${targetBounds.width}x${targetBounds.height}`);
        }
    } catch (e) {
        console.warn('Error reapplying bounds:', e);
    }
}

function updateStoredBounds() {
    if (!mainWindow) return;

    try {
        const bounds = mainWindow.getBounds();
        if (isTimerOnlyMode) {
            timerOnlyBounds = { width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y };
        } else if (isCompactMode) {
            compactBounds = { width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y };
        } else {
            normalBounds = { width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y };
        }
    } catch (e) { /* ignore */ }
}

// Tray management
function createTray() {
    const trayIcon = createTrayIcon();

    tray = new Tray(trayIcon);
    const contextMenu = Menu.buildFromTemplate([
        {
            label: `Show ${APP_CONFIG.name}`,
            click: () => showMainWindow()
        },
        { type: 'separator' },
        {
            label: `Quit ${APP_CONFIG.name}`,
            click: () => {
                app.isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray.setToolTip(`${APP_CONFIG.name} - AI Posture & Gesture Control`);
    tray.setContextMenu(contextMenu);

    // Single click toggles show/hide
    tray.on('click', () => {
        if (!mainWindow) return;

        if (mainWindow.isVisible()) {
            mainWindow.hide();
        } else {
            showMainWindow();
        }
    });

    tray.on('double-click', () => {
        if (!mainWindow) return;
        showMainWindow();
    });
}

function showMainWindow() {
    if (!mainWindow) return;

    try {
        reapplyWindowBounds();
        mainWindow.show();
        mainWindow.focus();
    } catch (e) {
        console.warn('Error showing main window:', e);
    }
}

// Cleanup handlers
app.on('before-quit', () => {
    console.log('App is quitting, stopping Python server...');
    stopPythonServer();
});

app.on('will-quit', () => {
    stopPythonServer();
});

// Keep app running in background on non-macOS
app.on('window-all-closed', () => {
    // Don't quit the app, keep it running in tray
    // Server will keep running until app actually quits
});