const { Plugin, PluginSettingTab, Setting } = require('obsidian');

const DEFAULT_SETTINGS = {
  schemaVersion: 3,
  glow: 0.78,
  sharpness: 'cut',
  scanlines: false,
  grid: true,
  animations: true,
  accentMode: 'cyan',
  hazardAccents: true,
  segmentedControls: true,
  panelHeaders: true,
  bloom: true
};

module.exports = class RickUIPlugin extends Plugin {
  async onload() {
    const saved = await this.loadData();
    this.settings = this.migrateSettings(saved || {});
    this.apply();
    this.addSettingTab(new RickUISettingTab(this.app, this));
  }

  migrateSettings(saved) {
    const next = Object.assign({}, DEFAULT_SETTINGS, saved);

    // 0.1/0.2 used a full-interface CRT emphasis. The supplied references show
    // holographic panels instead, so old installs migrate to local screen texture off.
    if (!saved.schemaVersion || saved.schemaVersion < 3) {
      next.scanlines = false;
      next.bloom = true;
      next.schemaVersion = 3;
    }
    return next;
  }

  onunload() {
    document.body.classList.remove(
      'rick-ui',
      'rick-ui-scanlines',
      'rick-ui-grid',
      'rick-ui-animate',
      'rick-ui-hazards',
      'rick-ui-segmented',
      'rick-ui-panel-headers',
      'rick-ui-bloom'
    );
    document.body.removeAttribute('data-rick-sharpness');
    document.body.removeAttribute('data-rick-accent');
    document.documentElement.style.removeProperty('--rick-glow-factor');
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.apply();
  }

  apply() {
    const body = document.body;
    body.classList.add('rick-ui');
    body.classList.toggle('rick-ui-scanlines', !!this.settings.scanlines);
    body.classList.toggle('rick-ui-grid', !!this.settings.grid);
    body.classList.toggle('rick-ui-animate', !!this.settings.animations);
    body.classList.toggle('rick-ui-hazards', !!this.settings.hazardAccents);
    body.classList.toggle('rick-ui-segmented', !!this.settings.segmentedControls);
    body.classList.toggle('rick-ui-panel-headers', !!this.settings.panelHeaders);
    body.classList.toggle('rick-ui-bloom', !!this.settings.bloom);
    body.dataset.rickSharpness = this.settings.sharpness;
    body.dataset.rickAccent = this.settings.accentMode;
    document.documentElement.style.setProperty('--rick-glow-factor', String(this.settings.glow));
  }
};

class RickUISettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Rick UI' });
    containerEl.createEl('p', {
      text: 'Оформление Obsidian по визуальному языку приборов Рика: световые экраны, многослойные рамки, аппаратные элементы и аварийные состояния.'
    });

    new Setting(containerEl)
      .setName('Цвет системы')
      .setDesc('Бирюзовый — основной лабораторный интерфейс; пурпурный — голографические панели; зелёный — терминальные экраны.')
      .addDropdown(dropdown => dropdown
        .addOption('cyan', 'Бирюзовый')
        .addOption('magenta', 'Пурпурный')
        .addOption('green', 'Зелёный')
        .setValue(this.plugin.settings.accentMode)
        .onChange(async value => {
          this.plugin.settings.accentMode = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Сила свечения')
      .setDesc('Интенсивность внешнего свечения рамок и активных элементов.')
      .addSlider(slider => slider
        .setLimits(0, 1.25, 0.05)
        .setValue(this.plugin.settings.glow)
        .setDynamicTooltip()
        .onChange(async value => {
          this.plugin.settings.glow = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Форма элементов')
      .setDesc('Срезанные углы используются на крупных и карточных экранах в примерах.')
      .addDropdown(dropdown => dropdown
        .addOption('cut', 'Срезанные углы')
        .addOption('square', 'Прямые углы')
        .addOption('soft', 'Небольшое скругление')
        .setValue(this.plugin.settings.sharpness)
        .onChange(async value => {
          this.plugin.settings.sharpness = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Световая дымка')
      .setDesc('Добавляет мягкую полосу преломления внутри крупных световых экранов.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.bloom)
        .onChange(async value => {
          this.plugin.settings.bloom = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Аварийные элементы')
      .setDesc('Красные капсулы и янтарные метки для опасных и подтверждающих действий.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.hazardAccents)
        .onChange(async value => {
          this.plugin.settings.hazardAccents = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Сегментированные элементы')
      .setDesc('Добавляет деления на кнопках, вкладках и шкалах как на приборных панелях.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.segmentedControls)
        .onChange(async value => {
          this.plugin.settings.segmentedControls = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Приборные заголовки')
      .setDesc('Оформляет заголовки панелей отдельными световыми полосами.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.panelHeaders)
        .onChange(async value => {
          this.plugin.settings.panelHeaders = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Техническая сетка')
      .setDesc('Очень слабая сетка только на боковом оборудовании интерфейса; заметки не перекрывает.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.grid)
        .onChange(async value => {
          this.plugin.settings.grid = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Строки экрана')
      .setDesc('Локальная текстура только на всплывающих экранах. По умолчанию выключена, потому что на большинстве присланных интерфейсов её нет.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.scanlines)
        .onChange(async value => {
          this.plugin.settings.scanlines = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Анимации')
      .setDesc('Медленный импульс индикатора и редкий проход световой полосы по крупным экранам.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.animations)
        .onChange(async value => {
          this.plugin.settings.animations = value;
          await this.plugin.saveSettings();
        }));
  }
}
