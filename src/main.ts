/**
 * 墨问 Obsidian 插件 - 主入口
 * 
 * 重构项：
 * - #1: 拆分为独立模块（Modal、Converter、FrontmatterService）
 * - #2: 消除重复发布逻辑，提取通用方法
 * - #13: 修复 settings.tags 污染问题
 * - #25: 命令面板条目中文化
 * - #27: 添加 onunload 生命周期
 * - #28: 图片上传失败 fallback 格式修正
 * - #29: TagService.mergeTags 参数简化
 * - #30: 发布中禁用插件时清理逻辑
 */

import { App, Editor, MarkdownView, Notice, Plugin, Menu, TFile } from 'obsidian';
import { MowenSettingTab, DEFAULT_SETTINGS, MowenPluginSettings } from "./settings";
import { publishNoteToMowen, markdownTagsToNoteAtomTags } from "./api";
import { generateNoteMetadata } from "./ai";
import { TagService } from "./services/TagService";
import { FrontmatterService } from "./services/FrontmatterService";
import { MarkdownConverter } from "./converter/MarkdownConverter";
import { HandlerRegistry } from "./converter/handlers/registry";
import { MowenPublishModal } from "./modals/MowenPublishModal";
import { PublishContextSettings, ModalSubmitParams } from "./types";

/** 发布请求参数 */
interface PublishOptions {
	title: string;
	content: string;
	tags: string;
	autoPublish: boolean;
	settings: PublishContextSettings;
	writeNoteIdToFrontmatter: boolean;
	summary: string | null;
	isSelection: boolean;
}

export default class MowenPlugin extends Plugin {
	settings!: MowenPluginSettings;
	private frontmatterService!: FrontmatterService;
	private markdownConverter!: MarkdownConverter;

	/** 公开的 Handler 注册表，供第三方插件扩展 */
	public get handlerRegistry(): HandlerRegistry {
		return this.markdownConverter.getRegistry();
	}

