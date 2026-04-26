/**
 * Markdown 转 NoteAtom 转换器
 * 
 * 重构为策略模式架构：
 * - 使用 HandlerRegistry 管理 BlockHandler
 * - 主循环依次尝试每个 handler 的 canHandle/handle
 * - 扩展 Handler 的 canHandle 内部检查开关状态
 * - 开关 OFF → canHandle 返回 false → 穿透到基础 handler 或默认段落
 * 
 * 修复项：
 * - #5: 引用块解析 Bug（非引用行不再被误归入引用）
 * - #8: 代码块使用 codeblock 类型
 * - #9: 支持 ![](url) 标准图片语法
 * - #10: 支持 *斜体* 格式（转为 highlight 因为墨问不支持 italic marks）
 */

import { App, getFrontMatterInfo } from 'obsidian';
import { NoteAtomNode } from '../api';
import { MowenPluginSettings } from '../settings';
import { HandlerContext, UploadCacheEntry } from './handlers/types';
import { HandlerRegistry } from './handlers/registry';
import { processInlineFormatting } from './inlineFormatter';

// 内置 Handler
import { CodeBlockHandler } from './handlers/CodeBlockHandler';
import { MathBlockHandler } from './handlers/MathBlockHandler';
import { TableHandler } from './handlers/TableHandler';
import { CalloutHandler } from './handlers/CalloutHandler';
import { QuoteHandler } from './handlers/QuoteHandler';
import { HorizontalRuleHandler } from './handlers/HorizontalRuleHandler';
import { ImageEmbedHandler } from './handlers/ImageEmbedHandler';
import { InternalLinkHandler } from './handlers/InternalLinkHandler';
import { TaskListHandler } from './handlers/TaskListHandler';
import { NestedListHandler } from './handlers/NestedListHandler';
import { ListHandler } from './handlers/ListHandler';
import { HeadingHandler } from './handlers/HeadingHandler';

/** 转换上下文，传递依赖 */
export interface ConverterContext {
	app: App;
	settings: MowenPluginSettings;
}

export class MarkdownConverter {
	private context: ConverterContext;
	private registry: HandlerRegistry;

	constructor(context: ConverterContext) {
		this.context = context;
		this.registry = new HandlerRegistry();

		// 注册内置 BlockHandler（按优先级：特殊语法优先于通用语法）
		this.registry.registerBuiltinBlockHandlers([
			// 多行围栏语法（最先匹配）
			new CodeBlockHandler(),       // ``` 代码块
			new MathBlockHandler(),       // $$ 数学公式（P2）
			// 结构化块语法
			new TableHandler(),           // | 表格（P1）
			new CalloutHandler(),         // > [!type] Callout（P1）
			new QuoteHandler(),           // > 引用
			new HorizontalRuleHandler(),  // --- 分隔线
			// 链接/嵌入语法
			new ImageEmbedHandler(),      // ![[image]] / ![](url)
			new InternalLinkHandler(),    // [[note]]
			// 列表语法
			new TaskListHandler(),        // - [ ] / - [x] 任务列表（P1）
			new NestedListHandler(),      // 缩进列表（P2）
			new ListHandler(),            // - / 1. 普通列表
			// 标题语法
			new HeadingHandler(),         // # 标题
		]);
	}

	/**
	 * 更新 settings 引用（不重建实例，保留第三方 Handler 注册）
	 */
	updateSettings(settings: MowenPluginSettings): void {
		this.context.settings = settings;
	}

	/**
	 * 获取 Handler 注册表（供第三方插件扩展）
	 */
	getRegistry(): HandlerRegistry {
		return this.registry;
	}

	/**
	 * 去除 YAML frontmatter
	 */
	stripFrontmatter(content: string): string {
		if (content.startsWith('---')) {
			const end = content.indexOf('\n---', 3);
			if (end !== -1) {
				return content.slice(end + 4).trimStart();
			}
		}
		return content;
	}

	/**
	 * 将 Markdown 文本转换为 NoteAtom 结构
	 */
	async convert(title: string, markdown: string, summary: string | null = null): Promise<{ content: NoteAtomNode[] }> {
		let contentToProcess = markdown;
		const frontMatterInfo = getFrontMatterInfo(markdown);
		if (frontMatterInfo.exists) {
			contentToProcess = markdown.slice(frontMatterInfo.contentStart);
		}

		const lines = contentToProcess.split('\n');
		const content: NoteAtomNode[] = [];

		// 标题（加粗）
		content.push({
			type: 'paragraph',
			content: [
				{ type: 'text', text: title, marks: [{ type: 'bold' }] }
			]
		});
		// 标题后空行
		content.push({ type: 'paragraph' });

		// 摘要（引用块）
		if (summary) {
			content.push({
				type: 'quote',
				content: [{ type: 'text', text: summary }]
			});
			content.push({ type: 'paragraph' });
		}

		// === 图片上传缓存（避免同一图片重复上传） ===
		const uploadCache = new Map<string, UploadCacheEntry>();

		// 构建 Handler 上下文
		const handlerCtx: HandlerContext = {
			app: this.context.app,
			settings: this.context.settings,
			uploadCache,
		};

		// 获取排序后的 handler 列表
		const blockHandlers = this.registry.getBlockHandlers();

		// === 逐行转换 ===
		for (let i = 0; i < lines.length; i++) {
			const trimmedLine = lines[i].trim();

			// 空行跳过
			if (trimmedLine === '') {
				continue;
			}

			// 依次尝试每个 handler
			let handled = false;
			for (const handler of blockHandlers) {
				if (handler.canHandle(lines, i, handlerCtx)) {
					const result = await handler.handle(lines, i, handlerCtx);
					if (result.nodes.length > 0) {
						content.push(...result.nodes);
					}
					i += result.linesConsumed - 1; // -1 因为外层循环会 i++
					handled = true;
					break;
				}
			}

			if (!handled) {
				// 默认：普通段落（行内格式处理）
				const parts = processInlineFormatting(trimmedLine, handlerCtx);
				if (parts.length > 0) {
					content.push({
						type: 'paragraph',
						content: parts
					});
					content.push({ type: 'paragraph' });
				}
			}
		}

		return { content };
	}
}
