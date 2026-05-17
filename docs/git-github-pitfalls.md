# Git/GitHub 操作常见坑

本文档记录 Git 和 GitHub CLI 操作过程中遇到的常见问题及解决方案。

---

## 1. Worktree 冲突

### 坑点
使用 git worktree 时，main 分支可能被其他 worktree 占用，无法 checkout。

### 报错信息
```
fatal: 'main' is already used by worktree at '/path/to/other/worktree'
```

### 正确做法
- 创建 feature/release 分支进行开发
- 通过 PR 合并到 main
- 使用 `git tag <version> origin/main` 创建 tag

---

## 2. gh pr merge 在 worktree 环境可能失败

### 坑点
`gh pr merge --merge --delete-branch` 在 worktree 环境可能因为 git 操作失败。

### 正确做法
- 使用 `gh pr merge --merge` (不带 --delete-branch)
- 或通过 GitHub Web UI 合并

---

## 3. 删除远程 Tag

### 命令
```bash
# 删除本地 tag
git tag -d v0.0.31

# 删除远程 tag
git push origin --delete v0.0.31
```

---

## 4. 删除 Release

### 命令
```bash
gh release delete v0.0.31 --yes
```

---

## 5. 查看 Release Assets

### 命令
```bash
gh release view 0.0.32
gh release download 0.0.32 --dir /tmp/check
```