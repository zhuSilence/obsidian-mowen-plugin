/**
 * TableHandler - 表格处理器（P1 扩展）
 * 
 * 处理 Markdown 表格语法
 * 开关开启：转为 codeblock 保留对齐
 * 开关关闭：canHandle 返回 false，穿透到默认段落原样输出
 */

import { BlockHandler, HandlerContext, HandlerResult } from './types';

export class TableHandler implements BlockHandler {
	readonly name = 'table';

	canHandle(lines: string[], index: number, ctx: HandlerContext): boolean {
		// 先检查开关
		if (!ctx.settings.extendedSyntax.enabled || !ctx.settings.extendedSyntax.table) {
			return false;
		}
		// 判断是否是表格行
		return /^\|(.+\|)+\s*$/.test(lines[index].trim());
	}

	async handle(lines: string[], index: number, _ctx: HandlerContext): Promise<HandlerResult> {
		// 收集连续的表格行
		const tableLines: string[] = [];
		let i = index;
		while (i < lines.length && /^\|(.+\|)+\s*$/.test(lines[i].trim())) {
			tableLines.push(lines[i].trim());
			i++;
		}

		// 转为 codeblock，保留原始对齐
		return {
			nodes: [
				{
					type: 'codeblock',
					attrs: { language: 'plaintext' },
					content: [{ type: 'text', text: tableLines.join('\n') }]
				},
				{ type: 'paragraph' }
			],
			linesConsumed: i - index,
		};
	}
}
