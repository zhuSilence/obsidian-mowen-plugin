import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, Menu, TextComponent, Modal } from 'obsidian';
import { MowenSettingTab, DEFAULT_SETTINGS, MowenPluginSettings } from "./settings";
import { publishNoteToMowen, markdownToNoteAtom, markdownTagsToNoteAtomTags } from "./api";

// 发布弹窗 Modal
class MowenPublishModal extends Modal {
	content: string;
	title: string;
	tags: string;
	autoPublish: boolean;
	section: number = 0;
	privacy: 'public' | 'private' | 'rule' = 'public';
	noShare: boolean = false;
	expireAt: number = 0;

	onSubmit: (title: string, tags: string, autoPublish: boolean, settings: any) => void;

	constructor(app: App, content: string, title: string, tags: string, autoPublish: boolean, onSubmit: (title: string, tags: string, autoPublish: boolean, settings: any) => void) {
		const newTags = markdownTagsToNoteAtomTags(content);
		super(app);
		this.content = content;
		this.title = title;
		this.tags = newTags.tags.join(',');
		this.autoPublish = autoPublish;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: '发布到墨问' });

		let titleInput: TextComponent;
		let tagInput: TextComponent;

		new Setting(contentEl)
			.setName('标题')
			.addText((text) => {
				titleInput = text;
				text.setValue(this.title).onChange((value) => {
					this.title = value;
				});
			});

		new Setting(contentEl)
			.setName('标签（可选，逗号分隔）')
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
					this.onClose();
					this.onOpen();
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
						this.onClose();
						this.onOpen();
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
								new MowenPublishModal(this.app, selectedText, '', '', this.settings.autoPublish, async (title, tags, autoPublish, settings) => {
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
						new MowenPublishModal(this.app, content, title, '', this.settings.autoPublish, async (newTitle, tags, autoPublish, settings) => {
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

	async publishToMowen(title: string, content: string, tags: string, autoPublish: boolean, settings: any) {
		const apiKey = this.settings.apiKey;
		if (!apiKey) {
			new Notice('请先在设置中填写 API-KEY');
			return;
		}
		const tagArr = tags.split(',').map(t => t.trim()).filter(Boolean);
		new Notice('正在发布到墨问...');
		const noteId = await this.getNoteIdFromFrontmatter();
		const res = await publishNoteToMowen({
			noteId,
			apiKey,
			title,
			content,
			tags: tagArr,
			autoPublish,
			settings
		});
		if (res.success) {
			new Notice('发布成功！');
			await this.addNoteIdToFrontmatter(res.data);
		} else {
			new Notice('发布失败：' + res.message);
		}
	}

	async addNoteIdToFrontmatter(noteId: string) {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return;
		const fileContent = await this.app.vault.read(activeFile);

		// 检查是否已有 frontmatter
		let newContent: string;
		if (fileContent.startsWith('---')) {
			// 替换或添加 noteId 字段
			newContent = fileContent.replace(
				/(^\---[\s\S]*?---)/,
				(match: string) => {
					console.log('匹配到 frontmatter:', match);
					if (/noteId:/.test(match)) {
						// 已有 noteId，替换
						console.log('替换现有 noteId');
						return match.replace(/noteId:.*$/, `noteId: ${noteId}`);
					} else {
						// 没有 noteId，添加
						console.log('添加新的 noteId');
						return match.replace(/---$/, `noteId: ${noteId}\n---`);
					}
				}
			);
		} else {
			// 没有 frontmatter，添加
			console.log('文件没有 frontmatter，创建新的 frontmatter');
			newContent = `---\nnoteId: ${noteId}\n---\n${fileContent}`;
		}

		console.log('新内容:', newContent);
		await this.app.vault.modify(activeFile, newContent);
	}

	/**
	 * 从 frontmatter 中获取 noteId，存在则更新笔记，不存在则创建笔记
	 * @returns {string | null}
	 */
	async getNoteIdFromFrontmatter(): Promise<string | null> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return null;
		const fileContent = await this.app.vault.read(activeFile);
		const match = fileContent.match(/noteId:\s*(\S+)/);
		return match ? match[1] : null;
	}
}
