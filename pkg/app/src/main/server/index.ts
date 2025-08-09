import express from 'express'
import cors from 'cors'
import { join } from 'path'
import { readdir } from 'fs/promises'
import { createServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'
import { watch } from 'chokidar'
import { registerRoutes } from './routes'
import { ThumbnailService } from '../services/thumbnails'
import { SettingsService } from '../services/settings'

export class LocalServer {
  private server: express.Application
  private httpServer: ReturnType<typeof createServer>
  private io: SocketIOServer
  private port: number = 8080
  private isRunning: boolean = false
  private readonly IMAGES_PATH = 'D:\\pictures\\wall'
  private readonly SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif']
  private thumbnailService: ThumbnailService
  private settingsService: SettingsService
  private clientAssets: { js: string; css: string } | null = null
  private templateWatcher: ReturnType<typeof watch> | null = null
  public isRapidDev: boolean = false
  private clientDevUrl: string = 'http://localhost:5173'

  constructor() {
    this.server = express()
    this.httpServer = createServer(this.server)
    this.io = new SocketIOServer(this.httpServer, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    })
    this.thumbnailService = new ThumbnailService()
    this.settingsService = new SettingsService()
    this.setupTemplateEngine()
    this.setupMiddleware()
    registerRoutes(this)
    this.setupSocketIO()
  }

  public async scanForClientAssets(): Promise<{ js: string; css: string }> {
    try {
      // Detect if we're running from built/packaged app
      const isPackaged = __dirname.includes('app.asar')
      const clientPath = isPackaged
        ? join(__dirname, 'client') // Production: client assets are in out/main/client
        : join(__dirname, '../../../client/dist') // Development: client assets in ../client/dist
      const assetsPath = join(clientPath, 'assets')

      console.log('Scanning for client assets in:', assetsPath)
      const files = await readdir(assetsPath)

      let jsFile = ''
      let cssFile = ''

      for (const file of files) {
        if (file.endsWith('.js') && file.startsWith('index-')) {
          jsFile = file
        } else if (file.endsWith('.css') && file.startsWith('index-')) {
          cssFile = file
        }
      }

      if (!jsFile || !cssFile) {
        throw new Error(`Missing client assets - JS: ${jsFile}, CSS: ${cssFile}`)
      }

      console.log('📦 Found client assets:', { js: jsFile, css: cssFile })
      return { js: jsFile, css: cssFile }
    } catch (error) {
      console.error('Error scanning client assets:', error)
      // Fallback to hardcoded values if scanning fails
      return { js: 'index-B8qUNiLk.js', css: 'index-CV3mCCdu.css' }
    }
  }

  private async scanForImages(): Promise<string[]> {
    try {
      console.log('Scanning for images in:', this.IMAGES_PATH)
      const allFiles: string[] = []

      // Helper function to recursively scan directories
      const scanDirectory = async (dirPath: string): Promise<void> => {
        const items = await readdir(dirPath, { withFileTypes: true, recursive: false })

        for (const item of items) {
          const fullPath = join(dirPath, item.name)

          if (item.isDirectory()) {
            // Recursively scan subdirectories
            // await scanDirectory(fullPath)
          } else if (item.isFile()) {
            // Check if file has a supported image extension
            const ext = item.name.toLowerCase().substring(item.name.lastIndexOf('.'))
            if (this.SUPPORTED_EXTENSIONS.includes(ext)) {
              // Store relative path from images directory
              const relativePath = fullPath.replace(this.IMAGES_PATH, '').replace(/^[\\/]/, '')
              allFiles.push(relativePath.replace(/\\/g, '/')) // Normalize path separators
            }
          }
        }
      }

      await scanDirectory(this.IMAGES_PATH)
      return allFiles.sort()
    } catch (error) {
      console.error('Error scanning images directory:', error)
      return []
    }
  }

  private setupTemplateEngine(): void {
    // Set EJS as template engine
    this.server.set('view engine', 'ejs')

    // Detect if we're running from built/packaged app
    const isPackaged = __dirname.includes('app.asar')
    const isDev =
      process.env.NODE_ENV === 'development' ||
      (process.env.NODE_ENV !== 'production' && !isPackaged)

    let templatesPath: string
    if (isDev) {
      // Development: templates are in src/main/templates
      templatesPath = join(process.cwd(), 'src/main/templates')
    } else {
      // Production/Packaged: templates are in out/main/templates (relative to __dirname)
      templatesPath = join(__dirname, 'templates')
    }

    this.server.set('views', templatesPath)
    console.log('📄 Templates path:', templatesPath)
    console.log('📄 Is packaged:', isPackaged)
    console.log('📄 Is dev:', isDev)
    console.log('📄 __dirname:', __dirname)
  }

  private async setupDevelopmentFeatures(): Promise<void> {
    // In electron-vite, the main process is built to 'out' even in dev mode
    // Only consider it packaged if it's in app.asar (actual distribution package)
    const isPackaged = __dirname.includes('app.asar')
    const isDev =
      process.env.NODE_ENV === 'development' ||
      (process.env.NODE_ENV !== 'production' && !isPackaged)

    console.log('🔍 Development mode check:')
    console.log('  NODE_ENV:', process.env.NODE_ENV)
    console.log('  __dirname:', __dirname)
    console.log('  isPackaged:', isPackaged)
    console.log('  isDev:', isDev)

    if (isDev) {
      console.log('🔧 Setting up development features...')

      // Check if client dev server is running (rapid development mode)
      await this.detectRapidDevMode()

      this.setupTemplateHotReload()
      this.setupDevelopmentRoutes()
    } else {
      console.log('📦 Production mode - development features disabled')
    }
  }

  private async detectRapidDevMode(): Promise<void> {
    // Try multiple common Vite dev server ports
    const possiblePorts = [5173, 5174, 5175, 5176, 5177, 5178, 5179]

    for (const port of possiblePorts) {
      const testUrl = `http://localhost:${port}/app/`
      try {
        const response = await fetch(testUrl)
        if (response.ok) {
          this.isRapidDev = true
          this.clientDevUrl = `http://localhost:${port}`
          console.log(
            `🚀 Rapid development mode detected - using client dev server at ${this.clientDevUrl}`
          )
          return
        }
      } catch {
        // Try next port
      }
    }

    this.isRapidDev = false
    console.log('📦 Using built client assets (rapid dev server not detected)')
  }

  private setupTemplateHotReload(): void {
    const isPackaged = __dirname.includes('app.asar')
    const isDev =
      process.env.NODE_ENV === 'development' ||
      (process.env.NODE_ENV !== 'production' && !isPackaged)
    const templatesPath = isDev
      ? join(process.cwd(), 'src/main/templates')
      : join(__dirname, 'templates')

    // Watch templates for changes
    this.templateWatcher = watch(join(templatesPath, '**/*.ejs'), {
      persistent: true,
      ignoreInitial: true
    })

    this.templateWatcher.on('change', (path: string) => {
      console.log(`📝 Template changed: ${path}`)
      this.clearTemplateCache().catch(console.error)
      this.invalidateClientAssets()
    })

    this.templateWatcher.on('add', (path: string) => {
      console.log(`📄 New template added: ${path}`)
      this.clearTemplateCache().catch(console.error)
    })

    console.log('🔄 Template hot reload enabled')
  }

  private async clearTemplateCache(): Promise<void> {
    // Clear EJS template cache
    const ejs = await import('ejs')
    ejs.clearCache()
    console.log('🗑️  Template cache cleared')
  }

  private invalidateClientAssets(): void {
    // Force rescan of client assets on next request
    this.clientAssets = null
    console.log('♻️  Client assets cache invalidated')
  }

  private setupDevelopmentRoutes(): void {
    // Development info endpoint
    this.server.get('/dev/info', (req, res) => {
      const isPackaged = __dirname.includes('app.asar')
      const clientPath = isPackaged
        ? join(__dirname, 'client')
        : join(__dirname, '../../../client/dist')

      res.json({
        development: true,
        templatePath: this.server.get('views'),
        clientAssetsPath: join(clientPath, 'assets'),
        currentAssets: this.clientAssets,
        request: {
          userAgent: req.get('User-Agent'),
          hostname: req.hostname,
          query: req.query,
          path: req.path
        },
        server: {
          port: this.port,
          isRunning: this.isRunning,
          uptime: process.uptime()
        }
      })
    })

    // Endpoint to manually clear caches
    this.server.post('/dev/clear-cache', async (_req, res) => {
      await this.clearTemplateCache()
      this.invalidateClientAssets()
      res.json({
        message: 'All caches cleared',
        timestamp: new Date().toISOString()
      })
    })

    // Endpoint to trigger client rebuild notification
    this.server.post('/dev/client-rebuilt', (_req, res) => {
      this.invalidateClientAssets()
      // Notify connected clients about the rebuild
      this.io.emit('client_rebuilt', {
        timestamp: new Date().toISOString(),
        message: 'Client assets rebuilt - refresh recommended'
      })
      res.json({
        message: 'Client rebuild notification sent',
        connectedClients: this.io.sockets.sockets.size
      })
    })

    console.log('🛠️  Development routes enabled: /dev/info, /dev/clear-cache, /dev/client-rebuilt')
  }

  private setupMiddleware(): void {
    // Enable CORS for cross-origin requests
    this.server.use(cors())

    // Parse JSON bodies
    this.server.use(express.json())

    // Parse URL-encoded bodies
    this.server.use(express.urlencoded({ extended: true }))

    // Serve static files from the built client (client/dist)
    // This serves the separate client app, not the Electron renderer
    const isPackaged = __dirname.includes('app.asar')
    const clientPath = isPackaged
      ? join(__dirname, 'client') // Production: client assets are in out/main/client
      : join(__dirname, '../../../client/dist') // Development: client assets in ../client/dist

    this.server.use('/app/assets', express.static(join(clientPath, 'assets')))
    this.server.use('/app/vite.svg', express.static(join(clientPath, 'vite.svg')))
    this.server.use('/app/favicon.ico', express.static(join(clientPath, 'favicon.ico')))
    console.log('📁 Client assets path:', join(clientPath, 'assets'))
    console.log('📁 Is packaged (middleware):', isPackaged)
  }

  // routes are registered in server/routes.ts

  private setupSocketIO(): void {
    this.io.on('connection', async (socket) => {
      console.log(`🔌 Client connected: ${socket.id}`)

      // Send current settings to newly connected client
      try {
        const settings = await this.settingsService.getSettings()
        socket.emit('settings_update', {
          type: 'settings_update',
          settings,
          timestamp: Date.now(),
          clientId: 'server'
        })
      } catch (error) {
        console.error('Error sending settings to new client:', error)
      }

      // Handle settings updates from clients
      socket.on('update_settings', async (data) => {
        try {
          const { settings, clientId = socket.id } = data
          const updateEvent = await this.settingsService.updateSettings(settings, clientId)

          // Broadcast to all other clients
          socket.broadcast.emit('settings_update', updateEvent)

          // Acknowledge to sender
          socket.emit('settings_updated', {
            success: true,
            settings: updateEvent.settings,
            timestamp: updateEvent.timestamp
          })
        } catch (error) {
          console.error('Error handling socket settings update:', error)
          socket.emit('settings_updated', {
            success: false,
            error: 'Failed to update settings'
          })
        }
      })

      socket.on('disconnect', () => {
        console.log(`🔌 Client disconnected: ${socket.id}`)
      })
    })
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      return
    }

    // Setup development features before starting server
    await this.setupDevelopmentFeatures()

    return new Promise((resolve, reject) => {
      const server = this.httpServer.listen(this.port, () => {
        this.isRunning = true
        console.log(`🚀 Local server running at http://localhost:${this.port}`)
        console.log(`🔌 Socket.IO enabled for real-time communication`)

        // Start background thumbnail generation
        this.startBackgroundThumbnailGeneration()

        resolve()
      })

      server.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          console.log(`⚠️  Port ${this.port} is in use, trying ${this.port + 1}`)
          this.port++
          this.start().then(resolve).catch(reject)
        } else {
          reject(error)
        }
      })
    })
  }

  private async startBackgroundThumbnailGeneration(): Promise<void> {
    try {
      console.log('📸 Starting background thumbnail generation...')
      const images = await this.scanForImages()
      await this.thumbnailService.generateAllThumbnailsInBackground(images)
    } catch (error) {
      console.error('Error starting background thumbnail generation:', error)
    }
  }

  public stop(): void {
    if (this.isRunning) {
      // Close template watcher
      if (this.templateWatcher) {
        this.templateWatcher.close()
        console.log('🔄 Template watcher stopped')
      }

      // Note: In a real implementation, you'd want to properly close the server
      // This is a simplified version
      this.isRunning = false
      console.log('🛑 Local server stopped')
    }
  }

  public getUrl(): string {
    return `http://localhost:${this.port}`
  }

  public isServerRunning(): boolean {
    return this.isRunning
  }

  public getSettingsService(): SettingsService {
    return this.settingsService
  }
}
