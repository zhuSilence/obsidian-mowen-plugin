/**
 * Handler 注册表
 * 
 * 管理 BlockHandler 和 InlineHandler 的注册、注销、排序
 * 支持优先级 + before/after 约束，供第三方插件扩展
 */

import { BlockHandler, InlineHandler } from './types';

/** 注册选项 */
export interface RegisterOptions {
	/** 优先级 0-100，越小越先匹配，默认 50 */
	priority?: number;
	/** 分组标识：'builtin' 内置 | 'custom' 第三方 */
	group?: 'builtin' | 'custom';
	/** 排在指定 handler 之前（按 name 匹配） */
	before?: string;
	/** 排在指定 handler 之后（按 name 匹配） */
	after?: string;
}

/** 已注册的 BlockHandler 条目 */
interface RegisteredBlockHandler {
	handler: BlockHandler;
	priority: number;
	group: 'builtin' | 'custom';
	before?: string;
	after?: string;
}

/** 已注册的 InlineHandler 条目 */
interface RegisteredInlineHandler {
	handler: InlineHandler;
	priority: number;
	group: 'builtin' | 'custom';
	before?: string;
	after?: string;
}

export class HandlerRegistry {
	private blockHandlers: RegisteredBlockHandler[] = [];
	private inlineHandlers: RegisteredInlineHandler[] = [];
	private blockSorted = false;
	private inlineSorted = false;

	/**
	 * 注册一个 BlockHandler
	 */
	registerBlockHandler(handler: BlockHandler, options?: RegisterOptions): void {
		const entry: RegisteredBlockHandler = {
			handler,
			priority: options?.priority ?? 50,
			group: options?.group ?? 'custom',
			before: options?.before,
			after: options?.after,
		};

		// 检查名称是否已存在
		if (this.blockHandlers.some(h => h.handler.name === handler.name)) {
			console.warn(`[Mowen] BlockHandler "${handler.name}" 已注册，跳过重复注册`);
			return;
		}

		this.blockHandlers.push(entry);
		this.blockSorted = false;
	}

	/**
	 * 注册一个 InlineHandler
	 */
	registerInlineHandler(handler: InlineHandler, options?: RegisterOptions): void {
		const entry: RegisteredInlineHandler = {
			handler,
			priority: options?.priority ?? 50,
			group: options?.group ?? 'custom',
			before: options?.before,
			after: options?.after,
		};

		if (this.inlineHandlers.some(h => h.handler.name === handler.name)) {
			console.warn(`[Mowen] InlineHandler "${handler.name}" 已注册，跳过重复注册`);
			return;
		}

		this.inlineHandlers.push(entry);
		this.inlineSorted = false;
	}

	/**
	 * 批量注册内置 BlockHandler
	 */
	registerBuiltinBlockHandlers(handlers: BlockHandler[]): void {
		for (const handler of handlers) {
			this.registerBlockHandler(handler, { priority: 50, group: 'builtin' });
		}
	}

	/**
	 * 批量注册内置 InlineHandler
	 */
	registerBuiltinInlineHandlers(handlers: InlineHandler[]): void {
		for (const handler of handlers) {
			this.registerInlineHandler(handler, { priority: 50, group: 'builtin' });
		}
	}

	/**
	 * 注销指定名称的 BlockHandler
	 */
	unregisterBlockHandler(name: string): boolean {
		const index = this.blockHandlers.findIndex(h => h.handler.name === name);
		if (index !== -1) {
			this.blockHandlers.splice(index, 1);
			this.blockSorted = false;
			return true;
		}
		return false;
	}

	/**
	 * 注销指定名称的 InlineHandler
	 */
	unregisterInlineHandler(name: string): boolean {
		const index = this.inlineHandlers.findIndex(h => h.handler.name === name);
		if (index !== -1) {
			this.inlineHandlers.splice(index, 1);
			this.inlineSorted = false;
			return true;
		}
		return false;
	}

	/**
	 * 获取排序后的 BlockHandler 列表
	 */
	getBlockHandlers(): BlockHandler[] {
		if (!this.blockSorted) {
			this.sortBlockHandlers();
			this.blockSorted = true;
		}
		return this.blockHandlers.map(h => h.handler);
	}

	/**
	 * 获取排序后的 InlineHandler 列表
	 */
	getInlineHandlers(): InlineHandler[] {
		if (!this.inlineSorted) {
			this.sortInlineHandlers();
			this.inlineSorted = true;
		}
		return this.inlineHandlers.map(h => h.handler);
	}

	/**
	 * 获取所有已注册的 BlockHandler 名称（调试用）
	 */
	getBlockHandlerNames(): string[] {
		return this.getBlockHandlers().map(h => h.name);
	}

	/**
	 * 获取所有已注册的 InlineHandler 名称（调试用）
	 */
	getInlineHandlerNames(): string[] {
		return this.getInlineHandlers().map(h => h.name);
	}

	/**
	 * 清除所有第三方 Handler（插件停用时调用）
	 */
	clearCustomHandlers(): void {
		this.blockHandlers = this.blockHandlers.filter(h => h.group === 'builtin');
		this.inlineHandlers = this.inlineHandlers.filter(h => h.group === 'builtin');
		this.blockSorted = false;
		this.inlineSorted = false;
	}

	// --- 排序逻辑 ---

	private sortBlockHandlers(): void {
		this.blockHandlers.sort((a, b) => {
			// before/after 约束优先
			if (a.before === b.handler.name) return -1;
			if (a.after === b.handler.name) return 1;
			if (b.before === a.handler.name) return 1;
			if (b.after === a.handler.name) return -1;
			// 其次按 priority
			return a.priority - b.priority;
		});
	}

	private sortInlineHandlers(): void {
		this.inlineHandlers.sort((a, b) => {
			if (a.before === b.handler.name) return -1;
			if (a.after === b.handler.name) return 1;
			if (b.before === a.handler.name) return 1;
			if (b.after === a.handler.name) return -1;
			return a.priority - b.priority;
		});
	}
}
