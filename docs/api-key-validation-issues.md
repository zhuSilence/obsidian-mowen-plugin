# API Key 验证按钮问题总结

本文档记录了插件 API Key 验证按钮功能开发过程中遇到的问题及修复方案。

## 问题 1：插件无法安装

### 问题描述
Obsidian 提示"无法安装插件"，无法从插件商店更新。

### 原因分析
Release tag 使用了 `v0.0.31` 格式（带 v 前缀），而历史版本都是 `0.0.30`（无前缀），导致 Obsidian 插件商店无法正确匹配版本。

### 修复方案
删除错误 release，重新创建 tag 时使用无 v 前缀的格式（如 `0.0.32`）。

### 参考版本
| 版本 | Tag 格式 | 状态 |
|------|----------|------|
| 0.0.29 | `0.0.29` | 正常 |
| 0.0.30 | `0.0.30` | 正常 |
| v0.0.31 | `v0.0.31` | 无法安装 |
| 0.0.32 | `0.0.32` | 正常 |

---

## 问题 2：Release 缺少 versions.json

### 问题描述
release assets 不包含 versions.json 文件。

### 原因分析
GitHub workflow 只打包了 main.js、manifest.json、styles.css，遗漏了 versions.json。

### 修复方案
修改 `.github/workflows/release.yml`：
```yaml
# Build 步骤添加 versions.json
cp main.js manifest.json styles.css versions.json ${{ env.PLUGIN_NAME }}

# Create Release 步骤添加 versions.json
files: |
  ${{ env.PLUGIN_NAME }}.zip
  main.js
  manifest.json
  styles.css
  versions.json
```

---

## 问题 3：验证按钮无 Notice 提示

### 问题描述
点击验证按钮后，没有任何 Notice 提示显示。

### 原因分析
使用动态 import `await import('obsidian')` 导入 Notice，在 Obsidian 插件运行时环境中不支持，导致报错：
```
Uncaught (in promise) TypeError: Failed to resolve module specifier 'obsidian'
```

### 修复方案
改为静态导入 Notice：
```typescript
// settings.ts 顶部
import { App, PluginSettingTab, Setting, Notice } from "obsidian";

// onClick 中直接使用
new Notice('API Key 验证通过');
new Notice('API Key 验证失败: ' + error);
```

---

## 问题 4：验证接口不存在

### 问题描述
调用 `/my/profile` 接口验证 API Key 时失败。

### 原因分析
`/my/profile` 接口在墨问官方开放平台文档中不存在，只有 schema 定义（MyProfileReply、MyProfileRequest）没有实际的 API endpoint。

### 修复方案
改用官方文档确认存在的 `/upload/prepare` 接口：
```typescript
// api.ts
const response = await safeRequest(
  `${baseUrl}/upload/prepare`,
  "POST",
  {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`,
  },
  JSON.stringify({ fileType: 1 }),
  10000
);
```

---

## 发布规范总结

| 规范 | 说明 |
|------|------|
| Tag 格式 | 使用 `0.0.X` 格式（无 v 前缀），与历史版本保持一致 |
| versions.json | 必须包含在 release assets 中，并记录所有版本号 |
| import 方式 | 禁止使用动态 `import()`，必须静态导入 Obsidian 模块 |
| API 接口 | 只使用官方文档确认存在的接口 |

---

## 相关文件

- `src/settings.ts` - 设置页面，验证按钮 UI
- `src/api.ts` - API 调用，checkApiKeyHealth 函数
- `.github/workflows/release.yml` - 发布 workflow
- `versions.json` - 版本兼容性记录