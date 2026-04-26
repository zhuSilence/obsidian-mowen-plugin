/**
 * InternalLinkHandler - 内部链接处理器
 * 
 * 处理 [[note]] 内部链接语法
 * 如果链接的是 Markdown 文件且有 noteId，转为墨问内嵌笔记
 * 否则保留为普通文本
 */

import { Notice, TFile } from 'obsidian';
import { BlockHandler, HandlerContext, HandlerResult } from './types';

export class InternalLinkHandler implements BlockHandler {
	readonly name = 'internal-link';

	canHandle(lines: string[], index: number, _ctx: HandlerContext): boolean {
		return !!lines[index].trim().match(/^\[\[(.+?)\]\]/);
	}

	async handle(lines: string[], index: number, ctx: HandlerContext): Promise<HandlerResult> {
		const trimmedLine = lines[index].trim();
		const internalLinkMatch = trimmedLine.match(/^\[\[(.+?)\]\]/);
		if (!internalLinkMatch) {
			return { nodes: [], linesConsumed: 1 };
		}

		const linkText = internalLinkMatch[1];
		let file: TFile | null = null;
		const currentActiveFile = ctx.app.workspace.getActiveFile();
		const sourcePath = currentActiveFile ? currentActiveFile.path : '';

		if (linkText) {
			file = ctx.app.metadataCache.getFirstLinkpathDest(linkText, sourcePath);
		}

		if (file instanceof TFile && file.extension.toLowerCase() === 'md') {
			// 内嵌 Markdown 笔记
			new Notice(`正在处理内嵌笔记: ${file.path}`);
			const noteId = this.getNoteIdFromFileCache(file, ctx);
			if (noteId) {
				return {
					nodes: [{ type: 'note', attrs: { uuid: noteId } }],
					linesConsumed: 1,
				};
			} else {
				new Notice(`内嵌笔记 ${file.name} 未找到 noteId，将作为普通文本插入`);
				return {
					nodes: [
						{
							type: 'paragraph',
							content: [{ type: 'text', text: `[[${linkText}]]` }]
						}
					],
					linesConsumed: 1,
				};
			}
		} else {
			new Notice(`文件未找到: ${linkText}`);
			return {
				nodes: [
					{
						type: 'paragraph',
						content: [{ type: 'text', text: `[[${linkText}]]` }]
					}
				],
				linesConsumed: 1,
			};
		}
	}

	/**
	 * 获取文件的 noteId（从缓存）
	 */
	private getNoteIdFromFileCache(file: TFile, ctx: HandlerContext): string | null {
		const fileCache = ctx.app.metadataCache.getFileCache(file);
		const frontmatterObj: Record<string, unknown> = fileCache?.frontmatter || {};
		const customKey = ctx.settings.noteIdKey || 'noteId';
		const defaultKey = 'noteId';

		const keysToCheck: string[] = [customKey];
		if (ctx.settings.enableLegacyNoteIdFallback && customKey !== defaultKey) {
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
}
