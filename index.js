/**
 * PicGo Plugin: Multi-Uploader
 * Upload one image to multiple image beds in parallel with retry and Markdown summary support.
 */

module.exports = (ctx) => {
  const PLUGIN_NAME = 'picgo-plugin-multi-uploader'
  
  // 不支持自定义文件名的图床列表
  const NO_CUSTOM_FILENAME_BEDS = ['smms', 'imgur']
  
  // Cache original image data between beforeUpload and afterUpload phases
  let cachedImageData = null

  const registerConfig = () => [
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

  const delay = (ms) => new Promise((res) => setTimeout(res, ms))

  const getCurrentUploader = (ctx) => {
    return ctx.getConfig('picBed.uploader') || ctx.getConfig('picBed.current')
  }

  const getRealBuffer = (item) => {
    if (item.buffer) {
      return Buffer.isBuffer(item.buffer) ? item.buffer : Buffer.from(item.buffer)
    }
    if (item.base64Image) {
      return Buffer.from(item.base64Image.replace(/^data:\S+;base64,/, ''), 'base64')
    }
    return undefined
  }

  // 从 URL 中提取文件名
  const extractFilenameFromUrl = (url) => {
    if (!url) return null
    const parts = url.split('/')
    const filename = parts[parts.length - 1]
    // 移除查询参数
    return filename.split('?')[0]
  }

  // 生成 hash 文件名
  const generateHashFilename = (ext) => {
    const hash = Date.now().toString(36) + Math.random().toString(36).substr(2, 8)
    return `${hash}${ext}`
  }

  // 检查图床是否支持自定义文件名
  const supportsCustomFilename = (bed) => {
    return !NO_CUSTOM_FILENAME_BEDS.includes(bed.toLowerCase())
  }

  const uploadWithRetry = async (bed, ctx, retryCount, retryDelay, customFilename = null) => {
    const uploader = ctx.helper.uploader.get(bed)
    if (!uploader?.handle) {
      throw new Error(`Uploader not found: ${bed}`)
    }

    for (let attempt = 0; attempt <= retryCount; attempt++) {
      try {
        // Construct isolated context for this uploader
        const clonedOutput = (cachedImageData || []).map((item) => {
          const output = {
            fileName: customFilename || item.fileName,
            extname: item.extname,
            buffer: getRealBuffer(item),
            base64Image: undefined, // Force buffer mode
            url: undefined,
            imgUrl: undefined
          }
          return output
        })

        const clonedCtx = {
          getConfig: (name) => ctx.getConfig(name),
          log: ctx.log,
          input: [...(ctx.input || [])],
          output: clonedOutput,
          helper: ctx.helper,
          emit: ctx.emit?.bind(ctx),
          request: ctx.request?.bind(ctx),
          Request: ctx.Request,
          // Pass through essential context properties
          baseDir: ctx.baseDir,
          configPath: ctx.configPath
        }

        await uploader.handle(clonedCtx)

        if (!clonedCtx.output?.length) {
          throw new Error(`Uploader ${bed} returned no valid output`)
        }

        const hasUrl = clonedCtx.output.some(i => i.url || i.imgUrl || i.image || i.source)
        if (!hasUrl) {
          throw new Error(`Uploader ${bed} returned no URL/imgUrl`)
        }

        ctx.log.info(`[${PLUGIN_NAME}] ✅ ${bed} upload successful`)
        return clonedCtx.output
      } catch (err) {
        if (attempt >= retryCount) {
          ctx.log.error(`[${PLUGIN_NAME}] ❌ ${bed} upload failed after maximum retries: ${err.message}`)
          return null
        }
        ctx.log.warn(`[${PLUGIN_NAME}] ⚠️ ${bed} upload failed, retrying (${attempt + 1}/${retryCount})... Error: ${err.message}`)
        await delay(retryDelay)
      }
    }
  }

  /** beforeUpload: Cache original data */
  ctx.helper.beforeUploadPlugins.register(PLUGIN_NAME, {
    handle: async (ctx) => {
      // Deep copy output and save buffer/base64 to cache
      cachedImageData = (ctx.output || []).map(item => ({
        fileName: item.fileName || (Date.now() + (item.extname || '.png')),
        extname: item.extname || '.png',
        buffer: item.buffer ? Buffer.from(item.buffer) : undefined,
        base64Image: item.base64Image || undefined
      }))

      ctx.log.info(`[${PLUGIN_NAME}] Cached ${cachedImageData.length} files for upload`)
      return ctx
    }
  })

  /** afterUpload: Smart upload with unified filename support */
  ctx.helper.afterUploadPlugins.register(PLUGIN_NAME, {
    handle: async (ctx) => {
      const config = ctx.getConfig(PLUGIN_NAME) || {}
      if (!config.enabledBeds) {
        ctx.log.warn(`[${PLUGIN_NAME}] No image beds configured`)
        cachedImageData = null
        return ctx
      }

      const allBeds = config.enabledBeds.split(',').map(b => b.trim()).filter(Boolean)
      const current = getCurrentUploader(ctx)
      const backupBeds = allBeds.filter(b => b !== current)

      if (backupBeds.length === 0) {
        ctx.log.warn(`[${PLUGIN_NAME}] No backup beds found, skipping`)
        cachedImageData = null
        return ctx
      }

      // 获取主图床的输出结果
      const primaryOutput = Array.isArray(ctx.output) ? ctx.output.map(i => ({ ...i, uploader: current || 'primary' })) : []
      
      // 分类：支持/不支持自定义文件名的图床
      const noCustomFilenameBeds = backupBeds.filter(b => !supportsCustomFilename(b))
      const customFilenameBeds = backupBeds.filter(b => supportsCustomFilename(b))

      let unifiedFilename = null
      let canUnifyFilename = config.unifyFileName !== false

      // 检查主图床是否支持自定义文件名
      const primarySupportsCustom = supportsCustomFilename(current)

      if (canUnifyFilename) {
        // 计算所有不支持自定义文件名的图床（包括主图床）
        const allNoCustomBeds = [...noCustomFilenameBeds]
        if (!primarySupportsCustom) {
          allNoCustomBeds.push(current)
        }

        if (allNoCustomBeds.length > 1) {
          // 多个不支持自定义文件名的图床，无法统一
          ctx.log.warn(`[${PLUGIN_NAME}] ⚠️ Multiple beds don't support custom filenames (${allNoCustomBeds.join(', ')}). Unified filename disabled.`)
          canUnifyFilename = false
        } else if (allNoCustomBeds.length === 1) {
          // 只有一个不支持自定义文件名的图床
          const noCustomBed = allNoCustomBeds[0]
          
          if (noCustomBed === current) {
            // 主图床不支持自定义文件名，从主图床输出中提取文件名
            if (primaryOutput.length > 0) {
              const url = primaryOutput[0].url || primaryOutput[0].imgUrl
              unifiedFilename = extractFilenameFromUrl(url)
              ctx.log.info(`[${PLUGIN_NAME}] 📝 Extracted filename from ${current}: ${unifiedFilename}`)
            }
          } else {
            // 备份图床中有一个不支持自定义文件名，需要先上传到它
            ctx.log.info(`[${PLUGIN_NAME}] 🚀 Uploading to ${noCustomBed} first (no custom filename support)...`)
            
            const result = await uploadWithRetry(noCustomBed, ctx, config.retryCount || 2, config.retryDelay || 2000)
            
            if (result && result.length > 0) {
              const url = result[0].url || result[0].imgUrl
              unifiedFilename = extractFilenameFromUrl(url)
              ctx.log.info(`[${PLUGIN_NAME}] 📝 Extracted filename from ${noCustomBed}: ${unifiedFilename}`)
              
              // 将这个结果添加到输出中，并从待上传列表中移除
              primaryOutput.push(...result.map(i => ({ ...i, uploader: noCustomBed })))
            }
            
            // 从备份列表中移除已上传的图床
            const remainingNoCustomBeds = noCustomFilenameBeds.filter(b => b !== noCustomBed)
            noCustomFilenameBeds.length = 0
            noCustomFilenameBeds.push(...remainingNoCustomBeds)
          }
        } else {
          // 所有图床都支持自定义文件名，生成 hash 文件名
          const ext = cachedImageData[0]?.extname || '.png'
          unifiedFilename = generateHashFilename(ext)
          ctx.log.info(`[${PLUGIN_NAME}] 📝 Generated unified filename: ${unifiedFilename}`)
        }
      }

      // 上传到剩余的备份图床
      const remainingBeds = [...noCustomFilenameBeds, ...customFilenameBeds]
      
      if (remainingBeds.length > 0) {
        ctx.log.info(`[${PLUGIN_NAME}] 🚀 Parallel uploading to: ${remainingBeds.join(', ')}${unifiedFilename ? ` (filename: ${unifiedFilename})` : ''}`)

        const tasks = remainingBeds.map(bed => {
          // 只对支持自定义文件名的图床使用统一文件名
          const filenameToUse = supportsCustomFilename(bed) ? unifiedFilename : null
          return uploadWithRetry(bed, ctx, config.retryCount || 2, config.retryDelay || 2000, filenameToUse)
            .then(output => ({ bed, output }))
        })

        const results = await Promise.allSettled(tasks)

        const backupOutputs = results
          .filter(r => {
            if (r.status !== 'fulfilled') {
              ctx.log.error(`[${PLUGIN_NAME}] Backup task exception:`, r.reason || 'unknown')
              return false
            }
            if (!r.value?.output) {
              ctx.log.warn(`[${PLUGIN_NAME}] ${r.value.bed} returned empty results`)
              return false
            }
            return true
          })
          .flatMap(r => r.value.output.map(i => ({ ...i, uploader: r.value.bed })))

        primaryOutput.push(...backupOutputs)
      }

      ctx.output = primaryOutput
      ctx.log.success(`[${PLUGIN_NAME}] 🎉 Multi-bed upload completed (${primaryOutput.length} results)`)

      if (config.generateMarkdown) {
        const markdown = generateMarkdownTable(primaryOutput)
        ctx.log.info('\n📋 Markdown Link Summary:\n')
        console.log(markdown)
      }

      cachedImageData = null
      return ctx
    }
  })

  function generateMarkdownTable(images) {
    if (!images?.length) return ''
    
    const grouped = images.reduce((acc, img) => {
      const fname = img.fileName || img.origin?.fileName || 'image'
      if (!acc[fname]) acc[fname] = []
      acc[fname].push(img)
      return acc
    }, {})

    return Object.entries(grouped).map(([filename, imgs]) => {
      const rows = imgs.map(img => {
        const url = img.url || img.imgUrl || img.image || img.source || ''
        return `| ${img.uploader || '-'} | ![](${url}) | [${url}](${url}) |`
      }).join('\n')
      
      return `### 🖼️ ${filename}\n\n| Bed | Preview | Link |\n|------|------|------|\n${rows}\n`
    }).join('\n')
  }

  return {
    register: registerConfig
  }
}
