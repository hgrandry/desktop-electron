import { Tray, Menu, shell } from 'electron'

type LocalServerLike = {
  isServerRunning: () => boolean
  getUrl: () => string
}

type CreateTrayOptions = {
  icon: string | Electron.NativeImage
  localServer: LocalServerLike
  showMainWindow: () => void
  onQuit: () => void
}

export function createTray(options: CreateTrayOptions) {
  const { icon, localServer, showMainWindow, onQuit } = options

  const tray = new Tray(icon as any)
  tray.setToolTip('Hey Ketsu')

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
        onQuit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)

  // Double click tray icon to show window
  tray.on('double-click', () => {
    showMainWindow()
  })

  return tray
}
