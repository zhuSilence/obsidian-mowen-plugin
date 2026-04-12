/**
 * CodeBlockHandler - 代码块处理器
 * 
 * 处理 ```language ... ``` 围栏代码块
 * 转换为墨问 NoteAtom 的 codeblock 节点
 */

import { BlockHandler, HandlerContext, HandlerResult } from './types';

export class CodeBlockHandler implements BlockHandler {
	readonly name = 'codeblock';

	canHandle(lines: string[], index: number, _ctx: HandlerContext): boolean {
		return lines[index].trim().startsWith('```');
	}

	async handle(lines: string[], index: number, _ctx: HandlerContext): Promise<HandlerResult> {
		const trimmedLine = lines[index].trim();

		// 开始代码块
		const codeLanguage = trimmedLine.slice(3).trim();
		const codeBuffer: string[] = [];
		let i = index + 1;

		while (i < lines.length) {
			if (lines[i].trim().startsWith('```')) {
				// 结束代码块
				return {
					nodes: [
						{
							type: 'codeblock',
							attrs: {
								language: codeLanguage || 'plaintext',
							},
							content: [{ type: 'text', text: codeBuffer.join('\n') }]
						},
						{ type: 'paragraph' } // 代码块后空行
					],
					linesConsumed: i - index + 1,
				};
			}
			codeBuffer.push(lines[i]); // 保持原始缩进
			i++;
		}

		// 未闭合的代码块：把剩余内容全部当作代码
		return {
			nodes: [
				{
					type: 'codeblock',
					attrs: {
						language: codeLanguage || 'plaintext',
					},
					content: [{ type: 'text', text: codeBuffer.join('\n') }]
				},
				{ type: 'paragraph' }
			],
			linesConsumed: i - index,
		};
	}
}
