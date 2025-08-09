import sharp from 'sharp'
import { join, dirname, basename, extname } from 'path'
import { mkdir, access, stat } from 'fs/promises'
import { constants } from 'fs'
import { app } from 'electron'

interface ThumbnailRequest {
  imagePath: string
  thumbnailPath: string
  resolve: (thumbnailPath: string) => void
  reject: (error: Error) => void
}

// interface ThumbnailOptions {
//   width: number
//   height: number
//   quality: number
// }

export class ThumbnailService {
  private readonly IMAGES_PATH = 'D:\\pictures\\wall'
  private readonly THUMBNAIL_SIZE = { width: 200, height: 200 }
  private readonly THUMBNAIL_QUALITY = 80
  private readonly thumbnailsDir: string
  private readonly processingQueue: ThumbnailRequest[] = []
  private readonly queuedPaths = new Set<string>()
  private isProcessing = false

  constructor() {
    // Store thumbnails in app's userData directory
    this.thumbnailsDir = join(app.getPath('userData'), 'thumbnails')
    this.ensureThumbnailsDirectory()
  }

  private async ensureThumbnailsDirectory(): Promise<void> {
    try {
      await mkdir(this.thumbnailsDir, { recursive: true })
    } catch (error) {
      console.error('Failed to create thumbnails directory:', error)
    }
  }

  /**
   * Get thumbnail path for an image. Creates if doesn't exist.
   * @param imageName Relative path from images directory
   * @returns Promise resolving to thumbnail file path
   */
  public async getThumbnailAsync(imageName: string): Promise<string> {
    const imagePath = join(this.IMAGES_PATH, imageName)
    const thumbnailPath = this.getThumbnailPath(imageName)

    // Check if thumbnail already exists
    if (await this.thumbnailExists(thumbnailPath)) {
      // Check if thumbnail is newer than source image
      if (await this.isThumbnailFresh(imagePath, thumbnailPath)) {
        return thumbnailPath
      }
    }

    // Check if already in queue
    if (this.queuedPaths.has(imagePath)) {
      // Return existing promise for this image
      return this.getQueuedPromise(imagePath)
    }

    // Add to queue and process
    return this.queueThumbnailGeneration(imagePath, thumbnailPath)
  }

  /**
   * Check if image has a thumbnail (without generating)
   * @param imageName Relative path from images directory
   */
  public async hasThumbnail(imageName: string): Promise<boolean> {
    const thumbnailPath = this.getThumbnailPath(imageName)
    return await this.thumbnailExists(thumbnailPath)
  }

  /**
   * Generate thumbnails for all images in background
   */
  public async generateAllThumbnailsInBackground(imageNames: string[]): Promise<void> {
    console.log(`🖼️  Starting background thumbnail generation for ${imageNames.length} images`)

    let generated = 0
    let skipped = 0

    for (const imageName of imageNames) {
      try {
        const imagePath = join(this.IMAGES_PATH, imageName)
        const thumbnailPath = this.getThumbnailPath(imageName)

        // Skip if thumbnail exists and is fresh
        if (
          (await this.thumbnailExists(thumbnailPath)) &&
          (await this.isThumbnailFresh(imagePath, thumbnailPath))
        ) {
          skipped++
          continue
        }

        // Queue for generation (don't await to avoid blocking)
        this.queueThumbnailGeneration(imagePath, thumbnailPath)
          .then(() => {
            generated++
            if ((generated + skipped) % 10 === 0) {
              console.log(`📸 Generated ${generated} thumbnails, skipped ${skipped}`)
            }
          })
          .catch((error) => {
            console.error(`Failed to generate thumbnail for ${imageName}:`, error)
          })
      } catch (error) {
        console.error(`Error processing ${imageName} for background generation:`, error)
      }
    }

    console.log(`🚀 Queued ${imageNames.length - skipped} images for thumbnail generation`)
  }

