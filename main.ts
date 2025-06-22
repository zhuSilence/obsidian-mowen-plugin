import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, Menu, TextComponent, Modal, TFile } from 'obsidian';
import { MowenSettingTab, DEFAULT_SETTINGS, MowenPluginSettings } from "./settings";
import { publishNoteToMowen, markdownTagsToNoteAtomTags, getUploadAuthorization, deliverFile, getFileType, getMimeType } from "./api";
import { generateNoteMetadata } from "./ai"; // 导入AI生成函数
import * as yaml from 'js-yaml';

// 发布弹窗 Modal
class MowenPublishModal extends Modal {
	content: string;
	title: string;
	tags: string;
	autoPublish: boolean;
	plugin: MowenPlugin; // 添加插件实例
	initialLoadDone: boolean = false; // 添加标志，控制是否已经初始化
	section: number = 0;
	privacy: 'public' | 'private' | 'rule' = 'public';
	noShare: boolean = false;
	expireAt: number = 0;
	summary: string | null = null; // 用于存储AI生成的摘要

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
			console.log('Loaded Settings:', loadedSettings);

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

		this.renderSettings(); // 渲染设置
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

	private renderSettings() {
		const { contentEl } = this;
		// 清除之前渲染的设置，以便重新渲染
		contentEl.empty();
		contentEl.createEl('h2', { text: '发布到墨问' });

		let titleInput: TextComponent;
		let tagInput: TextComponent;

		new Setting(contentEl)
			.setName('标题')
			.setDesc('发布到墨问后的笔记标题，会自动加粗')
			.addText((text) => {
				titleInput = text;
				text.setValue(this.title).onChange((value) => {
					this.title = value;
				});
			});

		new Setting(contentEl)
			.setName('标签')
			.setDesc('可选，英文逗号分隔，发布到墨问后的笔记标签，通过默认标签配置可以进行自定义')
			.addText((text) => {
				tagInput = text;
				text.setValue(this.tags).onChange((value) => {
					this.tags = value;
				});
			});

		new Setting(contentEl)
			.setName('AI 功能')
			.setDesc('使用AI为当前笔记生成标题和标签')
			.addButton(button => {
				button
					.setButtonText('✨ AI 生成')
					.setCta()
					.onClick(async () => {
						button.setButtonText('正在生成...').setDisabled(true);
						new Notice('AI 正在生成内容，请稍候...');

						try {
							const cleanContent = this.stripFrontmatter(this.content);
							const result = await generateNoteMetadata(this.plugin.settings, cleanContent);

							if (result) {
								this.title = result.title;
								const defaultTags = markdownTagsToNoteAtomTags(this.content, this.plugin.settings.defaultTag).tags;
								const aiTags = result.tags || [];
								const combinedTags = [...new Set([...defaultTags, ...aiTags])];
								this.tags = combinedTags.join(',');

								if (result.summary) {
									this.summary = result.summary;
									console.log('AI 生成的摘要:', this.summary);
									new Notice('AI 生成成功，摘要已保存！');
								} else {
									this.summary = null;
									new Notice('AI 生成成功！');
								}
								this.renderSettings();
							}
						} catch (error) {
							console.error(error);
							this.renderSettings(); // 即使失败也重绘，恢复按钮
						}
				});
			});

		new Setting(contentEl)
			.setName('自动发布')
			.setDesc('立即发布到墨问')
			.addToggle(toggle => {
				toggle.setValue(this.autoPublish).onChange(value => {
					this.autoPublish = value;
				});
			});

		new Setting(contentEl)
			.setName('内容')
			.setDesc(
				(() => {
					let previewContent = this.stripFrontmatter(this.content);
					if (this.summary) {
						previewContent = `> ${this.summary}\n\n${previewContent}`;
					}
					return previewContent.length > 100 ? previewContent.slice(0, 100) + '...' : previewContent;
				})()
			);

		new Setting(contentEl)
			.setName('隐私设置')
			.setDesc('设置笔记隐私')
			.addToggle(toggle => {
				toggle.setValue(this.section === 1).onChange(value => {
					this.section = value ? 1 : 0;
					this.renderSettings(); // 只重新渲染设置部分
				});
			});

		if (this.section === 1) {
			new Setting(contentEl)
				.setName('隐私类型')
				.setDesc('设置笔记的隐私类型')
				.addDropdown(drop => {
					drop.addOption('public', '公开');
					drop.addOption('private', '私有');
					drop.addOption('rule', '规则');					
					drop.setValue(this.privacy);
					drop.onChange(value => {
						this.privacy = value as 'public' | 'private' | 'rule';
						this.renderSettings(); // 只重新渲染设置部分
					});
				});
		}

		if (this.privacy === 'rule') {
			new Setting(contentEl)
				.setName('允许分享')
				.setDesc('是否允许分享')
				.addToggle(toggle => {
					toggle.setValue(this.noShare).onChange(value => {
						this.noShare = value;
					});
				});

			new Setting(contentEl)
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

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText('发布')
					.setCta()
					.onClick(() => {
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
					})
			);
	}
}

