import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import icon from '../../../resources/icon.png?asset'

// Store reference to main window
let window: BrowserWindow | null = null

// Track if the app is actually quitting
let isQuitting = false

export function createWindow(): void {
  // Create the browser window.
  window = new BrowserWindow({
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

  window.on('ready-to-show', () => {
    window?.show()
  })

  window.once('ready-to-show', () => {
    if (!window) return
    const { width: winW, height: _winH } = window.getBounds()
    const { workArea } = screen.getPrimaryDisplay() // respects taskbar/dock
    const x = workArea.x + workArea.width - winW // bottom-right
    const y = workArea.y / 2
    window.setBounds({
      x: x,
      y: y,
      width: 500,
      height: workArea.height
    })
    window.setPosition(x, y)
    window.show()
  })

  // Check for updates when window is shown
  window.on('show', () => {
    if (!is.dev) {
      console.log('Window shown - checking for updates...')
      autoUpdater.checkForUpdates()
    }
  })

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Close to tray behavior
  window.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      window?.hide()
    }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function getMainWindow(): BrowserWindow | null {
  return window
}

function setIsQuitting(quitting: boolean): void {
  isQuitting = quitting
}

export function getIsQuitting(): boolean {
  return isQuitting
}

function showMainWindow(): void {
  if (window && !window.isDestroyed()) {
    window.show()
    window.focus()
  } else {
    // If main window is destroyed, create a new one
    createWindow()
  }
}

function hideMainWindow(): void {
  if (window && !window.isDestroyed()) {
    window.hide()
  }
}

function toggleMainWindow(): void {
  if (window && !window.isDestroyed()) {
    window.isVisible() ? hideMainWindow() : showMainWindow()
  }
}

export const mainWindow = {
  show: showMainWindow,
  hide: hideMainWindow,
  toggle: toggleMainWindow,
  get: getMainWindow,
  setIsQuitting: (quitting: boolean) => setIsQuitting(quitting)
}

export type MainWindow = typeof mainWindow
