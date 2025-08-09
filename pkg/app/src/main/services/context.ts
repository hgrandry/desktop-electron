import { BackgroundManager } from '../windows/backgrounds'
import { MainWindow } from '../windows/mainWindow'
import { LocalServer } from '../server'

export type AppContext = {
  app: Electron.App
  icon: string | Electron.NativeImage
  bg: BackgroundManager
  localServer: LocalServer
  mainWindow: MainWindow
}