	async onload() {
		await this.loadSettings();

		// 初始化服务
		this.frontmatterService = new FrontmatterService(this.app, this.settings);
		this.markdownConverter = new MarkdownConverter({ app: this.app, settings: this.settings });

		// 右键菜单：选中文本发布到墨问
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor, _view: MarkdownView) => {
				const selectedText = editor.getSelection();
				if (selectedText && selectedText.length > 0) {
					menu.addItem((item) => {
						item
							.setTitle('发布选中文本到墨问')
							.setIcon('upload')
							.onClick(async () => {
								await this.handlePublishRequest(selectedText, '', false, true);
							});
					});
				}
			})
		);

		// 文件菜单：整篇发布到墨问
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (file instanceof TFile && file.extension === 'md') {
					menu.addItem((item) => {
						item
							.setTitle('发布到墨问')
							.setIcon('upload')
							.onClick(async () => {
								const content = await this.app.vault.read(file);
								const title = await this.frontmatterService.getTitleFromFile(file);
								await this.handlePublishRequest(content, title, true, false);
							});
					});
				}
			})
		);

		// 命令面板：整篇发布到墨问
		this.addCommand({
			id: 'publish-current-file-to-mowen',
			name: '发布当前文件到墨问',
			checkCallback: (checking: boolean) => {
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView && markdownView.file) {
					if (!checking) {
						const file = markdownView.file;
						const content = markdownView.editor.getValue();
						this.frontmatterService.getTitleFromFile(file).then(title => {
							this.handlePublishRequest(content, title, true, false);
						});
					}
					return true;
				}
				return false;
			}
		});

		// 命令面板：选中内容发布到墨问
		this.addCommand({
			id: 'publish-current-selected-text-to-mowen',
			name: '发布选中文本到墨问',
			editorCheckCallback: (checking: boolean, editor: Editor, view: MarkdownView) => {
				const selection = editor.getSelection();
				if (view.file && selection && selection.trim().length > 0) {
					if (!checking) {
						const file = view.file;
						const content = selection;
						this.frontmatterService.getTitleFromFile(file).then(title => {
							this.handlePublishRequest(content, title, false, true);
						});
					}
					return true;
				}
				return false;
			}
		});

		// 设置页
		this.addSettingTab(new MowenSettingTab(this.app, this));
	}

	/**
	 * 修复 #27: 添加 onunload 生命周期
	 */
	onunload() {
		// 清理资源（当前没有需要清理的定时器或长连接）
		console.log('[Mowen] 插件已卸载');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()) as MowenPluginSettings;
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// 设置更新后刷新服务实例的 settings 引用（不重建实例，保留第三方 Handler 注册）
		this.frontmatterService.updateSettings(this.settings);
		this.markdownConverter.updateSettings(this.settings);
	}

	/**
	 * 统一发布入口 - 修复 #2: 消除重复的发布逻辑
	 * 所有发布入口（右键菜单、文件菜单、命令面板）都调用此方法
	 */
	private async handlePublishRequest(
		content: string,
		title: string,
		isWholeFile: boolean,
		isSelection: boolean
	): Promise<void> {
		if (this.settings.globalPublishEnabled) {
			// 全局发布模式：直接发布，不弹窗
			const tags = TagService.mergeTags(
				this.settings.globalPublishConfig.tags,
				this.settings.defaultTag,
				content
			);
			const autoPublish = this.settings.globalPublishConfig.autoPublish;
			const privacy = this.settings.globalPublishConfig.privacy;

			await this.publishToMowen({
				title,
				content,
				tags,
				autoPublish,
				settings: {
					section: 1,
					privacy
				},
				writeNoteIdToFrontmatter: isWholeFile,
				summary: null,
				isSelection
			});
		} else {
			// 弹窗模式
			new MowenPublishModal(
				this.app,
				content,
				title,
				{ settings: this.settings, getSettingsFromFrontmatter: () => this.frontmatterService.getSettingsFromFrontmatter() },
				async (params: ModalSubmitParams) => {
					await this.publishToMowen({
						title: params.title,
						content,
						tags: params.tags,
						autoPublish: params.autoPublish,
						settings: params.settings,
						writeNoteIdToFrontmatter: isWholeFile,
						summary: params.summary,
						isSelection
					});
				}
			).open();
		}
	}

	/**
	 * 核心发布方法
	 * 修复 #13: 不再直接修改传入的 settings 对象
	 */
	async publishToMowen(options: PublishOptions): Promise<void> {
		const { title, content, tags, autoPublish, settings, writeNoteIdToFrontmatter, summary, isSelection } = options;
		const apiKey = this.settings.apiKey;
		if (!apiKey) {
			new Notice('请先在设置中填写 API key');
			return;
		}

		const tagArr = tags.split(',').map(t => t.trim()).filter(Boolean);
		new Notice('正在发布到墨问...');

		// 对于选中文本发布，不传递 noteId
		let noteId: string | null;
		if (isSelection) {
			noteId = null;
		} else {
			noteId = await this.frontmatterService.getNoteIdFromContent(content);
		}

		// 使用 MarkdownConverter 转换内容
		const noteBody = await this.markdownConverter.convert(title, content, summary);

		// 按官方文档构建发布参数
		// 创建接口只需要 autoPublish + tags，隐私设置走独立的 /note/set
		const res = await publishNoteToMowen({
			noteId,
			apiKey,
			tags: tagArr,
			autoPublish,
			settings: {
				section: settings.section,
				privacy: settings.privacy
			},
			body: noteBody.content
		});

		if (res.success && res.data) {
			new Notice('发布成功！');
			if (writeNoteIdToFrontmatter) {
				const frontmatterSettings: PublishContextSettings = {
					section: settings.section,
					privacy: settings.privacy,
					tags: tags,
					auto_publish: autoPublish
				};
				await this.frontmatterService.addNoteIdToFrontmatter(
					res.data as string,
					frontmatterSettings
				);
			}
		} else {
			new Notice('发布失败：' + res.message);
		}
	}
}
