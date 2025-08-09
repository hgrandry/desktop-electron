import { BrowserWindow, screen } from 'electron'
import { attach, detach, reset } from 'electron-as-wallpaper'

export class BackgroundManager {
  private backgroundWindows: Map<number, BrowserWindow> = new Map()
  private serverUrl: string

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl
    this.setupMultiMonitorBackgrounds()
  }

  private setupMultiMonitorBackgrounds(): void {
    const displays = screen.getAllDisplays()

    console.log(`Setting up background windows for ${displays.length} monitor(s)`)

    displays.forEach((display, index) => {
      console.log(
        `Monitor ${index}: ${display.bounds.width}x${display.bounds.height} at (${display.bounds.x}, ${display.bounds.y})`
      )

      // Platform-specific window configuration
      const windowConfig: Electron.BrowserWindowConstructorOptions = {
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
        backgroundColor: '#000000',
        alwaysOnTop: false,
        focusable: true,
        skipTaskbar: true,
        show: false,
        frame: false,
        // transparent: true, // Make transparent for wallpaper attachment
        resizable: false, // Prevent resizing
        minimizable: false, // Prevent minimizing
        maximizable: false, // Prevent maximizing
        closable: false, // Prevent closing
        movable: false, // Prevent moving
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          webSecurity: true,
          allowRunningInsecureContent: false
          // No preload script needed for web content
        }
      }

      const backgroundWindow = new BrowserWindow(windowConfig)

      // Load the background webview
      const monitorUrl = index === 0 ? 'monitor1' : 'monitor2'
      const backgroundUrl = `${this.serverUrl}/app/hadrien/${monitorUrl}`
      console.log(`Loading background for monitor ${index}: ${backgroundUrl}`)

      backgroundWindow.loadURL(backgroundUrl)

      // Show the window after it's loaded and attach to wallpaper
      backgroundWindow.once('ready-to-show', () => {
        backgroundWindow.show()
        //backgroundWindow.wallpaperState.isForwardMouseInput = true
        // Attach the window to the desktop wallpaper
        try {
          attach(backgroundWindow, {
            transparent: false,
            forwardKeyboardInput: false, // Disable to prevent input interference
            forwardMouseInput: false // Disable to prevent input interference
          })
          console.log(`Background window ${index} attached to wallpaper`)
        } catch (error) {
          console.error(`Failed to attach background window ${index} to wallpaper:`, error)
          // Fallback to the old method
          //this.setWindowBehindOthers(backgroundWindow)
        }

        console.log(`Background window ${index} is ready`)
      })

      // Handle window errors
      backgroundWindow.webContents.on('did-fail-load', (_event, _errorCode, errorDescription) => {
        console.error(`Failed to load background for monitor ${index}:`, errorDescription)
      })

      // Ensure window stays behind when it gains focus
      //   backgroundWindow.on('focus', () => {
      //     this.setWindowBehindOthers(backgroundWindow)
      //   })

      //   // Ensure window stays behind when shown
      //   backgroundWindow.on('show', () => {
      //     this.setWindowBehindOthers(backgroundWindow)
      //   })

      this.backgroundWindows.set(index, backgroundWindow)
    })
  }

  //   private setWindowBehindOthers(window: BrowserWindow): void {
  //     // Fallback method if wallpaper attachment fails
  //     if (platform() === 'win32') {
  //       window.setAlwaysOnTop(false, 'screen-saver')
  //       window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  //       window.setMenu(null)
  //       window.setAutoHideMenuBar(true)
  //     } else if (platform() === 'darwin') {
  //       window.setAlwaysOnTop(false, 'screen-saver')
  //       window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  //       window.setMenu(null)
  //     } else if (platform() === 'linux') {
  //       window.setAlwaysOnTop(false)
  //       window.setMenu(null)
  //     }
  //   }

  public getBackgroundWindow(monitorId: number): BrowserWindow | undefined {
    return this.backgroundWindows.get(monitorId)
  }

  public getAllBackgroundWindows(): BrowserWindow[] {
    return Array.from(this.backgroundWindows.values())
  }

  public reloadBackground(monitorId: number): void {
    const window = this.backgroundWindows.get(monitorId)
    if (window) {
      window.reload()
      console.log(`Reloaded background for monitor ${monitorId}`)
    }
  }

  public reloadAllBackgrounds(): void {
    this.backgroundWindows.forEach((window, monitorId) => {
      window.reload()
      console.log(`Reloaded background for monitor ${monitorId}`)
    })
  }

  public closeAllBackgrounds(): void {
    console.log(`Closing ${this.backgroundWindows.size} background windows...`)

    this.backgroundWindows.forEach((window, monitorId) => {
      try {
        // Detach from wallpaper before closing
        detach(window)
        console.log(`Detached background window ${monitorId} from wallpaper`)
      } catch (error) {
        console.error(`Failed to detach background window ${monitorId} from wallpaper:`, error)
      }

      // Force close the window
      if (!window.isDestroyed()) {
        window.destroy()
        console.log(`Destroyed background window ${monitorId}`)
      } else {
        console.log(`Background window ${monitorId} was already destroyed`)
      }
    })

    this.backgroundWindows.clear()
    console.log('All background windows closed and cleared')
  }

  public resetWallpaper(): void {
    try {
      reset()
      console.log('Wallpaper reset to original')
    } catch (error) {
      console.error('Failed to reset wallpaper:', error)
    }
  }

  // Cleanup method to be called when the manager is no longer needed
  public cleanup(): void {
    console.log('BackgroundManager cleanup initiated')
    this.closeAllBackgrounds()
    this.resetWallpaper()
  }

  // Method to make a specific background window interactive
  public makeInteractive(monitorId: number): void {
    const window = this.backgroundWindows.get(monitorId)
    if (window && !window.isDestroyed()) {
      try {
        // Detach from wallpaper for interaction
        detach(window)
        console.log(`Made background window ${monitorId} interactive (detached from wallpaper)`)
      } catch (error) {
        console.error(`Failed to make background window ${monitorId} interactive:`, error)
      }
    }
  }

  // Method to make all background windows interactive
  public makeAllInteractive(): void {
    console.log('Making all background windows interactive...')
    this.backgroundWindows.forEach((_window, monitorId) => {
      this.makeInteractive(monitorId)
    })
  }

  // Method to make a specific background window non-interactive (behind others)
  public makeNonInteractive(monitorId: number): void {
    const window = this.backgroundWindows.get(monitorId)
    if (window && !window.isDestroyed()) {
      try {
        // Re-attach to wallpaper
        attach(window, {
          transparent: false,
          forwardKeyboardInput: false, // Disable to prevent input interference
          forwardMouseInput: false // Disable to prevent input interference
        })
        console.log(
          `Made background window ${monitorId} non-interactive (re-attached to wallpaper)`
        )
      } catch (error) {
        console.error(`Failed to make background window ${monitorId} non-interactive:`, error)
      }
    }
  }

  // Method to make all background windows non-interactive
  public makeAllNonInteractive(): void {
    this.backgroundWindows.forEach((_window, monitorId) => {
      this.makeNonInteractive(monitorId)
    })
  }
}
