import { App, Editor, MarkdownView, Notice, Plugin, Setting, Menu, TextComponent, Modal, TFile, getFrontMatterInfo, parseYaml, stringifyYaml } from 'obsidian';
import { MowenSettingTab, DEFAULT_SETTINGS, MowenPluginSettings } from "./settings";
import { publishNoteToMowen, markdownTagsToNoteAtomTags, getUploadAuthorization, deliverFile, getFileType, getMimeType, getFileTypeName } from "./api";
import { generateNoteMetadata } from "./ai"; // 导入AI生成函数
import { TagService } from "./services/TagService";

// 发布弹窗 Modal - UX优化版：局部更新，避免全量重绘
class MowenPublishModal extends Modal {
	content: string;
	title: string;
	tags: string;
	autoPublish: boolean;
	plugin: MowenPlugin; // 添加插件实例
	initialLoadDone: boolean = false; // 添加标志，控制是否已经初始化
	section: number = 0;
	privacy: string = 'private';
	noShare: boolean = false;
	expireAt: number = 0;
	summary: string | null = null; // 用于存储AI生成的摘要

	// === UX优化：分离容器元素，避免全量重绘 ===
	private titleInput!: TextComponent;
	private tagsInput!: TextComponent;
	private aiButton!: HTMLButtonElement;
	private aiSettingEl!: HTMLElement;
	private autoPublishToggleEl!: HTMLElement;
	private contentPreviewEl!: HTMLElement;
	private privacySectionContainer!: HTMLElement;
	private publishButtonEl!: HTMLElement;
	private errorContainer!: HTMLElement; // 验证错误显示区域

	onSubmit: (title: string, tags: string, autoPublish: boolean, settings: any, summary: string | null) => void;

