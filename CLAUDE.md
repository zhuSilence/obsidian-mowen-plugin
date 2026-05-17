# Obsidian 墨问插件开发指南

> Claude Code Agent 导航索引手册，保持在 200 行以内。详细内容见 docs 目录。

---

## 项目概览

- **插件名称**: Publish Note to Mowen Note
- **插件 ID**: `publish-note-to-mowen`
- **墨问 API 文档**: https://mowen.apifox.cn/llms.txt

---

## 文档索引

| 文档 | 说明 |
|------|------|
| [docs/api-key-validation-issues.md](docs/api-key-validation-issues.md) | API Key 验证按钮问题总结 |
| [docs/obsidian-plugin-pitfalls.md](docs/obsidian-plugin-pitfalls.md) | Obsidian 插件开发常见坑 |
| [docs/git-github-pitfalls.md](docs/git-github-pitfalls.md) | Git/GitHub 操作常见坑 |
| [docs/dev-workflow.md](docs/dev-workflow.md) | 开发流程指南 |

---

## 关键约束（必读）

### Obsidian 插件开发

1. **禁止动态 import** - 必须静态导入 `import { X } from "obsidian"`
2. **Tag 格式统一** - 使用 `0.0.XX`（无 v 前缀），与历史版本保持一致
3. **versions.json 必须包含在 release** - 缺少会导致安装失败

### 墨问 API

- **只使用官方文档确认存在的接口** - 查看 https://mowen.apifox.cn/llms.txt
- 可用接口: `/upload/prepare`, `/note/create`, `/note/edit`, `/note/set`

---

## 发布流程（简版）

1. 更新版本号: manifest.json, package.json, versions.json
2. 创建分支 → 提交 → PR → 合并到 main
3. 创建 tag: `git tag 0.0.XX origin/main && git push origin 0.0.XX`
4. 等待 workflow，检查 release assets

---

## 文件结构

```
src/
├── api.ts          # 墨问 API 调用
├── settings.ts     # 设置页面
├── main.ts         # 插件入口
├── converter/      # Markdown 转换器
└── utils/          # 工具函数
```