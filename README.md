# picgo-plugin-multi-uploader

🚀 **PicGo 插件**：让你一次上传图片到多个图床！支持并行上传、自动重试、统一文件名、上传结果 Markdown 汇总输出。

---

## ✨ 功能特性

- ⚡ **并行上传**：同时向多个图床发起请求，极大提升效率。
- 🔁 **自动重试**：针对不稳定图床，支持自定义重试次数与延迟。
- 🧱 **统一文件名**：确保同一张图片在不同图床中拥有相同的文件名（可选）。
- 🧩 **Markdown 汇总**：上传完成后在控制台输出所有图床的链接汇总表格，方便批量获取。
- 🪶 **高兼容性**：支持 PicGo 官方及绝大多数第三方图床插件。

---

## 📦 安装

### CLI 方式
```bash
picgo install multi-uploader
```

### GUI 方式
在 PicGo 软件的插件设置中搜索 `multi-uploader` 并安装。

---

## ⚙️ 配置说明

在 PicGo 的插件设置中，你可以找到 `multi-uploader` 的配置项：

| 配置项 | 别名 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `enabledBeds` | 启用图床 | `string` | `smms,github` | 需要同步上传的备份图床列表，多个用英文逗号分隔。 |
| `unifyFileName` | 统一文件名 | `boolean` | `true` | 是否为本次上传的所有图床强制使用统一的时间戳文件名。 |
| `retryCount` | 重试次数 | `number` | `2` | 备份图床上传失败时的重试次数。 |
| `retryDelay` | 重试间隔 | `number` | `2000` | 每次重试之间的等待时间（单位：毫秒）。 |
| `generateMarkdown` | 生成 Markdown | `boolean` | `true` | 上传成功后是否在控制台/日志中生成 Markdown 链接汇总表。 |

### 配置文件路径

根据你使用的是 **PicGo (GUI)** 还是 **PicGo-Core (CLI)**，配置文件的名称和位置有所不同：

#### PicGo (GUI 桌面版)
配置文件通常名为 `data.json`：
- **Windows**: `%APPDATA%\picgo\data.json`
- **macOS**: `~/Library/Application\ Support/picgo/data.json`
- **Linux**: `$XDG_CONFIG_HOME/picgo/data.json` 或 `~/.config/picgo/data.json`

#### PicGo-Core (CLI 命令行版)
配置文件通常名为 `config.json`：
- **Windows**: `%UserProfile%\.picgo\config.json`
- **macOS / Linux**: `~/.picgo/config.json`

### 配置示例

在 `data.json` 中，该插件的配置项如下：

```json
{
  "picgo-plugin-multi-uploader": {
    "enabledBeds": "smms,github",
    "unifyFileName": true,
    "retryCount": 2,
    "retryDelay": 2000,
    "generateMarkdown": true
  }
}
```

---

## 📖 使用指南

1. **设置主图床**：在 PicGo 的“图床设置”中选择一个作为你的“当前使用”图床（主图床）。
2. **配置备份图床**：在 `multi-uploader` 插件配置中，填入你想同步上传的其他图床名称（如 `smms, github, imgur`）。
3. **正常上传**：像往常一样上传图片。
4. **获取结果**：
   - 剪贴板会保留**主图床**的链接。
   - 插件会自动将图片并行上传到你在 `enabledBeds` 中配置的其他图床。
   - 如果启用了 `generateMarkdown`，可以在 PicGo 的日志查看器或控制台中看到所有图床的链接汇总。

### 提示
- **避重就轻**：插件会自动跳过当前的“主图床”，避免重复上传。
- **配置一致性**：请确保你在 `enabledBeds` 中填写的图床已经在 PicGo 中正确配置了对应的账号信息。

---

## 📄 开源协议

[MIT](LICENSE)
