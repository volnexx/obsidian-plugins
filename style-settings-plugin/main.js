const { Plugin, PluginSettingTab, Setting, Notice } = require('obsidian');

const COMMON = {
  'minimal-style@@bg1@@dark': '#000000',
  'minimal-style@@base@@dark': '#000000',
  'minimal-style@@bases-toolbar-opacity': 0.85,
  'minimal-style@@bases-table-header-icon-display': 'none',
  'minimal-style@@callouts-style': 'callouts-outlined',
  'minimal-style@@callout-blend-mode': 'normal',
  'minimal-style@@color-orange@@dark': '#FF8000FF',
  'minimal-style@@color-yellow@@dark': '#FFFF00FF',
  'minimal-style@@color-green@@dark': '#00FF80FF',
  'minimal-style@@color-red@@dark': '#FF0000FF',
  'minimal-style@@color-blue@@dark': '#0080FFFF',
  'minimal-style@@code-size': '0.9em',
  'minimal-style@@minimal-code-scroll': false,
  'minimal-style@@embed-strict': false,
  'minimal-style@@embed-hide-title': false,
  'minimal-style@@embed-underline': false,
  'minimal-style@@embed-max-height': '70',
  'minimal-style@@h1-size': '1.7em',
  'minimal-style@@h1-weight': 700,
  'minimal-style@@h1-variant': 'normal',
  'minimal-style@@h1-style': 'normal',
  'minimal-style@@h1-l': false,
  'minimal-style@@h2-size': '1.43em',
  'minimal-style@@h2-weight': 600,
  'minimal-style@@h2-variant': 'normal',
  'minimal-style@@h3-size': '1.2em',
  'minimal-style@@h3-weight': 500,
  'minimal-style@@h3-variant': 'normal',
  'minimal-style@@h4-size': '1.11em',
  'minimal-style@@h4-variant': 'normal',
  'minimal-style@@h4-weight': 400,
  'minimal-style@@h5-size': '0.94em',
  'minimal-style@@h5-weight': 400,
  'minimal-style@@h6-size': '0.8em',
  'minimal-style@@link-unresolved-opacity': 0.45,
  'minimal-style@@active-line-on': true,
  'minimal-style@@folding-offset': 32,
  'minimal-style@@gutter-background@@dark': '#00000000',
  'minimal-style@@bold-modifier': 400,
  'minimal-style@@p-spacing': '1.75rem',
  'minimal-style@@heading-spacing': '1.4em',
  'minimal-style@@minimal-unstyled-tags': false,
  'minimal-style@@tag-radius': '14px',
  'minimal-style@@tag-border-width': '1px'
};

function theme(p) {
  return {
    ...COMMON,
    'minimal-style@@bg2@@dark': p.bg2,
    'minimal-style@@bg3@@dark': p.bg3,
    'minimal-style@@ui1@@dark': p.ui1,
    'minimal-style@@ui2@@dark': p.ui2,
    'minimal-style@@ui3@@dark': p.main,
    'minimal-style@@ax1@@dark': p.main,
    'minimal-style@@ax2@@dark': p.contrastSoft,
    'minimal-style@@ax3@@dark': p.text,
    'minimal-style@@sp1@@dark': p.contrast,
    'minimal-style@@canvas-dot-pattern@@dark': p.ui2,
    'minimal-style@@code-background@@dark': p.codeBg,
    'minimal-style@@code-normal@@dark': p.main,
    'minimal-style@@embed-background@@dark': p.embed,
    'minimal-style@@embed-decoration-color@@dark': p.ui2,
    'minimal-style@@graph-line@@dark': p.ui2,
    'minimal-style@@graph-node@@dark': p.main,
    'minimal-style@@graph-node-focused@@dark': p.contrast,
    'minimal-style@@graph-node-tag@@dark': p.main,
    'minimal-style@@graph-node-attachment@@dark': p.contrastText,
    'minimal-style@@graph-node-unresolved@@dark': p.unresolved,
    'minimal-style@@h1-color@@dark': p.contrast,
    'minimal-style@@h2-color@@dark': p.contrastSoft,
    'minimal-style@@h3-color@@dark': p.contrastText,
    'minimal-style@@h4-color@@dark': p.contrastText,
    'minimal-style@@h5-color@@dark': p.contrastText,
    'minimal-style@@h6-color@@dark': p.contrastText,
    'minimal-style@@link-color@@dark': p.main,
    'minimal-style@@link-color-hover@@dark': p.contrast,
    'minimal-style@@link-unresolved-color@@dark': p.muted,
    'minimal-style@@link-unresolved-decoration-color@@dark': p.contrast,
    'minimal-style@@link-external-color@@dark': p.format,
    'minimal-style@@link-external-color-hover@@dark': p.contrast,
    'minimal-style@@line-number-color@@dark': p.line,
    'minimal-style@@line-number-color-active@@dark': p.main,
    'minimal-style@@active-line-bg@@dark': p.active,
    'minimal-style@@tx1@@dark': p.text,
    'minimal-style@@tx2@@dark': p.muted,
    'minimal-style@@tx3@@dark': p.dim,
    'minimal-style@@hl1@@dark': p.highlight,
    'minimal-style@@hl2@@dark': p.highlight2,
    'minimal-style@@text-formatting@@dark': p.format,
    'minimal-style@@italic-color@@dark': p.italic,
    'minimal-style@@bold-color@@dark': p.format,
    'minimal-style@@tag-color@@dark': p.italic,
    'minimal-style@@tag-background@@dark': p.tagBg,
    'minimal-style@@tag-background-hover@@dark': p.tagHover
  };
}

