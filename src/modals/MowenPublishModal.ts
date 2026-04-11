/**
 * 发布弹窗 Modal
 * 
 * 修复项：
 * - #1: 从 main.ts 拆分独立文件
 * - #24: 添加 mowen-publish-modal CSS class
 * - #26: 错误提示使用 CSS 变量替代硬编码颜色
 */

import { App, Modal, Notice, Setting, TextComponent } from 'obsidian';
import { MowenPluginSettings } from '../settings';
import { PublishContextSettings, ModalSubmitParams } from '../types';
import { markdownTagsToNoteAtomTags } from '../api';
import { generateNoteMetadata } from '../ai';
import { MarkdownConverter } from '../converter/MarkdownConverter';

class MowenPublishModal extends Modal {
	content: string;
	title: string;
	tags: string;
	autoPublish: boolean;
	plugin: { settings: MowenPluginSettings; getSettingsFromFrontmatter: () => Promise<Partial<PublishContextSettings>> };
	initialLoadDone: boolean = false;
	section: number = 0;
	privacy: string = 'private';
	noShare: boolean = false;
	expireAt: number = 0;
	summary: string | null = null;

	// === UX优化：分离容器元素 ===
	private titleInput!: TextComponent;
	private tagsInput!: TextComponent;
	private aiButton!: HTMLButtonElement;
	private aiSettingEl!: HTMLElement;
	private autoPublishToggleEl!: HTMLElement;
	private contentPreviewEl!: HTMLElement;
	private privacySectionContainer!: HTMLElement;
	private publishButtonEl!: HTMLElement;
	private errorContainer!: HTMLElement;

	onSubmit: (params: ModalSubmitParams) => void;

	constructor(
		app: App,
		content: string,
		title: string,
		plugin: { settings: MowenPluginSettings; getSettingsFromFrontmatter: () => Promise<Partial<PublishContextSettings>> },
		onSubmit: (params: ModalSubmitParams) => void
	) {
		super(app);
		this.content = content;
		this.title = title;
		this.plugin = plugin;
		this.onSubmit = onSubmit;
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		// 修复 #24：添加 CSS class
		contentEl.addClass('mowen-publish-modal');

		contentEl.createEl('h2', { text: '发布到墨问' });

		// 首次打开时加载现有设置
		if (!this.initialLoadDone) {
			const loadedSettings = await this.plugin.getSettingsFromFrontmatter();
			this.tags = loadedSettings.tags
				? loadedSettings.tags
				: markdownTagsToNoteAtomTags(this.content, this.plugin.settings.defaultTag).tags.join(',');
			this.autoPublish = typeof loadedSettings.auto_publish !== 'undefined'
				? loadedSettings.auto_publish
				: this.plugin.settings.autoPublish;
			this.section = loadedSettings.privacy ? 1 : 0;
			if (loadedSettings.privacy) {
				this.privacy = loadedSettings.privacy.type;
				if (loadedSettings.privacy.rule) {
					this.noShare = loadedSettings.privacy.rule.noShare ?? false;
					this.expireAt = loadedSettings.privacy.rule.expireAt ?? 0;
				}
			}
			this.initialLoadDone = true;
		}

		this.renderLayout();
		this.updateContentPreview();
		this.renderPrivacySection();
	}

	// 工具方法：去除 YAML frontmatter
	private stripFrontmatter(content: string): string {
		const converter = new MarkdownConverter({ app: this.app, settings: this.plugin.settings });
		return converter.stripFrontmatter(content);
	}

	private renderLayout() {
		const { contentEl } = this;

		// 修复 #26：错误提示使用 CSS 变量
		this.errorContainer = contentEl.createDiv({ cls: 'mowen-error-container' });

		// 标题输入
		new Setting(contentEl)
			.setName('标题')
			.setDesc('发布到墨问后的笔记标题，会自动加粗（必填）')
			.addText((text) => {
				this.titleInput = text;
				text.setValue(this.title).onChange((value) => {
					this.title = value;
					this.validateForm();
				});
				text.inputEl.addEventListener('blur', () => this.validateForm());
			});

		// 标签输入
		new Setting(contentEl)
			.setName('标签')
			.setDesc('可选，英文逗号分隔，发布到墨问后的笔记标签')
			.addText((text) => {
				this.tagsInput = text;
				text.setValue(this.tags).onChange((value) => {
					this.tags = value;
					this.validateForm();
				});
			});

		// AI 功能按钮
		this.aiSettingEl = contentEl.createDiv();
		this.renderAiButton();

		// 自动发布开关
		new Setting(contentEl)
			.setName('自动发布')
			.setDesc('立即发布到墨问')
			.addToggle(toggle => {
				this.autoPublishToggleEl = toggle.toggleEl;
				toggle.setValue(this.autoPublish).onChange(value => {
					this.autoPublish = value;
				});
			});

		// 内容预览
		this.contentPreviewEl = contentEl.createDiv();
		this.updateContentPreview();

		// 隐私设置
		new Setting(contentEl)
			.setName('隐私设置')
			.setDesc('设置笔记隐私')
			.addToggle(toggle => {
				toggle.setValue(this.section === 1).onChange(value => {
					this.section = value ? 1 : 0;
					this.renderPrivacySection();
				});
			});
		this.privacySectionContainer = contentEl.createDiv();

		// 发布按钮
		this.publishButtonEl = contentEl.createDiv();
		this.renderPublishButton();

		this.validateForm();
	}

