import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, Menu, TextComponent, Modal, TFile } from 'obsidian';
import { MowenSettingTab, DEFAULT_SETTINGS, MowenPluginSettings } from "./settings";
import { publishNoteToMowen, markdownTagsToNoteAtomTags, getUploadAuthorization, deliverFile, getFileType, getMimeType } from "./api";
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

	onSubmit: (title: string, tags: string, autoPublish: boolean, settings: any) => void;

	constructor(app: App, content: string, title: string, plugin: MowenPlugin, onSubmit: (title: string, tags: string, autoPublish: boolean, settings: any) => void) {
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
			this.tags = loadedSettings.tags ? loadedSettings.tags : markdownTagsToNoteAtomTags(this.content).tags.join(',');
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
			.setDesc('可选，逗号分隔，发布到墨问后的笔记标签，会自动增加一个Obsidian标签')
			.addText((text) => {
				tagInput = text;
				text.setValue(this.tags).onChange((value) => {
					this.tags = value;
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
			.setDesc(this.content.length > 100 ? this.content.slice(0, 100) + '...' : this.content);

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
							}
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
							.setTitle('Publish to Mowen')
							.setIcon('upload')
							.onClick(() => {
								new MowenPublishModal(this.app, selectedText, '', this, async (title, tags, autoPublish, settings) => {
									await this.publishToMowen(title, selectedText, tags, autoPublish, settings);
								}).open();
							});
					});
				}
			})
		);

		// 文章菜单：整篇发布到墨问
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
						const title = file.basename;
						new MowenPublishModal(this.app, content, title, this, async (newTitle, tags, autoPublish, settings) => {
							await this.publishToMowen(newTitle, content, tags, autoPublish, settings);
						}).open();
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
	async markdownToNoteAtom(title: string, markdown: string): Promise<{ content: any[] }> {
		const lines = markdown.split('\n');
		const content = [];
		content.push({
			type: 'paragraph',
			content: [
				{ type: 'text', text: title, marks: [{ type: 'bold' }] }
			]
		});
		// title 后面增加一个空行
		content.push({ type: 'paragraph' }); // 引用后添加空行
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

			// 2. 图片
			const imgMatch = line.match(/^!\[\[(.+?)\]\]/);
			if (imgMatch) {
				const imageName = imgMatch[1]; // 获取到的只是文件名，例如 "file-20250612224955426.png"

				let imageFile: TFile | null = null;
				let fullImagePath = imageName; // 用于通知和日志，如果找不到完整路径就用文件名

				// 尝试获取当前活动的Markdown文件（即当前正在编辑的笔记）
				const currentMarkdownFile = this.app.workspace.getActiveFile();

				if (currentMarkdownFile) {
					// 策略1: 检查图片是否在当前笔记所在的文件夹
					const currentFolder = currentMarkdownFile.parent?.path;
					if (currentFolder) {
						const potentialPath = `${currentFolder}/${imageName}`;
						const file = this.app.vault.getAbstractFileByPath(potentialPath);
						if (file instanceof TFile) {
							imageFile = file;
							fullImagePath = potentialPath;
						}
					}
				}

				// 策略2: 如果策略1失败，尝试在整个vault中按文件名查找
				if (!imageFile) {
					const allFiles = this.app.vault.getFiles();
					for (const file of allFiles) {
						if (file.name === imageName) {
							imageFile = file;
							fullImagePath = file.path;
							break;
						}
					}
				}

				if (imageFile instanceof TFile) { // 确保 imageFile 确实是一个 TFile 实例
					new Notice(`正在上传图片: ${fullImagePath}`);
					const mimeType = getMimeType(imageFile.extension);
					const fileBlob = new Blob([await this.app.vault.readBinary(imageFile)], { type: mimeType });
					const fileName = imageFile.name; // 确保文件名正确
					// 将文件扩展转换成对应的整型，1-图片 2-音频 3-PDF
					const fileType = getFileType(imageFile.extension);
					const authRes = await getUploadAuthorization(this.settings.apiKey, fileType);
					if (authRes.success && authRes.data.endpoint) {
						// 确保 authRes.data 包含 $content-type，因为墨问的策略可能会检查这个表单字段
						const uploadRes = await deliverFile(authRes.data.endpoint, authRes.data, fileBlob, fileName);
						// console.log('uploadRes', uploadRes);
						if (uploadRes.success && uploadRes.data) {
							content.push({
								type: 'image',
								attrs: {
									// href: uploadRes.data.url,
									uuid: uploadRes.data.fileId,
									align: 'center', // 默认居中
									alt: fileName // 使用文件名作为 alt 文本
								}
							});
							new Notice(`图片上传成功: ${fileName}`);
						} else {
							new Notice(`图片上传失败: ${fileName} - ${uploadRes.message}`);
							// 上传失败，仍将图片路径作为文本插入
							content.push({
								type: 'paragraph',
								content: [{ type: 'text', text: `![[${imageName}]]` }]
							});
						}
					} else {
						new Notice(`获取图片上传授权失败: ${authRes.message}`);
						// 获取授权失败，仍将图片路径作为文本插入
						content.push({
							type: 'paragraph',
							content: [{ type: 'text', text: `![[${imageName}]]` }]
						});
					}
				} else {
					new Notice(`图片文件未找到或不是文件: ${imageName}. 检查路径: ${fullImagePath}`); // 优化通知
					// 文件未找到，仍将图片路径作为文本插入
					content.push({
						type: 'paragraph',
						content: [{ type: 'text', text: `![[${imageName}]]` }]
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
							text: '\n' + headingMatch[2] + '\n',
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

	async publishToMowen(title: string, content: string, tags: string, autoPublish: boolean, settings: any) {
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
		const noteBody = await this.markdownToNoteAtom(title, content);

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
				}
			},
			body: noteBody.content // 传递转换后的 NoteAtom 内容
		});

		if (res.success && res.data) {
			new Notice('发布成功！');
			await this.addNoteIdToFrontmatter(res.data, settings);
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

		// 更新或添加 noteId
		frontmatterObj.noteId = noteId;

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
		// const activeFile = this.app.workspace.getActiveFile();
		// if (!activeFile) return null;
		// const fileContent = await this.app.vault.read(activeFile);
		const match = content.match(/noteId:\s*(\S+)/);
		return match ? match[1] : null;
	}
}
