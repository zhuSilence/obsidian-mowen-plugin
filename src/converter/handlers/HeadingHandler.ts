/**
 * HeadingHandler - 标题处理器
 * 
 * 处理 # 标题语法
 * 转换为加粗段落（墨问不支持标题层级）
 */

import { BlockHandler, HandlerContext, HandlerResult } from './types';
import { processInlineFormatting } from '../inlineFormatter';

export class HeadingHandler implements BlockHandler {
	readonly name = 'heading';

	canHandle(lines: string[], index: number, _ctx: HandlerContext): boolean {
		return /^(#+)\s*(.+)$/.test(lines[index].trim());
	}

	async handle(lines: string[], index: number, ctx: HandlerContext): Promise<HandlerResult> {
		const headingMatch = lines[index].trim().match(/^(#+)\s*(.+)$/);
		if (!headingMatch) {
			return { nodes: [], linesConsumed: 1 };
		}

		// 处理标题文本中的行内格式（加粗、高亮、链接等）
		const inlineContent = processInlineFormatting(headingMatch[2], ctx);
		// 为所有行内节点添加 bold mark
		const boldContent = inlineContent.map(node => {
			if (node.type === 'text') {
				return {
					...node,
					marks: [{ type: 'bold' as const }, ...(node.marks || [])]
				};
			}
			return node;
		});

		return {
			nodes: [
				{
					type: 'paragraph',
					content: boldContent
				},
				{ type: 'paragraph' }
			],
			linesConsumed: 1,
		};
	}
}
