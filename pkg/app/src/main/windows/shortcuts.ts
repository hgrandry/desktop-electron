import { globalShortcut } from 'electron'

type ToggleMainWindowFn = () => void

export function registerGlobalShortcuts(toggleMainWindow: ToggleMainWindowFn) {
  // Register global keyboard shortcut (Ctrl+B) to toggle main window
  try {
    globalShortcut.register('CommandOrControl+B', () => {
      toggleMainWindow()
    })
  } catch (err) {
    console.error('Failed to register global shortcuts:', err)
  }
}

export function unregisterGlobalShortcuts() {
  try {
    globalShortcut.unregisterAll()
  } catch (err) {
    console.error('Failed to unregister global shortcuts:', err)
  }
}
