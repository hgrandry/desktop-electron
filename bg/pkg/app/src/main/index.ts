import { app, shell, BrowserWindow, ipcMain, Menu, Tray, globalShortcut } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater, UpdateInfo } from 'electron-updater'
import icon from '../../resources/icon.png?asset'
import { LocalServer } from './server'
import { BackgroundManager } from './background-manager'
import { createWindow, getMainWindow, setIsQuitting, showMainWindow } from './mainWindow'

// Initialize local server
const localServer = new LocalServer()

// Initialize background manager
let backgroundManager: BackgroundManager | null = null

// Configure auto-updater
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

// Auto-updater event handlers
autoUpdater.on('checking-for-update', () => {
  console.log('Checking for updates...')
})

autoUpdater.on('update-available', (info: UpdateInfo) => {
  console.log('Update available:', info)
  const mainWindow = getMainWindow()
  if (mainWindow) {
    mainWindow.webContents.send('update-available', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes
    })
  }
})

autoUpdater.on('update-not-available', (info) => {
  console.log('Update not available:', info)
})

autoUpdater.on('error', (err) => {
  console.error('Auto-updater error:', err)
})

autoUpdater.on('download-progress', (progressObj) => {
  console.log('Download progress:', progressObj)
  const mainWindow = getMainWindow()
  if (mainWindow) {
    mainWindow.webContents.send('update-download-progress', progressObj)
  }
})

autoUpdater.on('update-downloaded', (info) => {
  console.log('Update downloaded:', info)
  const mainWindow = getMainWindow()
  if (mainWindow) {
    mainWindow.webContents.send('update-downloaded', info)
  }
})

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Register global keyboard shortcut (Ctrl+B) to show main window
  globalShortcut.register('CommandOrControl+B', () => {
    showMainWindow()
  })

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // IPC handlers for server communication
  ipcMain.handle('get-server-url', () => {
    return localServer.getUrl()
  })

  ipcMain.handle('is-server-running', () => {
    return localServer.isServerRunning()
  })

  // IPC handler for app version
  ipcMain.handle('get-app-version', () => {
    return app.getVersion()
  })

  // IPC handlers for background management
  ipcMain.handle('reload-background', (_, monitorId: number) => {
    if (backgroundManager) {
      backgroundManager.reloadBackground(monitorId)
    }
  })

  ipcMain.handle('reload-all-backgrounds', () => {
    if (backgroundManager) {
      backgroundManager.reloadAllBackgrounds()
    }
  })

  // IPC handlers for background interactivity
  ipcMain.handle('make-background-interactive', (_, monitorId: number) => {
    if (backgroundManager) {
      backgroundManager.makeInteractive(monitorId)
    }
  })

  ipcMain.handle('make-all-backgrounds-interactive', () => {
    if (backgroundManager) {
      backgroundManager.makeAllInteractive()
    }
  })

  ipcMain.handle('make-background-non-interactive', (_, monitorId: number) => {
    if (backgroundManager) {
      backgroundManager.makeNonInteractive(monitorId)
    }
  })

  ipcMain.handle('make-all-backgrounds-non-interactive', () => {
    if (backgroundManager) {
      backgroundManager.makeAllNonInteractive()
    }
  })

  // IPC handlers for auto-update
  ipcMain.handle('check-for-updates', () => {
    autoUpdater.checkForUpdates()
  })

  ipcMain.handle('download-update', () => {
    autoUpdater.downloadUpdate()
  })

  ipcMain.handle('install-update', () => {
    autoUpdater.quitAndInstall()
  })

  // IPC handlers for settings
  ipcMain.handle('settings-get', async () => {
    try {
      const settings = await localServer.getSettingsService().getSettings()
      return { success: true, data: settings }
    } catch (error) {
      console.error('IPC settings-get error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  ipcMain.handle('settings-update-shared', async (_, settings) => {
    try {
      const currentSettings = await localServer.getSettingsService().getSettings()
      const updatedSettings = {
        shared: {
          ...currentSettings.shared,
          ...settings
        }
      }
      const updateEvent = await localServer
        .getSettingsService()
        .updateSettings(updatedSettings, 'ipc-client')
      return { success: true, data: updateEvent.settings }
    } catch (error) {
      console.error('IPC settings-update-shared error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  ipcMain.handle('settings-update-local', async (_, screenId, settings) => {
    try {
      const currentSettings = await localServer.getSettingsService().getSettings()
      const updatedSettings = {
        screens: {
          ...currentSettings.screens,
          [screenId]: {
            ...currentSettings.screens[screenId],
            ...settings
          }
        }
      }
      const updateEvent = await localServer
        .getSettingsService()
        .updateSettings(updatedSettings, 'ipc-client')
      return { success: true, data: updateEvent.settings }
    } catch (error) {
      console.error('IPC settings-update-local error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  ipcMain.handle('settings-is-available', async () => {
    try {
      await localServer.getSettingsService().getSettings()
      return { success: true, data: true }
    } catch (error) {
      console.error('IPC settings-is-available error:', error)
      return { success: false, data: false }
    }
  })

  // Start the local server
  localServer
    .start()
    .then(() => {
      // Initialize background manager after server is ready
      backgroundManager = new BackgroundManager(localServer.getUrl())
    })
    .catch((error) => {
      console.error('Failed to start local server:', error)
    })

  createWindow()

  // Check for updates (only in production)
  if (!is.dev) {
    // Check for updates after a short delay to ensure app is fully loaded
    setTimeout(() => {
      autoUpdater.checkForUpdates()
    }, 3000)
  }

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  const tray = new Tray(icon)
  tray.setToolTip('Hey Ketsu')

  // Create tray context menu
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show App',
      click: () => {
        showMainWindow()
      }
    },
    {
      label: 'Open in Browser',
      click: () => {
        if (localServer.isServerRunning()) {
          shell.openExternal(localServer.getUrl())
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        console.log('Tray quit clicked - starting cleanup...')
        setIsQuitting(true)
        if (backgroundManager) {
          backgroundManager.cleanup()
        }
        localServer.stop()

        // Force quit after cleanup
        setTimeout(() => {
          console.log('Force quitting from tray...')
          app.exit(0)
        }, 1000)
      }
    }
  ])

  tray.setContextMenu(contextMenu)

  // Double click tray icon to show window
  tray.on('double-click', () => {
    showMainWindow()
  })
})

// Handle app quit events to ensure proper cleanup
app.on('before-quit', () => {
  console.log('App quitting - starting cleanup...')
  setIsQuitting(true)
  // Unregister global shortcuts
  globalShortcut.unregisterAll()
  if (backgroundManager) {
    backgroundManager.cleanup()
  }
  localServer.stop()
})

// Force quit after a timeout if normal quit doesn't work
app.on('will-quit', () => {
  console.log('App will quit - forcing exit...')
  // Unregister global shortcuts
  globalShortcut.unregisterAll()
  // Force exit after 1 second if the app is still running
  setTimeout(() => {
    console.log('Forcing app exit...')
    process.exit(0)
  }, 1000)
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Unregister global shortcuts
    globalShortcut.unregisterAll()
    if (backgroundManager) {
      backgroundManager.cleanup()
    }
    localServer.stop()
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.