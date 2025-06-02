### 项目基本信息

- **项目名称**: `obsidian-mowen-plugin`
- **项目描述**: This is a mowen plugin for Obsidian (https://obsidian.md)
- **主入口文件**: [main.js](file:///Users/silence/obsidian-mowen-plugin/obsidian-mowen-plugin/main.js)

### 使用的语言和技术栈

从 [package.json](file:///Users/silence/obsidian-mowen-plugin/obsidian-mowen-plugin/node_modules/@eslint/js/package.json) 中的 `devDependencies` 可以看出该项目使用的主要技术如下：

- **项目依赖**:
  - 墨问 API KEY: 通过墨问小程序获取，用于调用墨问的 API，会员账号才有的权限
  - 墨问开放接口: 墨问的官方开放接口，用于创建和修改笔记，https://mowen.apifox.cn/298137640e0

- **开发语言**:
  - TypeScript (`typescript`: "4.7.4")
  - JavaScript (支持 Node.js 内置模块 `builtin-modules`: "3.3.0")

- **构建工具**:
  - [esbuild](https://esbuild.github.io/) ([esbuild](file:///Users/silence/obsidian-mowen-plugin/obsidian-mowen-plugin/node_modules/esbuild/bin/esbuild): "0.17.3") —— 用于快速打包构建
  - TypeScript 编译器 ([tsc](file:///Users/silence/obsidian-mowen-plugin/obsidian-mowen-plugin/node_modules/typescript/bin/tsc)) —— 用于类型检查和编译 TypeScript 源码

- **编辑器/IDE 支持**:
  - ESLint + TypeScript ESLint 插件 (`@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`) —— 用于代码规范和静态分析
  - `@types/node` —— 提供 Node.js 的 TypeScript 类型定义

- **插件平台依赖**:
  - [Obsidian](https://obsidian.md) (`obsidian`: "latest") —— 这是一个 Obsidian 客户端插件，因此该插件运行在 Obsidian 平台上。

- **辅助库**:
  - `tslib` —— 用于 TypeScript 辅助函数（如 `__awaiter`, `__extends` 等）

### 构建流程简述

- 开发模式: 执行 `npm run dev` 将调用 [esbuild.config.mjs](file:///Users/silence/obsidian-mowen-plugin/obsidian-mowen-plugin/esbuild.config.mjs) 启动开发构建。
- 生产构建: `npm run build` 会执行 TypeScript 类型检查并使用 esbuild 构建生产环境版本，并复制必要的资源文件到 `dist` 目录。
- 版本管理: `npm run version` 调用脚本 [version-bump.mjs](file:///Users/silence/obsidian-mowen-plugin/obsidian-mowen-plugin/version-bump.mjs) 来更新插件版本号并提交 [manifest.json](file:///Users/silence/obsidian-mowen-plugin/obsidian-mowen-plugin/manifest.json) 和 [versions.json](file:///Users/silence/obsidian-mowen-plugin/obsidian-mowen-plugin/versions.json)。

## 使用说明
找到本地 Obsidian 笔记文件夹位置，在.obsidian/plugin 文件夹下创建一个名称为 obsidian-mowen-plugin 的文件夹，将页面 https://github.com/zhuSilence/obsidian-mowen-plugin/releases/tag/0.0.1 上的 main.js,style.css,manifest.json 三个文件下载下来，放到刚刚创建的 obsidian-mowen-plugin 文件夹中。
[](1.png)

下载安装成功过后，在 Obsidian 的设置中，找到插件管理，点击插件管理，找到 obsidian-mowen-plugin 进行启用，然后在设置中配置墨问的 API KEY，在这里也可以配置是否默认开启自动发布功能。
[](2.png)
[](3.png)

打开一篇已经写好的笔记，然后再打开命令板输入 mowen 可以看到发布选项
[](4.png)
[](5.png)