  private getThumbnailPath(imageName: string): string {
    // Create thumbnail filename: original_name.jpg (always use jpg for thumbnails)
    const nameWithoutExt = basename(imageName, extname(imageName))
    const relativePath = dirname(imageName)
    const thumbnailName = `${nameWithoutExt}.jpg`

    // Preserve directory structure in thumbnails
    if (relativePath === '.' || relativePath === '') {
      return join(this.thumbnailsDir, thumbnailName)
    }

    return join(this.thumbnailsDir, relativePath, thumbnailName)
  }

  private async thumbnailExists(thumbnailPath: string): Promise<boolean> {
    try {
      await access(thumbnailPath, constants.F_OK)
      return true
    } catch {
      return false
    }
  }

  private async isThumbnailFresh(imagePath: string, thumbnailPath: string): Promise<boolean> {
    try {
      const [imageStat, thumbnailStat] = await Promise.all([stat(imagePath), stat(thumbnailPath)])

      // Thumbnail is fresh if it's newer than the source image
      return thumbnailStat.mtime >= imageStat.mtime
    } catch {
      return false
    }
  }

  private queueThumbnailGeneration(imagePath: string, thumbnailPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // Add to queue
      this.processingQueue.push({
        imagePath,
        thumbnailPath,
        resolve,
        reject
      })

      // Mark as queued
      this.queuedPaths.add(imagePath)

      // Start processing if not already running
      if (!this.isProcessing) {
        this.processQueue()
      }
    })
  }

  private getQueuedPromise(imagePath: string): Promise<string> {
    // Find existing request in queue
    const existingRequest = this.processingQueue.find((req) => req.imagePath === imagePath)
    if (existingRequest) {
      return new Promise((resolve, reject) => {
        // Wrap the existing promise
        const originalResolve = existingRequest.resolve
        const originalReject = existingRequest.reject

        existingRequest.resolve = (result) => {
          originalResolve(result)
          resolve(result)
        }

        existingRequest.reject = (error) => {
          originalReject(error)
          reject(error)
        }
      })
    }

    // This shouldn't happen, but return a rejected promise as fallback
    return Promise.reject(new Error('Image not found in queue'))
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.processingQueue.length === 0) {
      return
    }

    this.isProcessing = true

    while (this.processingQueue.length > 0) {
      const request = this.processingQueue.shift()!

      try {
        await this.generateThumbnail(request.imagePath, request.thumbnailPath)
        this.queuedPaths.delete(request.imagePath)
        request.resolve(request.thumbnailPath)
      } catch (error) {
        this.queuedPaths.delete(request.imagePath)
        request.reject(error as Error)
      }
    }

    this.isProcessing = false
  }

  private async generateThumbnail(imagePath: string, thumbnailPath: string): Promise<void> {
    try {
      // Ensure thumbnail directory exists
      await mkdir(dirname(thumbnailPath), { recursive: true })

      // Generate thumbnail using Sharp
      await sharp(imagePath)
        .resize(this.THUMBNAIL_SIZE.width, this.THUMBNAIL_SIZE.height, {
          fit: 'cover',
          position: 'center'
        })
        .jpeg({
          quality: this.THUMBNAIL_QUALITY,
          progressive: true
        })
        .toFile(thumbnailPath)
    } catch (error) {
      console.error(`Failed to generate thumbnail for ${imagePath}:`, error)
      throw error
    }
  }

  /**
   * Get queue status for debugging
   */
  public getQueueStatus(): { queueLength: number; processing: boolean; queuedPaths: string[] } {
    return {
      queueLength: this.processingQueue.length,
      processing: this.isProcessing,
      queuedPaths: Array.from(this.queuedPaths)
    }
  }

  /**
   * Clear thumbnail cache (for development/testing)
   */
  public async clearThumbnailCache(): Promise<void> {
    try {
      const { rmdir } = await import('fs/promises')
      await rmdir(this.thumbnailsDir, { recursive: true })
      await this.ensureThumbnailsDirectory()
      console.log('📸 Thumbnail cache cleared')
    } catch (error) {
      console.error('Failed to clear thumbnail cache:', error)
    }
  }
}
