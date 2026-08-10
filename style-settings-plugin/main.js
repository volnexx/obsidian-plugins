const { Plugin, PluginSettingTab, Setting, Notice } = require('obsidian');

const DEFAULT_SETTINGS = {
  enabled: true,
  holdSeconds: 60,
  transitionSeconds: 8,
  fps: 30,
  presets: [
    { name: 'Красная', json: '' },
    { name: 'Оранжевая', json: '' },
    { name: 'Жёлтая', json: '' },
    { name: 'Зелёная', json: '' },
    { name: 'Голубая', json: '' },
    { name: 'Синяя', json: '' },
    { name: 'Фиолетовая', json: '' },
    { name: 'Розовая', json: '' }
  ]
};

function clamp01(v){ return Math.max(0, Math.min(1, v)); }
function parseHexColor(value){
  if(typeof value!=='string') return null;
  const s=value.trim();
  if(!/^#[0-9a-fA-F]{3,8}$/.test(s)) return null;
  const h=s.slice(1);
  if(h.length===3||h.length===4){
    const r=parseInt(h[0]+h[0],16), g=parseInt(h[1]+h[1],16), b=parseInt(h[2]+h[2],16);
    const a=h.length===4?parseInt(h[3]+h[3],16)/255:1; return {r,g,b,a};
  }
  if(h.length===6||h.length===8){
    const r=parseInt(h.slice(0,2),16), g=parseInt(h.slice(2,4),16), b=parseInt(h.slice(4,6),16);
    const a=h.length===8?parseInt(h.slice(6,8),16)/255:1; return {r,g,b,a};
  }
  return null;
}
function parseRgbColor(value){
  if(typeof value!=='string') return null;
  const m=value.trim().match(/^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)(?:\s*[,\/]\s*([\d.]+%?))?\s*\)$/i);
  if(!m) return null;
  const r=Math.max(0,Math.min(255,Number(m[1]))), g=Math.max(0,Math.min(255,Number(m[2]))), b=Math.max(0,Math.min(255,Number(m[3])));
  let a=1; if(m[4]!==undefined){a=m[4].endsWith('%')?Number(m[4].slice(0,-1))/100:Number(m[4]);a=clamp01(a);}
  if(![r,g,b,a].every(Number.isFinite)) return null; return {r,g,b,a};
}
function parseColor(v){ return parseHexColor(v)||parseRgbColor(v); }
function byteHex(n){ return Math.round(Math.max(0,Math.min(255,n))).toString(16).padStart(2,'0').toUpperCase(); }
function mixColor(a,b,t){
  const u=clamp01(t), r=a.r+(b.r-a.r)*u, g=a.g+(b.g-a.g)*u, bl=a.b+(b.b-a.b)*u, al=a.a+(b.a-a.a)*u;
  return `#${byteHex(r)}${byteHex(g)}${byteHex(bl)}${byteHex(al*255)}`;
}
function parsePreset(text){
  if(!text||!text.trim()) throw new Error('пустой набор');
  const p=JSON.parse(text); if(!p||typeof p!=='object'||Array.isArray(p)) throw new Error('ожидается объект JSON'); return p;
}
function parseThemesArray(text){
  if(!text||!text.trim()) throw new Error('поле тем пустое');
  const arr=JSON.parse(text);
  if(!Array.isArray(arr)) throw new Error('ожидается JSON-массив из 8 объектов');
  if(arr.length!==8) throw new Error(`нужно ровно 8 тем, сейчас: ${arr.length}`);
  arr.forEach((theme,i)=>{if(!theme||typeof theme!=='object'||Array.isArray(theme)) throw new Error(`тема ${i+1}: ожидается объект JSON`);});
  return arr;
}
function cssVarName(fullKey){
  const parts=fullKey.split('@@'); return parts.length>=2?parts[1]:fullKey;
}
function modifierOf(fullKey){
  const parts=fullKey.split('@@'); return parts.length>=3?parts[2]:'base';
}

