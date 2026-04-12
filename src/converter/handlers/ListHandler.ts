/**
 * ListHandler - 列表处理器
 * 
 * 处理有序/无序列表语法
 * 注意：排除任务列表语法（- [ ] / - [x]），由 TaskListHandler 处理
 * 注意：嵌套列表由 NestedListHandler 处理（开关开启时）
 */

import { BlockHandler, HandlerContext, HandlerResult } from './types';
import { processInlineFormatting } from '../inlineFormatter';

export class ListHandler implements BlockHandler {
	readonly name = 'list';

	canHandle(lines: string[], index: number, _ctx: HandlerContext): boolean {
		const line = lines[index].trim();
		const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
		if (!listMatch) return false;
		// 排除任务列表
		return !line.match(/^(\s*)([-*+])\s+\[[ x]\]/);
	}

	async handle(lines: string[], index: number, ctx: HandlerContext): Promise<HandlerResult> {
		const trimmedLine = lines[index].trim();
		const listMatch = trimmedLine.match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
		if (!listMatch) {
			return { nodes: [], linesConsumed: 1 };
		}

		const listContent = processInlineFormatting(listMatch[3], ctx);

		return {
			nodes: [
				{
					type: 'paragraph',
					content: [
						{ type: 'text', text: listMatch[2] + ' ' },
						...listContent
					]
				},
				{ type: 'paragraph' }
			],
			linesConsumed: 1,
		};
	}
}
