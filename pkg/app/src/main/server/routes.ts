import { join } from 'path'
import { constants } from 'fs'
import { access } from 'fs/promises'

export function registerRoutes(localServer: any) {
  const server = localServer.server

  // Health check endpoint
  server.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      message: 'Electron app server is running',
      timestamp: new Date().toISOString()
    })
  })

  // API endpoint example
  server.get('/api/info', (_req, res) => {
    res.json({
      appName: 'Electron App',
      version: '1.0.0',
      platform: process.platform,
      arch: process.arch,
      uptime: process.uptime()
    })
  })

  // Images API endpoint
  server.get('/api/images', async (_req, res) => {
    try {
      const images = await localServer.scanForImages()
      res.json({
        images: images.map((imagePath: string) => ({
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
  server.get('/api/image', async (req, res) => {
    try {
      const imageName = decodeURIComponent((req.query.name as string) || '')
      const imagePath = join(localServer.IMAGES_PATH, imageName)

      // Security check: ensure the path is within the images directory
      if (!imagePath.startsWith(localServer.IMAGES_PATH)) {
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
      res.setHeader('Cache-Control', 'public, max-age=3600')

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

  // Thumbnail endpoint
  server.get('/api/thumbnail', async (req, res) => {
    try {
      const imageName = decodeURIComponent((req.query.name as string) || '')

      if (!imageName) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Missing image name parameter'
        })
      }

      const imagePath = join(localServer.IMAGES_PATH, imageName)

      // Security check
      if (!imagePath.startsWith(localServer.IMAGES_PATH)) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Access denied to path outside images directory'
        })
      }

      try {
        await access(imagePath, constants.F_OK | constants.R_OK)
      } catch {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Original image not found'
        })
      }

      const thumbnailPath = await localServer.thumbnailService.getThumbnailAsync(imageName)

      res.setHeader('Content-Type', 'image/jpeg')
      res.setHeader('Cache-Control', 'public, max-age=86400')
      res.setHeader('X-Thumbnail-Generated', 'true')

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
  server.get('/api/thumbnails/status', (_req, res) => {
    try {
      const status = localServer.thumbnailService.getQueueStatus()
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

  // Clear thumbnail cache endpoint
  server.post('/api/thumbnails/clear-cache', async (_req, res) => {
    try {
      await localServer.thumbnailService.clearThumbnailCache()
      res.json({ message: 'Thumbnail cache cleared successfully' })
    } catch (error) {
      console.error('Error clearing thumbnail cache:', error)
      res
        .status(500)
        .json({ error: 'Internal Server Error', message: 'Failed to clear thumbnail cache' })
    }
  })

  // Settings API endpoints
  server.get('/api/settings', async (_req, res) => {
    try {
      const settings = await localServer.settingsService.getSettings()
      res.json({ settings, message: 'Settings retrieved successfully' })
    } catch (error) {
      console.error('Error getting settings:', error)
      res
        .status(500)
        .json({ error: 'Internal Server Error', message: 'Failed to retrieve settings' })
    }
  })

  server.post('/api/update-settings', async (req, res) => {
    try {
      const { settings, clientId = 'api-client' } = req.body

      if (!settings || typeof settings !== 'object') {
        return res
          .status(400)
          .json({ error: 'Bad Request', message: 'Invalid settings data provided' })
      }

      const updateEvent = await localServer.settingsService.updateSettings(settings, clientId)
      localServer.io.emit('settings_update', updateEvent)

      return res.json({
        message: 'Settings updated successfully',
        settings: updateEvent.settings,
        timestamp: updateEvent.timestamp
      })
    } catch (error) {
      console.error('Error updating settings:', error)
      return res
        .status(500)
        .json({ error: 'Internal Server Error', message: 'Failed to update settings' })
    }
  })

  // Background routes for each monitor
  server.get('/background/:monitorId', (req, res) => {
    const monitorId = parseInt(req.params.monitorId)
    res.redirect(`/app/hadrien/monitor${monitorId + 1}`)
  })

  // Serve the Svelte client using correct path format: /app/:userId/:screenId
  server.get('/app/:userId/:screenId', async (req, res) => {
    const { userId, screenId } = req.params

    let assets
    if (localServer.isRapidDev) {
      assets = { js: `${localServer.clientDevUrl}/app/src/main.ts`, css: null }
    } else {
      if (!localServer.clientAssets) {
        localServer.clientAssets = await localServer.scanForClientAssets()
      }
      assets = localServer.clientAssets
    }

    const data = {
      title: 'Hey ketsu',
      timestamp: new Date().toISOString(),
      route: req.path,
      query: req.query,
      userId,
      screenId,
      userAgent: req.get('User-Agent') || 'unknown',
      serverUrl: `http://localhost:${localServer.port}`,
      assets,
      isRapidDev: localServer.isRapidDev,
      clientDevUrl: localServer.clientDevUrl
    }

    res.render('app', data)
  })

  // Fallback route for /app
  server.get('/app', (_req, res) => {
    res.redirect('/app/hadrien/monitor1')
  })

  // Legacy static route for fallback
  server.get('/app-static', (_req, res) => {
    const isPackaged = __dirname.includes('app.asar')
    const clientPath = isPackaged
      ? join(__dirname, 'client')
      : join(__dirname, '../../../client/dist')
    res.sendFile(join(clientPath, 'index.html'))
  })

  // Handle any other /app/* routes (but not /app/assets/*)
  server.get(/^\/app\/(?!assets\/).*/, (_req, res) => {
    const isPackaged = __dirname.includes('app.asar')
    const clientPath = isPackaged
      ? join(__dirname, 'client')
      : join(__dirname, '../../../client/dist')
    res.sendFile(join(clientPath, 'index.html'))
  })

  // Serve a simple HTML page at root
  server.get('/', (_req, res) => {
    res.send(`...server-root-html...`)
  })

  // Handle all other routes
  server.use((_req, res) => {
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
