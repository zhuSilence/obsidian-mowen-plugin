/**
 * QuoteHandler - 引用块处理器
 * 
 * 处理 > 开头的引用行
 * 注意：排除 Callout 语法（> [!note] 等），由 CalloutHandler 处理
 */

import { NoteAtomNode } from '../../api';
import { BlockHandler, HandlerContext, HandlerResult } from './types';
import { processInlineFormatting } from '../inlineFormatter';

export class QuoteHandler implements BlockHandler {
	readonly name = 'quote';

	canHandle(lines: string[], index: number, _ctx: HandlerContext): boolean {
		const line = lines[index].trim();
		// 只认普通引用，不认 Callout
		return line.startsWith('>') && !line.match(/^>\s*\[!\w+/);
	}

	async handle(lines: string[], index: number, ctx: HandlerContext): Promise<HandlerResult> {
		// 收集连续引用行
		const quoteLines: string[] = [];
		let i = index;
		while (i < lines.length && lines[i].trim().startsWith('>') && !lines[i].trim().match(/^>\s*\[!\w+/)) {
			quoteLines.push(lines[i].trim().replace(/^>\s*/, ''));
			i++;
		}

		// 逐行处理行内格式，避免 \n 被吞入文本节点
		const content: NoteAtomNode[] = [];
		for (let j = 0; j < quoteLines.length; j++) {
			const lineContent = processInlineFormatting(quoteLines[j], ctx);
			content.push(...lineContent);
			// 行间插入换行文本节点（非最后一行）
			if (j < quoteLines.length - 1) {
				content.push({ type: 'text', text: '\n' });
			}
		}

		return {
			nodes: [
				{ type: 'quote', content },
				{ type: 'paragraph' }
			],
			linesConsumed: i - index,
		};
	}
}
