const { app, BrowserWindow, Tray, Menu, nativeImage, Notification, ipcMain } = require('electron');
const path = require('path');

let mainWindow;
let tray;

// Set app name and metadata for Windows notifications
app.setAppUserModelId('com.birdy.app');
app.name = 'Birdy';

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
    // Create a proper icon for the app
    const appIcon = nativeImage.createFromPath(path.join(__dirname, 'images', 'logo.png'));
    
    // If icon file doesn't exist, create a fallback
    if (appIcon.isEmpty()) {
        console.warn('App icon not found at images/logo.png, using fallback');
        // Create a simple fallback icon
        const fallbackIcon = nativeImage.createFromBuffer(Buffer.from(`
            <svg width="64" height="64" xmlns="http://www.w3.org/2000/svg">
                <circle cx="32" cy="32" r="28" fill="#3b82f6"/>
                <text x="32" y="40" text-anchor="middle" fill="white" font-family="Arial" font-size="20">B</text>
            </svg>
        `));
    }

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        title: 'Birdy - AI Posture & Gesture Control',
        frame: false, // Borderless
        transparent: true, // Transparent background
        backgroundColor: '#00000000',
        icon: appIcon, // Set window icon
        webPreferences: {
            nodeIntegration: true, // Enable Node integration for IPC
            contextIsolation: false, // Disable context isolation for simpler IPC
            backgroundThrottling: false, // CRITICAL: Allows ML to run in background
            webSecurity: false, // Allow loading external resources (CDN) from file://
            devTools: true
        }
    });

    mainWindow.loadFile('index.html');

    // Set window title explicitly
    mainWindow.setTitle('Birdy - AI Posture & Gesture Control');

    // Pipe renderer console logs to terminal
    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
        console.log(`[Renderer]: ${message} (${sourceId}:${line})`);
    });

    // IPC Handlers for Window Controls
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
            if (process.platform === 'win32') {
                tray.displayBalloon({
                    title: 'Birdy',
                    content: 'App is running in the background.'
                });
            }
        } else {
            mainWindow.close();
        }
    });

    // IPC Handlers for Notification Actions - IMPROVED FOR WINDOWS 11
    ipcMain.on('show-posture-notification', (event, message) => {
        if (Notification.isSupported()) {
            // Try to load notification icon
            let notificationIcon;
            try {
                notificationIcon = nativeImage.createFromPath(path.join(__dirname, 'images', 'logo.png'));
                if (notificationIcon.isEmpty()) {
                    // Create fallback icon if file doesn't exist
                    notificationIcon = nativeImage.createFromBuffer(Buffer.from(`
                        <svg width="64" height="64" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="32" cy="32" r="30" fill="#3b82f6"/>
                            <text x="32" y="42" text-anchor="middle" fill="white" font-family="Arial" font-size="24" font-weight="bold">B</text>
                        </svg>
                    `));
                }
            } catch (error) {
                console.warn('Could not load notification icon:', error);
                // Use built-in fallback
                notificationIcon = nativeImage.createFromDataURL('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMzIiIGN5PSIzMiIgcj0iMzAiIGZpbGw9IiMzYjgyZjYiLz48dGV4dCB4PSIzMiIgeT0iNDIiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IndoaXRlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMjQiIGZvbnQtd2VpZ2h0PSJib2xkIj5CPC90ZXh0Pjwvc3ZnPg==');
            }

            const notification = new Notification({
                title: 'Birdy - Posture Alert',
                body: message,
                icon: notificationIcon,
                urgency: 'normal',
                timeoutType: 'default' // Use 'default' instead of 'never' for better Windows compatibility
            });

            notification.on('click', () => {
                mainWindow.show();
                mainWindow.focus();
                // Send action to renderer
                mainWindow.webContents.send('notification-action', 'show');
            });

            // Note: Windows 11 has limited support for notification actions
            // The actions array may not work consistently across Windows versions
            
            notification.show();
            
            // Also log to console for debugging
            console.log('Notification sent:', message);
        } else {
            console.warn('Notifications not supported on this system');
        }
    });

    // Handle notification actions from renderer
    ipcMain.on('notification-action', (event, action) => {
        console.log('Notification action received:', action);
        // Forward to renderer process
        mainWindow.webContents.send('notification-action', action);
    });

    // IPC Handler for Compact Mode Toggle
    let isCompactMode = false;
    ipcMain.on('toggle-compact-mode', (event, compact) => {
        isCompactMode = compact;

        if (compact) {
            // Compact mode: very horizontal window, always on top
            mainWindow.setSize(700, 300);
            mainWindow.setAlwaysOnTop(true);
            mainWindow.center();
        } else {
            // Full mode: larger window, not always on top
            mainWindow.setSize(1280, 800);
            mainWindow.setAlwaysOnTop(false);
            mainWindow.center();
        }
    });

    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
            if (process.platform === 'win32') {
                tray.displayBalloon({
                    title: 'Birdy',
                    content: 'App is running in the background.'
                });
            }
        }
        return false;
    });
}

function createTray() {
    // Try to load tray icon from file
    let trayIcon;
    try {
        trayIcon = nativeImage.createFromPath(path.join(__dirname, 'images', 'logo.png'));
        // Resize for tray (16x16 or 32x32)
        trayIcon = trayIcon.resize({ width: 16, height: 16 });
    } catch (error) {
        console.warn('Could not load tray icon, using fallback');
        // Fallback: create a simple blue circle with B
        trayIcon = nativeImage.createFromBuffer(Buffer.from(`
            <svg width="16" height="16" xmlns="http://www.w3.org/2000/svg">
                <circle cx="8" cy="8" r="7" fill="#3b82f6"/>
                <text x="8" y="11" text-anchor="middle" fill="white" font-family="Arial" font-size="8" font-weight="bold">B</text>
            </svg>
        `));
    }

    tray = new Tray(trayIcon);

    const contextMenu = Menu.buildFromTemplate([
        { 
            label: 'Show Birdy', 
            click: () => {
                mainWindow.show();
                mainWindow.focus();
            }
        },
        { type: 'separator' },
        {
            label: 'Quit Birdy', 
            click: () => {
                app.isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray.setToolTip('Birdy - AI Posture & Gesture Control');
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
        if (mainWindow.isVisible()) {
            mainWindow.hide();
        } else {
            mainWindow.show();
            mainWindow.focus();
        }
    });

    // Double-click to show/hide
    tray.on('double-click', () => {
        mainWindow.show();
        mainWindow.focus();
    });
}

// Handle App Exit
app.on('window-all-closed', () => {
    // Do not quit when all windows are closed (keep running in tray)
    if (process.platform !== 'darwin') {
        // app.quit(); - Commented to keep app running in background
    }
});

// Set app name before ready
app.setName('Birdy');