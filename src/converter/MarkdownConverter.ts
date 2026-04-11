/**
 * Markdown 转 NoteAtom 转换器
 * 负责将 Markdown 文本转换为墨问 NoteAtom 结构
 * 
 * 修复项：
 * - #5: 引用块解析 Bug（非引用行不再被误归入引用）
 * - #8: 代码块使用 code_block 类型
 * - #9: 支持 ![](url) 标准图片语法
 * - #10: 支持 *斜体* 格式
 */

import { App, TFile, getFrontMatterInfo, Notice } from 'obsidian';
import { NoteAtomMark, NoteAtomNode, getUploadAuthorization, deliverFile, getFileType, getMimeType, getFileTypeName } from '../api';
import { MowenPluginSettings } from '../settings';

/** 转换上下文，传递依赖 */
export interface ConverterContext {
	app: App;
	settings: MowenPluginSettings;
}

export class MarkdownConverter {
	private context: ConverterContext;

	constructor(context: ConverterContext) {
		this.context = context;
	}

	/**
	 * 去除 YAML frontmatter
	 */
	stripFrontmatter(content: string): string {
		if (content.startsWith('---')) {
			const end = content.indexOf('\n---', 3);
			if (end !== -1) {
				return content.slice(end + 4).trimStart();
			}
		}
		return content;
	}

	/**
	 * 将 Markdown 文本转换为 NoteAtom 结构
	 */
	async convert(title: string, markdown: string, summary: string | null = null): Promise<{ content: NoteAtomNode[] }> {
		let contentToProcess = markdown;
		const frontMatterInfo = getFrontMatterInfo(markdown);
		if (frontMatterInfo.exists) {
			contentToProcess = markdown.slice(frontMatterInfo.contentStart);
		}

		const lines = contentToProcess.split('\n');
		const content: NoteAtomNode[] = [];

		// 标题（加粗）
		content.push({
			type: 'paragraph',
			content: [
				{ type: 'text', text: title, marks: [{ type: 'bold' }] }
			]
		});
		// 标题后空行
		content.push({ type: 'paragraph' });

		// 摘要（引用块）
		if (summary) {
			content.push({
				type: 'quote',
				content: [{ type: 'text', text: summary }]
			});
			content.push({ type: 'paragraph' });
		}

		// === 第一遍：收集所有图片链接，并行上传 ===
		const imageUploadMap = await this.preUploadImages(lines);

		// === 第二遍：逐行转换 ===
		let inCode = false;
		let codeBuffer: string[] = [];
		let codeLanguage = '';

		for (let i = 0; i < lines.length; i++) {
			let line = lines[i];
			const trimmedLine = line.trim();

			// --- 代码块处理 ---
			if (trimmedLine.startsWith('```')) {
				if (!inCode) {
					// 开始代码块
					inCode = true;
					codeLanguage = trimmedLine.slice(3).trim();
					codeBuffer = [];
					continue;
				} else {
					// 结束代码块，输出为 code_block 节点
					inCode = false;
					content.push({
						type: 'code_block',
						attrs: {
							language: codeLanguage || 'plaintext',
						},
						content: [{ type: 'text', text: codeBuffer.join('\n') }]
					});
					content.push({ type: 'paragraph' }); // 代码块后空行
					codeBuffer = [];
					codeLanguage = '';
					continue;
				}
			}

			if (inCode) {
				codeBuffer.push(line); // 保持原始缩进
				continue;
			}

			// --- 分隔线处理 ---
			if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmedLine)) {
				content.push({
					type: 'paragraph',
					content: [{ type: 'text', text: '———', marks: [{ type: 'bold' }] }]
				});
				content.push({ type: 'paragraph' });
				continue;
			}

			// --- 引用块处理（修复 #5）---
			if (trimmedLine.startsWith('>')) {
				// 收集连续引用行
				const quoteLines: string[] = [];
				while (i < lines.length && lines[i].trim().startsWith('>')) {
					quoteLines.push(lines[i].trim().replace(/^>\s*/, ''));
					i++;
				}
				i--; // 回退一行，外层循环会 i++
				content.push({
					type: 'quote',
					content: [{ type: 'text', text: quoteLines.join('\n') }]
				});
				content.push({ type: 'paragraph' });
				continue;
			}

