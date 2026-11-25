/* Danmaku uses source time, so cuts, repeats, speed changes and seeks share one clock. */
const DM={generation:0,busy:false,binding:null,comments:[],candidates:[],hint:null,enabled:true,opacity:.8,density:8,size:24,range:1,scroll:true,top:true,bottom:true,offset:0,revision:0,layoutKey:'',layout:[],lastFrame:'',status:'打开视频后可自动识别弹幕'};
let dmProvider='bilibili';
const dmCanvas=$('dmcanvas'),dmContext=dmCanvas.getContext('2d');
function dmPayload(){return {binding:DM.binding,enabled:DM.enabled,opacity:DM.opacity,density:DM.density,size:DM.size,range:DM.range,scroll:DM.scroll,top:DM.top,bottom:DM.bottom,offset:DM.offset};}
function dmDefaults(){try{return JSON.parse(localStorage.getItem('inkcut-danmaku-display')||'{}')||{};}catch{return {};}}
function saveDmDefaults(){const {binding,offset,...settings}=dmPayload();try{localStorage.setItem('inkcut-danmaku-display',JSON.stringify(settings));}catch{}}
function resetDanmaku(saved){saved={...dmDefaults(),...saved};DM.generation++;window.ink.dmCancel();DM.busy=false;DM.binding=saved?.binding||null;DM.comments=[];DM.candidates=[];DM.hint=null;DM.enabled=saved?.enabled!==false;DM.opacity=clamp(Number(saved?.opacity)||.8,.2,1);DM.density=[4,8,12].includes(+saved?.density)?+saved.density:8;DM.size=clamp(Math.round(Number(saved?.size)||24),5,30);DM.range=clamp(Number(saved?.range)||1,.1,1);DM.scroll=saved?.scroll!==false;DM.top=saved?.top!==false;DM.bottom=saved?.bottom!==false;DM.offset=clamp(Number(saved?.offset)||0,-36000,36000);DM.revision++;DM.lastFrame='';DM.status=S.file?'正在读取弹幕…':'打开视频后可自动识别弹幕';$('dm-remember').checked=false;$('dm-query').value='';$('dm-episode').value='';dmSync();renderDanmaku();}
function dmSliderLabels(){$('dm-size-value').textContent=DM.size;$('dm-range-value').textContent=Math.round(DM.range*100)+'%';}
function dmSync(){
  $('dm-status').textContent=DM.status;$('dm-open').textContent=DM.busy?'⚙ 加载中':DM.candidates.length?'⚙ 待确认':'⚙';$('dm-open').classList.toggle('active',DM.enabled&&DM.comments.length>0);$('dm-toggle').textContent=DM.enabled?'隐藏弹幕':'显示弹幕';$('dm-toggle').classList.toggle('active',DM.enabled);$('dm-toggle').setAttribute('aria-pressed',String(DM.enabled));
  $('dm-opacity').value=DM.opacity;$('dm-density').value=DM.density;$('dm-size').value=DM.size;$('dm-range').value=DM.range;dmSliderLabels();$('dm-scroll').checked=DM.scroll;$('dm-top').checked=DM.top;$('dm-bottom').checked=DM.bottom;$('dm-offset').value=DM.offset;
  for(const b of document.querySelectorAll('[data-dm-work]'))b.disabled=DM.busy||(!S.file&&!['dm-save-settings','dm-clear-settings'].includes(b.id));
  $('dm-refresh').disabled=DM.busy||!(DM.binding?.episodeId||DM.binding?.cid);$('dm-remove').disabled=DM.busy||!DM.binding;$('dm-provider').disabled=DM.busy;
  $('dm-remember').disabled=!DM.hint?.episode;$('dm-forget').classList.toggle('hide',!DM.hint?.rule);
  $('dm-hint').textContent=DM.hint?(DM.hint.episode?'路径集数：'+DM.hint.episode+'；文件夹：'+DM.hint.scope:'路径没有明确集数，请手动选择。')+(DM.hint.rule?'（已记住：'+DM.hint.rule.title+'）':''):'';
  const list=$('dm-candidates');list.replaceChildren();for(const match of DM.candidates){const b=document.createElement('button');b.disabled=DM.busy;b.textContent=match.animeTitle;const sub=document.createElement('span');sub.textContent=match.episodeTitle;b.append(sub);b.onclick=()=>dmWork(async()=>window.ink.dmSelect({file:S.file,match,remember:$('dm-remember').checked}));list.append(b);}
}
function dmApply(r){
  if(!r?.ok)throw Error(r?.error||'弹幕加载失败');if(r.hint)DM.hint=r.hint;
  if(r.state==='loaded'){const changed=JSON.stringify(DM.binding)!==JSON.stringify(r.binding);DM.binding=r.binding;DM.comments=r.comments||[];DM.candidates=[];if(changed)DM.offset=Number(r.binding.shift)||0;DM.revision++;DM.status=[r.binding.animeTitle,r.binding.episodeTitle].filter(Boolean).join(' · ')+' · '+DM.comments.length+' 条'+(r.cached?'（本地缓存）':'')+(r.inferred?' · 按已记住的文件夹匹配':'')+(r.warning?'；'+r.warning:'');scheduleSave();}
  else if(r.state==='unconfigured'){DM.status='在线自动识别还需要应用凭证；可先导入本地 XML / JSON 弹幕。';}
  else if(r.state==='needs-link'){DM.status='首次需要确认番剧：粘贴B站链接并选择对应集数，记住文件夹后会自动加载后续集数。';}
  else if(r.state==='disabled'){DM.status='自动识别已关闭，可以点击「重新识别」或手动搜索。';}
  else if(r.state==='choose'){DM.candidates=r.matches||[];DM.status=DM.candidates.length?'找到可能的剧集，请选择正确的一集。':'没有找到明确匹配，请输入番剧名搜索。';}
  else if(r.matches){DM.candidates=r.matches;DM.status=r.matches.length?'请选择正确的番剧和集数。'+(r.hasMore?'结果较多，可补充集数缩小范围。':''):'没有搜索结果，请尝试其他名称。';}
  dmSync();renderDanmaku();
}
async function dmWork(fn){
  const gen=++DM.generation,previousStatus=DM.status;DM.busy=true;DM.status='正在加载弹幕…';dmSync();
  try{await window.ink.dmCancel();if(gen!==DM.generation)return;const result=await fn();if(gen!==DM.generation)return;if(result?.canceled){DM.status=previousStatus;return;}dmApply(result);}
  catch(e){if(gen===DM.generation)DM.status=e.message+(DM.comments.length?'；保留当前弹幕':'');}
  finally{if(gen===DM.generation){DM.busy=false;dmSync();renderDanmaku();}}
}
function loadDanmaku(){const file=S.file,binding=DM.binding,duration=S.info?.duration;return dmWork(()=>window.ink.dmLoad({file,binding,duration}));}
async function dmSettings(){const r=await window.ink.dmSettings();if(!r?.ok)throw Error(r?.error||'无法读取弹幕设置');dmProvider=r.provider||'bilibili';$('dm-provider').value=dmProvider;const bili=dmProvider==='bilibili';$('dm-bili-guide').classList.toggle('hide',!bili);$('dm-find-bili').classList.toggle('hide',!bili);$('dm-settings').classList.toggle('hide',bili);$('dm-episode').classList.toggle('hide',bili);$('dm-search').textContent=bili?'读取链接':'搜索';$('dm-query').placeholder=bili?'粘贴B站完整链接，或 ss / ep / BV 编号':'输入番剧名';$('dm-appid').value=r.appId;$('dm-auto').checked=r.automatic;$('dm-credential-status').textContent=r.configured?'应用凭证已保存，实际可用性以请求结果为准。':'尚未配置应用凭证。建议使用B站来源或本地弹幕。';return r;}
$('dm-toggle').onclick=()=>{DM.enabled=!DM.enabled;saveDmDefaults();scheduleSave();renderDanmaku();dmSync();$('dm-toggle').blur();};
$('dm-open').onclick=async()=>{pause();$('dmmodal').classList.remove('hide');dmSync();try{await dmSettings();}catch(e){$('dm-credential-status').textContent=e.message;}if(!$('dm-query').value&&DM.hint&&dmProvider!=='bilibili')$('dm-query').value=DM.hint.title;if(!$('dm-episode').value&&DM.hint?.episode)$('dm-episode').value=DM.hint.episode;$('dm-close').focus();};
$('dm-provider').onchange=async()=>{if(await dmSaveConfig({provider:$('dm-provider').value})){$('dm-query').value='';DM.candidates=[];dmSync();}};
$('dm-find-bili').onclick=()=>window.ink.dmBiliSearch(DM.hint?.title||'');
function dmClose(){$('dmmodal').classList.add('hide');$('dm-open').focus();}
$('dm-close').onclick=dmClose;
document.addEventListener('keydown',e=>{if($('dmmodal').classList.contains('hide'))return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();dmClose();}if(e.key==='Tab'){const all=[...$('dmmodal').querySelectorAll('button,input,select,summary')].filter(el=>!el.disabled&&el.getClientRects().length),first=all[0],last=all.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}},true);
$('dm-match').onclick=()=>{const file=S.file,duration=S.info?.duration;dmWork(()=>window.ink.dmLoad({file,duration,force:true}));};
$('dm-refresh').onclick=()=>{const file=S.file,binding=DM.binding;dmWork(()=>window.ink.dmLoad({file,binding,refresh:true}));};
$('dm-search').onclick=()=>{const title=$('dm-query').value,episode=$('dm-episode').value;dmWork(()=>window.ink.dmSearch(title,episode));};
for(const el of [$('dm-query'),$('dm-episode')])el.addEventListener('keydown',e=>{if(e.key==='Enter'&&!DM.busy)$('dm-search').click();});
$('dm-remove').onclick=()=>{const hint=DM.hint;resetDanmaku({enabled:DM.enabled});DM.hint=hint;DM.status='已解除当前关联；重新打开时会按自动识别设置处理。';scheduleSave();dmSync();};
$('dm-forget').onclick=async()=>{const gen=DM.generation,r=await window.ink.dmForgetFolder(S.file);if(gen!==DM.generation)return;if(!r?.ok)return toast(r?.error||'操作失败');DM.hint.rule=null;dmSync();};
for(const [field,key]of [['dm-opacity','opacity'],['dm-density','density'],['dm-size','size'],['dm-range','range'],['dm-scroll','scroll'],['dm-top','top'],['dm-bottom','bottom'],['dm-offset','offset']]){
  $(field).oninput=()=>{if(key==='size'&&(!$(field).value||!Number.isFinite($(field).valueAsNumber)))return;DM[key]=['enabled','scroll','top','bottom'].includes(key)?$(field).checked:Number($(field).value);if(key==='offset')DM.offset=clamp(DM.offset||0,-36000,36000);if(key==='size')DM.size=clamp(Math.round(DM.size),5,30);if(key==='range')DM.range=clamp(DM.range,.1,1);dmSliderLabels();if(['density','size','range','scroll','top','bottom'].includes(key))DM.revision++;if(key!=='offset')saveDmDefaults();scheduleSave();renderDanmaku();$('dm-open').classList.toggle('active',DM.enabled&&DM.comments.length>0);};
  if(key==='size')$(field).onchange=()=>{$(field).value=DM.size;};
}
async function dmSaveConfig(input){const r=await window.ink.dmSaveSettings(input);if(!r?.ok){$('dm-credential-status').textContent=r?.error||'保存失败';return false;}$('dm-secret').value='';await dmSettings();return true;}
$('dm-save-settings').onclick=async()=>{if(await dmSaveConfig({appId:$('dm-appid').value,secret:$('dm-secret').value,automatic:$('dm-auto').checked}))if(S.file)loadDanmaku();};
$('dm-clear-settings').onclick=()=>dmSaveConfig({clear:true});
$('dm-auto').onchange=()=>dmSaveConfig({automatic:$('dm-auto').checked});
$('dm-docs').onclick=()=>window.ink.dmDocs();
$('dm-local').onclick=()=>dmWork(async()=>{const r=await window.ink.dmPick();if(r?.canceled)return r;if(!r?.ok)throw Error(r?.error||'无法打开弹幕文件');let comments;
  if(/\.xml$/i.test(r.name)){const xml=new DOMParser().parseFromString(r.text,'application/xml');if(xml.querySelector('parsererror'))throw Error('XML 格式错误');comments=[...xml.querySelectorAll('d[p]')].map(e=>{const p=e.getAttribute('p').split(',');return {time:+p[0],mode:+p[1],color:+p[3],text:e.textContent};});}
  else{let json;try{json=JSON.parse(r.text.replace(/^\uFEFF/,''));}catch{throw Error('JSON 格式错误');}comments=Array.isArray(json)?json:json.comments;}
  return window.ink.dmImport({name:r.name,comments});
});
function dmBuildLayout(w,h){
  const font=Math.max(5,DM.size*w/960),area=h*DM.range,rows=Math.max(0,Math.min(DM.density,Math.floor((area-16)/(font*1.45)))),duration=8;
  dmContext.font='600 '+font+'px "Microsoft YaHei",sans-serif';
  const top=DM.top&&rows>0&&DM.comments.some(c=>c.mode===5)?1:0,bottom=DM.bottom&&rows>top&&DM.comments.some(c=>c.mode===4)?1:0;
  const lanes={1:Array(DM.scroll?Math.max(0,rows-top-bottom):0).fill(null),4:Array(bottom).fill(null),5:Array(top).fill(null)};DM.layout=[];
  for(const c of DM.comments){const width=dmContext.measureText(c.text).width,ls=lanes[c.mode];if(!ls)continue;let lane=-1;
    for(let i=0;i<ls.length;i++){const prev=ls[i],dt=prev?c.time-prev.time:Infinity;
      // Check both entry clearance and end clearance to prevent faster long comments catching up.
      if(!prev||(c.mode!==1?dt>=duration:dt>=duration||((w+prev.width)*dt/duration>=prev.width+18&&(w+width)*dt/duration>=width+18))){lane=i;break;}}
    if(lane<0)continue;ls[lane]={time:c.time,width};DM.layout.push({...c,width,font,lane:lane+(c.mode===1?top:0),duration});
  }
}
// The editing cursor is frame-quantized. Playback uses the continuous media clock
// on every display refresh, including subframes during slow motion.
let dmAnimation=0;
function stopDanmakuAnimation(){cancelAnimationFrame(dmAnimation);dmAnimation=0;}
function startDanmakuAnimation(){stopDanmakuAnimation();if(notesOnlyPreview)return;const tick=()=>{dmAnimation=0;if(!S.playing)return;renderDanmaku();dmAnimation=requestAnimationFrame(tick);};dmAnimation=requestAnimationFrame(tick);}
function danmakuTime(){const source=S.file?currentSource():-1;if(source<0)return {source,time:-1};const video=V[S.active],continuous=S.playing&&!transitioning&&!video.paused&&!video.seeking;return {source,time:(continuous?video.currentTime:source/S.fps)-DM.offset};}
function renderDanmaku(){
  if(notesOnlyPreview)return;
  const w=Math.max(2,Math.round($('wrap').clientWidth)),h=Math.max(2,Math.round($('wrap').clientHeight)),{source,time}=danmakuTime();
  if(dmCanvas.width!==w||dmCanvas.height!==h){dmCanvas.width=w;dmCanvas.height=h;DM.lastFrame='';}
  const key=[w,h,DM.revision,DM.enabled,DM.opacity,time,source<0].join(':');if(key===DM.lastFrame)return;DM.lastFrame=key;dmContext.clearRect(0,0,w,h);
  if(!DM.enabled||source<0||!DM.comments.length)return;
  const layoutKey=[w,h,DM.revision,DM.size,DM.density].join(':');if(layoutKey!==DM.layoutKey){dmBuildLayout(w,h);DM.layoutKey=layoutKey;}
  let lo=0,hi=DM.layout.length;while(lo<hi){const mid=(lo+hi)>>1;if(DM.layout[mid].time<time-8)lo=mid+1;else hi=mid;}
  const g=dmContext;g.save();g.beginPath();g.rect(0,0,w,h*DM.range);g.clip();g.globalAlpha=DM.opacity;g.textBaseline='top';g.lineWidth=2.5;g.lineJoin='round';g.strokeStyle='rgba(0,0,0,.85)';
  for(let i=lo;i<DM.layout.length&&DM.layout[i].time<=time;i++){const c=DM.layout[i],age=time-c.time;if(age<0||age>=c.duration)continue;const x=c.mode===1?w-(w+c.width)*age/c.duration:(w-c.width)/2,y=c.mode===4?h*DM.range-(c.lane+1)*c.font*1.45-8:8+c.lane*c.font*1.45;g.font='600 '+c.font+'px "Microsoft YaHei",sans-serif';g.fillStyle='#'+c.color.toString(16).padStart(6,'0');g.strokeText(c.text,x,y);g.fillText(c.text,x,y);}
  g.restore();
}
