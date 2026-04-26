/**
 * CalloutHandler - Callout 引用块处理器（P1 扩展）
 * 
 * 处理 Obsidian Callout 语法：> [!type] 标题
 * 开关开启：提取标题加粗 + 内容作为引用
 * 开关关闭：canHandle 返回 false，穿透到 QuoteHandler 作为普通引用
 */

import { NoteAtomMark } from '../../api';
import { BlockHandler, HandlerContext, HandlerResult } from './types';
import { processInlineFormatting } from '../inlineFormatter';

/** Callout 类型 → Emoji 映射 */
const CALLOUT_ICONS: Record<string, string> = {
	note: '📝',
	tip: '💡',
	warning: '⚠️',
	important: '❗',
	caution: '🔥',
	example: '📋',
	quote: '💬',
	abstract: '📄',
	info: 'ℹ️',
	success: '✅',
	question: '❓',
	failure: '❌',
	danger: '⚡',
	bug: '🐛',
	todo: '📋',
};

export class CalloutHandler implements BlockHandler {
	readonly name = 'callout';

	canHandle(lines: string[], index: number, ctx: HandlerContext): boolean {
		// 先检查开关
		if (!ctx.settings.extendedSyntax.enabled || !ctx.settings.extendedSyntax.callout) {
			return false;
		}
		// 判断是否是 Callout 开头
		return !!lines[index].trim().match(/^>\s*\[!\w+/);
	}

	async handle(lines: string[], index: number, ctx: HandlerContext): Promise<HandlerResult> {
		const firstLine = lines[index].trim();
		const calloutMatch = firstLine.match(/^>\s*\[!(\w+)\]\s*(.*)$/);
		if (!calloutMatch) {
			return { nodes: [], linesConsumed: 1 };
		}

		const calloutType = calloutMatch[1].toLowerCase();
		const calloutTitle = calloutMatch[2];
		const icon = CALLOUT_ICONS[calloutType] || '📝';

		// 收集后续引用行（Callout 的内容）
		const contentLines: string[] = [];
		let i = index + 1;
		while (i < lines.length && lines[i].trim().startsWith('>')) {
			contentLines.push(lines[i].trim().replace(/^>\s*/, ''));
			i++;
		}

		const nodes = [];

		// 标题行：emoji + 标题（加粗）
		if (calloutTitle) {
			nodes.push({
				type: 'paragraph',
				content: [
					{ type: 'text', text: `${icon} `, marks: [] as NoteAtomMark[] },
					{ type: 'text', text: calloutTitle, marks: [{ type: 'bold' } as NoteAtomMark] }
				]
			});
		} else {
			// 无标题时只显示 emoji + 类型名
			nodes.push({
				type: 'paragraph',
				content: [
					{ type: 'text', text: `${icon} ${calloutType.charAt(0).toUpperCase() + calloutType.slice(1)}`, marks: [{ type: 'bold' } as NoteAtomMark] }
				]
			});
		}

		// 内容行：引用块
		if (contentLines.length > 0) {
			const content = processInlineFormatting(contentLines.join('\n'), ctx);
			nodes.push({
				type: 'quote',
				content
			});
		}

		nodes.push({ type: 'paragraph' });

		return {
			nodes,
			linesConsumed: i - index,
		};
	}
}
