import { Tray, Menu, shell } from 'electron'
import { AppContext } from '../services/context'

export function createTray(context: AppContext) {
  const { app, icon, localServer: localServer, mainWindow, bg } = context

  const tray = new Tray(icon as any)
  tray.setToolTip('Hey Ketsu')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show App',
      click: () => {
        mainWindow.show()
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
        mainWindow.setIsQuitting(true)
        bg?.cleanup()
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
    mainWindow.show()
  })

  return tray
}
