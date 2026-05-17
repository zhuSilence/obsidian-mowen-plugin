# 开发流程指南

本文档记录 Obsidian 墨问插件的开发流程和操作指南。

---

## 发布新版本流程

### 1. 修改代码
- 本地开发和测试
- 确保代码正确运行

### 2. 更新版本号
需要修改以下文件：
- `manifest.json` - `"version": "0.0.XX"`
- `package.json` - `"version": "0.0.XX"`
- `versions.json` - 添加 `"0.0.XX": "0.15.0"`

### 3. 提交代码
```bash
git checkout -b release/v0.0.XX
git add manifest.json package.json versions.json
git commit -m "chore: bump version to 0.0.XX"
git push -u origin release/v0.0.XX
```

### 4. 创建 PR 并合并
```bash
gh pr create --title "chore: bump version to 0.0.XX" --base main
gh pr merge <PR号> --merge
```

### 5. 创建 Tag（无 v 前缀）
```bash
git fetch origin
git tag 0.0.XX origin/main
git push origin 0.0.XX
```

### 6. 等待 Workflow 完成
```bash
gh run list --limit 1
gh release view 0.0.XX
```

### 7. 检查 Release Assets
确保包含：
- main.js
- manifest.json
- styles.css
- versions.json
- obsidian-mowen-plugin.zip

---

## 验证 API 接口流程

### 1. 查看官方文档
访问 https://mowen.apifox.cn/llms.txt

### 2. 确认接口存在
检查接口是否有完整路径和方法，不只是 schema 定义。

### 3. 墨问开放平台可用接口
| 接口 | 方法 | 说明 |
|------|------|------|
| `/upload/prepare` | POST | 获取上传授权 |
| `/note/create` | POST | 创建笔记 |
| `/note/edit` | POST | 编辑笔记 |
| `/note/set` | POST | 设置笔记属性 |
| `/upload/via-url` | POST | URL 上传文件 |

---

## 修复 Bug 流程

### 1. 创建修复分支
```bash
git checkout -b fix/<bug-name>
```

### 2. 修改代码并提交
```bash
git add <files>
git commit -m "fix: 问题描述"
git push -u origin fix/<bug-name>
```

### 3. 创建 PR 并合并
```bash
gh pr create --title "fix: 问题描述" --base main
gh pr merge <PR号> --merge
```

### 4. 如果需要发布新版本
按上述发布流程操作。