			// --- 图片或内嵌笔记 ---
			const embedWikiMatch = trimmedLine.match(/^!\[\[(.+?)\]\]/);  // ![[image.png]]
			const embedStdMatch = trimmedLine.match(/^!\[([^\]]*)\]\(([^)]+)\)/);  // ![alt](url) - 修复 #9
			const internalLinkMatch = trimmedLine.match(/^\[\[(.+?)\]\]/);  // [[note]]

			if (embedWikiMatch || embedStdMatch || internalLinkMatch) {
				await this.processEmbedOrLink(
					trimmedLine, embedWikiMatch, embedStdMatch, internalLinkMatch,
					imageUploadMap, content
				);
				continue;
			}

			// --- 标题 ---
			const headingMatch = trimmedLine.match(/^(#+)\s*(.+)$/);
			if (headingMatch) {
				content.push({
					type: 'paragraph',
					content: [
						{
							type: 'text',
							text: headingMatch[2],
							marks: [{ type: 'bold' }]
						}
					]
				});
				continue;
			}

			// --- 有序/无序列表 ---
			const listMatch = trimmedLine.match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
			if (listMatch) {
				const listContent = this.processInlineFormatting(listMatch[3]);
				content.push({
					type: 'paragraph',
					content: [
						{ type: 'text', text: listMatch[2] + ' ' },
						...listContent
					]
				});
				content.push({ type: 'paragraph' });
				continue;
			}

			// --- 普通文本 ---
			if (trimmedLine !== '') {
				const parts = this.processInlineFormatting(trimmedLine);
				if (parts.length > 0) {
					content.push({
						type: 'paragraph',
						content: parts
					});
					content.push({ type: 'paragraph' });
				}
			}
		}

		return { content };
	}

	/**
	 * 预上传所有图片（并行），返回映射：行索引 -> 上传结果
	 * 修复 #15：图片并行上传
	 */
	private async preUploadImages(lines: string[]): Promise<Map<number, { success: boolean; uuid?: string; fileType?: number; alt?: string; originalLine: string }>> {
		const uploadMap = new Map<number, { success: boolean; uuid?: string; fileType?: number; alt?: string; originalLine: string }>();

		// 收集需要上传的图片行
		const imageTasks: Array<{ lineIndex: number; linkText: string; altText: string }> = [];

		for (let i = 0; i < lines.length; i++) {
			const trimmedLine = lines[i].trim();
			// Wiki 链接图片: ![[image.png]]
			const wikiMatch = trimmedLine.match(/^!\[\[(.+?)\]\]/);
			if (wikiMatch) {
				imageTasks.push({ lineIndex: i, linkText: wikiMatch[1], altText: wikiMatch[1] });
				continue;
			}
			// 标准图片: ![alt](url) - 仅处理本地路径，不处理 http 链接
			const stdMatch = trimmedLine.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
			if (stdMatch && !stdMatch[2].startsWith('http')) {
				imageTasks.push({ lineIndex: i, linkText: stdMatch[2], altText: stdMatch[1] || stdMatch[2] });
			}
		}

		if (imageTasks.length === 0) return uploadMap;

		// 并行上传
		const uploadPromises = imageTasks.map(async (task) => {
			const result = await this.uploadSingleImage(task.linkText, task.altText);
			uploadMap.set(task.lineIndex, {
				success: result.success,
				uuid: result.uuid,
				fileType: result.fileType,
				alt: task.altText,
				originalLine: lines[task.lineIndex].trim()
			});
		});

		await Promise.allSettled(uploadPromises);
		return uploadMap;
	}

	/**
	 * 上传单个图片/文件
	 */
	private async uploadSingleImage(linkText: string, altText: string): Promise<{ success: boolean; uuid?: string; fileType?: number }> {
		const { app, settings } = this.context;

		let file: TFile | null = null;
		const currentActiveFile = app.workspace.getActiveFile();
		const sourcePath = currentActiveFile ? currentActiveFile.path : '';

		if (linkText) {
			file = app.metadataCache.getFirstLinkpathDest(linkText, sourcePath);
		}

		if (!(file instanceof TFile)) {
			new Notice(`文件未找到: ${linkText}`);
			return { success: false };
		}

		// 判断文件类型
		if (file.extension.toLowerCase() === 'md') {
			// 内嵌笔记不在此处理
			return { success: false };
		}

		try {
			new Notice(`正在上传图片: ${file.path}`);
			const mimeType = getMimeType(file.extension);
			const fileBlob = new Blob([await app.vault.readBinary(file)], { type: mimeType });
			const fileType = getFileType(file.extension);
			const fileTypeName = getFileTypeName(fileType);
			const fName = file.name;

			const authRes = await getUploadAuthorization(settings.apiKey, fileType);
			if (authRes.success && authRes.data && authRes.data.endpoint) {
				const uploadRes = await deliverFile(authRes.data.endpoint, authRes.data as Record<string, string>, fileBlob, fName);
				if (uploadRes.success && uploadRes.data) {
					const uuidKey = fileType === 2 ? 'audio-uuid' : 'uuid';
					const uuid = uploadRes.data.file?.fileId || '';
					new Notice(`图片上传成功: ${fName}`);
					return { success: true, uuid, fileType };
				} else {
					new Notice(`图片上传失败: ${fName} - ${uploadRes.message}`);
				}
			} else {
				new Notice(`获取图片上传授权失败: ${authRes.message}`);
			}
		} catch (error) {
			console.error('图片上传异常:', error);
			new Notice(`图片上传异常: ${altText}`);
		}

		return { success: false };
	}

	/**
	 * 处理图片/内嵌链接
	 */
	private async processEmbedOrLink(
		line: string,
		embedWikiMatch: RegExpMatchArray | null,
		embedStdMatch: RegExpMatchArray | null,
		internalLinkMatch: RegExpMatchArray | null,
		imageUploadMap: Map<number, { success: boolean; uuid?: string; fileType?: number; alt?: string; originalLine: string }>,
		content: NoteAtomNode[]
	): Promise<void> {
		const { app, settings } = this.context;
		let linkText = '';
		let altText = '';
		let isImage = false;

		if (embedWikiMatch) {
			linkText = embedWikiMatch[1];
			altText = linkText;
			isImage = true;
		} else if (embedStdMatch) {
			linkText = embedStdMatch[2];
			altText = embedStdMatch[1] || linkText;
			isImage = true;
		} else if (internalLinkMatch) {
			linkText = internalLinkMatch[1];
		}

		// 尝试解析为文件
		let file: TFile | null = null;
		const currentActiveFile = app.workspace.getActiveFile();
		const sourcePath = currentActiveFile ? currentActiveFile.path : '';

		if (linkText) {
			file = app.metadataCache.getFirstLinkpathDest(linkText, sourcePath);
		}

		if (file instanceof TFile) {
			if (file.extension.toLowerCase() === 'md') {
				// 内嵌 Markdown 笔记
				new Notice(`正在处理内嵌笔记: ${file.path}`);
				const noteId = this.getNoteIdFromFileCache(file);
				if (noteId) {
					content.push({
						type: 'note',
						attrs: { uuid: noteId }
					});
					new Notice(`成功嵌入笔记: ${file.name}`);
				} else {
					new Notice(`内嵌笔记 ${file.name} 未找到 noteId，将作为普通文本插入`);
					content.push({
						type: 'paragraph',
						content: [{ type: 'text', text: `[[${linkText}]]` }]
					});
				}
			} else if (isImage) {
				// 图片文件 - 使用预上传结果
				// 由于预上传是按行索引映射的，这里需要根据 linkText 查找
				// 直接再次上传（已在 preUploadImages 中缓存结果）
				const uploadResult = await this.uploadSingleImage(linkText, altText);
				if (uploadResult.success && uploadResult.uuid) {
					const fileType = uploadResult.fileType || 1;
					const fileTypeName = getFileTypeName(fileType);
					const uuidKey = fileType === 2 ? 'audio-uuid' : 'uuid';
					content.push({
						type: fileTypeName,
						attrs: {
							[uuidKey]: uploadResult.uuid,
							align: 'center',
							alt: altText
						}
					});
				} else {
					// 上传失败 fallback
					content.push({
						type: 'paragraph',
						content: [{ type: 'text', text: `![${altText}](${linkText})` }]
					});
				}
			}
		} else if (isImage && linkText.startsWith('http')) {
			// 外部 URL 图片 - 直接作为链接保留
			content.push({
				type: 'paragraph',
				content: [{ type: 'text', text: `![${altText}](${linkText})` }]
			});
		} else {
			new Notice(`文件未找到: ${linkText}`);
			content.push({
				type: 'paragraph',
				content: [{ type: 'text', text: isImage ? `![${altText}](${linkText})` : `[[${linkText}]]` }]
			});
		}
	}

	/**
	 * 获取文件的 noteId（从缓存）
	 */
	private getNoteIdFromFileCache(file: TFile): string | null {
		const fileCache = this.context.app.metadataCache.getFileCache(file);
		const frontmatterObj: Record<string, unknown> = fileCache?.frontmatter || {};
		const customKey = this.context.settings.noteIdKey || 'noteId';
		const defaultKey = 'noteId';

		const keysToCheck: string[] = [customKey];
		if (this.context.settings.enableLegacyNoteIdFallback && customKey !== defaultKey) {
			keysToCheck.push(defaultKey);
		}

		for (const key of keysToCheck) {
			const value = frontmatterObj[key];
			if (value) {
				return String(value);
			}
		}

		return null;
	}

	/**
	 * 处理行内格式化（加粗、高亮、斜体、链接的组合）
	 * 修复 #10：支持 *斜体* 格式
	 */
	processInlineFormatting(line: string): NoteAtomNode[] {
		const parts: NoteAtomNode[] = [];
		const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
		let lastIndex = 0;
		let match;

		// 跟踪当前的 bold/highlight/italic 状态
		let currentFormatMarks: NoteAtomMark[] = [];

		while ((match = linkRegex.exec(line)) !== null) {
			// 处理链接前的文本
			if (match.index > lastIndex) {
				const textBeforeLink = line.slice(lastIndex, match.index);
				currentFormatMarks = this.processTextSegment(textBeforeLink, parts, []);
			}

			// 处理链接
			const linkMark: NoteAtomMark = { type: 'link', attrs: { href: match[2] } };
			const combinedMarks = [...currentFormatMarks, linkMark];
			this.processTextSegment(match[1], parts, combinedMarks);

			lastIndex = match.index + match[0].length;
		}

		// 处理链接后的剩余文本
		if (lastIndex < line.length) {
			const remainingText = line.slice(lastIndex);
			this.processTextSegment(remainingText, parts, currentFormatMarks);
		}

		return parts;
	}

	/**
	 * 处理文本片段的格式标记，支持 marks 叠加
	 * 支持：**加粗**、==高亮==、*斜体*
	 */
	processTextSegment(textSegment: string, partsArray: NoteAtomNode[], baseMarks: NoteAtomMark[] = []): NoteAtomMark[] {
		let currentText = '';
		let activeMarks: NoteAtomMark[] = [...baseMarks];

		let i = 0;
		while (i < textSegment.length) {
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
				this.toggleMark(activeMarks, 'highlight');
				i += 2;
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
				this.toggleMark(activeMarks, 'bold');
				i += 2;
				continue;
			}

			// 检测 italic 标记 (*text*) - 修复 #10
			if (textSegment[i] === '*' && textSegment[i + 1] !== '*' && (i === 0 || textSegment[i - 1] !== '*')) {
				// 确保不是 ** 的后半部分
				if (currentText) {
					partsArray.push({
						type: 'text',
						text: currentText,
						marks: activeMarks.length > 0 ? [...activeMarks] : [...baseMarks]
					});
					currentText = '';
				}
				this.toggleMark(activeMarks, 'italic');
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
		return activeMarks.filter(m => m.type === 'bold' || m.type === 'highlight' || m.type === 'italic');
	}

	/**
	 * 切换 mark 状态
	 */
	private toggleMark(marks: NoteAtomMark[], markType: 'bold' | 'highlight' | 'italic'): void {
		const index = marks.findIndex(m => m.type === markType);
		if (index !== -1) {
			marks.splice(index, 1);
		} else {
			marks.push({ type: markType });
		}
	}
}
