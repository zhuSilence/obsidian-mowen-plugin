/**
 * NestedListHandler - 嵌套列表处理器（P2 扩展）
 * 
 * 处理带缩进的嵌套列表
 * 开关开启：用空格+符号模拟缩进层级
 * 开关关闭：canHandle 返回 false，穿透到 ListHandler 作为平级列表
 */

import { BlockHandler, HandlerContext, HandlerResult } from './types';
import { processInlineFormatting } from '../inlineFormatter';

/** 缩进层级 → 缩进符号映射 */
const INDENT_SYMBOLS = ['•', '◦', '▪'];

export class NestedListHandler implements BlockHandler {
	readonly name = 'nested-list';

	canHandle(lines: string[], index: number, ctx: HandlerContext): boolean {
		// 先检查开关
		if (!ctx.settings.extendedSyntax.enabled || !ctx.settings.extendedSyntax.nestedList) {
			return false;
		}
		// 判断是否是有缩进的列表项（至少2个空格或1个tab）
		const line = lines[index];
		const nestedMatch = line.match(/^(\s{2,}|\t+)([-*+]|\d+\.)\s+(.+)$/);
		return !!nestedMatch;
	}

	async handle(lines: string[], index: number, ctx: HandlerContext): Promise<HandlerResult> {
		const line = lines[index];
		const nestedMatch = line.match(/^(\s+)([-*+]|\d+\.)\s+(.+)$/);
		if (!nestedMatch) {
			return { nodes: [], linesConsumed: 1 };
		}

		const indent = nestedMatch[1];
		const bullet = nestedMatch[2];
		const text = nestedMatch[3];

		// 计算缩进层级
		const indentLevel = Math.min(
			Math.floor(indent.replace(/\t/g, '    ').length / 2),
			INDENT_SYMBOLS.length - 1
		);
		const indentStr = '  '.repeat(indentLevel);
		const symbol = INDENT_SYMBOLS[indentLevel];

		const content = processInlineFormatting(text, ctx);

		return {
			nodes: [
				{
					type: 'paragraph',
					content: [
						{ type: 'text', text: `${indentStr}${symbol} ` },
						...content
					]
				},
				{ type: 'paragraph' }
			],
			linesConsumed: 1,
		};
	}
}
