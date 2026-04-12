/**
 * Frontmatter 操作服务
 * 集中管理所有 frontmatter 相关的读写操作
 */

import { App, TFile, getFrontMatterInfo, parseYaml } from 'obsidian';
import { MowenPluginSettings } from '../settings';
import { PublishContextSettings } from '../types';

export class FrontmatterService {
	constructor(
		private app: App,
		private settings: MowenPluginSettings
	) {}

	/**
	 * 更新 settings 引用（不重建实例）
	 */
	updateSettings(settings: MowenPluginSettings): void {
		this.settings = settings;
	}

	/**
	 * 从文件缓存获取 noteId
	 */
	getNoteIdFromFileCache(file: TFile): string | null {
		const fileCache = this.app.metadataCache.getFileCache(file);
		const frontmatterObj: Record<string, unknown> = fileCache?.frontmatter || {};
		
		const keysToCheck = this.getNoteIdKeys();
		
		for (const key of keysToCheck) {
			const value = frontmatterObj[key];
			if (value) {
				return String(value);
			}
		}

		return null;
	}

	/**
	 * 从当前活动文件的缓存获取 noteId
	 */
	getNoteIdFromCache(): string | null {
		const frontmatterObj = this.getFrontmatterFromCache();
		const keysToCheck = this.getNoteIdKeys();
		
		for (const key of keysToCheck) {
			const value = frontmatterObj[key];
			if (value) {
				return String(value);
			}
		}

		return null;
	}

	/**
	 * 从 Markdown 内容中解析 noteId（用于选中文本场景）
	 */
	async getNoteIdFromContent(content: string): Promise<string | null> {
		const keysToCheck = this.getNoteIdKeys();

		const frontMatterInfo = getFrontMatterInfo(content);

		if (frontMatterInfo.exists) {
			try {
				const frontmatterObj = parseYaml(frontMatterInfo.frontmatter);

				if (frontmatterObj && typeof frontmatterObj === 'object') {
					for (const key of keysToCheck) {
						if (frontmatterObj[key]) {
							return frontmatterObj[key];
						}
					}
				}
			} catch (e) {
				console.error('解析 frontmatter 失败:', e);
				// 如果解析失败，回退到简单的正则匹配
				for (const key of keysToCheck) {
					const regex = new RegExp(`^${key}:\\s*(\\S+)`, 'm');
					const match = frontMatterInfo.frontmatter.match(regex);
					if (match) return match[1];
				}
			}
		}

		return null;
	}

	/**
	 * 将 noteId 和发布设置回写到 frontmatter
	 */
	async addNoteIdToFrontmatter(noteId: string, settings: PublishContextSettings): Promise<void> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return;

		const noteIdKey = this.settings.noteIdKey || 'noteId';

		await this.app.fileManager.processFrontMatter(activeFile, (fm) => {
			fm[noteIdKey] = noteId;

			if (settings) {
				if (settings.tags) {
					fm.mowenTags = settings.tags;
				}
				if (typeof settings.auto_publish !== 'undefined') {
					fm.mowenAutoPublish = settings.auto_publish;
				}
				if (settings.privacy) {
					fm.mowenPrivacyType = settings.privacy.type;
					if (settings.privacy.rule) {
						fm.mowenPrivacyNoShare = settings.privacy.rule.noShare;
						fm.mowenPrivacyExpireAt = settings.privacy.rule.expireAt;
					}
				}
			}
		});
	}

	/**
	 * 从 frontmatter 加载已保存的发布设置
	 */
	async getSettingsFromFrontmatter(): Promise<Partial<PublishContextSettings>> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return {};

		const fileCache = this.app.metadataCache.getFileCache(activeFile);
		const frontmatterObj: Record<string, unknown> = fileCache?.frontmatter || {};
		
		const loadedSettings: Partial<PublishContextSettings> = {};
		if (frontmatterObj.mowenTags) {
			loadedSettings.tags = String(frontmatterObj.mowenTags);
		}
		if (typeof frontmatterObj.mowenAutoPublish !== 'undefined') {
			loadedSettings.auto_publish = Boolean(frontmatterObj.mowenAutoPublish);
		}
		if (frontmatterObj.mowenPrivacyType) {
			loadedSettings.privacy = {
				type: String(frontmatterObj.mowenPrivacyType) as 'private' | 'public' | 'rule',
				rule: {
					noShare: Boolean(frontmatterObj.mowenPrivacyNoShare),
					expireAt: Number(frontmatterObj.mowenPrivacyExpireAt) || 0,
				}
			};
		}
		return loadedSettings;
	}

	/**
	 * 从文件获取标题
	 */
	async getTitleFromFile(file: TFile): Promise<string> {
		const titleKey = this.settings.titleKey;
		if (!titleKey) {
			return file.basename;
		}

		const fileCache = this.app.metadataCache.getFileCache(file);
		const frontmatterObj: Record<string, unknown> = fileCache?.frontmatter || {};
		
		if (frontmatterObj[titleKey]) {
			return String(frontmatterObj[titleKey]);
		}

		return file.basename;
	}

	/**
	 * 获取当前活动文件的 frontmatter 对象
	 */
	getFrontmatterFromCache(): Record<string, unknown> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return {};

		const fileCache = this.app.metadataCache.getFileCache(activeFile);
		return fileCache?.frontmatter || {};
	}

	/**
	 * 获取需要检查的 noteId 键名列表
	 */
	private getNoteIdKeys(): string[] {
		const customKey = this.settings.noteIdKey || 'noteId';
		const defaultKey = 'noteId';

		const keysToCheck: string[] = [customKey];
		if (this.settings.enableLegacyNoteIdFallback && customKey !== defaultKey) {
			keysToCheck.push(defaultKey);
		}

		return keysToCheck;
	}
}
