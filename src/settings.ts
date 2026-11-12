import { PluginSettingTab, Setting } from "obsidian";
import type SuperCsvEditorPlugin from "./main.ts";

export class SuperCsvSettingTab extends PluginSettingTab {
	constructor(private plugin: SuperCsvEditorPlugin) {
		super(plugin.app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Restart plugin")
			.setDesc(
				"Reloads the plugin without restarting Obsidian. Any unsaved edit is written to the vault first.",
			)
			.addButton((button) =>
				button
					.setButtonText("Restart plugin")
					.setDestructive()
					.onClick(async () => {
						button.setDisabled(true);
						await this.plugin.restartPlugin();
					}),
			);

		new Setting(containerEl).setName("Delimiter").setHeading();

		new Setting(containerEl)
			.setName("Preferred delimiter")
			.setDesc("Used when opening a file. Auto reads it from the file contents.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("auto", "Auto detect")
					.addOption(",", "Comma ( , )")
					.addOption(";", "Semicolon ( ; )")
					.addOption("\t", "Tab")
					.addOption("|", "Pipe ( | )")
					.setValue(this.plugin.settings.delimiter)
					.onChange(async (value) => {
						this.plugin.settings.delimiter = value;
						await this.plugin.saveData(this.plugin.settings);
					}),
			);

		new Setting(containerEl).setName("Embeds").setHeading();

		new Setting(containerEl)
			.setName("Show the add-row and add-column strips")
			.setDesc(
				"Inside a `![[file.csv]]` embed. Off keeps the note looking like a table. Rows and columns can still be added from the right-click menus.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.embedShowAddButtons)
					.onChange(async (value) => {
						this.plugin.settings.embedShowAddButtons = value;
						await this.plugin.saveData(this.plugin.settings);
						this.plugin.applyEmbedSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Show the rows/columns/delimiter readout")
			.setDesc("Inside embeds only. The standalone view always keeps it.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.embedShowStatusBar)
					.onChange(async (value) => {
						this.plugin.settings.embedShowStatusBar = value;
						await this.plugin.saveData(this.plugin.settings);
						this.plugin.applyEmbedSettings();
					}),
			);

		new Setting(containerEl).setName("Saving").setHeading();

		new Setting(containerEl)
			.setName("Save delay")
			.setDesc("How long to wait after the last edit before writing to the vault.")
			.addText((text) =>
				text
					.setPlaceholder("400")
					.setValue(String(this.plugin.settings.saveDelayMs))
					.onChange(async (value) => {
						const parsed = Number.parseInt(value, 10);
						if (Number.isFinite(parsed) && parsed >= 0) {
							this.plugin.settings.saveDelayMs = parsed;
							await this.plugin.saveData(this.plugin.settings);
						}
					}),
			);
	}
}
