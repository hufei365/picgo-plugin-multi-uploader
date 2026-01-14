# picgo-plugin-multi-uploader

🚀 **PicGo 插件**：一次上传图片到多个图床，支持并行上传、自动重试、统一文件名。

## ✨ 功能特性

- ⚡ **并行上传**：同时向多个图床发起请求，提升效率
- 🔁 **自动重试**：支持自定义重试次数与延迟
- 🧱 **统一文件名**：确保同一张图片在不同图床中拥有相同的文件名
- 🧩 **Markdown 汇总**：上传完成后输出所有图床的链接汇总表格

## 📦 安装

```bash
picgo install multi-uploader
```

## ⚙️ 配置

### 配置项

| 配置项 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `enabledBeds` | `string` | `smms,github` | 需要上传的图床列表，多个用逗号分隔 |
| `unifyFileName` | `boolean` | `true` | 是否使用统一的时间戳文件名 |
| `retryCount` | `number` | `2` | 上传失败时的重试次数 |
| `retryDelay` | `number` | `2000` | 重试间隔（毫秒） |
| `generateMarkdown` | `boolean` | `true` | 是否生成 Markdown 链接汇总 |

### 配置文件位置

| 版本 | 配置文件 |
| :--- | :--- |
| PicGo GUI | `%APPDATA%\picgo\data.json` (Windows) / `~/Library/Application Support/picgo/data.json` (macOS) |
| PicGo-Core CLI | `~/.picgo/config.json` |

### 配置示例

```json
{
  "picBed": {
    "uploader": "smms",
    "current": "smms",
    "smms": {
      "token": "your-smms-token"
    },
    "github": {
      "repo": "username/repo",
      "branch": "main",
      "path": "images/",
      "token": "your-github-token"
    }
  },
  "picgoPlugins": {
    "picgo-plugin-multi-uploader": true
  },
  "picgo-plugin-multi-uploader": {
    "enabledBeds": "smms,github",
    "unifyFileName": true,
    "retryCount": 2,
    "retryDelay": 2000,
    "generateMarkdown": true
  }
}
```

> ⚠️ **注意**：
> - `picgoPlugins` 中插件值应为 `true`/`false`，不要放置配置对象
> - 插件配置必须放在配置文件的**根级别**
> - `picBed.uploader` 只设置一个主图床，插件会自动上传到 `enabledBeds` 中的其他图床

## 📖 使用

1. 在 PicGo 中设置主图床（如 `smms`）
2. 在插件配置的 `enabledBeds` 中填入所有需要上传的图床
3. 正常上传图片，插件会自动并行上传到所有配置的图床

> 💡 插件会自动跳过主图床，避免重复上传。请确保 `enabledBeds` 中的图床都已正确配置。

## 📄 开源协议

[MIT](LICENSE)
