/**
 * 标签服务类
 * 提供标签合并等通用标签处理方法
 * 
 * 修复 #29: 简化参数，移除重复的 defaultTag/defaultTagsStr 参数
 */

import { markdownTagsToNoteAtomTags } from '../api';

export class TagService {
	/**
	 * 合并全局标签、默认标签和笔记标签
	 * @param globalTagsStr - 全局标签字符串（逗号分隔）
	 * @param defaultTag - 默认标签（同时用于 markdownTagsToNoteAtomTags 和作为默认标签）
	 * @param content - 笔记内容（用于提取笔记标签）
	 * @returns 合并后的标签字符串（逗号分隔）
	 */
	static mergeTags(
		globalTagsStr: string | undefined,
		defaultTag: string | undefined,
		content: string
	): string {
		const globalTags = globalTagsStr
			? globalTagsStr.split(',').map((t) => t.trim()).filter(Boolean)
			: [];
		const defaultTags = defaultTag
			? defaultTag.split(',').map((t) => t.trim()).filter(Boolean)
			: [];
		const noteTags = markdownTagsToNoteAtomTags(content, defaultTag || 'Obsidian').tags || [];
		const tagsArr = Array.from(new Set([...defaultTags, ...globalTags, ...noteTags]));
		return tagsArr.join(',');
	}
}