export default class MowenPlugin extends Plugin {
	settings: MowenPluginSettings;

	async onload() {
		await this.loadSettings();

		// 右键菜单：选中文本发布到墨问
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor, view: MarkdownView) => {
				const selectedText = editor.getSelection();
				if (selectedText && selectedText.length > 0) {
					menu.addItem((item) => {
						item
							.setTitle('Publish Selected Text to Mowen')
							.setIcon('upload')
							.onClick(() => {
								new MowenPublishModal(this.app, selectedText, '', this, async (title, tags, autoPublish, settings, summary) => {
									await this.publishToMowen(title, selectedText, tags, autoPublish, settings, false, summary);
								}).open();
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
							.setIcon('upload') // 你可以选择合适的图标
							.onClick(async () => {
								const content = await this.app.vault.read(file);
								const title = await this.getTitleFromFile(file);
								new MowenPublishModal(this.app, content, title, this, async (newTitle, tags, autoPublish, settings, summary) => {
									await this.publishToMowen(newTitle, content, tags, autoPublish, settings, true, summary);
								}).open();
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
				if (markdownView) {
					if (!checking) {
						const file = markdownView.file;
						if (!file) {
							new Notice('未找到当前笔记文件');
							return;
						}
						const content = markdownView.editor.getValue();
						this.getTitleFromFile(file).then(title => {
							new MowenPublishModal(this.app, content, title, this, async (newTitle, tags, autoPublish, settings, summary) => {
								await this.publishToMowen(newTitle, content, tags, autoPublish, settings, true, summary);
							}).open();
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
			name: 'Publish Selected Text to Mowen',
			checkCallback: (checking: boolean) => {
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					if (!checking) {
						const file = markdownView.file;
						if (!file) {
							new Notice('未找到当前笔记文件');
							return;
						}
						const content = markdownView.editor.getSelection();
						this.getTitleFromFile(file).then(title => {
							new MowenPublishModal(this.app, content, title, this, async (newTitle, tags, autoPublish, settings, summary) => {
								await this.publishToMowen(newTitle, content, tags, autoPublish, settings, false, summary);
							}).open();
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
		const lines = markdown.split('\n');
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
		let inFrontmatter = false;
		let inCode = false;

		for (let i = 0; i < lines.length; i++) {
			let line = lines[i].trim();

			// 处理 frontmatter
			if (line === '---') {
				inFrontmatter = !inFrontmatter;
				continue;
			}
			if (inFrontmatter) {
				continue;
			}
			if (line === '```') {
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

				// 如果 API 没找到（可能缓存没更新），做一个简单的后备查找
				if (!file) {
					const allFiles = this.app.vault.getFiles();
					// 查找 basename (无后缀) 或 name (有后缀)
					file = allFiles.find(f => f.basename === linkText || f.name === linkText) ?? null;
				}

				if (file instanceof TFile) {
					const fullPath = file.path;
					// 判断文件类型
					if (file.extension.toLowerCase() === 'md') {
						// 处理内嵌的 Markdown 文件
						new Notice(`正在处理内嵌笔记: ${fullPath}`);
						const fileContent = await this.app.vault.read(file);
						const noteId = await this.getNoteIdFromFrontmatter(fileContent);
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
						const authRes = await getUploadAuthorization(this.settings.apiKey, fileType);
						if (authRes.success && authRes.data.endpoint) {
							const uploadRes = await deliverFile(authRes.data.endpoint, authRes.data, fileBlob, fName);
							if (uploadRes.success && uploadRes.data) {
						content.push({
									type: 'image',
									attrs: {
										uuid: uploadRes.data.fileId,
										align: 'center',
										alt: fName
									}
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

			// 4. 处理普通文本（包括加粗和链接）
			if (line !== '') {
				const parts = [];
				const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
				let lastIndex = 0;
				let match;

				while ((match = linkRegex.exec(line)) !== null) {
					// 处理链接前的普通文本
					if (match.index > lastIndex) {
						const textBeforeLink = line.slice(lastIndex, match.index);
						this.processBoldText(textBeforeLink, parts);
					}
					// 处理链接
					parts.push({
						type: 'text',
						text: match[1],
						marks: [{ type: 'link', attrs: { href: match[2] } }]
					});
					lastIndex = match.index + match[0].length;
				}

				// 处理链接后的剩余文本
				if (lastIndex < line.length) {
					const remainingText = line.slice(lastIndex);
					this.processBoldText(remainingText, parts);
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

	// 辅助函数：处理加粗文本，被 markdownToNoteAtom 调用
	processBoldText(textSegment: string, partsArray: any[]) {
		let currentText = '';
		let inBold = false;
		for (let j = 0; j < textSegment.length; j++) {
			if (textSegment[j] === '*' && textSegment[j + 1] === '*') {
				if (currentText) {
					partsArray.push({
						type: 'text',
						text: currentText,
						marks: inBold ? [{ type: 'bold' }] : []
					});
					currentText = '';
				}
				inBold = !inBold;
				j++; // 跳过下一个 *
			} else {
				currentText += textSegment[j];
			}
		}
		if (currentText) {
			partsArray.push({
				type: 'text',
				text: currentText,
				marks: inBold ? [{ type: 'bold' }] : []
			});
		}
	}

	async publishToMowen(title: string, content: string, tags: string, autoPublish: boolean, settings: any, writeNoteIdToFrontmatter: boolean = true, summary: string | null = null) {
		const apiKey = this.settings.apiKey;
		if (!apiKey) {
			new Notice('请先在设置中填写 API-KEY');
			return;
		}
		const tagArr = tags.split(',').map(t => t.trim()).filter(Boolean);
		new Notice('正在发布到墨问...');
		
		const noteId = await this.getNoteIdFromFrontmatter(content);

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
		const fileContent = await this.app.vault.read(activeFile);

		// 检查是否已有 frontmatter
		let newContent: string;
		let frontmatterMatch = fileContent.match(/(^---[\s\S]*?---)/);
		let currentFrontmatter = '';
		let contentWithoutFrontmatter = fileContent;

		if (frontmatterMatch) {
			currentFrontmatter = frontmatterMatch[1];
			contentWithoutFrontmatter = fileContent.substring(frontmatterMatch[0].length);
		}

		let frontmatterObj: any = {};
		if (currentFrontmatter) {
			// 移除 '---' 边界，解析 YAML
			const yamlContent = currentFrontmatter.replace(/^---\n|\n---$/g, '');
			try {
				frontmatterObj = yaml.load(yamlContent) || {};
			} catch (e) {
				console.error('解析现有 frontmatter 失败:', e);
				// 如果解析失败，则按原样保留现有 frontmatter，只添加 noteId 和新设置
				frontmatterObj = {};
			}
		}

		// 更新或添加 noteId，使用用户自定义的键名
		const noteIdKey = this.settings.noteIdKey || 'noteId';
		frontmatterObj[noteIdKey] = noteId;

		// 更新或添加其他设置
		if (settings) {
			console.log('更新或添加其他设置:', settings);
			if (settings.tags) {
				frontmatterObj.mowenTags = settings.tags; // 使用单独的字段避免与 Obsidian 自身标签冲突
			}
			if (typeof settings.auto_publish !== 'undefined') {
				frontmatterObj.mowenAutoPublish = settings.auto_publish;
			}
			if (settings.privacy) {
				frontmatterObj.mowenPrivacyType = settings.privacy.type;
				if (settings.privacy.rule) {
					frontmatterObj.mowenPrivacyNoShare = settings.privacy.rule.noShare;
					frontmatterObj.mowenPrivacyExpireAt = settings.privacy.rule.expireAt;
				}
			}
		}

		// 重新序列化为 YAML 字符串
		const updatedYaml = yaml.dump(frontmatterObj);
		newContent = `---\n${updatedYaml}---\n${contentWithoutFrontmatter.trim()}`;

		await this.app.vault.modify(activeFile, newContent);
	}

	async getSettingsFromFrontmatter(): Promise<any> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return {};
		const fileContent = await this.app.vault.read(activeFile);

		let frontmatterMatch = fileContent.match(/(^---[\s\S]*?---)/);
		let frontmatterObj: any = {};

		if (frontmatterMatch) {
			const yamlContent = frontmatterMatch[1].replace(/^---\n|\n---$/g, '');
			try {
				frontmatterObj = yaml.load(yamlContent) || {};
			} catch (e) {
				console.error('解析现有 frontmatter 失败:', e);
				return {};
			}
		}

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

		const frontmatterMatch = content.match(/(^---[\s\S]*?---)/);

		if (frontmatterMatch) {
			const yamlContent = frontmatterMatch[1].replace(/^---\n|\n---$/g, '');
			try {
				const frontmatterObj: any = yaml.load(yamlContent);
				if (frontmatterObj && typeof frontmatterObj === 'object') {
					for (const key of keysToCheck) {
						if (frontmatterObj[key]) {
							return frontmatterObj[key];
						}
					}
				}
			} catch (e) {
				console.error('解析 frontmatter 失败，回退到正则匹配:', e);
				// 如果YAML解析失败，在YAML块内尝试用简单的正则作为后备
				for (const key of keysToCheck) {
					const regex = new RegExp(`^${key}:\\s*(\\S+)`, 'm');
					const match = yamlContent.match(regex);
					if (match) return match[1];
				}
			}
		}
		
		// 如果没有 frontmatter 或解析失败，最后尝试一次全局正则匹配
		for (const key of keysToCheck) {
			const regex = new RegExp(`${key}:\\s*(\\S+)`);
			const match = content.match(regex);
			if (match) return match[1];
		}

		return null;
	}

	async getTitleFromFile(file: TFile): Promise<string> {
		const titleKey = this.settings.titleKey;
		if (!titleKey) {
			return file.basename;
		}

		const fileContent = await this.app.vault.read(file);
		const frontmatterMatch = fileContent.match(/(^---[\s\S]*?---)/);

		if (frontmatterMatch) {
			const yamlContent = frontmatterMatch[1].replace(/^---\n|\n---$/g, '');
			try {
				const frontmatterObj: any = yaml.load(yamlContent);
				if (frontmatterObj && typeof frontmatterObj === 'object' && frontmatterObj[titleKey]) {
					return frontmatterObj[titleKey];
				}
			} catch (e) {
				console.error(`解析 frontmatter 失败 (${file.path}):`, e);
			}
		}

		// 如果没有找到key或者解析失败，回退到文件名
		return file.basename;
	}
}
