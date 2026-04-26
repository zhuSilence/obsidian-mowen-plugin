/**
 * MathBlockHandler - 数学公式处理器（P2 扩展）
 * 
 * 处理 $...$（行内）和 $$...$$（块级）数学公式语法
 * 开关开启：转为 codeblock(latex)
 * 开关关闭：canHandle 返回 false，穿透到默认段落原样输出
 */

import { BlockHandler, HandlerContext, HandlerResult } from './types';

export class MathBlockHandler implements BlockHandler {
	readonly name = 'math-block';

	canHandle(lines: string[], index: number, ctx: HandlerContext): boolean {
		// 先检查开关
		if (!ctx.settings.extendedSyntax.enabled || !ctx.settings.extendedSyntax.math) {
			return false;
		}
		// 判断是否是块级公式 $$...$$
		return lines[index].trim().startsWith('$$');
	}

	async handle(lines: string[], index: number, _ctx: HandlerContext): Promise<HandlerResult> {
		const trimmedLine = lines[index].trim();

		// 单行 $$ 公式：$$ E=mc^2 $$
		if (trimmedLine.length > 4 && trimmedLine.endsWith('$$') && trimmedLine.startsWith('$$')) {
			const formula = trimmedLine.slice(2, -2).trim();
			return {
				nodes: [
					{
						type: 'codeblock',
						attrs: { language: 'latex' },
						content: [{ type: 'text', text: formula }]
					},
					{ type: 'paragraph' }
				],
				linesConsumed: 1,
			};
		}

		// 多行 $$ 公式块
		const mathBuffer: string[] = [];
		let i = index + 1;
		while (i < lines.length) {
			if (lines[i].trim() === '$$') {
				// 结束公式块
				return {
					nodes: [
						{
							type: 'codeblock',
							attrs: { language: 'latex' },
							content: [{ type: 'text', text: mathBuffer.join('\n') }]
						},
						{ type: 'paragraph' }
					],
					linesConsumed: i - index + 1,
				};
			}
			mathBuffer.push(lines[i]);
			i++;
		}

		// 未闭合的公式块
		return {
			nodes: [
				{
					type: 'codeblock',
					attrs: { language: 'latex' },
					content: [{ type: 'text', text: mathBuffer.join('\n') }]
				},
				{ type: 'paragraph' }
			],
			linesConsumed: i - index,
		};
	}
}