	constructor(app: App, content: string, title: string, plugin: MowenPlugin, onSubmit: (title: string, tags: string, autoPublish: boolean, settings: any, summary: string | null) => void) {
		super(app);
		this.content = content;
		this.title = title;
		this.plugin = plugin; // 保存插件实例
		this.onSubmit = onSubmit;
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: '发布到墨问' });

		// 只有在首次打开时才加载现有设置
		if (!this.initialLoadDone) {
			const loadedSettings = await this.plugin.getSettingsFromFrontmatter();
			// 使用加载的设置（如果存在）初始化模态框的状态
			this.tags = loadedSettings.tags ? loadedSettings.tags : markdownTagsToNoteAtomTags(this.content, this.plugin.settings.defaultTag).tags.join(',');
			this.autoPublish = typeof loadedSettings.autoPublish !== 'undefined' ? loadedSettings.autoPublish : this.plugin.settings.autoPublish;
			this.section = loadedSettings.privacy ? 1 : 0;
			if (loadedSettings.privacy) {
				this.privacy = loadedSettings.privacy.type;
				if (loadedSettings.privacy.rule) {
					this.noShare = loadedSettings.privacy.rule.noShare;
					this.expireAt = loadedSettings.privacy.rule.expireAt;
				}
			}
			this.initialLoadDone = true; // 标记为已完成初始加载
		}

		this.renderLayout(); // 渲染布局（只执行一次）
		this.updateContentPreview(); // 更新内容预览
		this.renderPrivacySection(); // 渲染隐私设置区域
	}

	// 工具方法：去除 YAML frontmatter
	private stripFrontmatter(content: string): string {
		if (content.startsWith('---')) {
			const end = content.indexOf('\n---', 3);
			if (end !== -1) {
				return content.slice(end + 4).trimStart();
			}
		}
		return content;
	}

	// === UX优化1：布局只渲染一次，后续只局部更新 ===
	private renderLayout() {
		const { contentEl } = this;

		// 错误提示区域（放在最上方）
		this.errorContainer = contentEl.createDiv({ cls: 'mowen-error-container' });
		this.errorContainer.style.color = '#e74c3c';
		this.errorContainer.style.marginBottom = '10px';

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

		// AI功能按钮 - 独立容器，方便只更新按钮状态
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

		// 内容预览 - 独立容器
		this.contentPreviewEl = contentEl.createDiv();
		this.updateContentPreview();

		// 隐私设置区域 - 独立容器
		new Setting(contentEl)
			.setName('隐私设置')
			.setDesc('设置笔记隐私')
			.addToggle(toggle => {
				toggle.setValue(this.section === 1).onChange(value => {
					this.section = value ? 1 : 0;
					this.renderPrivacySection(); // === UX优化3：只局部渲染隐私区域 ===
				});
			});
		this.privacySectionContainer = contentEl.createDiv();

		// 发布按钮 - 独立容器
		this.publishButtonEl = contentEl.createDiv();
		this.renderPublishButton();

		// 初始验证
		this.validateForm();
	}

	// === UX优化2：AI按钮独立渲染，生成时只更新按钮状态 ===
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
				// setCta() 不接受参数，根据条件调用
				if (!isGenerating) {
					button.setCta();
				}
				button.onClick(async () => {
					await this.handleAiGenerate();
				});
			});
	}

	// AI生成处理 - 只更新必要元素，不刷新整个弹窗
	private async handleAiGenerate() {
		// === UX优化：只更新按钮状态，不调用 renderSettings ===
		this.renderAiButton(true);
		new Notice('AI 正在生成内容，请稍候...');

		try {
			const cleanContent = this.stripFrontmatter(this.content);
			const result = await generateNoteMetadata(this.plugin.settings, cleanContent);

			if (result) {
				// 只更新输入框值，不重绘整个弹窗
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

				// 只更新内容预览
				this.updateContentPreview();

				// 验证表单
				this.validateForm();
			}
		} catch (error) {
			console.error('AI生成失败:', error);
			new Notice('AI 生成失败，请检查API配置');
		}

		// 无论成功失败，恢复按钮状态
		this.renderAiButton(false);
	}

	// 内容预览局部更新
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

	// === UX优化3：隐私设置局部渲染 ===
	private renderPrivacySection() {
		this.privacySectionContainer.empty();

		if (this.section === 1) {
			// 隐私类型下拉框
			new Setting(this.privacySectionContainer)
				.setName('隐私类型')
				.setDesc('设置笔记的隐私类型')
				.addDropdown(drop => {
					drop.addOption('private', '私有');
					drop.addOption('public', '公开');
					drop.addOption('rule', '规则');
					drop.setValue(this.privacy);
					drop.onChange(value => {
						this.privacy = value;
						this.renderPrivacyRuleSection(); // === 只局部渲染规则部分 ===
					});
				});

			// 规则设置容器
			this.renderPrivacyRuleSection();
		}
	}

	// 隐私规则部分局部渲染
	private renderPrivacyRuleSection() {
		// 移除旧的规则容器（如果存在）
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

	// 发布按钮渲染
	private renderPublishButton() {
		this.publishButtonEl.empty();
		new Setting(this.publishButtonEl)
			.addButton((btn) =>
				btn
					.setButtonText('发布')
					.setCta()
					.onClick(() => {
						if (this.validateForm()) {
							this.onSubmit(
								this.title,
								this.tags,
								this.autoPublish,
								{
									section: this.section,
									privacy: {
										type: this.privacy,
										rule: {
											noShare: this.privacy === 'rule' ? this.noShare : undefined,
											expireAt: this.privacy === 'rule' ? this.expireAt : undefined
										}
									}
								},
								this.summary // 传递摘要
							);
							this.close();
						}
					})
			);
	}

	// === UX优化4：表单验证 ===
	private validateForm(): boolean {
		this.errorContainer.empty();
		const errors: string[] = [];

		// 标题必填验证
		if (!this.title || this.title.trim().length === 0) {
			errors.push('❌ 标题为必填项');
		}

		// 标签格式验证（可选，但如果有内容必须符合格式）
		if (this.tags && this.tags.trim().length > 0) {
			// 验证标签是否用英文逗号分隔
			const tagPattern = /^[\u4e00-\u9fa5a-zA-Z0-9_-]+(,[\u4e00-\u9fa5a-zA-Z0-9_-]+)*$/;
			const cleanedTags = this.tags.trim();
			if (!tagPattern.test(cleanedTags) && !cleanedTags.split(',').every(t => t.trim().length > 0)) {
				errors.push('❌ 标签格式错误：请使用英文逗号分隔，如：技术,AI,笔记');
			}
		}

		// 显示错误
		if (errors.length > 0) {
			errors.forEach(err => {
				this.errorContainer.createEl('div', { text: err });
			});
			return false;
		}

		return true;
	}
}

export default class MowenPlugin extends Plugin {
	settings: MowenPluginSettings;

