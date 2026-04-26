/**
 * 墨问插件公开 API
 * 
 * 供第三方插件扩展所需的类型和接口
 * 第三方插件通过以下方式访问：
 * 
 * ```typescript
 * import type { BlockHandler, HandlerContext, HandlerResult } from 'obsidian-mowen-plugin';
 * 
 * const mowenPlugin = this.app.plugins.plugins['obsidian-mowen-plugin']?.instance;
 * if (mowenPlugin) {
 *   mowenPlugin.handlerRegistry.registerBlockHandler(myHandler, { before: 'codeblock' });
 * }
 * ```
 */

// Handler 接口
export type { BlockHandler, InlineHandler, HandlerContext, HandlerResult, UploadCacheEntry } from './converter/handlers/types';

// Registry
export { HandlerRegistry } from './converter/handlers/registry';
export type { RegisterOptions } from './converter/handlers/registry';

// NoteAtom 类型
export type { NoteAtomNode, NoteAtomMark } from './api';

// API 配置
export { setBaseUrl, getBaseUrl } from './api';
