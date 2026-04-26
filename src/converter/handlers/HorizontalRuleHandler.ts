/**
 * HorizontalRuleHandler - 分隔线处理器
 * 
 * 处理 --- / *** / ___ 分隔线
 * 开关开启：直接去掉（返回空节点）
 * 开关关闭：canHandle 返回 false，原样输出
 */

import { BlockHandler, HandlerContext, HandlerResult } from './types';

export class HorizontalRuleHandler implements BlockHandler {
	readonly name = 'horizontal-rule';

	canHandle(lines: string[], index: number, ctx: HandlerContext): boolean {
		// 先检查开关
		if (!ctx.settings.extendedSyntax.enabled || !ctx.settings.extendedSyntax.horizontalRule) {
			return false;
		}
		// 判断是否是分隔线
		return /^(-{3,}|\*{3,}|_{3,})$/.test(lines[index].trim());
	}

	async handle(_lines: string[], _index: number, _ctx: HandlerContext): Promise<HandlerResult> {
		// 开关开启：直接去掉分隔线，不输出任何节点
		return {
			nodes: [],
			linesConsumed: 1,
		};
	}
}
