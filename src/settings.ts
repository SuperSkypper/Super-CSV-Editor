import { PluginSettingTab, Setting, type SettingDefinitionItem } from "obsidian";
import type SuperCsvEditorPlugin from "./main.ts";
import type { SuperCsvSettings } from "./main.ts";
import { MIN_COLUMN_WIDTH } from "./ui/columns.ts";

export class SuperCsvSettingTab extends PluginSettingTab {
	constructor(private plugin: SuperCsvEditorPlugin) {
		super(plugin.app, plugin);
	}

	/**
	 * Declarative settings for Obsidian 1.13.0+ (enables global settings search).
	 * Older Obsidian versions ignore this method and fall back to `display()`.
	 */
	override getSettingDefinitions(): SettingDefinitionItem<keyof SuperCsvSettings>[] {
		return [
			{
				name: "Restart plugin",
				desc: "Reloads the plugin without restarting Obsidian. Any unsaved edit is written to the vault first.",
				render: (setting) => {
					setting.addButton((button) =>
						button
							.setButtonText("Restart plugin")
							.setClass("mod-warning")
							.onClick(async () => {
								button.setDisabled(true);
								await this.plugin.restartPlugin();
							}),
					);
				},
			},
			{
				type: "group",
				heading: "Delimiter",
				items: [
					{
						name: "Preferred delimiter",
						desc: "Used when opening a file. Auto reads it from the file contents.",
						control: {
							type: "dropdown",
							key: "delimiter",
							defaultValue: "auto",
							options: {
								auto: "Auto detect",
								",": "Comma ( , )",
								";": "Semicolon ( ; )",
								"\t": "Tab",
								"|": "Pipe ( | )",
							},
						},
					},
				],
			},
			{
				type: "group",
				heading: "Columns",
				items: [
					{
						name: "Auto-fit columns",
						desc: "Automatically size columns to fit their content, up to the maximum width limit. When off, columns use a fixed default width.",
						control: {
							type: "toggle",
							key: "autoFitColumns",
							defaultValue: true,
						},
					},
					{
						name: "Minimum column width",
						desc: "Minimum column width in pixels.",
						control: {
							type: "number",
							key: "minColumnWidth",
							defaultValue: MIN_COLUMN_WIDTH,
							placeholder: String(MIN_COLUMN_WIDTH),
							min: 0,
						},
					},
					{
						name: "Maximum column width",
						desc: "Maximum column width in pixels. Set to 0 for no limit.",
						control: {
							type: "number",
							key: "maxColumnWidth",
							defaultValue: 0,
							placeholder: "0",
							min: 0,
						},
					},
				],
			},
			{
				type: "group",
				heading: "Embeds",
				items: [
					{
						name: "Show the add-row and add-column strips",
						desc: "Inside a `![[file.csv]]` embed. Off keeps the note looking like a table. Rows and columns can still be added from the right-click menus.",
						control: {
							type: "toggle",
							key: "embedShowAddButtons",
							defaultValue: false,
						},
					},
					{
						name: "Show the rows/columns/delimiter readout",
						desc: "Inside embeds only. The standalone view always keeps it.",
						control: {
							type: "toggle",
							key: "embedShowStatusBar",
							defaultValue: false,
						},
					},
				],
			},
			{
				type: "group",
				heading: "Saving",
				items: [
					{
						name: "Save delay",
						desc: "How long to wait after the last edit before writing to the vault.",
						control: {
							type: "number",
							key: "saveDelayMs",
							defaultValue: 400,
							placeholder: "400",
							min: 0,
						},
					},
				],
			},
		];
	}

	override getControlValue(key: string): unknown {
		if (key in this.plugin.settings) {
			return this.plugin.settings[key as keyof SuperCsvSettings];
		}
		return undefined;
	}

