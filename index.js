/**
 * PicGo Plugin: Multi-Uploader v1.3.1 (fixed)
 * 修复点：
 * - 在 beforeUpload 阶段缓存原始图片数据（buffer/base64）
 * - 为备份 uploader 构建使用缓存数据的 clonedCtx（清除 url/imgUrl 强制上传）
 * - 跳过当前默认图床（避免重复上传）
 * - Markdown 兼容更多返回字段
 */

module.exports = (ctx) => {
  const PLUGIN_NAME = 'picgo-plugin-multi-uploader'

  // 用于缓存 beforeUpload 的原始图片数据（包含 buffer/base64）
  let cachedImageData = null

  /** 注册配置项 */
  const registerConfig = () => {
    return [
      {
        name: 'enabledBeds',
        type: 'string',
        default: 'smms,github',
        message: '启用的图床（用逗号分隔）',
        alias: '启用图床'
      },
      {
        name: 'unifyFileName',
        type: 'boolean',
        default: true,
        message: '是否保持统一文件名',
        alias: '统一文件名'
      },
      {
        name: 'retryCount',
        type: 'number',
        default: 2,
        message: '失败重试次数',
        alias: '重试次数'
      },
      {
        name: 'retryDelay',
        type: 'number',
        default: 2000,
        message: '每次重试间隔（毫秒）',
        alias: '重试间隔'
      },
      {
        name: 'generateMarkdown',
        type: 'boolean',
        default: true,
        message: '是否生成 Markdown 链接汇总',
        alias: '生成 Markdown'
      }
    ]
  }

  const delay = (ms) => new Promise((res) => setTimeout(res, ms))

  // helper: 获取当前默认 uploader（兼容不同 config 键）
  const getCurrentUploader = (ctx) => {
    return ctx.getConfig('picBed.uploader') || ctx.getConfig('picBed.current')
  }

  /**
   * 上传逻辑（带自动重试 + 使用缓存数据构建独立上下文）
   * bed: uploader name
   */
  const uploadWithRetry = async (bed, ctx, retryCount, retryDelay) => {
    const uploader = ctx.helper.uploader.get(bed)
    if (!uploader || !uploader.handle) {
      throw new Error(`未找到 uploader: ${bed}`)
    }

    let attempts = 0
    while (attempts <= retryCount) {
      try {
        // 使用缓存的原始图片数据来构建 clonedCtx.output
        // 深拷贝 cachedImageData 保证独立
        const clonedOutput = (cachedImageData || []).map((item) => {
          // --- 修复 Buffer 构造 ---
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
            // 不传 base64Image，让 uploader 使用 buffer 方式上传
            base64Image: undefined,
            // 清除 url/imgUrl，强制 uploader 真正上传
            url: undefined,
            imgUrl: undefined
          }
        })

        const clonedCtx = {
          getConfig: (name) => ctx.getConfig(name),
          log: ctx.log,
          input: [...(ctx.input || [])],
          // 🚨 保留 Buffer 原样传递，不能 JSON.stringify
          output: clonedOutput.map(i => ({
            fileName: i.fileName,
            extname: i.extname,
            buffer: i.buffer, // 直接保留 Buffer
            base64Image: i.base64Image,
            url: undefined,
            imgUrl: undefined
          })),
          helper: ctx.helper,
          emit: ctx.emit ? ctx.emit.bind(ctx) : undefined,
          request: ctx.request ? ctx.request.bind(ctx) : undefined,
          Request: ctx.Request
        }

        // Some uploaders expect ctx.baseDir etc.
        if (ctx.baseDir) clonedCtx.baseDir = ctx.baseDir
        if (ctx.configPath) clonedCtx.configPath = ctx.configPath

        await uploader.handle(clonedCtx)

        // uploader 应该写回 clonedCtx.output，检查是否包含 URL
        if (!clonedCtx.output || !Array.isArray(clonedCtx.output) || clonedCtx.output.length === 0) {
          throw new Error(`uploader ${bed} 未返回有效 output`)
        }

        // 检查是否至少一个 item 含有 url/imgUrl
        const hasUrl = clonedCtx.output.some(i => i.url || i.imgUrl || i.image || i.source)
        if (!hasUrl) {
          throw new Error(`uploader ${bed} 未返回任何 url/imgUrl`)
        }

        ctx.log.info(`[${PLUGIN_NAME}] ✅ ${bed} 上传成功`)
        return clonedCtx.output
      } catch (err) {
        attempts++
        if (attempts > retryCount) {
          ctx.log.error(`[${PLUGIN_NAME}] ❌ ${bed} 上传失败，已达最大重试次数: ${err.message}`)
          return null
        } else {
          ctx.log.warn(`[${PLUGIN_NAME}] ⚠️ ${bed} 上传失败，第 ${attempts} 次重试中... (${err.message})`)
          await delay(retryDelay)
        }
      }
    }
  }

  /** beforeUpload: 缓存原始图片数据并（可选）统一文件名 */
  ctx.helper.beforeUploadPlugins.register(PLUGIN_NAME, {
    handle: async (ctx) => {
      const config = ctx.getConfig(PLUGIN_NAME) || {}
      // 深拷贝 ctx.output 并保存 buffer/base64 至 cachedImageData
      cachedImageData = (ctx.output || []).map(item => ({
        fileName: item.fileName || (Date.now() + (item.extname || '.png')),
        extname: item.extname || '.png',
        buffer: item.buffer ? Buffer.from(item.buffer) : undefined,
        base64Image: item.base64Image ? item.base64Image : undefined
      }))

      // 统一文件名（写回 ctx.output，主上传会使用）
      if (config?.unifyFileName) {
        const now = new Date()
        const pad = (n) => String(n).padStart(2, '0')
        const formatted = `${now.getFullYear()}_${pad(now.getMonth() + 1)}_${pad(now.getDate())}_${pad(now.getHours())}_${pad(now.getMinutes())}_${pad(now.getSeconds())}`
      
        ctx.output.forEach((item, idx) => {
          const ext = item.extname || cachedImageData[idx]?.extname || '.png'
          item.fileName = `pic_${formatted}${ext}`
          // 同步缓存中的名称
          if (cachedImageData[idx]) cachedImageData[idx].fileName = item.fileName
        })
      
        ctx.log.info(`[${PLUGIN_NAME}] 文件名统一为: ${ctx.output[0]?.fileName}`)
      } else {
        ctx.log.info(`[${PLUGIN_NAME}] 已缓存 ${cachedImageData.length} 个文件以备份使用`)
      }
      return ctx
    }
  })

  /** afterUpload: 并行上传 + 自动重试 + Markdown 汇总（跳过主图床） */
  ctx.helper.afterUploadPlugins.register(PLUGIN_NAME, {
    handle: async (ctx) => {
      const config = ctx.getConfig(PLUGIN_NAME) || {}
      if (!config?.enabledBeds) {
        ctx.log.warn(`[${PLUGIN_NAME}] 未配置启用的图床`)
        // 清理缓存防内存泄漏
        cachedImageData = null
        return ctx
      }

      const allBeds = config.enabledBeds.split(',').map(b => b.trim()).filter(Boolean)
      const current = getCurrentUploader(ctx)
      // 跳过当前默认主图床，避免重复上传
      const beds = allBeds.filter(b => b !== current)

      if (beds.length === 0) {
        ctx.log.warn(`[${PLUGIN_NAME}] 没有备份图床（或所有备份图床都与当前图床相同），跳过`)
        cachedImageData = null
        return ctx
      }

      ctx.log.info(`[${PLUGIN_NAME}] 🚀 并行上传到多个图床: ${beds.join(', ')}`)

      // 并行上传
      const tasks = beds.map(bed => uploadWithRetry(bed, ctx, config.retryCount || 2, config.retryDelay || 2000).then(output => ({ bed, output })))
      const results = await Promise.allSettled(tasks)

      // 收集成功结果
      const mergedOutput = []
      results.forEach(r => {
        if (r.status === 'fulfilled' && r.value && r.value.output) {
          const bed = r.value.bed
          const outs = r.value.output.map(i => ({ ...i, uploader: bed }))
          mergedOutput.push(...outs)
        } else if (r.status === 'fulfilled' && r.value && !r.value.output) {
          ctx.log.warn(`[${PLUGIN_NAME}] ${r.value.bed} 返回空结果`)
        } else {
          ctx.log.error(`[${PLUGIN_NAME}] 备份任务异常:`, r.reason || (r.value && r.value.error) || 'unknown')
        }
      })

      // 最终合并：把主图床原始 ctx.output（主上传结果）也保留，然后追加备份结果
      const finalOutput = []
      // 保证主上传结果先列出（ctx.output 是主上传写回的结果）
      if (Array.isArray(ctx.output)) {
        finalOutput.push(...ctx.output.map(i => ({ ...i, uploader: current || 'primary' })))
      }
      if (mergedOutput.length > 0) finalOutput.push(...mergedOutput)

      ctx.output = finalOutput
      ctx.log.success(`[${PLUGIN_NAME}] 🎉 多图床上传完成 (${finalOutput.length} 条结果)`)

      // 生成 Markdown（兼容多个字段）
      if (config.generateMarkdown) {
        const markdown = generateMarkdownTable(finalOutput)
        ctx.log.info('\n📋 Markdown 链接汇总：\n')
        console.log(markdown)
        ctx.emit && ctx.emit('notification') // 触发 GUI 通知（如果可用）
      }

      // 清理缓存
      cachedImageData = null
      return ctx
    }
  })

  /** Markdown 表生成函数 */
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
      md += '| 图床 | 预览 | 链接 |\n|------|------|------|\n'
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
