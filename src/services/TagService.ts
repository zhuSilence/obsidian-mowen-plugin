import { markdownTagsToNoteAtomTags } from '../api';

/**
 * 标签服务类
 * 提供标签合并等通用标签处理方法
 */
export class TagService {
	/**
	 * 合并全局标签、默认标签和笔记标签
	 * @param globalTagsStr - 全局标签字符串（逗号分隔）
	 * @param defaultTagsStr - 默认标签字符串（逗号分隔）
	 * @param content - 笔记内容（用于提取笔记标签）
	 * @param defaultTag - 默认标签（用于 markdownTagsToNoteAtomTags）
	 * @returns 合并后的标签字符串（逗号分隔）
	 */
	static mergeTags(
		globalTagsStr: string | undefined,
		defaultTagsStr: string | undefined,
		content: string,
		defaultTag: string
	): string {
		const globalTags = globalTagsStr
			? globalTagsStr.split(',').map((t) => t.trim()).filter(Boolean)
			: [];
		const defaultTags = defaultTagsStr
			? defaultTagsStr.split(',').map((t) => t.trim()).filter(Boolean)
			: [];
		const noteTags = markdownTagsToNoteAtomTags(content, defaultTag).tags || [];
		const tagsArr = Array.from(new Set([...defaultTags, ...globalTags, ...noteTags]));
		return tagsArr.join(',');
	}
}