const DEFAULT_THEMES = [
  theme({main:'#FF0000',bg2:'#0B0808',bg3:'#161010',ui1:'#402525',ui2:'#804040',contrast:'#00FFFF',contrastSoft:'#80FFFF',text:'#FFC0C0',contrastText:'#C0FFFF',codeBg:'#0C0808',embed:'#FFC0C00D',unresolved:'#800000',muted:'#A06060',dim:'#604040',line:'#805050',active:'#FF00000D',highlight:'#00FFFF40',highlight2:'#FF000026',format:'#FF4040',italic:'#FF8080',tagBg:'#100808',tagHover:'#082020'}),
  theme({main:'#00FFFF',bg2:'#080B0B',bg3:'#101616',ui1:'#254040',ui2:'#408080',contrast:'#FF0000',contrastSoft:'#FF8080',text:'#C0FFFF',contrastText:'#FFC0C0',codeBg:'#080C0C',embed:'#C0FFFF0D',unresolved:'#008080',muted:'#60A0A0',dim:'#406060',line:'#508080',active:'#00FFFF0D',highlight:'#FF000040',highlight2:'#00FFFF26',format:'#40FFFF',italic:'#80FFFF',tagBg:'#081010',tagHover:'#402020'}),
  theme({main:'#FF8000',bg2:'#0B0907',bg3:'#17120E',ui1:'#403025',ui2:'#805838',contrast:'#0080FF',contrastSoft:'#80BFFF',text:'#FFD0A0',contrastText:'#C0DFFF',codeBg:'#0D0A08',embed:'#FFD0A00D',unresolved:'#804000',muted:'#A07858',dim:'#604838',line:'#806048',active:'#FF80000D',highlight:'#0080FF40',highlight2:'#FF800026',format:'#FF9A40',italic:'#FFB070',tagBg:'#120C08',tagHover:'#08182A'}),
  theme({main:'#0080FF',bg2:'#08090B',bg3:'#101216',ui1:'#253040',ui2:'#405880',contrast:'#FF8000',contrastSoft:'#FFC080',text:'#C0D8FF',contrastText:'#FFE0C0',codeBg:'#080A0D',embed:'#C0D8FF0D',unresolved:'#004080',muted:'#6078A0',dim:'#404860',line:'#506080',active:'#0080FF0D',highlight:'#FF800040',highlight2:'#0080FF26',format:'#4098FF',italic:'#80BFFF',tagBg:'#080C12',tagHover:'#2A1808'}),
  theme({main:'#FFFF00',bg2:'#0B0B08',bg3:'#161610',ui1:'#404025',ui2:'#808040',contrast:'#0080FF',contrastSoft:'#8080FF',text:'#FFFFC0',contrastText:'#C0C0FF',codeBg:'#0C0C08',embed:'#FFFFC00D',unresolved:'#808000',muted:'#A0A060',dim:'#606040',line:'#808050',active:'#FFFF000D',highlight:'#0080FF40',highlight2:'#FFFF0026',format:'#FFFF40',italic:'#FFFF80',tagBg:'#101008',tagHover:'#101C30'}),
  theme({main:'#BF00FF',bg2:'#0A080B',bg3:'#151016',ui1:'#382540',ui2:'#704080',contrast:'#00FF80',contrastSoft:'#80FFB0',text:'#E8C0FF',contrastText:'#C0FFD8',codeBg:'#0B080C',embed:'#E8C0FF0D',unresolved:'#600080',muted:'#9060A0',dim:'#584060',line:'#785080',active:'#BF00FF0D',highlight:'#00FF8040',highlight2:'#BF00FF26',format:'#D040FF',italic:'#D880FF',tagBg:'#0F0810',tagHover:'#082018'}),
  theme({main:'#00FF00',bg2:'#080B08',bg3:'#101610',ui1:'#254025',ui2:'#408040',contrast:'#FF00FF',contrastSoft:'#FF80FF',text:'#C0FFC0',contrastText:'#FFC0FF',codeBg:'#080C08',embed:'#C0FFC00D',unresolved:'#008000',muted:'#60A060',dim:'#406040',line:'#508050',active:'#00FF000D',highlight:'#FF00FF40',highlight2:'#00FF0026',format:'#40FF40',italic:'#80FF80',tagBg:'#081008',tagHover:'#200820'}),
  theme({main:'#FF00FF',bg2:'#0B080B',bg3:'#161016',ui1:'#402540',ui2:'#804080',contrast:'#00FF00',contrastSoft:'#80FF80',text:'#FFC0FF',contrastText:'#C0FFC0',codeBg:'#0C080C',embed:'#FFC0FF0D',unresolved:'#800080',muted:'#A060A0',dim:'#604060',line:'#805080',active:'#FF00FF0D',highlight:'#00FF0040',highlight2:'#FF00FF26',format:'#FF40FF',italic:'#FF80FF',tagBg:'#100810',tagHover:'#082008'})
];

