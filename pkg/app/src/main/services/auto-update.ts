import { ipcMain } from 'electron'
import { autoUpdater, UpdateInfo } from 'electron-updater'
import { MainWindow } from '../windows/mainWindow'
import { is } from '@electron-toolkit/utils'

export function setupAutoUpdate(mainWindow: MainWindow) {
  // Configure auto-updater
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  // Auto-updater event handlers
  autoUpdater.on('checking-for-update', () => {
    console.log('Checking for updates...')
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    console.log('Update available:', info)
    const window = mainWindow.get()
    if (window) {
      window.webContents.send('update-available', {
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
    const window = mainWindow.get()
    if (window) {
      window.webContents.send('update-download-progress', progressObj)
    }
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log('Update downloaded:', info)
    const window = mainWindow.get()
    if (window) {
      window.webContents.send('update-downloaded', info)
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

  autoUpdater.checkForUpdates()

  // Expose a small API for programmatic use
  return {
    checkForUpdates: () => autoUpdater.checkForUpdates(),
    downloadUpdate: () => autoUpdater.downloadUpdate(),
    installUpdate: () => autoUpdater.quitAndInstall(),
    instance: autoUpdater
  }
}