	override async setControlValue(key: string, value: unknown): Promise<void> {
		switch (key as keyof SuperCsvSettings) {
			case "delimiter":
				if (typeof value === "string") {
					this.plugin.settings.delimiter = value;
					await this.plugin.saveData(this.plugin.settings);
				}
				break;
			case "autoFitColumns":
				if (typeof value === "boolean") {
					this.plugin.settings.autoFitColumns = value;
					await this.plugin.saveData(this.plugin.settings);
					this.plugin.applyColumnWidthSettings();
				}
				break;
			case "minColumnWidth":
				if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
					const parsed = Math.round(value);
					if (this.plugin.settings.minColumnWidth !== parsed) {
						this.plugin.settings.minColumnWidth = parsed;
						await this.plugin.saveData(this.plugin.settings);
						this.plugin.applyColumnWidthSettings();
					}
				}
				break;
			case "maxColumnWidth":
				if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
					const parsed = Math.round(value);
					if (this.plugin.settings.maxColumnWidth !== parsed) {
						this.plugin.settings.maxColumnWidth = parsed;
						await this.plugin.saveData(this.plugin.settings);
						this.plugin.applyColumnWidthSettings();
					}
				}
				break;
			case "embedShowAddButtons":
				if (typeof value === "boolean") {
					this.plugin.settings.embedShowAddButtons = value;
					await this.plugin.saveData(this.plugin.settings);
					this.plugin.applyEmbedSettings();
				}
				break;
			case "embedShowStatusBar":
				if (typeof value === "boolean") {
					this.plugin.settings.embedShowStatusBar = value;
					await this.plugin.saveData(this.plugin.settings);
					this.plugin.applyEmbedSettings();
				}
				break;
			case "saveDelayMs":
				if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
					this.plugin.settings.saveDelayMs = Math.round(value);
					await this.plugin.saveData(this.plugin.settings);
				}
				break;
		}
	}

	/** Fallback for Obsidian versions older than 1.13.0. */
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
					.setClass("mod-warning")
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

		new Setting(containerEl).setName("Columns").setHeading();

		new Setting(containerEl)
			.setName("Auto-fit columns")
			.setDesc(
				"Automatically size columns to fit their content, up to the maximum width limit. When off, columns use a fixed default width.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoFitColumns)
					.onChange(async (value) => {
						this.plugin.settings.autoFitColumns = value;
						await this.plugin.saveData(this.plugin.settings);
						this.plugin.applyColumnWidthSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Minimum column width")
			.setDesc("Minimum column width in pixels. Applied when you finish editing.")
			.addText((text) => {
				text
					.setPlaceholder("48")
					.setValue(String(this.plugin.settings.minColumnWidth));
				const commit = async (): Promise<void> => {
					const trimmed = text.getValue().trim();
					const parsed = trimmed === "" ? 0 : Number.parseInt(trimmed, 10);
					if (Number.isFinite(parsed) && parsed >= 0) {
						if (this.plugin.settings.minColumnWidth !== parsed) {
							this.plugin.settings.minColumnWidth = parsed;
							await this.plugin.saveData(this.plugin.settings);
							this.plugin.applyColumnWidthSettings();
						}
						text.setValue(String(parsed));
					} else {
						text.setValue(String(this.plugin.settings.minColumnWidth));
					}
				};
				text.inputEl.addEventListener("blur", () => void commit());
				text.inputEl.addEventListener("keydown", (event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						void commit();
					}
				});
			});

		new Setting(containerEl)
			.setName("Maximum column width")
			.setDesc("Maximum column width in pixels. Set to 0 for no limit. Applied when you finish editing.")
			.addText((text) => {
				text
					.setPlaceholder("0")
					.setValue(String(this.plugin.settings.maxColumnWidth));
				const commit = async (): Promise<void> => {
					const trimmed = text.getValue().trim();
					const parsed = trimmed === "" ? 0 : Number.parseInt(trimmed, 10);
					if (Number.isFinite(parsed) && parsed >= 0) {
						if (this.plugin.settings.maxColumnWidth !== parsed) {
							this.plugin.settings.maxColumnWidth = parsed;
							await this.plugin.saveData(this.plugin.settings);
							this.plugin.applyColumnWidthSettings();
						}
						text.setValue(String(parsed));
					} else {
						text.setValue(String(this.plugin.settings.maxColumnWidth));
					}
				};
				text.inputEl.addEventListener("blur", () => void commit());
				text.inputEl.addEventListener("keydown", (event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						void commit();
					}
				});
			});

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