class ColorCycleSettingTab extends PluginSettingTab{
  constructor(app,plugin){super(app,plugin);this.plugin=plugin;}
  display(){
    const {containerEl}=this; containerEl.empty();
    containerEl.createEl('h2',{text:'Style Settings — цветовой цикл'});
    containerEl.createEl('p',{text:'Восемь готовых тем используются как опорные состояния. Каждая тема некоторое время держится без изменений, затем быстро и плавно переходит в следующую.'});
    new Setting(containerEl).setName('Цветовой цикл').setDesc('Красная → оранжевая → жёлтая → зелёная → голубая → синяя → фиолетовая → розовая → красная.')
      .addToggle(t=>t.setValue(this.plugin.settings.enabled).onChange(async v=>{this.plugin.settings.enabled=v;await this.plugin.saveSettings();v?this.plugin.startCycle():this.plugin.stopCycle(true);this.display();}));
    new Setting(containerEl).setName('Время показа темы').setDesc('Сколько секунд готовая тема остаётся неизменной перед началом перехода.')
      .addText(t=>t.setValue(String(this.plugin.settings.holdSeconds)).onChange(async v=>{const n=Number(v.replace(',','.'));if(Number.isFinite(n)&&n>=0&&n<=86400){this.plugin.settings.holdSeconds=n;await this.plugin.saveSettings();this.plugin.restartCycleIfRunning();}}));
    new Setting(containerEl).setName('Время перехода').setDesc('Сколько секунд занимает быстрый плавный переход от одной темы к следующей.')
      .addText(t=>t.setValue(String(this.plugin.settings.transitionSeconds)).onChange(async v=>{const n=Number(v.replace(',','.'));if(Number.isFinite(n)&&n>=0.2&&n<=86400){this.plugin.settings.transitionSeconds=n;await this.plugin.saveSettings();this.plugin.restartCycleIfRunning();}}));
    new Setting(containerEl).setName('Частота обновления').setDesc('30 кадров/с — нормальный вариант для iPhone.')
      .addDropdown(d=>d.addOption('15','15 кадров/с').addOption('30','30 кадров/с').addOption('60','60 кадров/с').setValue(String(this.plugin.settings.fps)).onChange(async v=>{this.plugin.settings.fps=Number(v);await this.plugin.saveSettings();}));
    const s=this.plugin.validatePresets(); const el=containerEl.createDiv({cls:'sscc-status'}); el.setText(s.ok?`Готово: ${s.colorKeyCount} цветовых параметров участвуют в переливе.`:`Ошибка: ${s.message}`); el.toggleClass('is-ok',s.ok);el.toggleClass('is-error',!s.ok);

    containerEl.createEl('h3',{text:'Все 8 тем'});
    containerEl.createEl('p',{text:'Одно поле для всех тем. Формат — JSON-массив из 8 объектов в порядке: красная, оранжевая, жёлтая, зелёная, голубая, синяя, фиолетовая, розовая.'});
    let draft=this.plugin.getThemesArrayText();
    new Setting(containerEl).setName('Массив тем').setDesc('Вставь сюда весь массив целиком. Пустые строки внутри объектов не мешают, потому что разделителем служат элементы JSON-массива.')
      .addTextArea(a=>{a.setValue(draft).onChange(v=>{draft=v;});a.inputEl.rows=28;a.inputEl.addClass('sscc-json');a.inputEl.style.width='100%';a.inputEl.style.minHeight='520px';});
    const actions=containerEl.createDiv({cls:'sscc-actions'});
    const apply=actions.createEl('button',{text:'Применить 8 тем'});
    apply.addEventListener('click',async()=>{
      try{
        const arr=parseThemesArray(draft);
        this.plugin.setThemesFromArray(arr);
        await this.plugin.saveSettings();
        this.plugin.restartCycleIfRunning();
        new Notice('Все 8 тем сохранены.');
        this.display();
      }catch(e){new Notice(`Ошибка массива тем: ${e.message}`);}
    });
    const check=actions.createEl('button',{text:'Проверить массив'});
    check.addEventListener('click',()=>{
      try{const arr=parseThemesArray(draft);const counts=arr.map(o=>Object.values(o).filter(v=>!!parseColor(v)).length);new Notice(`Массив корректен. Тем: 8. Цветовых значений: ${counts.join(', ')}.`);}catch(e){new Notice(`Ошибка массива тем: ${e.message}`);}
    });
  }
}