	private renderAiButton(isGenerating: boolean = false) {
		this.aiSettingEl.empty();
		new Setting(this.aiSettingEl)
			.setName('AI 功能')
			.setDesc('使用AI为当前笔记生成标题和标签')
			.addButton(button => {
				this.aiButton = button.buttonEl;
				button
					.setButtonText(isGenerating ? '正在生成...' : '✨ AI 生成')
					.setDisabled(isGenerating);
				if (!isGenerating) {
					button.setCta();
				}
				button.onClick(async () => {
					await this.handleAiGenerate();
				});
			});
	}

	private async handleAiGenerate() {
		this.renderAiButton(true);
		new Notice('AI 正在生成内容，请稍候...');

		try {
			const cleanContent = this.stripFrontmatter(this.content);
			const result = await generateNoteMetadata(this.plugin.settings, cleanContent);

			if (result) {
				this.title = result.title;
				this.titleInput.setValue(this.title);

				const defaultTags = markdownTagsToNoteAtomTags(this.content, this.plugin.settings.defaultTag).tags;
				const aiTags = result.tags || [];
				const combinedTags = [...new Set([...defaultTags, ...aiTags])];
				this.tags = combinedTags.join(',');
				this.tagsInput.setValue(this.tags);

				if (result.summary) {
					this.summary = result.summary;
					new Notice('AI 生成成功，摘要已保存！');
				} else {
					this.summary = null;
					new Notice('AI 生成成功！');
				}

				this.updateContentPreview();
				this.validateForm();
			}
		} catch (error) {
			console.error('AI生成失败:', error);
			new Notice('AI 生成失败，请检查API配置');
		}

		this.renderAiButton(false);
	}

	private updateContentPreview() {
		this.contentPreviewEl.empty();
		let previewContent = this.stripFrontmatter(this.content);
		if (this.summary) {
			previewContent = `> ${this.summary}\n\n${previewContent}`;
		}
		const previewText = previewContent.length > 100 ? previewContent.slice(0, 100) + '...' : previewContent;
		new Setting(this.contentPreviewEl)
			.setName('内容')
			.setDesc(previewText);
	}

	private renderPrivacySection() {
		this.privacySectionContainer.empty();

		if (this.section === 1) {
			new Setting(this.privacySectionContainer)
				.setName('隐私类型')
				.setDesc('设置笔记的隐私类型')
				.addDropdown(drop => {
					drop.addOption('public', '公开');
					drop.addOption('private', '私有');
					drop.addOption('rule', '规则');
					drop.setValue(this.privacy);
					drop.onChange(value => {
						this.privacy = value;
						this.renderPrivacyRuleSection();
					});
				});

			this.renderPrivacyRuleSection();
		}
	}

	private renderPrivacyRuleSection() {
		const existingRuleContainer = this.privacySectionContainer.querySelector('.privacy-rule-container');
		if (existingRuleContainer) {
			existingRuleContainer.remove();
		}

		if (this.privacy === 'rule') {
			const ruleContainer = this.privacySectionContainer.createDiv({ cls: 'privacy-rule-container' });

			new Setting(ruleContainer)
				.setName('允许分享')
				.setDesc('是否允许分享')
				.addToggle(toggle => {
					toggle.setValue(this.noShare).onChange(value => {
						this.noShare = value;
					});
				});

			new Setting(ruleContainer)
				.setName('公开过期时间')
				.setDesc('到期后自动变为私有，选择日期和时间')
				.addText(text => {
					let defaultValue = '';
					if (this.expireAt) {
						const date = new Date(this.expireAt * 1000);
						defaultValue = date.toISOString().slice(0, 16);
					}
					text.inputEl.type = 'datetime-local';
					text.setValue(defaultValue);
					text.onChange((value) => {
						if (value) {
							this.expireAt = Math.floor(new Date(value).getTime() / 1000);
						} else {
							this.expireAt = 0;
						}
					});
				});
		}
	}

	private renderPublishButton() {
		this.publishButtonEl.empty();
		new Setting(this.publishButtonEl)
			.addButton((btn) =>
				btn
					.setButtonText('发布')
					.setCta()
					.onClick(() => {
						if (this.validateForm()) {
							this.onSubmit({
								title: this.title,
								tags: this.tags,
								autoPublish: this.autoPublish,
								settings: {
									section: this.section,
									privacy: {
										type: this.privacy as 'private' | 'public' | 'rule',
										...(this.privacy === 'rule' ? {
											rule: {
												noShare: this.noShare,
												expireAt: this.expireAt
											}
										} : {})
									}
								},
								summary: this.summary
							});
							this.close();
						}
					})
			);
	}

	private validateForm(): boolean {
		this.errorContainer.empty();
		const errors: string[] = [];

		if (!this.title || this.title.trim().length === 0) {
			errors.push('❌ 标题为必填项');
		}

		// 修复 #14：放宽标签验证，支持更多字符
		if (this.tags && this.tags.trim().length > 0) {
			const tagParts = this.tags.split(',').map(t => t.trim()).filter(Boolean);
			const invalidTags = tagParts.filter(t => !/^[\u4e00-\u9fa5a-zA-Z0-9_.\-\s]+$/.test(t));
			if (invalidTags.length > 0) {
				errors.push('❌ 标签格式错误：请使用英文逗号分隔，如：技术,AI,笔记');
			}
		}

		if (errors.length > 0) {
			errors.forEach(err => {
				this.errorContainer.createEl('div', { text: err });
			});
			return false;
		}

		return true;
	}
}

export { MowenPublishModal };