	async onload() {
		await this.loadSettings();

		// 右键菜单：选中文本发布到墨问
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor, _view: MarkdownView) => {
				const selectedText = editor.getSelection();
				if (selectedText && selectedText.length > 0) {
					menu.addItem((item) => {
						item
							.setTitle('Publish selected text to Mowen')
							.setIcon('upload')
							.onClick(async () => {
								if (this.settings.globalPublishEnabled) {
									// 合并全局标签、默认标签和笔记自身标签
									const tags = TagService.mergeTags(
										this.settings.globalPublishConfig.tags,
										this.settings.defaultTag,
										selectedText,
										this.settings.defaultTag
									);
									const autoPublish = this.settings.globalPublishConfig.autoPublish;
									const privacy = this.settings.globalPublishConfig.privacy;
									const section = 1;
									await this.publishToMowen(
										'',
										selectedText,
										tags,
										autoPublish,
										{
											section,
											privacy
										},
										false,
										null,
										true
									);
								} else {
									new MowenPublishModal(this.app, selectedText, '', this, async (title, tags, autoPublish, settings, summary) => {
										await this.publishToMowen(title, selectedText, tags, autoPublish, settings, false, summary, true);
									}).open();
								}
							});
					});
				}
			})
		);

		// 文章菜单：整篇发布到墨问
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (file instanceof TFile && file.extension === 'md') {
					menu.addItem((item) => {
						item
							.setTitle('Publish to Mowen')
							.setIcon('upload')
							.onClick(async () => {
								const content = await this.app.vault.read(file);
								const title = await this.getTitleFromFile(file);
								if (this.settings.globalPublishEnabled) {
									// 合并全局标签、默认标签和笔记自身标签
									const tags = TagService.mergeTags(
										this.settings.globalPublishConfig.tags,
										this.settings.defaultTag,
										content,
										this.settings.defaultTag
									);
									const autoPublish = this.settings.globalPublishConfig.autoPublish;
									const privacy = this.settings.globalPublishConfig.privacy;
									const section = 1;
									await this.publishToMowen(
										title,
										content,
										tags,
										autoPublish,
										{
											section,
											privacy
										},
										true,
										null,
										false
									);
								} else {
									new MowenPublishModal(this.app, content, title, this, async (newTitle, tags, autoPublish, settings, summary) => {
										await this.publishToMowen(newTitle, content, tags, autoPublish, settings, true, summary, false);
									}).open();
								}
							});
					});
				}
			})
		);

		// 命令面板：整篇发布到墨问
		this.addCommand({
			id: 'publish-current-file-to-mowen',
			name: 'Publish to Mowen',
			checkCallback: (checking: boolean) => {
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView && markdownView.file) {
					if (!checking) {
						const file = markdownView.file;
						const content = markdownView.editor.getValue();
						this.getTitleFromFile(file).then(title => {
							if (this.settings.globalPublishEnabled) {
								// 合并全局标签、默认标签和笔记自身标签
								const tags = TagService.mergeTags(
									this.settings.globalPublishConfig.tags,
									this.settings.defaultTag,
									content,
									this.settings.defaultTag
								);
								const autoPublish = this.settings.globalPublishConfig.autoPublish;
								const privacy = this.settings.globalPublishConfig.privacy;
								const section = 1;
								this.publishToMowen(
									title,
									content,
									tags,
									autoPublish,
									{
										section,
										privacy
									},
									true,
									null,
									false
								);
							} else {
								new MowenPublishModal(this.app, content, title, this, async (newTitle, tags, autoPublish, settings, summary) => {
									await this.publishToMowen(newTitle, content, tags, autoPublish, settings, true, summary, false);
								}).open();
							}
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
			name: 'Publish selected text to Mowen',
			editorCheckCallback: (checking: boolean, editor: Editor, view: MarkdownView) => {
				const selection = editor.getSelection();
				if (view.file && selection && selection.trim().length > 0) {
					if (!checking) {
						const file = view.file;
						const content = selection;
						this.getTitleFromFile(file).then(title => {
							if (this.settings.globalPublishEnabled) {
								// 合并全局标签、默认标签和笔记自身标签
								const tags = TagService.mergeTags(
									this.settings.globalPublishConfig.tags,
									this.settings.defaultTag,
									content,
									this.settings.defaultTag
								);
								const autoPublish = this.settings.globalPublishConfig.autoPublish;
								const privacy = this.settings.globalPublishConfig.privacy;
								const section = 1;
								this.publishToMowen(
									title,
									content,
									tags,
									autoPublish,
									{
										section,
										privacy
									},
									false,
									null,
									true
								);
							} else {
								new MowenPublishModal(this.app, content, title, this, async (newTitle, tags, autoPublish, settings, summary) => {
									await this.publishToMowen(newTitle, content, tags, autoPublish, settings, false, summary, true);
								}).open();
							}
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

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()) as MowenPluginSettings;
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/**
	 * 将 Markdown 文本转换为 NoteAtom 结构
	 * @param {string} markdown - Markdown 文本
	 * @param {string} title - 笔记标题
	 * @returns {Promise<{ content: any[] }>} NoteAtom 结构
	 */
	async markdownToNoteAtom(title: string, markdown: string, summary: string | null = null): Promise<{ content: any[] }> {
		// Skip frontmatter using Obsidian's getFrontMatterInfo
		let contentToProcess = markdown;
		const frontMatterInfo = getFrontMatterInfo(markdown);
		if (frontMatterInfo.exists) {
			// Remove frontmatter from content to process
			contentToProcess = markdown.slice(frontMatterInfo.contentStart);
		}

		const lines = contentToProcess.split('\n');
		const content = [];
		content.push({
			type: 'paragraph',
			content: [
				{ type: 'text', text: title, marks: [{ type: 'bold' }] }
			]
		});
		// title 后面增加一个空行
		content.push({ type: 'paragraph' });

		// 如果有摘要，将其作为引用块添加到标题下方
		if (summary) {
			content.push({
				type: 'quote',
				content: [{ type: 'text', text: summary }]
			});
			content.push({ type: 'paragraph' }); // 摘要后也添加空行
		}

		let inQuote = false;
		let quoteBuffer = [];
		let inCode = false;

		for (let i = 0; i < lines.length; i++) {
			let line = lines[i].trim();
			if (line.startsWith('```')) {
				inCode = !inCode;
				continue; // 跳过代码块的三个反引号行
			}
			if (inCode) {
				// 如果在代码块内，直接添加为普通文本
				content.push({
					type: 'paragraph',
					content: [{ type: 'text', text: line + '\n' }] // 代码块内保持单行
				});
				continue;
			}

			// 1. 引用块
			if (line.startsWith('>')) {
				inQuote = true;
				quoteBuffer.push(line.replace(/^>\s*/, '').trim()); // 移除 > 和可能的空格
				continue;
			}
			// 检查是否还在引用块内（或者引用块结束）
			if (inQuote && (line.startsWith('>') || line !== '')) {
				quoteBuffer.push(line.replace(/^>\s*/, '').trim());
				continue;
			}
			if (inQuote && !line.startsWith('>') && line === '') {
				// 结束引用
				content.push({
					type: 'quote',
					content: [
						{
							type: 'text',
							text: quoteBuffer.join('\n')
						}
					]
				});
				content.push({ type: 'paragraph' }); // 引用后添加空行
				quoteBuffer = [];
				inQuote = false;
			}

			// 2. 图片或内嵌笔记
			const embedMatch = line.match(/^!\[\[(.+?)\]\]/);
			const embedMatch2 = line.match(/^\[\[(.+?)\]\]/);
			if (embedMatch || embedMatch2) {
				let linkText = ""; // 获取链接文本，如 "My Note" 或 "images/photo.png"
				if (embedMatch) {
					linkText = embedMatch[1];
				} else if (embedMatch2) {
					linkText = embedMatch2[1];
				}

				let file: TFile | null = null;

				// 使用 Obsidian API 来解析链接，这是最可靠的方法
				const currentActiveFile = this.app.workspace.getActiveFile();
				const sourcePath = currentActiveFile ? currentActiveFile.path : '';
				if (linkText) {
					file = this.app.metadataCache.getFirstLinkpathDest(linkText, sourcePath);
				}

				if (file instanceof TFile) {
					const fullPath = file.path;
					// 判断文件类型
					if (file.extension.toLowerCase() === 'md') {
						// 处理内嵌的 Markdown 文件
						new Notice(`正在处理内嵌笔记: ${fullPath}`);
						const noteId = this.getNoteIdFromFileCache(file);
						if (noteId) {
							content.push({
								type: 'note',
								attrs: {
									uuid: noteId
								}
							});
							new Notice(`成功嵌入笔记: ${file.name}`);
						} else {
							new Notice(`内嵌笔记 ${file.name} 未找到 noteId，将作为普通文本插入`);
							content.push({
								type: 'paragraph',
								content: [{ type: 'text', text: `[[${linkText}]]` }]
							});
						}
					} else {
						// 处理图片文件（沿用现有逻辑）
						new Notice(`正在上传图片: ${fullPath}`);
						const mimeType = getMimeType(file.extension);
						const fileBlob = new Blob([await this.app.vault.readBinary(file)], { type: mimeType });
						const fName = file.name;
						const fileType = getFileType(file.extension);
						const fileTypeName = getFileTypeName(fileType);
						const authRes = await getUploadAuthorization(this.settings.apiKey, fileType);
						if (authRes.success && authRes.data && authRes.data.endpoint) {
							const uploadRes = await deliverFile(authRes.data.endpoint, authRes.data as Record<string, string>, fileBlob, fName);
							if (uploadRes.success && uploadRes.data) {
								let uuidKey = fileType == 2 ? 'audio-uuid' : 'uuid';
								let attr = {
									[uuidKey]: uploadRes.data.file?.fileId || '',
									align: 'center',
									alt: fName
								};
								content.push({
									type: fileTypeName,
									attrs: attr
								});
								new Notice(`图片上传成功: ${fName}`);
							} else {
								new Notice(`图片上传失败: ${fName} - ${uploadRes.message}`);
								content.push({ type: 'paragraph', content: [{ type: 'text', text: `![[${linkText}]]` }] });
							}
						} else {
							new Notice(`获取图片上传授权失败: ${authRes.message}`);
							content.push({ type: 'paragraph', content: [{ type: 'text', text: `![[${linkText}]]` }] });
						}
					}
				} else {
					new Notice(`文件未找到: ${linkText}`);
					content.push({
						type: 'paragraph',
						content: [{ type: 'text', text: `![[${linkText}]]` }]
					});
				}
				continue;
			}

			// 3. 标题
			const headingMatch = line.match(/^(#+)\s*(.+)$/);
			if (headingMatch) {
				content.push({
					type: 'paragraph',
					content: [
						{
							type: 'text',
							text: headingMatch[2],
							marks: [{ type: 'bold' }] // 标题默认加粗
						}
					]
				});
				continue;
			}

			// 4. 处理普通文本（包括加粗、高亮和链接的组合）
			if (line !== '') {
				const parts: { type: string; text: string; marks: any[] }[] = [];
				const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
				let lastIndex = 0;
				let match;
				
				// 跟踪当前的 bold/highlight 状态（用于链接叠加）
				let currentFormatMarks: any[] = [];

				while ((match = linkRegex.exec(line)) !== null) {
					// 处理链接前的文本（包括 ** 和 == 标记）
					if (match.index > lastIndex) {
						const textBeforeLink = line.slice(lastIndex, match.index);
						// processBoldText 会处理格式标记并返回结束时的状态
						currentFormatMarks = this.processBoldText(textBeforeLink, parts, []);
					}
					
					// 处理链接：叠加外层的 bold/highlight 状态
					const linkText = match[1];
					const linkHref = match[2];
					const linkMark = { type: 'link', attrs: { href: linkHref } };
					
					// 组合 marks：外层格式 + link
					const combinedMarks = [...currentFormatMarks, linkMark];
					
					// 处理链接文本内部可能的格式标记（如 [**链接**](url)）
					this.processBoldText(linkText, parts, combinedMarks);
					
					lastIndex = match.index + match[0].length;
				}

				// 处理链接后的剩余文本
				if (lastIndex < line.length) {
					const remainingText = line.slice(lastIndex);
					this.processBoldText(remainingText, parts, currentFormatMarks);
				}

				if (parts.length > 0) {
					content.push({
						type: 'paragraph',
						content: parts
					});
					content.push({ type: 'paragraph' }); // 添加段落换行
				}
			}
		}

		return { content: content };
	}

	/**
	 * 辅助函数：处理文本格式化标记，支持 marks 数组叠加
	 * @param textSegment - 文本片段
	 * @param partsArray - 输出的 NoteAtom parts 数组
	 * @param baseMarks - 基础 marks 数组（如 link），用于叠加 bold/highlight
	 * @returns 结束时的 marks 状态（用于传递给下一个处理）
	 * 
	 * 支持场景：
	 * - **普通加粗** → marks: [{ type: 'bold' }]
	 * - ==高亮文本== → marks: [{ type: 'highlight' }]
	 * - **==加粗高亮==** → marks: [{ type: 'bold' }, { type: 'highlight' }]
	 * - **[链接](url)** → marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'url' } }]
	 */
	processBoldText(textSegment: string, partsArray: any[], baseMarks: any[] = []): any[] {
		let currentText = '';
		// 当前激活的 marks，从 baseMarks 开始叠加
		let activeMarks: any[] = [...baseMarks];
		
		let i = 0;
		while (i < textSegment.length) {
			// 检测 highlight 标记 (==text==)
			if (textSegment[i] === '=' && textSegment[i + 1] === '=') {
				// 先推送已累积的文本
				if (currentText) {
					partsArray.push({
						type: 'text',
						text: currentText,
						marks: activeMarks.length > 0 ? [...activeMarks] : [...baseMarks]
					});
					currentText = '';
				}
				
				// 切换 highlight 状态
				const highlightIndex = activeMarks.findIndex(m => m.type === 'highlight');
				if (highlightIndex !== -1) {
					activeMarks.splice(highlightIndex, 1);
				} else {
					activeMarks.push({ type: 'highlight' });
				}
				
				i += 2; // 跳过 ==
				continue;
			}
			
			// 检测 bold 标记 (**)
			if (textSegment[i] === '*' && textSegment[i + 1] === '*') {
				// 先推送已累积的文本
				if (currentText) {
					partsArray.push({
						type: 'text',
						text: currentText,
						marks: activeMarks.length > 0 ? [...activeMarks] : [...baseMarks]
					});
					currentText = '';
				}
				
				// 切换 bold 状态
				const boldIndex = activeMarks.findIndex(m => m.type === 'bold');
				if (boldIndex !== -1) {
					activeMarks.splice(boldIndex, 1);
				} else {
					activeMarks.push({ type: 'bold' });
				}
				
				i += 2; // 跳过 **
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
		
		// 返回结束时的 marks 状态（用于传递给链接处理）
		return activeMarks.filter(m => m.type === 'bold' || m.type === 'highlight');
	}

	async publishToMowen(title: string, content: string, tags: string, autoPublish: boolean, settings: any, writeNoteIdToFrontmatter: boolean = true, summary: string | null = null, isSelection: boolean = false) {
		const apiKey = this.settings.apiKey;
		if (!apiKey) {
			new Notice('请先在设置中填写 API key');
			return;
		}
		const tagArr = tags.split(',').map(t => t.trim()).filter(Boolean);
		new Notice('正在发布到墨问...');

		// 对于选中文本发布，不传递 noteId，因为这是新笔记
		let noteId: string | null;
		if (isSelection) {
			noteId = null;
		} else {
			noteId = await this.getNoteIdFromFrontmatter(content);
		}

		settings.tags = tags;
		// 在这里调用移动后的 markdownToNoteAtom
		const noteBody = await this.markdownToNoteAtom(title, content, summary);

		const res = await publishNoteToMowen({
			noteId,
			apiKey,
			title, // 实际API可能不需要 title，body里已经有了
			content: '', // 内容通过 body 字段传递
			tags: tagArr,
			autoPublish,
			settings: {
				auto_publish: autoPublish, // 确保字段名正确
				tags: tagArr, // 确保字段名正确
				privacy: {
					type: settings.privacy.type,
					rule: settings.privacy.rule
				},
				section: settings.section
			},
			body: noteBody.content // 传递转换后的 NoteAtom 内容
		});

		if (res.success && res.data) {
			new Notice('发布成功！');
			if (writeNoteIdToFrontmatter) {
				await this.addNoteIdToFrontmatter(res.data, settings);
			}
		} else {
			new Notice('发布失败：' + res.message);
		}
	}

	async addNoteIdToFrontmatter(noteId: string, settings: any) {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return;

		// 更新或添加 noteId，使用用户自定义的键名
		const noteIdKey = this.settings.noteIdKey || 'noteId';

		// 使用 processFrontMatter 来修改 frontmatter
		await this.app.fileManager.processFrontMatter(activeFile, (fm) => {
			// 添加或更新 noteId
			fm[noteIdKey] = noteId;

			// 更新或添加其他设置
			if (settings) {
				if (settings.tags) {
					fm.mowenTags = settings.tags; // 使用单独的字段避免与 Obsidian 自身标签冲突
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
	 * Get note ID from file frontmatter using MetadataCache
	 */
	getNoteIdFromFileCache(file: TFile): string | null {
		const fileCache = this.app.metadataCache.getFileCache(file);
		const frontmatterObj = fileCache?.frontmatter || {};

		const customKey = this.settings.noteIdKey || 'noteId';
		const defaultKey = 'noteId';

		// 根据设置，决定要检查哪些key
		const keysToCheck: string[] = [customKey];
		if (this.settings.enableLegacyNoteIdFallback && customKey !== defaultKey) {
			keysToCheck.push(defaultKey);
		}

		for (const key of keysToCheck) {
			if (frontmatterObj[key]) {
				return frontmatterObj[key];
			}
		}

		return null;
	}

	/**
	 * Get note ID from frontmatter using MetadataCache (useful for selections)
	 */
	getNoteIdFromCache(): string | null {
		const frontmatterObj = this.getFrontmatterFromCache();

		const customKey = this.settings.noteIdKey || 'noteId';
		const defaultKey = 'noteId';

		// 根据设置，决定要检查哪些key
		const keysToCheck: string[] = [customKey];
		if (this.settings.enableLegacyNoteIdFallback && customKey !== defaultKey) {
			keysToCheck.push(defaultKey);
		}

		for (const key of keysToCheck) {
			if (frontmatterObj[key]) {
				return frontmatterObj[key];
			}
		}

		return null;
	}

	/**
	 * Get frontmatter from active file using MetadataCache (useful for selections)
	 */
	getFrontmatterFromCache(): any {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return {};

		const fileCache = this.app.metadataCache.getFileCache(activeFile);
		return fileCache?.frontmatter || {};
	}

	async getSettingsFromFrontmatter(): Promise<any> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return {};

		// 使用 MetadataCache 获取 frontmatter，避免从磁盘读取文件内容
		const fileCache = this.app.metadataCache.getFileCache(activeFile);
		const frontmatterObj = fileCache?.frontmatter || {};

		const loadedSettings: any = {};
		// 加载标签
		if (frontmatterObj.mowenTags) {
			loadedSettings.tags = frontmatterObj.mowenTags;
		}
		// 加载自动发布
		if (typeof frontmatterObj.mowenAutoPublish !== 'undefined') {
			loadedSettings.autoPublish = frontmatterObj.mowenAutoPublish;
		}
		// 加载隐私设置
		if (frontmatterObj.mowenPrivacyType) {
			loadedSettings.privacy = {
				type: frontmatterObj.mowenPrivacyType,
				rule: {
					noShare: frontmatterObj.mowenPrivacyNoShare || false,
					expireAt: frontmatterObj.mowenPrivacyExpireAt || 0,
				}
			};
		}
		return loadedSettings;
	}

	/**
	 * 从 frontmatter 中获取 noteId，存在则更新笔记，不存在则创建笔记
	 * @returns {string | null}
	 */
	async getNoteIdFromFrontmatter(content: string): Promise<string | null> {
		const customKey = this.settings.noteIdKey || 'noteId';
		const defaultKey = 'noteId';

		// 根据设置，决定要检查哪些key
		const keysToCheck: string[] = [customKey];
		if (this.settings.enableLegacyNoteIdFallback && customKey !== defaultKey) {
			keysToCheck.push(defaultKey);
		}

		// 使用 Obsidian 的 getFrontMatterInfo 获取 frontmatter 信息
		const frontMatterInfo = getFrontMatterInfo(content);

		if (frontMatterInfo.exists) {
			try {
				// 使用 parseYaml 解析 frontmatter
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

	async getTitleFromFile(file: TFile): Promise<string> {
		const titleKey = this.settings.titleKey;
		if (!titleKey) {
			return file.basename;
		}

		// 使用 MetadataCache 获取 frontmatter，避免从磁盘读取文件内容
		const fileCache = this.app.metadataCache.getFileCache(file);
		const frontmatterObj = fileCache?.frontmatter || {};

		if (frontmatterObj[titleKey]) {
			return frontmatterObj[titleKey];
		}

		// 如果没有找到key，回退到文件名
		return file.basename;
	}
}