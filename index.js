/**
 * PicGo Plugin: Multi-Uploader v1.3.1 (fixed)
 * Key improvements:
 * - Caches original image data (buffer/base64) during beforeUpload phase.
 * - Constructs a clonedCtx for backup uploaders using cached data (clearing url/imgUrl to force upload).
 * - Skips the current default uploader to avoid redundant uploads.
 * - Markdown summary supports multiple return fields for better compatibility.
 */

module.exports = (ctx) => {
  const PLUGIN_NAME = 'picgo-plugin-multi-uploader'

  // Used to cache original image data (including buffer/base64) from beforeUpload
  let cachedImageData = null

  /** Register configuration options */
  const registerConfig = () => {
    return [
      {
        name: 'enabledBeds',
        type: 'string',
        default: 'smms,github',
        message: 'Enabled image beds (comma-separated)',
        alias: 'Enabled Beds'
      },
      {
        name: 'unifyFileName',
        type: 'boolean',
        default: true,
        message: 'Whether to maintain a unified filename across all beds',
        alias: 'Unify Filename'
      },
      {
        name: 'retryCount',
        type: 'number',
        default: 2,
        message: 'Number of retry attempts on failure',
        alias: 'Retry Count'
      },
      {
        name: 'retryDelay',
        type: 'number',
        default: 2000,
        message: 'Delay between retries (milliseconds)',
        alias: 'Retry Delay'
      },
      {
        name: 'generateMarkdown',
        type: 'boolean',
        default: true,
        message: 'Whether to generate a Markdown summary of links',
        alias: 'Generate Markdown'
      }
    ]
  }

  const delay = (ms) => new Promise((res) => setTimeout(res, ms))

  // Helper: Get the current default uploader (compatible with different config keys)
  const getCurrentUploader = (ctx) => {
    return ctx.getConfig('picBed.uploader') || ctx.getConfig('picBed.current')
  }

  /**
   * Upload logic with automatic retry and isolated context construction
   * @param {string} bed - The name of the uploader
   * @param {object} ctx - PicGo context
   * @param {number} retryCount - Maximum retries
   * @param {number} retryDelay - Delay between retries
   */
  const uploadWithRetry = async (bed, ctx, retryCount, retryDelay) => {
    const uploader = ctx.helper.uploader.get(bed)
    if (!uploader || !uploader.handle) {
      throw new Error(`Uploader not found: ${bed}`)
    }

    let attempts = 0
    while (attempts <= retryCount) {
      try {
        // Build clonedCtx.output using cached original image data
        // Deep map cachedImageData to ensure independence
        const clonedOutput = (cachedImageData || []).map((item) => {
          // Fix Buffer construction
          let realBuffer = undefined
          if (item.buffer) {
            realBuffer = Buffer.isBuffer(item.buffer)
              ? item.buffer
              : Buffer.from(item.buffer)
          } else if (item.base64Image) {
            const base64 = item.base64Image.replace(/^data:\S+;base64,/, '')
            realBuffer = Buffer.from(base64, 'base64')
          }
        
          return {
            fileName: item.fileName,
            extname: item.extname,
            buffer: realBuffer,
            // Clear base64Image to force uploader to use buffer mode
            base64Image: undefined,
            // Clear existing URLs to force the uploader to perform a real upload
            url: undefined,
            imgUrl: undefined
          }
        })

        const clonedCtx = {
          getConfig: (name) => ctx.getConfig(name),
          log: ctx.log,
          input: [...(ctx.input || [])],
          // Retain Buffer objects without JSON stringification to preserve binary data
          output: clonedOutput.map(i => ({
            fileName: i.fileName,
            extname: i.extname,
            buffer: i.buffer,
            base64Image: i.base64Image,
            url: undefined,
            imgUrl: undefined
          })),
          helper: ctx.helper,
          emit: ctx.emit ? ctx.emit.bind(ctx) : undefined,
          request: ctx.request ? ctx.request.bind(ctx) : undefined,
          Request: ctx.Request
        }

        // Pass through essential context properties if they exist
        if (ctx.baseDir) clonedCtx.baseDir = ctx.baseDir
        if (ctx.configPath) clonedCtx.configPath = ctx.configPath

        await uploader.handle(clonedCtx)

        // The uploader should write back to clonedCtx.output; verify the results
        if (!clonedCtx.output || !Array.isArray(clonedCtx.output) || clonedCtx.output.length === 0) {
          throw new Error(`Uploader ${bed} returned no valid output`)
        }

        // Check if at least one item contains a valid URL
        const hasUrl = clonedCtx.output.some(i => i.url || i.imgUrl || i.image || i.source)
        if (!hasUrl) {
          throw new Error(`Uploader ${bed} returned no URL/imgUrl`)
        }

        ctx.log.info(`[${PLUGIN_NAME}] ✅ ${bed} upload successful`)
        return clonedCtx.output
      } catch (err) {
        attempts++
        if (attempts > retryCount) {
          ctx.log.error(`[${PLUGIN_NAME}] ❌ ${bed} upload failed after maximum retries: ${err.message}`)
          return null
        } else {
          ctx.log.warn(`[${PLUGIN_NAME}] ⚠️ ${bed} upload failed, retrying (${attempts}/${retryCount})... Error: ${err.message}`)
          await delay(retryDelay)
        }
      }
    }
  }

  /** beforeUpload: Cache original data and optionally unify filename */
  ctx.helper.beforeUploadPlugins.register(PLUGIN_NAME, {
    handle: async (ctx) => {
      const config = ctx.getConfig(PLUGIN_NAME) || {}
      // Deep copy ctx.output and save buffer/base64 to cachedImageData
      cachedImageData = (ctx.output || []).map(item => ({
        fileName: item.fileName || (Date.now() + (item.extname || '.png')),
        extname: item.extname || '.png',
        buffer: item.buffer ? Buffer.from(item.buffer) : undefined,
        base64Image: item.base64Image ? item.base64Image : undefined
      }))

      // Unify filename if enabled (writes back to ctx.output for the primary uploader)
      if (config?.unifyFileName) {
        const now = new Date()
        const pad = (n) => String(n).padStart(2, '0')
        const formatted = `${now.getFullYear()}_${pad(now.getMonth() + 1)}_${pad(now.getDate())}_${pad(now.getHours())}_${pad(now.getMinutes())}_${pad(now.getSeconds())}`
      
        ctx.output.forEach((item, idx) => {
          const ext = item.extname || cachedImageData[idx]?.extname || '.png'
          item.fileName = `pic_${formatted}${ext}`
          // Sync unified name with the cache
          if (cachedImageData[idx]) cachedImageData[idx].fileName = item.fileName
        })
      
        ctx.log.info(`[${PLUGIN_NAME}] Filename unified to: ${ctx.output[0]?.fileName}`)
      } else {
        ctx.log.info(`[${PLUGIN_NAME}] Cached ${cachedImageData.length} files for backup use`)
      }
      return ctx
    }
  })

  /** afterUpload: Parallel upload + Retry + Markdown Summary (Skips primary bed) */
  ctx.helper.afterUploadPlugins.register(PLUGIN_NAME, {
    handle: async (ctx) => {
      const config = ctx.getConfig(PLUGIN_NAME) || {}
      if (!config?.enabledBeds) {
        ctx.log.warn(`[${PLUGIN_NAME}] No backup image beds configured`)
        // Clear cache to prevent memory leaks
        cachedImageData = null
        return ctx
      }

      const allBeds = config.enabledBeds.split(',').map(b => b.trim()).filter(Boolean)
      const current = getCurrentUploader(ctx)
      
      // Skip the current default uploader to avoid duplicate uploads
      const beds = allBeds.filter(b => b !== current)

      if (beds.length === 0) {
        ctx.log.warn(`[${PLUGIN_NAME}] No backup beds found (or all matched the primary bed), skipping`)
        cachedImageData = null
        return ctx
      }

      ctx.log.info(`[${PLUGIN_NAME}] 🚀 Parallel uploading to: ${beds.join(', ')}`)

      // Execute uploads in parallel
      const tasks = beds.map(bed => uploadWithRetry(bed, ctx, config.retryCount || 2, config.retryDelay || 2000).then(output => ({ bed, output })))
      const results = await Promise.allSettled(tasks)

      // Collect successful results
      const mergedOutput = []
      results.forEach(r => {
        if (r.status === 'fulfilled' && r.value && r.value.output) {
          const bed = r.value.bed
          const outs = r.value.output.map(i => ({ ...i, uploader: bed }))
          mergedOutput.push(...outs)
        } else if (r.status === 'fulfilled' && r.value && !r.value.output) {
          ctx.log.warn(`[${PLUGIN_NAME}] ${r.value.bed} returned empty results`)
        } else {
          ctx.log.error(`[${PLUGIN_NAME}] Backup task exception:`, r.reason || (r.value && r.value.error) || 'unknown')
        }
      })

      // Merge primary upload results with backup results
      const finalOutput = []
      // List primary results first
      if (Array.isArray(ctx.output)) {
        finalOutput.push(...ctx.output.map(i => ({ ...i, uploader: current || 'primary' })))
      }
      if (mergedOutput.length > 0) finalOutput.push(...mergedOutput)

      ctx.output = finalOutput
      ctx.log.success(`[${PLUGIN_NAME}] 🎉 Multi-bed upload completed (${finalOutput.length} results)`)

      // Generate Markdown table with compatibility for multiple URL fields
      if (config.generateMarkdown) {
        const markdown = generateMarkdownTable(finalOutput)
        ctx.log.info('\n📋 Markdown Link Summary:\n')
        console.log(markdown)
        ctx.emit && ctx.emit('notification') // Trigger GUI notification if available
      }

      // Final cleanup
      cachedImageData = null
      return ctx
    }
  })

  /**
   * Helper function to generate a Markdown table from upload results
   * @param {Array} images - Array of image output objects
   */
  function generateMarkdownTable(images) {
    if (!images || images.length === 0) return ''
    const grouped = {}
    for (const img of images) {
      const fname = img.fileName || (img.origin && img.origin.fileName) || 'image'
      if (!grouped[fname]) grouped[fname] = []
      grouped[fname].push(img)
    }

    let md = ''
    for (const [filename, imgs] of Object.entries(grouped)) {
      md += `### 🖼️ ${filename}\n\n`
      md += '| Bed | Preview | Link |\n|------|------|------|\n'
      imgs.forEach(img => {
        const url = img.url || img.imgUrl || img.image || img.source || ''
        md += `| ${img.uploader || '-'} | ![](${url}) | [${url}](${url}) |\n`
      })
      md += '\n'
    }
    return md
  }

  return {
    register: registerConfig
  }
}
