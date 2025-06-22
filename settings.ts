import { App, PluginSettingTab, Setting } from "obsidian";
import MowenPlugin from "./main";

// 定义 LLM 设置的接口
export interface LLMSettings {
  provider: 'deepseek'; // 未来可扩展为 'deepseek' | 'kimi' | 'openai'
  apiKey: string;
  model: string;
  generateSummary: boolean; // 添加生成摘要的开关
  tagsCount: number; // AI生成标签的数量
}

export interface MowenPluginSettings {
  apiKey: string;
  autoPublish: boolean;
  defaultTag: string;
  noteIdKey: string; // frontmatter 中存储 noteId 的键名
  llmSettings: LLMSettings; // 添加 LLM 设置
}

export const DEFAULT_SETTINGS: MowenPluginSettings = {
  apiKey: "",
  autoPublish: true,
  defaultTag: "Obsidian",
  noteIdKey: 'noteId', // 默认为 'noteId'
  llmSettings: {
    provider: 'deepseek',
    apiKey: '',
    model: 'deepseek-chat', // DeepSeek 默认模型
    generateSummary: false, // 默认不生成摘要
    tagsCount: 3 // 默认生成3个标签
  },
};

export class MowenSettingTab extends PluginSettingTab {
  plugin: MowenPlugin;

  constructor(app: App, plugin: MowenPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // 墨问发布设置
    containerEl.createEl('h2', { text: '墨问发布设置' });

    new Setting(containerEl)
      .setName('API-KEY')
      .setDesc('请输入你的墨问 API-KEY')
      .addText(text => text
        .setPlaceholder('Enter your API-KEY')
        .setValue(this.plugin.settings.apiKey)
        .onChange(async (value) => {
          this.plugin.settings.apiKey = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('笔记ID键名')
      .setDesc('用于在frontmatter中存储墨问笔记ID的键名，以避免与其他插件冲突，不建议频繁修改，建议保持不变。')
      .addText(text => text
        .setPlaceholder('例如: mowenId')
        .setValue(this.plugin.settings.noteIdKey)
        .onChange(async (value) => {
          this.plugin.settings.noteIdKey = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('默认标签')
      .setDesc('发布到墨问笔记中默认的标签，多个标签用英文逗号分隔')
      .addText(text => text
        .setValue(this.plugin.settings.defaultTag)
        .onChange(async (value) => {
          this.plugin.settings.defaultTag = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('自动发布')
      .setDesc('发布后是否自动发布到墨问，默认是发布到墨问笔记中，但不是发布状态')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoPublish)
        .onChange(async (value) => {
          this.plugin.settings.autoPublish = value;
          await this.plugin.saveSettings();
        }));

    // AI 功能设置
    containerEl.createEl('h2', { text: 'AI 功能设置' });

    new Setting(containerEl)
      .setName('AI 服务商')
      .setDesc('选择用于生成标题和标签的AI服务')
      .addDropdown(dropdown => {
        dropdown
          .addOption('deepseek', 'DeepSeek')
          //未来在这里添加更多选项
          .setValue(this.plugin.settings.llmSettings.provider)
          .onChange(async (value: 'deepseek') => {
            this.plugin.settings.llmSettings.provider = value;
            await this.plugin.saveSettings();
            this.display(); // 重新渲染以显示或隐藏相关设置
          });
      });

    new Setting(containerEl)
      .setName('API Key')
      .setDesc('请输入所选 AI 服务商的 API Key')
      .addText(text => text
        .setPlaceholder('在此输入 API Key')
        .setValue(this.plugin.settings.llmSettings.apiKey)
        .onChange(async (value) => {
          this.plugin.settings.llmSettings.apiKey = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('模型名称')
      .setDesc('指定要使用的模型，例如 deepseek-chat')
      .addText(text => text
        .setPlaceholder('例如 deepseek-chat')
        .setValue(this.plugin.settings.llmSettings.model)
        .onChange(async (value) => {
          this.plugin.settings.llmSettings.model = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('生成摘要')
      .setDesc('开启后，AI 将在生成标题和标签的同时生成内容摘要，摘要内容会随文章发布到墨问笔记中，在墨问笔记中会显示在笔记标题下方引用块中')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.llmSettings.generateSummary)
        .onChange(async (value) => {
          this.plugin.settings.llmSettings.generateSummary = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName('生成标签数量')
      .setDesc('指定 AI 生成标签的数量 (1-5)')
      .addDropdown(dropdown => {
        for (let i = 1; i <= 5; i++) {
          dropdown.addOption(String(i), String(i));
        }
        dropdown
          .setValue(String(this.plugin.settings.llmSettings.tagsCount))
          .onChange(async (value) => {
            this.plugin.settings.llmSettings.tagsCount = parseInt(value, 10);
            await this.plugin.saveSettings();
          });
      });
  }
}
