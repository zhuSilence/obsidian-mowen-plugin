# Claude Code 开发注意事项

本文档记录使用 Claude Code 开发 Obsidian 墨问插件时遇到的各种坑，供后续开发参考。

---

## Obsidian 插件开发坑

### 1. 禁止使用动态 import

**坑点**：Obsidian 插件运行时不支持动态 import ES 模块。

**错误示例**：
```typescript
const { Notice } = await import('obsidian'); // 会报错
```

**报错信息**：
```
Uncaught (in promise) TypeError: Failed to resolve module specifier 'obsidian'
```

**正确做法**：
```typescript
import { Notice } from "obsidian"; // 静态导入
```

---

### 2. Release Tag 格式必须统一

**坑点**：Obsidian 插件商店对 tag 格式有要求，必须与历史版本格式一致。

**问题**：本项目历史版本使用 `0.0.X`（无 v 前缀），如果新版本使用 `v0.0.X`（有 v 前缀），会导致插件无法安装。

**正确做法**：
- 创建 tag 时使用 `git tag 0.0.33`（无 v 前缀）
- 检查历史版本 tag 格式，保持一致

---

### 3. versions.json 必须包含在 Release 中

**坑点**：Obsidian 插件商店依赖 versions.json 追踪版本兼容性，缺少该文件会导致安装失败。

**正确做法**：
- workflow 中打包 versions.json 到 zip
- release assets 包含 versions.json
- 每次发布新版本时更新 versions.json

---

### 4. 只使用官方文档确认存在的 API

**坑点**：墨问开放平台文档中有些 schema 定义（如 MyProfileReply）但没有实际的 API endpoint。

**问题**：调用 `/my/profile` 接口会失败，因为该接口不存在。

**正确做法**：
- 只使用官方文档明确列出的接口
- 查看 https://mowen.apifox.cn/llms.txt 确认接口是否存在
- 墨问开放平台可用接口：`/upload/prepare`、`/note/create`、`/note/edit`、`/note/set` 等

---

## Git/GitHub 坑

### 1. Worktree 冲突

**坑点**：使用 git worktree 时，main 分支可能被其他 worktree 占用，无法 checkout。

**报错信息**：
```
fatal: 'main' is already used by worktree at '/path/to/other/worktree'
```

**正确做法**：
- 创建 feature/release 分支进行开发
- 通过 PR 合并到 main
- 使用 `git tag <version> origin/main` 创建 tag

---

### 2. gh pr merge 在 worktree 环境可能失败

**坑点**：`gh pr merge --merge --delete-branch` 在 worktree 环境可能因为 git 操作失败。

**正确做法**：
- 使用 `gh pr merge --merge` (不带 --delete-branch)
- 或通过 GitHub Web UI 合并

---

## 开发流程建议

### 发布新版本流程

1. 修改代码，本地测试
2. 更新版本号：
   - manifest.json
   - package.json
   - versions.json（添加新版本记录）
3. 创建分支，提交代码
4. 创建 PR 并合并到 main
5. 创建 tag（无 v 前缀）：`git tag 0.0.XX origin/main`
6. 推送 tag：`git push origin 0.0.XX`
7. 等待 workflow 完成，检查 release assets

### 验证 API 接口流程

1. 查看 https://mowen.apifox.cn/llms.txt
2. 确认接口在文档中明确列出（有完整路径和方法）
3. 只使用确认存在的接口