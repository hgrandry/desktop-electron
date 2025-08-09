import { app, BrowserWindow } from 'electron'
import { registerGlobalShortcuts, unregisterGlobalShortcuts } from './windows/shortcuts'
import { setupIpc } from './services/ipc'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { setupAutoUpdate } from './services/auto-update'
import icon from '../../resources/icon.png?asset'
import { createTray } from './windows/tray'
import { LocalServer } from './server'
import { BackgroundManager } from './windows/backgrounds'
import { createWindow, mainWindow } from './windows/mainWindow'

const localServer = new LocalServer()
const bg = new BackgroundManager()

function setupApp() {
  const context = {
    app,
    icon,
    localServer,
    bg,
    mainWindow
  }

  createWindow()
  createTray(context)
  registerGlobalShortcuts(mainWindow)
  setupIpc(context)

  localServer
    .start()
    .then(() => bg.start(localServer.getUrl()))
    .catch((error) => console.error('Failed to start local server:', error))

  if (!is.dev) {
    setTimeout(() => setupAutoUpdate(mainWindow), 3000)
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  setupApp()
})

app.on('activate', function () {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// Handle app quit events to ensure proper cleanup
app.on('before-quit', () => {
  console.log('App quitting - starting cleanup...')
  mainWindow.setIsQuitting(true)
  unregisterGlobalShortcuts()
  bg?.cleanup()
  localServer.stop()
})

// Force quit after a timeout if normal quit doesn't work
app.on('will-quit', () => {
  console.log('App will quit - forcing exit...')
  unregisterGlobalShortcuts()
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
    unregisterGlobalShortcuts()
    bg?.cleanup()
    localServer.stop()
    app.quit()
  }
})
