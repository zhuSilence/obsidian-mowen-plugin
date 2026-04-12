/**
 * ImageEmbedHandler - 图片/内嵌链接处理器
 * 
 * 处理 ![[image.png]]、![alt](url)、[[note]] 三种语法
 * 包含图片上传、内嵌笔记、外部链接等逻辑
 */

import { App, Notice, TFile } from 'obsidian';
import { NoteAtomNode, getUploadAuthorization, deliverFile, getFileType, getFileTypeName, getMimeType } from '../../api';
import { BlockHandler, HandlerContext, HandlerResult, UploadCacheEntry } from './types';

export class ImageEmbedHandler implements BlockHandler {
	readonly name = 'image-embed';

	canHandle(lines: string[], index: number, _ctx: HandlerContext): boolean {
		const trimmedLine = lines[index].trim();
		// 支持 ![[image.png]], ![[image.png|300]], ![[image.png|描述]], ![alt](url)
		return !!(trimmedLine.match(/^!\[\[(.+?)\]\]/) || trimmedLine.match(/^!\[([^\]]*)\]\(([^)]+)\)/));
	}

	async handle(lines: string[], index: number, ctx: HandlerContext): Promise<HandlerResult> {
		const trimmedLine = lines[index].trim();
		const embedWikiMatch = trimmedLine.match(/^!\[\[(.+?)\]\]/);
		const embedStdMatch = trimmedLine.match(/^!\[([^\]]*)\]\(([^)]+)\)/);

		const nodes: NoteAtomNode[] = [];

		let linkText = '';
		let altText = '';
		let isImage = false;

		if (embedWikiMatch) {
			// 支持 ![[image.png|300]] 和 ![[image.png|描述]] 语法
			// Obsidian Wiki 链接中 | 后面是尺寸参数或描述文本
			const rawLink = embedWikiMatch[1];
			const pipeIndex = rawLink.indexOf('|');
			if (pipeIndex !== -1) {
				linkText = rawLink.slice(0, pipeIndex).trim();
				altText = rawLink.slice(pipeIndex + 1).trim();
			} else {
				linkText = rawLink;
				altText = linkText;
			}
			isImage = true;
		} else if (embedStdMatch) {
			linkText = embedStdMatch[2];
			altText = embedStdMatch[1] || linkText;
			isImage = true;
		}

		// 尝试解析为文件
		let file: TFile | null = null;
		const currentActiveFile = ctx.app.workspace.getActiveFile();
		const sourcePath = currentActiveFile ? currentActiveFile.path : '';

		if (linkText) {
			file = ctx.app.metadataCache.getFirstLinkpathDest(linkText, sourcePath);
		}

		if (file instanceof TFile) {
			if (isImage) {
				// 图片文件 - 检查缓存
				const cachedResult = ctx.uploadCache.get(linkText);
				if (cachedResult) {
					if (cachedResult.success && cachedResult.uuid) {
						const fileType = cachedResult.fileType || 1;
						const fileTypeName = getFileTypeName(fileType);
						const uuidKey = fileType === 2 ? 'audio-uuid' : 'uuid';
						nodes.push({
							type: fileTypeName,
							attrs: {
								[uuidKey]: cachedResult.uuid,
								align: 'center',
								alt: cachedResult.alt || altText
							}
						});
					} else {
						nodes.push({
							type: 'paragraph',
							content: [{ type: 'text', text: `![${altText}](${linkText})` }]
						});
					}
				} else {
					// 未缓存，执行上传
					const uploadResult = await this.uploadSingleImage(file, altText, ctx);
					ctx.uploadCache.set(linkText, {
						success: uploadResult.success,
						uuid: uploadResult.uuid,
						fileType: uploadResult.fileType,
						alt: altText,
					});
					if (uploadResult.success && uploadResult.uuid) {
						const fileType = uploadResult.fileType || 1;
						const fileTypeName = getFileTypeName(fileType);
						const uuidKey = fileType === 2 ? 'audio-uuid' : 'uuid';
						nodes.push({
							type: fileTypeName,
							attrs: {
								[uuidKey]: uploadResult.uuid,
								align: 'center',
								alt: altText
							}
						});
					} else {
						nodes.push({
							type: 'paragraph',
							content: [{ type: 'text', text: `![${altText}](${linkText})` }]
						});
					}
				}
			}
		} else if (isImage && linkText.startsWith('http')) {
			// 外部 URL 图片 - 直接作为链接保留
			nodes.push({
				type: 'paragraph',
				content: [{ type: 'text', text: `![${altText}](${linkText})` }]
			});
		} else {
			new Notice(`文件未找到: ${linkText}`);
			nodes.push({
				type: 'paragraph',
				content: [{ type: 'text', text: `![${altText}](${linkText})` }]
			});
		}

		return {
			nodes,
			linesConsumed: 1,
		};
	}

	/**
	 * 上传单个图片/文件
	 */
	private async uploadSingleImage(
		file: TFile,
		altText: string,
		ctx: HandlerContext
	): Promise<{ success: boolean; uuid?: string; fileType?: number }> {
		const { settings } = ctx;

		// 判断文件类型
		if (file.extension.toLowerCase() === 'md') {
			return { success: false };
		}

		try {
			new Notice(`正在上传图片: ${file.path}`);
			const mimeType = getMimeType(file.extension);
			const fileBlob = new Blob([await ctx.app.vault.readBinary(file)], { type: mimeType });
			const fileType = getFileType(file.extension);
			const fName = file.name;

			const authRes = await getUploadAuthorization(settings.apiKey, fileType, { fileName: fName });
			if (authRes.success && authRes.data && authRes.data.endpoint) {
				const uploadRes = await deliverFile(authRes.data.endpoint, authRes.data as Record<string, string>, fileBlob, fName);
				if (uploadRes.success && uploadRes.data) {
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
}