const DEFAULT_SETTINGS = {
  enabled: true,
  holdSeconds: 900,
  transitionSeconds: 3,
  fps: 30,
  randomContrastOrder: true,
  themesText: JSON.stringify(DEFAULT_THEMES, null, 2)
};

function parseThemes(text) {
  const value = JSON.parse(text);
  if (!Array.isArray(value) || value.length !== 8) throw new Error('Нужен JSON-массив ровно из 8 тем.');
  for (const item of value) if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Каждая тема должна быть объектом JSON.');
  return value;
}

function parseHex(value) {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(/^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/);
  if (!m) return null;
  const h = m[1];
  return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16), a: m[2] ? parseInt(m[2],16) : 255 };
}
function hx(n){return Math.round(Math.max(0,Math.min(255,n))).toString(16).padStart(2,'0').toUpperCase();}
function mixHex(a,b,t){const x=parseHex(a),y=parseHex(b);if(!x||!y)return t<0.5?a:b;return'#'+hx(x.r+(y.r-x.r)*t)+hx(x.g+(y.g-x.g)*t)+hx(x.b+(y.b-x.b)*t)+hx(x.a+(y.a-x.a)*t);}
function cssName(key){const parts=String(key).split('@@');return'--'+(parts.length>1?parts[1]:parts[0]);}

function hueFromHex(value) {
  const c = parseHex(value);
  if (!c) return null;
  const r=c.r/255,g=c.g/255,b=c.b/255,max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
  if (d===0) return 0;
  let h;
  if (max===r) h=((g-b)/d)%6;
  else if (max===g) h=(b-r)/d+2;
  else h=(r-g)/d+4;
  return (h*60+360)%360;
}
function hueDistance(a,b){let d=Math.abs(a-b)%360;return Math.min(d,360-d);}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}

class CycleSettingsTab extends PluginSettingTab {
  constructor(app,plugin){super(app,plugin);this.plugin=plugin;}
  display(){
    const {containerEl}=this;containerEl.empty();
    containerEl.createEl('h2',{text:'Style Settings — 8 тем'});
    containerEl.createEl('p',{text:'Темы перемешиваются случайно, но соседние цвета подбираются контрастными. Каждая из 8 тем используется один раз за круг.'});
    new Setting(containerEl).setName('Цветовой цикл').addToggle(t=>t.setValue(this.plugin.settings.enabled).onChange(async v=>{this.plugin.settings.enabled=v;await this.plugin.saveSettings();v?this.plugin.start():this.plugin.stop();}));
    new Setting(containerEl).setName('Контрастное случайное перемешивание').setDesc('Запрещает близкие соседние оттенки и создаёт новый случайный порядок после каждого круга.').addToggle(t=>t.setValue(this.plugin.settings.randomContrastOrder!==false).onChange(async v=>{this.plugin.settings.randomContrastOrder=v;await this.plugin.saveSettings();this.plugin.resetOrder();this.plugin.restart();}));
    new Setting(containerEl).setName('Время одной темы, секунд').setDesc('По умолчанию 15 минут.').addText(t=>t.setValue(String(this.plugin.settings.holdSeconds)).onChange(async v=>{const n=Number(String(v).replace(',','.'));if(Number.isFinite(n)&&n>=0){this.plugin.settings.holdSeconds=n;await this.plugin.saveSettings();this.plugin.restart();}}));
    new Setting(containerEl).setName('Время перехода, секунд').setDesc('По умолчанию 3 секунды.').addText(t=>t.setValue(String(this.plugin.settings.transitionSeconds)).onChange(async v=>{const n=Number(String(v).replace(',','.'));if(Number.isFinite(n)&&n>=0.1){this.plugin.settings.transitionSeconds=n;await this.plugin.saveSettings();this.plugin.restart();}}));
    const setting=new Setting(containerEl).setName('Массив тем').setDesc('Один JSON-массив из восьми объектов.');
    setting.addTextArea(t=>{t.setValue(this.plugin.settings.themesText).onChange(async v=>{this.plugin.settings.themesText=v;try{parseThemes(v);await this.plugin.saveSettings();this.plugin.reloadThemes();this.plugin.resetOrder();this.plugin.restart();}catch{}});t.inputEl.rows=18;t.inputEl.style.width='100%';t.inputEl.style.minWidth='100%';});
    new Setting(containerEl).setName('Вернуть встроенные темы').addButton(b=>b.setButtonText('Вернуть').onClick(async()=>{this.plugin.settings.themesText=JSON.stringify(DEFAULT_THEMES,null,2);await this.plugin.saveSettings();this.plugin.reloadThemes();this.plugin.resetOrder();this.plugin.restart();this.display();new Notice('Встроенные темы восстановлены.');}));
  }
}

