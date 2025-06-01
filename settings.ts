import { App, PluginSettingTab, Setting } from "obsidian";
import MowenPlugin from "./main";

export interface MowenPluginSettings {
  apiKey: string;
  autoPublish: boolean;
}

export const DEFAULT_SETTINGS: MowenPluginSettings = {
  apiKey: "",
  autoPublish: false,
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
    containerEl.createEl("h2", { text: "Mowen API 设置" });

    new Setting(containerEl)
      .setName("API-KEY")
      .setDesc("你的墨问 API-KEY")
      .addText(text =>
        text
          .setPlaceholder("输入 API-KEY")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("自动发布")
      .setDesc("开启后，弹窗默认勾选自动发布")
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.autoPublish)
          .onChange(async (value) => {
            this.plugin.settings.autoPublish = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
