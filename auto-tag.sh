#!/bin/zsh

# 获取 manifest.json 里的 version 字段（无 v 前缀）
TAG=$(grep '"version"' manifest.json | head -1 | sed -E 's/.*"version": *"([^"]+)".*/\1/')

if [[ -z "$TAG" ]]; then
  echo "未能从 manifest.json 读取到 version 字段"
  exit 1
fi

# 检查本地是否已有该 tag
if git tag | grep -q "^$TAG$"; then
  echo "本地已存在 tag $TAG"
else
  git tag "$TAG"
  echo "已创建 tag $TAG"
fi

# 推送 tag 到远程
git push origin "$TAG"
echo "已推送 tag $TAG 到远程"