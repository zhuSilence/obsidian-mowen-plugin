/**
 * Handler 核心接口定义
 * 
 * 策略模式架构：每种 Markdown 语法对应一个 Handler 实现
 * - BlockHandler：处理块级语法（代码块、引用、表格等）
 * - InlineHandler：处理行内格式（加粗、高亮、链接等）
 */

import { App } from 'obsidian';
import { NoteAtomMark, NoteAtomNode } from '../../api';
import { MowenPluginSettings } from '../../settings';

/** 上传缓存条目类型 */
export interface UploadCacheEntry {
	success: boolean;
	uuid?: string;
	fileType?: number;
	alt?: string;
}

/** Handler 上下文，传递依赖 */
export interface HandlerContext {
	app: App;
	settings: MowenPluginSettings;
	uploadCache: Map<string, UploadCacheEntry>;
}

/** Handler 处理结果 */
export interface HandlerResult {
	/** 产生的 NoteAtom 节点 */
	nodes: NoteAtomNode[];
	/** 消耗的行数（包含当前行） */
	linesConsumed: number;
}

/**
 * 块级处理器接口
 * 
 * canHandle 判断是否认领当前行，handle 执行转换
 * 
 * 开关逻辑：
 * - 扩展 Handler 的 canHandle 内部检查 settings.extendedSyntax 开关
 * - 开关 OFF → canHandle 返回 false → 穿透到基础 Handler 或默认段落
 * - 开关 ON → canHandle 正常判断语法 → handle 执行转换
 */
export interface BlockHandler {
	/** 处理器名称（用于日志/调试/注册表管理） */
	readonly name: string;

	/**
	 * 判断是否能处理当前位置
	 * 
	 * 注意：扩展 Handler 应在此方法内检查开关状态，
	 * 开关 OFF 时返回 false，让语法穿透到下游处理器原样输出。
	 * 
	 * @param lines - 全部行内容
	 * @param index - 当前行索引
	 * @param ctx - 处理器上下文
	 */
	canHandle(lines: string[], index: number, ctx: HandlerContext): boolean;

	/**
	 * 执行转换，返回 NoteAtom 节点 + 消耗行数
	 * 
	 * @param lines - 全部行内容
	 * @param index - 当前行索引
	 * @param ctx - 处理器上下文
	 */
	handle(lines: string[], index: number, ctx: HandlerContext): Promise<HandlerResult>;
}

/**
 * 行内处理器接口
 * 
 * 处理段落内的行内格式（加粗、高亮、链接、删除线等）
 * 在段落文本处理阶段依次调用
 */
export interface InlineHandler {
	/** 处理器名称 */
	readonly name: string;

	/**
	 * 判断行内文本是否包含此格式
	 * 
	 * 扩展 Handler 应在此方法内检查开关状态
	 */
	canHandle(text: string, ctx: HandlerContext): boolean;

	/**
	 * 处理行内格式
	 * 
	 * @param text - 待处理文本
	 * @param parts - 已有的 NoteAtom 节点数组（可追加）
	 * @param baseMarks - 当前继承的 marks
	 * @param ctx - 处理器上下文
	 * @returns 处理后的 marks 状态（用于后续处理器叠加）
	 */
	handle(text: string, parts: NoteAtomNode[], baseMarks: NoteAtomMark[], ctx: HandlerContext): NoteAtomMark[];
}
