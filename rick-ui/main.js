const { Plugin, PluginSettingTab, Setting } = require('obsidian');

const DEFAULT_SETTINGS = {
  glow: 0.82,
  sharpness: 'cut',
  scanlines: true,
  grid: true,
  animations: true,
  accentMode: 'cyan',
  hazardAccents: true,
  segmentedControls: true,
  panelHeaders: true
};

module.exports = class RickUIPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.apply();
    this.addSettingTab(new RickUISettingTab(this.app, this));
  }

  onunload() {
    document.body.classList.remove(
      'rick-ui', 'rick-ui-scanlines', 'rick-ui-grid', 'rick-ui-animate',
      'rick-ui-hazards', 'rick-ui-segmented', 'rick-ui-panel-headers'
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
    const b = document.body;
    b.classList.add('rick-ui');
    b.classList.toggle('rick-ui-scanlines', !!this.settings.scanlines);
    b.classList.toggle('rick-ui-grid', !!this.settings.grid);
    b.classList.toggle('rick-ui-animate', !!this.settings.animations);
    b.classList.toggle('rick-ui-hazards', !!this.settings.hazardAccents);
    b.classList.toggle('rick-ui-segmented', !!this.settings.segmentedControls);
    b.classList.toggle('rick-ui-panel-headers', !!this.settings.panelHeaders);
    b.dataset.rickSharpness = this.settings.sharpness;
    b.dataset.rickAccent = this.settings.accentMode;
    document.documentElement.style.setProperty('--rick-glow-factor', String(this.settings.glow));
  }
};

class RickUISettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Rick UI' });
    containerEl.createEl('p', { text: 'Интерфейсный слой в стиле приборных систем Рика. Содержимое заметок не изменяется.' });

    new Setting(containerEl)
      .setName('Сила свечения')
      .setDesc('Интенсивность свечения рамок, индикаторов и активных элементов.')
      .addSlider(s => s.setLimits(0, 1.25, 0.05).setValue(this.plugin.settings.glow).setDynamicTooltip()
        .onChange(async v => { this.plugin.settings.glow = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Форма панелей')
      .setDesc('Срезанные углы ближе всего к экранным панелям из примеров.')
      .addDropdown(d => d.addOption('cut', 'Срезанные углы').addOption('square', 'Прямые углы').addOption('soft', 'Небольшое скругление')
        .setValue(this.plugin.settings.sharpness)
        .onChange(async v => { this.plugin.settings.sharpness = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Цвет активных элементов')
      .addDropdown(d => d.addOption('cyan', 'Бирюзовый').addOption('green', 'Портальный зелёный').addOption('magenta', 'Пурпурный')
        .setValue(this.plugin.settings.accentMode)
        .onChange(async v => { this.plugin.settings.accentMode = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName('Аварийные акценты').setDesc('Красные и жёлтые состояния для опасных, удаляющих и предупреждающих действий.')
      .addToggle(t => t.setValue(this.plugin.settings.hazardAccents).onChange(async v => { this.plugin.settings.hazardAccents = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName('Сегментированные элементы').setDesc('Добавляет внутренние деления и аппаратный вид кнопкам и вкладкам.')
      .addToggle(t => t.setValue(this.plugin.settings.segmentedControls).onChange(async v => { this.plugin.settings.segmentedControls = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName('Приборные заголовки').setDesc('Оформляет заголовки окон и панелей как отдельные экранные модули.')
      .addToggle(t => t.setValue(this.plugin.settings.panelHeaders).onChange(async v => { this.plugin.settings.panelHeaders = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName('Строки экрана').setDesc('Тонкая развёртка поверх интерфейса.')
      .addToggle(t => t.setValue(this.plugin.settings.scanlines).onChange(async v => { this.plugin.settings.scanlines = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('Техническая сетка').setDesc('Слабая координатная сетка на рабочих панелях.')
      .addToggle(t => t.setValue(this.plugin.settings.grid).onChange(async v => { this.plugin.settings.grid = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('Анимации').setDesc('Короткие импульсы активных индикаторов.')
      .addToggle(t => t.setValue(this.plugin.settings.animations).onChange(async v => { this.plugin.settings.animations = v; await this.plugin.saveSettings(); }));
  }
}
