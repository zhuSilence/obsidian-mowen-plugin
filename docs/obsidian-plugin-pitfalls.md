# Obsidian 插件开发常见坑

本文档记录 Obsidian 插件开发过程中遇到的常见问题及解决方案。

---

## 1. 禁止使用动态 import

### 坑点
Obsidian 插件运行时不支持动态 import ES 模块。

### 错误示例
```typescript
const { Notice } = await import('obsidian'); // 会报错
```

### 报错信息
```
Uncaught (in promise) TypeError: Failed to resolve module specifier 'obsidian'
```

### 正确做法
```typescript
import { Notice } from "obsidian"; // 静态导入
```

---

## 2. Release Tag 格式必须统一

### 坑点
Obsidian 插件商店对 tag 格式有要求，必须与历史版本格式一致。

### 问题
本项目历史版本使用 `0.0.X`（无 v 前缀），如果新版本使用 `v0.0.X`（有 v 前缀），会导致插件无法安装。

### 正确做法
- 创建 tag 时使用 `git tag 0.0.33`（无 v 前缀）
- 检查历史版本 tag 格式，保持一致

---

## 3. versions.json 必须包含在 Release 中

### 坑点
Obsidian 插件商店依赖 versions.json 追踪版本兼容性，缺少该文件会导致安装失败。

### 正确做法
- workflow 中打包 versions.json 到 zip
- release assets 包含 versions.json
- 每次发布新版本时更新 versions.json

---

## 4. Notice 显示时间

### 坑点
移动端 Notice 默认显示时间较短（约 3-5 秒），可能来不及看到。

### 建议
```typescript
new Notice('提示信息', 8000); // 显示 8 秒
```

---

## 5. requestUrl 超时处理

### 坑点
Obsidian 的 `requestUrl` 不支持 `AbortController`，需要使用内置的 `timeout` 参数。

### 正确做法
```typescript
requestUrl({
  url,
  method,
  headers,
  body,
  timeout: 10000 // 毫秒
});
```