module.exports = class StyleSettingsColorCycle extends Plugin {
  async onload(){
    const loaded=await this.loadData()||{};
    this.settings={...DEFAULT_SETTINGS,...loaded};
    if((!loaded.themesText||!String(loaded.themesText).trim())&&Array.isArray(loaded.presets)&&loaded.presets.length===8){try{this.settings.themesText=JSON.stringify(loaded.presets.map(p=>JSON.parse(p.json)),null,2);await this.saveSettings();}catch{}}
    this._progressKey=`style-settings-color-cycle-progress:${this.app.vault.getName()}`;
    this.reloadThemes();
    this.addSettingTab(new CycleSettingsTab(this.app,this));
    this.registerDomEvent(document,'visibilitychange',()=>{if(document.hidden){this.saveProgress();this.stopTimer();}else if(this.settings.enabled){this.restoreProgress();this.startTimer();}});
    this.registerDomEvent(window,'pagehide',()=>this.saveProgress());
    this.registerDomEvent(window,'beforeunload',()=>this.saveProgress());
    if(this.settings.enabled)this.start();else this.applyTheme(this.themes[0]);
  }
  async saveSettings(){await this.saveData(this.settings);}
  reloadThemes(){try{this.themes=parseThemes(this.settings.themesText);}catch(e){this.themes=DEFAULT_THEMES;new Notice(`Style Settings — 8 тем: ${e.message}`);}}
  getThemeHue(i){const t=this.themes[i]||{};return hueFromHex(t['minimal-style@@ui3@@dark']||t['minimal-style@@ax1@@dark']||t['minimal-style@@link-color@@dark']) ?? (i*45);}
  buildContrastOrder(previousIndex=null){
    if(this.settings.randomContrastOrder===false)return [0,1,2,3,4,5,6,7];
    const all=[0,1,2,3,4,5,6,7], hues=all.map(i=>this.getThemeHue(i));
    const thresholds=[100,85,70,0];
    for(const minDistance of thresholds){
      for(let attempt=0;attempt<300;attempt++){
        const remaining=shuffle([...all]);
        const order=[];
        const backtrack=()=>{
          if(!remaining.length)return true;
          const candidates=shuffle([...remaining]).sort((a,b)=>{
            const prev=order.length?order[order.length-1]:previousIndex;
            if(prev===null||prev===undefined)return Math.random()-0.5;
            return hueDistance(hues[b],hues[prev])-hueDistance(hues[a],hues[prev]);
          });
          for(const candidate of candidates){
            const prev=order.length?order[order.length-1]:previousIndex;
            if(prev!==null&&prev!==undefined&&hueDistance(hues[candidate],hues[prev])<minDistance)continue;
            const pos=remaining.indexOf(candidate);remaining.splice(pos,1);order.push(candidate);
            if(backtrack())return true;
            order.pop();remaining.splice(pos,0,candidate);
          }
          return false;
        };
        if(backtrack())return order;
      }
    }
    return shuffle(all);
  }
  resetOrder(){this.order=null;this.segmentIndex=0;this.elapsedMs=0;try{localStorage.removeItem(this._progressKey);}catch{}}
  ensureOrder(previousIndex=null){if(!Array.isArray(this.order)||this.order.length!==8)this.order=this.buildContrastOrder(previousIndex);}
  currentThemeIndex(){this.ensureOrder();return this.order[this.segmentIndex%8];}
  nextThemeIndex(){this.ensureOrder();return this.order[(this.segmentIndex+1)%8];}
  start(){this.stopTimer();this.running=true;if(!this.restoreProgress()){this.order=this.buildContrastOrder(null);this.segmentIndex=0;this.elapsedMs=0;}this.ensureOrder();this.segmentStarted=performance.now()-this.elapsedMs;this.render();this.startTimer();}
  restart(){const was=this.running;this.saveProgress();this.stopTimer();if(was&&this.settings.enabled){this.restoreProgress();this.ensureOrder();this.segmentStarted=performance.now()-this.elapsedMs;this.render();this.startTimer();}}
  stop(){this.saveProgress();this.running=false;this.stopTimer();}
  stopTimer(){if(this.timer){window.clearInterval(this.timer);this.timer=null;}}
  startTimer(){if(!this.running||this.timer)return;const fps=Math.max(1,Math.min(60,Number(this.settings.fps)||30));this.timer=window.setInterval(()=>this.render(),Math.round(1000/fps));}
  advanceSegments(steps){
    for(let s=0;s<steps;s++){
      this.ensureOrder();
      if(this.segmentIndex<7){this.segmentIndex++;}
      else{
        const previous=this.order[7];
        this.order=this.buildContrastOrder(previous);
        this.segmentIndex=0;
      }
    }
  }
  render(){
    if(!this.running||!this.themes?.length)return;
    const hold=Math.max(0,Number(this.settings.holdSeconds)||0)*1000;
    const transition=Math.max(100,Number(this.settings.transitionSeconds||3)*1000);
    const total=hold+transition;
    let elapsed=Math.max(0,performance.now()-this.segmentStarted);
    if(elapsed>=total){const steps=Math.floor(elapsed/total);this.advanceSegments(steps);elapsed-=steps*total;this.segmentStarted=performance.now()-elapsed;this.saveProgress();}
    this.elapsedMs=elapsed;
    const a=this.themes[this.currentThemeIndex()], b=this.themes[this.nextThemeIndex()];
    if(elapsed<=hold){this.applyTheme(a);return;}
    const t=Math.max(0,Math.min(1,(elapsed-hold)/transition));this.applyMixed(a,b,t);
  }
  applyMixed(a,b,t){const result={};for(const key of new Set([...Object.keys(a),...Object.keys(b)])){const av=a[key],bv=b[key];result[key]=(parseHex(av)&&parseHex(bv))?mixHex(av,bv,t):(t<0.5?av:bv);}this.applyTheme(result);}
  applyTheme(obj){const target=document.body;if(!target)return;for(const[key,value]of Object.entries(obj)){if(typeof value==='boolean'||value===null||value===undefined)continue;target.style.setProperty(cssName(key),String(value),'important');}if(!document.body.classList.contains('is-mobile'))for(const name of['--background-primary','--background-primary-alt','--background-secondary','--background-secondary-alt','--bg1','--base'])target.style.setProperty(name,'#000000','important');}
  saveProgress(){try{if(!this.running||!Number.isFinite(this.segmentStarted))return;const hold=Math.max(0,Number(this.settings.holdSeconds)||0)*1000;const transition=Math.max(100,Number(this.settings.transitionSeconds||3)*1000);const total=hold+transition;let elapsed=Math.max(0,performance.now()-this.segmentStarted);if(elapsed>=total){const steps=Math.floor(elapsed/total);this.advanceSegments(steps);elapsed-=steps*total;}localStorage.setItem(this._progressKey,JSON.stringify({segmentIndex:this.segmentIndex,elapsedMs:elapsed,order:this.order}));}catch(e){console.warn('[Style Settings — 8 тем] save progress',e);}}
  restoreProgress(){try{const raw=localStorage.getItem(this._progressKey);if(!raw)return false;const p=JSON.parse(raw);if(!Number.isFinite(p.segmentIndex)||!Number.isFinite(p.elapsedMs))return false;this.order=Array.isArray(p.order)&&p.order.length===8?p.order.map(Number):this.buildContrastOrder(null);if(new Set(this.order).size!==8||this.order.some(i=>!Number.isInteger(i)||i<0||i>7))this.order=this.buildContrastOrder(null);this.segmentIndex=Math.max(0,Math.min(7,Math.trunc(p.segmentIndex)));this.elapsedMs=Math.max(0,p.elapsedMs);return true;}catch{return false;}}
  onunload(){this.saveProgress();this.stopTimer();}
};
