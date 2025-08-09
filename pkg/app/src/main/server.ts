import express from 'express'
import cors from 'cors'
import { join } from 'path'
import { readdir, access } from 'fs/promises'
import { constants } from 'fs'
import { createServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'
import { watch } from 'chokidar'
import { ThumbnailService } from './services/thumbnails'
import { SettingsService } from './services/settings'

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
  private isRapidDev: boolean = false
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
    this.setupRoutes()
    this.setupSocketIO()
  }

  private async scanForClientAssets(): Promise<{ js: string; css: string }> {
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

  private setupRoutes(): void {
    // Health check endpoint
    this.server.get('/health', (_req, res) => {
      res.json({
        status: 'ok',
        message: 'Electron app server is running',
        timestamp: new Date().toISOString()
      })
    })

    // API endpoint example
    this.server.get('/api/info', (_req, res) => {
      res.json({
        appName: 'Electron App',
        version: '1.0.0',
        platform: process.platform,
        arch: process.arch,
        uptime: process.uptime()
      })
    })

    // Images API endpoint
    this.server.get('/api/images', async (_req, res) => {
      try {
        const images = await this.scanForImages()
        res.json({
          images: images.map((imagePath) => ({
            name: imagePath,
            thumbnail: `/api/thumbnail?name=${encodeURIComponent(imagePath)}`
          }))
        })
      } catch (error) {
        console.error('Error fetching images:', error)
        res.status(500).json({
          error: 'Internal Server Error',
          message: 'Failed to retrieve images list'
        })
      }
    })

    // Image file endpoint - handle nested paths with query parameter
    this.server.get('/api/image', async (req, res) => {
      try {
        const imageName = decodeURIComponent((req.query.name as string) || '')
        const imagePath = join(this.IMAGES_PATH, imageName)

        // Security check: ensure the path is within the images directory
        if (!imagePath.startsWith(this.IMAGES_PATH)) {
          return res.status(403).json({
            error: 'Forbidden',
            message: 'Access denied to path outside images directory'
          })
        }

        // Check if file exists and is readable
        await access(imagePath, constants.F_OK | constants.R_OK)

        // Determine content type based on file extension
        const ext = imageName.toLowerCase().substring(imageName.lastIndexOf('.'))
        const contentTypeMap: Record<string, string> = {
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.webp': 'image/webp',
          '.bmp': 'image/bmp',
          '.gif': 'image/gif'
        }

        const contentType = contentTypeMap[ext] || 'application/octet-stream'
        res.setHeader('Content-Type', contentType)
        res.setHeader('Cache-Control', 'public, max-age=3600') // Cache for 1 hour

        // Send the file
        return res.sendFile(imagePath)
      } catch (error) {
        console.error('Error serving image:', error)
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return res.status(404).json({
            error: 'Not Found',
            message: 'Image not found'
          })
        } else {
          return res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to serve image'
          })
        }
      }
    })

    // Thumbnail endpoint with Sharp-generated thumbnails
    this.server.get('/api/thumbnail', async (req, res) => {
      try {
        const imageName = decodeURIComponent((req.query.name as string) || '')

        if (!imageName) {
          return res.status(400).json({
            error: 'Bad Request',
            message: 'Missing image name parameter'
          })
        }

        const imagePath = join(this.IMAGES_PATH, imageName)

        // Security check: ensure the path is within the images directory
        if (!imagePath.startsWith(this.IMAGES_PATH)) {
          return res.status(403).json({
            error: 'Forbidden',
            message: 'Access denied to path outside images directory'
          })
        }

        // Check if original image exists
        try {
          await access(imagePath, constants.F_OK | constants.R_OK)
        } catch {
          return res.status(404).json({
            error: 'Not Found',
            message: 'Original image not found'
          })
        }

        // Get thumbnail using the thumbnail service
        const thumbnailPath = await this.thumbnailService.getThumbnailAsync(imageName)

        // Set appropriate headers for thumbnail
        res.setHeader('Content-Type', 'image/jpeg') // Thumbnails are always JPEG
        res.setHeader('Cache-Control', 'public, max-age=86400') // Cache for 24 hours
        res.setHeader('X-Thumbnail-Generated', 'true')

        // Send the thumbnail file
        return res.sendFile(thumbnailPath)
      } catch (error) {
        console.error('Error serving thumbnail:', error)
        return res.status(500).json({
          error: 'Internal Server Error',
          message: 'Failed to generate or serve thumbnail'
        })
      }
    })

    // Debug endpoint for thumbnail service status
    this.server.get('/api/thumbnails/status', (_req, res) => {
      try {
        const status = this.thumbnailService.getQueueStatus()
        res.json({
          ...status,
          message: 'Thumbnail service status'
        })
      } catch (error) {
        console.error('Error getting thumbnail status:', error)
        res.status(500).json({
          error: 'Internal Server Error',
          message: 'Failed to get thumbnail service status'
        })
      }
    })

    // Clear thumbnail cache endpoint (for development)
    this.server.post('/api/thumbnails/clear-cache', async (_req, res) => {
      try {
        await this.thumbnailService.clearThumbnailCache()
        res.json({
          message: 'Thumbnail cache cleared successfully'
        })
      } catch (error) {
        console.error('Error clearing thumbnail cache:', error)
        res.status(500).json({
          error: 'Internal Server Error',
          message: 'Failed to clear thumbnail cache'
        })
      }
    })

    // Settings API endpoints
    this.server.get('/api/settings', async (_req, res) => {
      try {
        const settings = await this.settingsService.getSettings()
        res.json({
          settings,
          message: 'Settings retrieved successfully'
        })
      } catch (error) {
        console.error('Error getting settings:', error)
        res.status(500).json({
          error: 'Internal Server Error',
          message: 'Failed to retrieve settings'
        })
      }
    })

    this.server.post('/api/update-settings', async (req, res) => {
      try {
        const { settings, clientId = 'api-client' } = req.body

        if (!settings || typeof settings !== 'object') {
          return res.status(400).json({
            error: 'Bad Request',
            message: 'Invalid settings data provided'
          })
        }

        const updateEvent = await this.settingsService.updateSettings(settings, clientId)

        // Broadcast to all connected Socket.IO clients except the sender
        this.io.emit('settings_update', updateEvent)

        return res.json({
          message: 'Settings updated successfully',
          settings: updateEvent.settings,
          timestamp: updateEvent.timestamp
        })
      } catch (error) {
        console.error('Error updating settings:', error)
        return res.status(500).json({
          error: 'Internal Server Error',
          message: 'Failed to update settings'
        })
      }
    })

    // Background routes for each monitor - serve the Svelte client
    this.server.get('/background/:monitorId', (req, res) => {
      const monitorId = parseInt(req.params.monitorId)
      // Redirect to the correct path format that client expects
      res.redirect(`/app/hadrien/monitor${monitorId + 1}`)
    })

    // Serve the Svelte client using correct path format: /app/:userId/:screenId
    this.server.get('/app/:userId/:screenId', async (req, res) => {
      const { userId, screenId } = req.params

      let assets
      if (this.isRapidDev) {
        // In rapid dev mode, use the dev server URLs
        assets = {
          js: `${this.clientDevUrl}/app/src/main.ts`,
          css: null // Vite injects CSS automatically in dev mode
        }
      } else {
        // Get client assets if not already cached
        if (!this.clientAssets) {
          this.clientAssets = await this.scanForClientAssets()
        }
        assets = this.clientAssets
      }

      const data = {
        title: 'Hey ketsu',
        timestamp: new Date().toISOString(),
        route: req.path,
        query: req.query,
        userId,
        screenId,
        userAgent: req.get('User-Agent') || 'unknown',
        serverUrl: `http://localhost:${this.port}`,
        assets,
        isRapidDev: this.isRapidDev,
        clientDevUrl: this.clientDevUrl
      }

      res.render('app', data)
    })

    // Fallback route for /app (without params) - redirect to default user/screen
    this.server.get('/app', (_req, res) => {
      res.redirect('/app/hadrien/monitor1')
    })

    // Legacy static route for fallback (can be removed once verified)
    this.server.get('/app-static', (_req, res) => {
      const isPackaged = __dirname.includes('app.asar')
      const clientPath = isPackaged
        ? join(__dirname, 'client')
        : join(__dirname, '../../../client/dist')
      res.sendFile(join(clientPath, 'index.html'))
    })

    // Handle any other /app/* routes (but not /app/assets/*) for client-side routing
    this.server.get(/^\/app\/(?!assets\/).*/, (_req, res) => {
      const isPackaged = __dirname.includes('app.asar')
      const clientPath = isPackaged
        ? join(__dirname, 'client')
        : join(__dirname, '../../../client/dist')
      res.sendFile(join(clientPath, 'index.html'))
    })

    // Serve a simple HTML page at root
    this.server.get('/', (_req, res) => {
      res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Electron App Server</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              max-width: 800px;
              margin: 0 auto;
              padding: 20px;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              min-height: 100vh;
            }
            .container {
              background: rgba(255, 255, 255, 0.1);
              padding: 30px;
              border-radius: 15px;
              backdrop-filter: blur(10px);
              border: 1px solid rgba(255, 255, 255, 0.2);
            }
            h1 {
              text-align: center;
              margin-bottom: 30px;
              font-size: 2.5em;
            }
            .status {
              background: rgba(34, 197, 94, 0.2);
              border: 1px solid rgba(34, 197, 94, 0.3);
              padding: 15px;
              border-radius: 10px;
              margin-bottom: 20px;
              text-align: center;
            }
            .endpoints {
              background: rgba(255, 255, 255, 0.1);
              padding: 20px;
              border-radius: 10px;
              margin-bottom: 20px;
            }
            .endpoints h3 {
              margin-top: 0;
            }
            .endpoints ul {
              list-style: none;
              padding: 0;
            }
            .endpoints li {
              margin-bottom: 10px;
            }
            .endpoints a {
              color: #3b82f6;
              text-decoration: none;
              font-weight: 600;
            }
            .endpoints a:hover {
              text-decoration: underline;
            }
            .info {
              background: rgba(255, 255, 255, 0.1);
              padding: 20px;
              border-radius: 10px;
            }
            .info h3 {
              margin-top: 0;
            }
            .info p {
              margin: 5px 0;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🚀 Electron App Server</h1>
            
            <div class="status">
              <strong>✅ Server is running successfully!</strong>
            </div>
            
                         <div class="endpoints">
               <h3>📡 Available Endpoints:</h3>
               <ul>
                 <li><a href="/health" target="_blank">Health Check</a> - Check server status</li>
                 <li><a href="/api/info" target="_blank">App Info</a> - Get application information</li>
                 <li><a href="/api/images" target="_blank">Images List</a> - Get list of available images</li>
                 <li>Image File - GET /api/image?name={name} - Serve individual image files</li>
                 <li>Thumbnail - GET /api/thumbnail?name={name} - Serve Sharp-generated thumbnails</li>
                 <li><a href="/api/thumbnails/status" target="_blank">Thumbnail Status</a> - Get thumbnail service status</li>
                 <li>Clear Cache - POST /api/thumbnails/clear-cache - Clear thumbnail cache</li>
               </ul>
             </div>
            
            <div class="info">
              <h3>ℹ️ Server Information:</h3>
              <p><strong>URL:</strong> http://localhost:${this.port}</p>
              <p><strong>Status:</strong> Active</p>
              <p><strong>Platform:</strong> ${process.platform}</p>
              <p><strong>Architecture:</strong> ${process.arch}</p>
            </div>
          </div>
        </body>
        </html>
      `)
    })

    // Handle all other routes
    this.server.use((_req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: 'The requested resource was not found on this server.',
        availableEndpoints: [
          '/health',
          '/api/info',
          '/api/images',
          '/api/image?name={name}',
          '/api/thumbnail?name={name}',
          '/api/thumbnails/status',
          'POST /api/thumbnails/clear-cache'
        ]
      })
    })
  }

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