module.exports=class StyleSettingsColorCyclePlugin extends Plugin{
  async onload(){
    const loaded=await this.loadData(); this.settings=Object.assign({},DEFAULT_SETTINGS,loaded||{});
    this.settings.presets=Array.from({length:8},(_,i)=>({...DEFAULT_SETTINGS.presets[i],...(this.settings.presets&&this.settings.presets[i]?this.settings.presets[i]:{})}));
    this.styleTag=document.createElement('style'); this.styleTag.id='style-settings-color-cycle-runtime'; document.head.appendChild(this.styleTag);
    this.rafId=null;this.running=false;this.segmentIndex=0;this.segmentStart=0;this.lastFrame=0;this.compiledPresets=null;
    this.addSettingTab(new ColorCycleSettingTab(this.app,this));
    this.addCommand({id:'toggle-color-cycle',name:'Включить/выключить цветовой цикл',callback:async()=>{this.settings.enabled=!this.settings.enabled;await this.saveSettings();this.settings.enabled?this.startCycle():this.stopCycle(true);new Notice(this.settings.enabled?'Цветовой цикл включён.':'Цветовой цикл выключен.');}});
    this.addCommand({id:'restart-color-cycle',name:'Начать цветовой цикл с красной темы',callback:async()=>{this.stopCycle(true);this.settings.enabled=true;await this.saveSettings();this.startCycle();}});
    this.app.workspace.onLayoutReady(()=>{if(this.settings.enabled)this.startCycle();});
  }
  onunload(){this.stopCycle(true);if(this.styleTag)this.styleTag.remove();}
  async saveSettings(){await this.saveData(this.settings);}
  getThemesArrayText(){
    const arr=this.settings.presets.map(p=>{try{return parsePreset(p.json);}catch{return {};}});
    return JSON.stringify(arr,null,2);
  }
  setThemesFromArray(arr){
    const names=['Красная','Оранжевая','Жёлтая','Зелёная','Голубая','Синяя','Фиолетовая','Розовая'];
    this.settings.presets=arr.map((obj,i)=>({name:names[i],json:JSON.stringify(obj,null,2)}));
  }
  compilePresets(){
    const parsed=this.settings.presets.map(p=>parsePreset(p.json));
    const colorMaps=parsed.map(obj=>{const out=new Map();for(const [k,v] of Object.entries(obj)){const c=parseColor(v);if(c)out.set(k,c);}return out;});
    const commonKeys=[...colorMaps[0].keys()].filter(k=>colorMaps.every(m=>m.has(k)));
    if(!commonKeys.length)throw new Error('нет общих цветовых параметров во всех 8 наборах');
    return {parsed,colorMaps,commonKeys};
  }
  validatePresets(){try{const c=this.compilePresets();return{ok:true,colorKeyCount:c.commonKeys.length};}catch(e){return{ok:false,message:e.message};}}
  renderFrame(fromMap,toMap,keys,t){
    const base=[],light=[],dark=[];
    for(const key of keys){const name=cssVarName(key),mod=modifierOf(key),val=mixColor(fromMap.get(key),toMap.get(key),t);const decl=`--${name}:${val};`;if(mod==='dark')dark.push(decl);else if(mod==='light')light.push(decl);else base.push(decl);}
    this.styleTag.textContent=`body{${base.join('')}} body.theme-light{${light.join('')}} body.theme-dark{${dark.join('')}}`;
  }
  startCycle(){
    if(this.running)return; let c; try{c=this.compilePresets();}catch(e){this.settings.enabled=false;this.saveSettings();new Notice(`Цветовой цикл не запущен: ${e.message}`);return;}
    this.compiledPresets=c;this.running=true;this.segmentIndex=0;this.segmentStart=performance.now();this.lastFrame=0;
    this.renderFrame(c.colorMaps[0],c.colorMaps[0],c.commonKeys,0);
    const tick=now=>{
      if(!this.running)return;
      const holdMs=Math.max(0,Number(this.settings.holdSeconds)||0)*1000;
      const transitionMs=Math.max(.2,Number(this.settings.transitionSeconds)||8)*1000;
      const segmentMs=holdMs+transitionMs;
      let elapsed=now-this.segmentStart;
      if(elapsed>=segmentMs){
        const steps=Math.floor(elapsed/segmentMs);
        this.segmentIndex=(this.segmentIndex+steps)%8;
        this.segmentStart+=steps*segmentMs;
        elapsed=now-this.segmentStart;
      }
      const minFrameMs=1000/Math.max(1,Number(this.settings.fps)||30);
      if(now-this.lastFrame>=minFrameMs){
        const next=(this.segmentIndex+1)%8;
        if(elapsed<holdMs){
          this.renderFrame(c.colorMaps[this.segmentIndex],c.colorMaps[this.segmentIndex],c.commonKeys,0);
        }else{
          const t=clamp01((elapsed-holdMs)/transitionMs);
          this.renderFrame(c.colorMaps[this.segmentIndex],c.colorMaps[next],c.commonKeys,t);
        }
        this.lastFrame=now;
      }
      this.rafId=requestAnimationFrame(tick);
    };
    this.rafId=requestAnimationFrame(tick);
  }
  stopCycle(clear){if(this.rafId!==null)cancelAnimationFrame(this.rafId);this.rafId=null;this.running=false;this.compiledPresets=null;if(clear&&this.styleTag)this.styleTag.textContent='';}
  restartCycleIfRunning(){if(!this.running)return;this.stopCycle(true);if(this.settings.enabled)this.startCycle();}
};
