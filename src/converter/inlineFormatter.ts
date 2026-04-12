/**
 * 行内格式化处理模块
 * 
 * 从 MarkdownConverter 中提取的行内格式化逻辑
 * 处理加粗、高亮、斜体、链接、删除线等行内语法
 */

import { NoteAtomMark, NoteAtomNode } from '../api';
import { HandlerContext } from './handlers/types';

/**
 * 处理行内格式化（加粗、高亮、斜体、链接的组合）
 * 兼容原有 MarkdownConverter.processInlineFormatting 逻辑
 */
export function processInlineFormatting(line: string, ctx?: HandlerContext): NoteAtomNode[] {
	const parts: NoteAtomNode[] = [];
	const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
	let lastIndex = 0;
	let match;

	// 跟踪当前的 bold/highlight 状态
	let currentFormatMarks: NoteAtomMark[] = [];

	while ((match = linkRegex.exec(line)) !== null) {
		// 处理链接前的文本
		if (match.index > lastIndex) {
			const textBeforeLink = line.slice(lastIndex, match.index);
			currentFormatMarks = processTextSegment(textBeforeLink, parts, [], ctx);
		}

		// 处理链接
		const linkMark: NoteAtomMark = { type: 'link', attrs: { href: match[2] } };
		const combinedMarks = [...currentFormatMarks, linkMark];
		processTextSegment(match[1], parts, combinedMarks, ctx);

		lastIndex = match.index + match[0].length;
	}

	// 处理链接后的剩余文本
	if (lastIndex < line.length) {
		const remainingText = line.slice(lastIndex);
		processTextSegment(remainingText, parts, currentFormatMarks, ctx);
	}

	return parts;
}

/**
 * 处理文本片段的格式标记，支持 marks 叠加
 * 支持：**加粗**、==高亮==、*斜体*、~~删除线~~
 */
export function processTextSegment(
	textSegment: string,
	partsArray: NoteAtomNode[],
	baseMarks: NoteAtomMark[] = [],
	ctx?: HandlerContext
): NoteAtomMark[] {
	let currentText = '';
	let activeMarks: NoteAtomMark[] = [...baseMarks];
	const ext = ctx?.settings.extendedSyntax;
	const strikethroughEnabled = ext?.enabled && ext?.strikethrough;

	let i = 0;
	while (i < textSegment.length) {
		// 检测删除线标记 (~~text~~) - 扩展语法，需开关
		// 处理方式：类似斜体，使用 highlight 标记（墨问不支持 strikethrough）
		if (strikethroughEnabled && textSegment[i] === '~' && textSegment[i + 1] === '~') {
			if (currentText) {
				partsArray.push({
					type: 'text',
					text: currentText,
					marks: activeMarks.length > 0 ? [...activeMarks] : [...baseMarks]
				});
				currentText = '';
			}
			// 切换 highlight 标记状态（类似斜体的处理方式）
			toggleMark(activeMarks, 'highlight');
			i += 2;
			continue;
		}

		// 检测 highlight 标记 (==text==)
		if (textSegment[i] === '=' && textSegment[i + 1] === '=') {
			if (currentText) {
				partsArray.push({
					type: 'text',
					text: currentText,
					marks: activeMarks.length > 0 ? [...activeMarks] : [...baseMarks]
				});
				currentText = '';
			}
			toggleMark(activeMarks, 'highlight');
			i += 2;
			continue;
		}

		// 检测 *** 标记（加粗+斜体，先于 ** 和 * 检测，避免解析歧义）
		// 墨问不支持 italic，*** 等效为 bold + highlight
		if (textSegment[i] === '*' && textSegment[i + 1] === '*' && textSegment[i + 2] === '*') {
			if (currentText) {
				partsArray.push({
					type: 'text',
					text: currentText,
					marks: activeMarks.length > 0 ? [...activeMarks] : [...baseMarks]
				});
				currentText = '';
			}
			toggleMark(activeMarks, 'bold');
			toggleMark(activeMarks, 'highlight');
			i += 3;
			continue;
		}

		// 检测 bold 标记 (**) - 必须在斜体之前检查
		if (textSegment[i] === '*' && textSegment[i + 1] === '*') {
			if (currentText) {
				partsArray.push({
					type: 'text',
					text: currentText,
					marks: activeMarks.length > 0 ? [...activeMarks] : [...baseMarks]
				});
				currentText = '';
			}
			toggleMark(activeMarks, 'bold');
			i += 2;
			continue;
		}

		// 检测 italic 标记 (*)
		// 墨问 NoteAtom 不支持 italic marks，转换为 highlight
		// 修复: 移除对前一个字符是否为*的检查，因为 *** 已在上方优先处理
		if (textSegment[i] === '*' && textSegment[i + 1] !== '*') {
			if (currentText) {
				partsArray.push({
					type: 'text',
					text: currentText,
					marks: activeMarks.length > 0 ? [...activeMarks] : [...baseMarks]
				});
				currentText = '';
			}
			toggleMark(activeMarks, 'highlight');
			i += 1;
			continue;
		}

		currentText += textSegment[i];
		i++;
	}

	// 处理末尾剩余文本
	if (currentText) {
		partsArray.push({
			type: 'text',
			text: currentText,
			marks: activeMarks.length > 0 ? [...activeMarks] : [...baseMarks]
		});
	}

	// 返回结束时的 marks 状态
	return activeMarks.filter(m => m.type === 'bold' || m.type === 'highlight');
}

/**
 * 切换 mark 状态
 */
function toggleMark(marks: NoteAtomMark[], markType: 'bold' | 'highlight'): void {
	const index = marks.findIndex(m => m.type === markType);
	if (index !== -1) {
		marks.splice(index, 1);
	} else {
		marks.push({ type: markType });
	}
}
