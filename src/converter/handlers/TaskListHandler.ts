/**
 * TaskListHandler - 任务列表处理器（P1 扩展）
 * 
 * 处理 - [ ] / - [x] 任务列表语法
 * 开关开启：转换为 ☐ / ☑ 符号
 * 开关关闭：canHandle 返回 false，穿透到 ListHandler 原样输出
 */

import { BlockHandler, HandlerContext, HandlerResult } from './types';
import { processInlineFormatting } from '../inlineFormatter';

export class TaskListHandler implements BlockHandler {
	readonly name = 'task-list';

	canHandle(lines: string[], index: number, ctx: HandlerContext): boolean {
		// 先检查开关
		if (!ctx.settings.extendedSyntax.enabled || !ctx.settings.extendedSyntax.taskList) {
			return false;
		}
		// 判断是否是任务列表
		return !!lines[index].trim().match(/^(\s*)([-*+])\s+\[[ x]\]/);
	}

	async handle(lines: string[], index: number, ctx: HandlerContext): Promise<HandlerResult> {
		const trimmedLine = lines[index].trim();
		const taskMatch = trimmedLine.match(/^(\s*)([-*+])\s+\[([ x])\]\s+(.+)$/);
		if (!taskMatch) {
			return { nodes: [], linesConsumed: 1 };
		}

		const isChecked = taskMatch[3] === 'x';
		const checkbox = isChecked ? '☑' : '☐';
		const taskContent = processInlineFormatting(taskMatch[4], ctx);

		return {
			nodes: [
				{
					type: 'paragraph',
					content: [
						{ type: 'text', text: checkbox + ' ' },
						...taskContent
					]
				},
				{ type: 'paragraph' }
			],
			linesConsumed: 1,
		};
	}
}
