import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import icon from '../../../resources/icon.png?asset'

// Store reference to main window
let mainWindow: BrowserWindow | null = null

// Track if the app is actually quitting
let isQuitting = false

export function createWindow(): void {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    resizable: true,
    frame: true,
    // transparent: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      plugins: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) return
    const { width: winW, height: _winH } = mainWindow.getBounds()
    const { workArea } = screen.getPrimaryDisplay() // respects taskbar/dock
    const x = workArea.x + workArea.width - winW // bottom-right
    const y = workArea.y / 2
    mainWindow.setBounds({
      x: x,
      y: y,
      width: 500,
      height: workArea.height
    })
    mainWindow.setPosition(x, y)
    mainWindow.show()
  })

  // Check for updates when window is shown
  mainWindow.on('show', () => {
    if (!is.dev) {
      console.log('Window shown - checking for updates...')
      autoUpdater.checkForUpdates()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Close to tray behavior
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function setIsQuitting(quitting: boolean): void {
  isQuitting = quitting
}

export function getIsQuitting(): boolean {
  return isQuitting
}

export function showMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
  } else {
    // If main window is destroyed, create a new one
    createWindow()
  }
}

export function hideMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide()
  }
}

export function toggleMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.isVisible() ? hideMainWindow() : showMainWindow()
  }
}
