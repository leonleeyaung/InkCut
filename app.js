
'use strict';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $ = (id) => document.getElementById(id);
const V = [$('vA'), $('vB')];
const cv = $('draw'), ctx = cv.getContext('2d');
const tl = $('tl'), tctx = tl.getContext('2d');

const S = {
  file: '', fps: 60, total: 0, hasAudio: false,
  videos: [], vi: -1,
  proj: null,
  clips: [], tracks: [{ id: 1, name: '注释 1', color: '#4ea1ff', visible: true }], trackId: 2, curTrack: 1,
  anns: [], annId: 1,
  t: 0, playing: false, tool: 'select',
  selClip: -1, selAnn: null,
  zoom: 4, viewStart: 0,
  hist: [], histPos: -1,
  active: 0, drag: null, draft: null
};

function say(msg) {
  const d = document.createElement('div');
  d.className = 'toast'; d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 1500);
}
const toast = say;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clipLen = c => Math.max(1, Number.isInteger(c.frames)?c.frames:Math.round((c.out-c.in+1)/clipRate(c)));
/* Editable clips keep their own sequence position. Playback resolves only the
   highest visible full-frame clip at each boundary, so only one decoder plays. */
S.videoTracks=[{id:1,name:'视频 1',visible:true}];S.curVideoTrack=1;S.videoTrackId=2;
let sequenceKey='',sequenceCache=[];
function clipRate(c){return c?.gap?1:clamp(Number(c?.rate)||1,.25,4);}
function sourceAt(c,offset){return Math.floor(Math.min(c.in+Math.max(0,offset)*clipRate(c),Math.ceil(c.out+1)-1)+1e-7);}
function sourceBoundary(c,offset){return Math.min(c.out+1,c.in+offset*clipRate(c));}
function sliceClip(c,from,to){return {...c,in:sourceBoundary(c,from),out:sourceBoundary(c,to)-1,start:c.start+from,frames:to-from};}
function noteRange(a,c){const rate=clipRate(c),length=clipLen(c);return [clamp(Math.ceil((a.start-c.in)/rate-1e-7),0,length),clamp(Math.ceil((a.end+1-c.in)/rate-1e-7),0,length)];}
function migrateSequence(saved){
  const modern=Array.isArray(saved?.videoTracks);
  S.videoTracks=modern?saved.videoTracks.map(t=>({...t} )):[{id:1,name:'视频 1',visible:true}];
  let offset=0,oldOffset=0;
  if(!modern&&S.clips.some(c=>c.parked))S.videoTracks.unshift({id:2,name:'视频 2',visible:false});
  S.clips=S.clips.map(c=>{const parked=!!c.parked,track=modern?c.track:(parked?2:1),start=modern?Math.max(0,Math.round(c.start)||0):(parked?oldOffset:offset);if(parked)oldOffset+=clipLen(c);else offset+=clipLen(c);const result={...c,track,start};delete result.parked;return result;}).filter(c=>S.videoTracks.some(t=>t.id===c.track));
  S.videoTrackId=Math.max(0,...S.videoTracks.map(t=>t.id))+1;
  S.curVideoTrack=S.videoTracks.some(t=>t.id===saved?.curVideoTrack)?saved.curVideoTrack:(S.videoTracks.at(-1)?.id??null);
  sequenceKey='';
}
function sequenceClips(){
  const key=S.videoTracks.map(t=>t.id+':'+(t.visible!==false)).join(',')+'|'+S.clips.map(c=>[c.track,c.start,c.in,c.out,c.rate,c.frames].join(':')).join(',');
  if(key===sequenceKey)return sequenceCache;sequenceKey=key;
  const tracks=S.videoTracks.filter(t=>t.visible!==false),eligible=S.clips.filter(c=>tracks.some(t=>t.id===c.track)),end=Math.max(0,...S.clips.map(c=>c.start+clipLen(c)));
  const boundaries=[...new Set([0,end,...eligible.flatMap(c=>[c.start,c.start+clipLen(c)])])].sort((a,b)=>a-b),result=[];
  for(let i=0;i<boundaries.length-1;i++){
    const start=boundaries[i],to=boundaries[i+1];if(to<=start)continue;
    let winner=null;for(const tr of tracks){winner=eligible.findLast(c=>c.track===tr.id&&start>=c.start&&start<c.start+clipLen(c));if(winner)break;}
    winner=winner||null;const previous=result.at(-1);
    if(previous&&previous.origin===winner){previous.frames+=to-start;previous.out=winner?sourceBoundary(winner,to-winner.start)-1:previous.frames-1;continue;}
    result.push(winner?{...sliceClip(winner,start-winner.start,to-winner.start),origin:winner,gap:false}:{in:0,out:to-start-1,frames:to-start,start,origin:null,gap:true});
  }
  sequenceCache=result;return result;
}
const liveClips=()=>sequenceClips();
const timelineTotal=()=>{const clips=sequenceClips();return clips.length?clips.at(-1).start+clipLen(clips.at(-1)):0;};
function timelineToSource(t){const clips=liveClips();for(let i=0;i<clips.length;i++){const c=clips[i];if(t<c.start+clipLen(c)||i===clips.length-1)return {src:c.gap?-1:sourceAt(c,t-c.start),clip:c,index:i,offset:c.start};}return {src:-1,clip:null,index:-1,offset:0};}
function editClip(c){return c?.origin||c;}
function settleOverwrite(c){
  const start=c.start,end=start+clipLen(c),result=[];
  for(const old of S.clips){if(old===c||old.track!==c.track||old.start>=end||old.start+clipLen(old)<=start){result.push(old);continue;}
    const oldEnd=old.start+clipLen(old);
    if(old.start<start)result.push(sliceClip(old,0,start-old.start));
    if(oldEnd>end)result.push(sliceClip(old,end-old.start,clipLen(old)));
  }S.clips=result;S.selClip=S.clips.indexOf(c);sequenceKey='';
}

/* ---------- 历史 ---------- */
function snapshot() { return JSON.stringify({ clips: S.clips, anns: S.anns, tracks: S.tracks, curTrack: S.curTrack, videoTracks:S.videoTracks, curVideoTrack:S.curVideoTrack }); }
function pushHist() {
  const s = snapshot();
  if (S.hist[S.histPos] === s) return;
  S.hist = S.hist.slice(0, S.histPos + 1);
  S.hist.push(s);
  if (S.hist.length > 120) S.hist.shift();
  S.histPos = S.hist.length - 1;
  scheduleSave();updateHistoryButtons();
}
function updateHistoryButtons(){$('undo').disabled=S.histPos<=0;$('redo').disabled=S.histPos>=S.hist.length-1;}
function restoreHist(i) {
  const d = JSON.parse(S.hist[i]);
  S.clips = d.clips; S.anns = d.anns; S.tracks = d.tracks; S.curTrack = d.curTrack; S.videoTracks=d.videoTracks||[];S.curVideoTrack=d.curVideoTrack;S.videoTrackId=Math.max(0,...S.videoTracks.map(t=>t.id))+1;sequenceKey="";
  S.selClip = -1; S.selAnn = null;
  canvasGroup.clear();S.trackId=Math.max(0,...S.tracks.map(t=>t.id))+1;S.annId=Math.max(0,...S.anns.map(a=>a.id))+1;pause();seekTimeline(S.t);drawTimeline();scheduleSave();updateHistoryButtons();
}
function undo() { if (S.histPos <= 0) return toast('没有可撤销的'); S.histPos--; restoreHist(S.histPos); }
function redo() { if (S.histPos >= S.hist.length - 1) return toast('没有可前进的'); S.histPos++; restoreHist(S.histPos); }

/* Playback keeps a distinct source preview so parked/trimmed frames remain inspectable. */
let saveTimer=0, dirty=false, saving=Promise.resolve(), loadToken=0;
function scheduleSave(){dirty=true;$('savehint').textContent='待保存';clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveNow(),1200);}
function dataPayload(){return {app:'inkcut',version:4,fps:S.fps,total:S.total,clips:S.clips,videoTracks:S.videoTracks,curVideoTrack:S.curVideoTrack,tracks:S.tracks,anns:S.anns,curTrack:S.curTrack,t:S.t,danmaku:dmPayload()};}
async function saveNow(){
  clearTimeout(saveTimer);if(!S.file||!dirty)return saving;
  if(S.proj)S.proj.videoLabels=projectVideoLabels();
  const file=S.file,data=JSON.parse(JSON.stringify(dataPayload())),project=S.proj?JSON.parse(JSON.stringify(S.proj)):null;dirty=false;
  saving=saving.catch(()=>false).then(async()=>{
    const r=await window.ink.notesSave(file,data);
    if(!r?.ok){dirty=true;$('savehint').textContent='保存失败';toast(r?.error||'保存失败');return false;}
    if(project){project.currentPath=file;const p=await window.ink.projectSave(project,project.file);if(!p?.ok){dirty=true;toast(p?.error||'工程保存失败');return false;}}
    if(S.file===file&&!dirty)$('savehint').textContent='已自动保存';
    const v=S.videos.find(v=>v.path===file);if(v){v.hasNote=data.anns.length>0;v.cov=coverage(data.anns,data.total);}renderVideos();return true;
  });return saving;
}
function coverage(anns,total){const ranges=anns.map(a=>[a.start,a.end]).sort((a,b)=>a[0]-b[0]);let n=0,end=-1;for(const [a,b]of ranges){n+=Math.max(0,b-Math.max(end,a-1));end=Math.max(end,b);}return Math.min(1,n/Math.max(1,total));}
async function computeCoverage(){for(const v of S.videos){const d=await window.ink.notesLoad(v.path);if(d?.app==='inkcut'){v.hasNote=!!d.anns?.length;v.cov=coverage(d.anns||[],d.total||Math.max(1,...(d.clips||[]).map(c=>c.out+1)));}}renderVideos();}
async function renameVideo(i){
  const v=S.videos[i];if(!v)return;const name=await askText('重命名视频（会修改磁盘文件名）',v.name.replace(/\.[^.]+$/,''));if(!name)return;
  if(await saveNow()===false)return;
  const isCurrent=S.file===v.path;if(isCurrent){pause();V.forEach(v=>{v.removeAttribute('src');v.load();});}
  const r=await window.ink.renameVideo(v.path,name);
  if(!r?.ok){toast(r?.error||'重命名失败');if(isCurrent)await loadVideo(v.path);return;}
  const old=v.path,oldLabel=videoListRows().find(row=>row.v===v)?.label;Object.assign(v,r);v.rel=oldLabel?oldLabel.replace(/[^\\/]+$/,r.name):r.name;
  if(S.proj){delete S.proj.videoLabels?.[old];S.proj.videos=S.proj.videos.map(p=>p===old?r.path:p);if(S.proj.currentPath===old)S.proj.currentPath=r.path;await persistProject();}
  if(isCurrent){S.file='';await loadVideo(r.path);}renderVideos();toast('已重命名');
}
async function openFromList(i){
  const v=S.videos[i];if(!v)return;if(await saveNow()===false)return;
  if(v.missing){const p=await window.ink.pickVideo();if(typeof p!=='string')return;const old=v.path,notes=await window.ink.notesLoad(old),existing=await window.ink.notesLoad(p);if(notes?.app==='inkcut'&&!existing){const r=await window.ink.notesSave(p,notes);if(!r?.ok)return toast(r?.error||'恢复注释失败');}v.path=p;v.name=p.split(/[\\/]/).pop();v.missing=false;if(S.proj){S.proj.videos=S.proj.videos.map(x=>x===old?p:x);await window.ink.projectSave(S.proj,S.proj.file);}}
  S.vi=i;renderVideos();await loadVideo(v.path);
}
async function loadVideo(p){
  DM.generation++;window.ink.dmCancel();DM.busy=false;
  const token=++loadToken;pause();await stopScrub();
  const info=await window.ink.probe(p);if(token!==loadToken)return;
  if(!info||info.error){toast(info?.error||'视频读取失败');return;}
  let restored=await window.ink.notesLoad(p);
  if(restored?.error){toast(restored.error+'；未覆盖原注释');return;}
  async function mount(media){
    const url=window.ink.mediaUrl(media);
    const metadata=new Promise((resolve,reject)=>{const v=V[0];const done=()=>{clean();resolve();},bad=()=>{clean();reject(Error('无法直接播放'));},timeout=setTimeout(bad,12000);function clean(){clearTimeout(timeout);v.removeEventListener('loadedmetadata',done);v.removeEventListener('error',bad);}v.addEventListener('loadedmetadata',done);v.addEventListener('error',bad);});
    V.forEach(v=>{v.pause();v.muted=true;v.src=url;v.preload='auto';v.load();});await metadata;
  }
  try{await mount(p);}catch{
    $('loadingmodal').classList.remove('hide');$('loadingstatus').textContent='正在准备兼容预览，首次打开需要稍候…';S.preparing=p;
    const prepared=await window.ink.preparePreview(p);S.preparing=null;$('loadingmodal').classList.add('hide');
    if(!prepared?.ok){clearMedia();toast(prepared?.canceled?'已取消':prepared?.error||'视频读取失败');return;}
    try{await mount(prepared.path);}catch(e){clearMedia();toast('兼容预览失败：'+e.message);return;}
  }if(token!==loadToken)return;
  applyPreviewView();canvasGroup.clear();S.file=p;S.fps=info.fps;S.info=info;S.hasAudio=info.hasAudio;S.total=Math.max(1,Math.round(V[0].duration*S.fps));
  resetDanmaku(restored?.danmaku);
  S.clips=Array.isArray(restored?.clips)?restored.clips:[{in:0,out:S.total-1}];
  S.clips=S.clips.map(c=>({...c,in:clamp(Number(c.in)||0,0,S.total-0.001),out:clamp(Number(c.out)||0,-.999,S.total-1)})).filter(c=>c.out+1>c.in);
  migrateSequence(restored);
  S.tracks=Array.isArray(restored?.tracks)?restored.tracks:[{id:1,name:'注释 1',color:'#4ea1ff',visible:true,onion:false}];
  S.anns=(restored?.anns||[]).filter(a=>S.tracks.some(t=>t.id===a.track)&&Number.isFinite(a.start)&&Number.isFinite(a.end));
  S.curTrack=S.tracks.some(t=>t.id===restored?.curTrack)?restored.curTrack:(S.tracks[0]?.id??null);
  S.trackId=Math.max(0,...S.tracks.map(t=>t.id))+1;S.annId=Math.max(0,...S.anns.map(a=>a.id))+1;
  S.t=clamp(restored?.t||0,0,Math.max(0,timelineTotal()-1));S.previewSrc=null;S.active=0;S.selAnn=null;S.selClip=-1;pendingSrc=null;seekBusy=false;
  V[0].style.opacity='1';V[0].style.zIndex='2';V[1].style.opacity='0';V[1].style.zIndex='1';
  $('drop').style.display='none';$('startup').classList.add('hide');$('fps').textContent=S.fps.toFixed(3).replace(/\.?0+$/,'');
  $('wrap').style.aspectRatio=info.width+'/'+info.height;layoutCanvas();$('fit').click();
  S.hist=[];S.histPos=-1;pushHist();seekTimeline(S.t);renderFrame();drawTimeline();
  loadDanmaku();
  if(S.proj){S.proj.currentPath=p;await window.ink.projectSave(S.proj,S.proj.file);}
}
function currentSource(){return S.previewSrc??timelineToSource(S.t).src;}
function sourceToTimeline(src,preferred){const target=editClip(preferred);if(target&&!target.gap&&src>=Math.floor(target.in)&&src<Math.ceil(target.out+1))return target.start+clamp(Math.round((src-target.in)/clipRate(target)),0,clipLen(target)-1);let best=null;for(const c of liveClips()){if(!c.gap&&src>=Math.floor(c.in)&&src<Math.ceil(c.out+1)){const t=c.start+clamp(Math.round((src-c.in)/clipRate(c)),0,clipLen(c)-1);if(best===null||Math.abs(t-S.t)<Math.abs(best-S.t))best=t;}}return best;}
let monTimer=0,playIndex=0,transitioning=false,playGeneration=0,preparedIndex=-1,gapClock=0,gapFrame=0;
let pendingSrc=null,seekBusy=false,scrubAudioTimer=0,scrubGeneration=0;
function setVideoTime(v,src){const time=(src+0.1)/S.fps;if(Math.abs(v.currentTime-time)>0.08/S.fps)v.currentTime=Math.max(0,time);}
function decodedSeek(v,src){return new Promise((resolve,reject)=>{
  const target=(src+0.1)/S.fps;if(!v.seeking&&v.readyState>=2&&Math.abs(v.currentTime-target)<0.2/S.fps)return resolve();
  const done=()=>{clearTimeout(timer);v.removeEventListener('seeked',done);v.removeEventListener('error',bad);resolve();};
  const bad=()=>{clearTimeout(timer);v.removeEventListener('seeked',done);reject(Error('视频定位失败'));};
  const timer=setTimeout(bad,8000);v.addEventListener('seeked',done,{once:true});v.addEventListener('error',bad,{once:true});setVideoTime(v,src);
});}
function audioSettings(rate=clipRate(timelineToSource(S.t).clip)){V.forEach((v,i)=>{v.volume=+$('volume').value;v.muted=i!==S.active||$('mute').checked;v.playbackRate=rate;v.preservesPitch=true;});}
function showVideo(show){V.forEach((v,i)=>{v.style.opacity=show&&i===S.active?'1':'0';v.style.zIndex=i===S.active?'2':'1';});}
async function prepareNext(){const live=liveClips(),next=live[playIndex+1];preparedIndex=-1;if(!next||next.gap)return;const index=playIndex+1,gen=playGeneration;try{await decodedSeek(V[1-S.active],next.in);if(gen===playGeneration)preparedIndex=index;}catch{}}
async function play(){
  if(!S.file||!timelineTotal())return;await stopScrub();pause();const gen=++playGeneration;
  if(S.t>=timelineTotal()-1)S.t=0;S.previewSrc=null;const m=timelineToSource(S.t);playIndex=m.index;
  try{if(!m.clip?.gap){await decodedSeek(V[S.active],m.src);if(gen!==playGeneration)return;showVideo(true);audioSettings();await V[S.active].play();}else{showVideo(false);gapClock=performance.now();gapFrame=S.t;}if(gen!==playGeneration)return;S.playing=true;$('play').textContent='暂停';prepareNext();monitor();startDanmakuAnimation();}catch(e){pause();toast('播放失败：'+e.message);}
}
function pause(){stopDanmakuAnimation();S.playing=false;playGeneration++;transitioning=false;$('play').textContent='播放';V.forEach(v=>v.pause());clearInterval(monTimer);}
function monitor(){clearInterval(monTimer);monTimer=setInterval(()=>{
  if(!S.playing||transitioning)return;const live=liveClips(),c=live[playIndex];if(!c){pause();return;}
  const off=c.start,v=V[S.active],src=c.gap?c.in+(performance.now()-gapClock)/1000*S.fps+gapFrame-off:v.currentTime*S.fps;
  const t=off+clamp(Math.floor((src-c.in+0.001)/clipRate(c)),0,clipLen(c)-1);if(t!==S.t){S.t=t;S.previewSrc=null;renderFrame();syncSeek();drawPlayhead();}
  if(src>=c.in+clipLen(c)*clipRate(c)-0.12||(!c.gap&&v.ended)){if(playIndex===live.length-1){pause();seekTimeline(timelineTotal()-1);return;}cutTo(off+clipLen(c));}
},8);}
async function cutTo(t){
  if(transitioning)return;transitioning=true;const gen=playGeneration,m=timelineToSource(t),old=V[S.active],other=V[1-S.active];
  const previous=liveClips()[playIndex];
  if(m.clip?.gap){old.pause();showVideo(false);playIndex=m.index;S.t=t;S.previewSrc=null;gapClock=performance.now();gapFrame=t;transitioning=false;renderFrame();syncSeek();drawPlayhead();prepareNext();return;}
  if(previous&&!previous.gap&&Math.abs(previous.in+clipLen(previous)*clipRate(previous)-m.clip.in)<.001){playIndex=m.index;S.t=t;S.previewSrc=null;audioSettings(clipRate(m.clip));renderFrame();syncSeek();drawPlayhead();transitioning=false;prepareNext();return;}
  try{old.pause();if(preparedIndex!==m.index||other.seeking)await decodedSeek(other,m.src);if(!S.playing||gen!==playGeneration)return;
    old.muted=true;S.active=1-S.active;showVideo(true);audioSettings(clipRate(m.clip));await other.play();
    S.t=t;S.previewSrc=null;playIndex=m.index;renderFrame();syncSeek();drawPlayhead();preparedIndex=-1;prepareNext();
  }catch(e){pause();toast('切换失败：'+e.message);}finally{transitioning=false;}
}
function pumpSeek(){
  if(seekBusy||pendingSrc===null||!S.file)return;const v=V[S.active],target=pendingSrc;pendingSrc=null;seekBusy=true;
  v.pause();clearTimeout(scrubAudioTimer);const gen=++scrubGeneration;
  decodedSeek(v,target).then(()=>{
    seekBusy=false;if(pendingSrc!==null){pumpSeek();return;}
    if(scrubbing&&$('scrubaudio').checked&&gen===scrubGeneration){audioSettings();v.play().catch(()=>{});scrubAudioTimer=setTimeout(()=>{v.pause();setVideoTime(v,target);},65);}
  }).catch(()=>{seekBusy=false;if(pendingSrc!==null)pumpSeek();});
}
let scrubbing=false;
function queueSeek(src){if(src<0){pendingSrc=null;scrubGeneration++;clearTimeout(scrubAudioTimer);V.forEach(v=>v.pause());showVideo(false);return;}showVideo(true);pendingSrc=clamp(Math.round(src),0,S.total-1);pumpSeek();}
function previewSource(src,preferred){pauseIfPlaying();S.previewSrc=clamp(Math.floor(src),0,S.total-1);const t=sourceToTimeline(S.previewSrc,preferred);if(t!==null)S.t=t;queueSeek(S.previewSrc);renderFrame();syncSeek();drawPlayhead();}
function pauseIfPlaying(){if(S.playing)pause();}
function seekTimeline(t){pauseIfPlaying();S.previewSrc=null;S.t=clamp(Math.round(t),0,Math.max(0,timelineTotal()-1));queueSeek(timelineToSource(S.t).src);renderFrame();syncSeek();drawPlayhead();}
async function stopScrub(){scrubbing=false;scrubGeneration++;clearTimeout(scrubAudioTimer);V.forEach(v=>v.pause());if(S.file)queueSeek(currentSource());}
function stepFrame(d){pause();seekTimeline(S.t+d);}
function syncSeek(){const total=timelineTotal(),src=currentSource();$('seek').max=Math.max(0,total-1);$('seek').value=S.t;$('tc').textContent='序列 '+S.t+' / '+total+' · '+(src<0?'空白':'源帧 '+src);$('jump').max=Math.max(0,total-1);if(document.activeElement!==$('jump'))$('jump').value=S.t;$('clipsum').textContent=S.clips.length+' 段 · '+(total/S.fps).toFixed(2)+' 秒';}
function layoutCanvas(){const stage=$('stage').getBoundingClientRect(),ratio=(S.info?.width||16)/(S.info?.height||9),w=Math.min(stage.width,stage.height*ratio),h=w/ratio;const wrap=$('wrap');wrap.style.width=w+'px';wrap.style.height=h+'px';const dpr=devicePixelRatio||1;const cw=Math.max(2,Math.round(w*dpr)),ch=Math.max(2,Math.round(h*dpr));if(cv.width!==cw)cv.width=cw;if(cv.height!==ch)cv.height=ch;}

const videoNameOrder=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
function videoListRows(){
  const paths=S.videos.map(v=>String(v.path||'').replaceAll('\\','/').split('/'));
  let shared=paths[0]?.slice(0,-1)||[];
  for(const parts of paths){let i=0;while(i<shared.length&&i<parts.length-1&&shared[i].toLowerCase()===parts[i].toLowerCase())i++;shared=shared.slice(0,i);}
  return S.videos.map((v,i)=>{const relative=paths[i].slice(shared.length).join('\\');return {v,i,label:v.rel||S.proj?.videoLabels?.[v.path]||relative||v.name||v.path};});
}
function projectVideoLabels(){return Object.fromEntries(videoListRows().map(({v,label})=>[v.path,label]));}

function renderVideos() {
  const box = $('videos');
  const q = ($('vq').value || '').trim().toLowerCase();
  const list = videoListRows().sort((a,b)=>videoNameOrder.compare(a.label,b.label)||videoNameOrder.compare(a.v.path,b.v.path)).filter(({v,label})=>!q||(label+' '+v.path).toLowerCase().includes(q));
  $('vcount').textContent = '视频 ' + (S.videos.length ? '(' + S.videos.length + ')' : '');
  if (!list.length) {
    box.innerHTML = '<div style="padding:12px 10px;color:var(--dim);font-size:12px">' + (S.videos.length ? '没有匹配' : '把视频或文件夹拖进来') + '</div>';
    return;
  }
  box.innerHTML = '';
  list.forEach(({ v, i, label }) => {
    const d = document.createElement('div');
    d.className = 'vi' + (i === S.vi ? ' on' : '');

    const pct = Math.round((v.cov || 0) * 100);
    d.innerHTML = '<span class="n" title="' + esc(v.path) + '">' + esc(label) + '</span>'
      + '<span class="s">' + (v.missing ? '文件失联 · 点击重新定位' : v.hasNote ? '有注释' : '无注释') + (v.size ? ' · ' + Math.round(v.size / 1048576) + 'MB' : '') + '</span>'
      + '<span class="bar"><i style="width:' + pct + '%"></i></span>'
      + '<span class="ops"><b class="ren" title="重命名">改</b><b class="del" title="从列表移除">×</b></span>';
    d.querySelector('.ren').onclick = (ev) => { ev.stopPropagation(); renameVideo(i); };
    d.querySelector('.del').onclick = (ev) => { ev.stopPropagation(); removeVideo(i); };
    d.onclick = () => openFromList(i);
    box.appendChild(d);
  });
}


/* ---------- 画面 ---------- */
function syncAnnBar() {
  const bar = $('annbar');
  if (!bar) return;
  if (!S.selAnn) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  $('edittext').style.display=S.selAnn.tool==='text'?'inline-block':'none';
  if(document.activeElement!==$('annin'))$('annin').value=S.selAnn.start;
  if(document.activeElement!==$('annout'))$('annout').value=S.selAnn.end;
}

function renderFrame() {
  if(!S.playing)renderDanmaku();
  if (!S.file) return;
  const src = currentSource();
  ctx.clearRect(0, 0, cv.width, cv.height);
  if(src<0)return;
  const W = cv.width, H = cv.height;
  // 洋葱皮：开了洋葱的轨道，画前后两帧的淡影
  const onionTracks = S.tracks.filter(tr => tr.onion && tr.visible !== false);
  if (onionTracks.length) {
    const ids = onionTracks.map(x => x.id);
    for (let d = 2; d >= 1; d--) {
      const alpha = 0.30 - (d - 1) * 0.10;
      [src - d, src + d].forEach(f => {
        S.anns.filter(a => ids.includes(a.track) && !(src >= a.start && src <= a.end) && f >= a.start && f <= a.end).forEach(a => {
          const g = ctx;
          g.save(); g.globalAlpha = alpha; paint(a, W, H); g.restore();
        });
      });
    }
  }
  S.anns.filter(a => {
    const tr = S.tracks.find(x => x.id === a.track) || S.tracks[0];
    return (!tr || tr.visible) && src >= a.start && src <= a.end;
  }).forEach(a => paint(a, W, H));
  if (S.draft) paint(S.draft, W, H);
  paintGroupSelection(src,W,H);
  if (S.selAnn && S.tracks.find(t=>t.id===S.selAnn.track)?.visible!==false && src >= S.selAnn.start && src <= S.selAnn.end) {
    const b = bounds(S.selAnn);
    if (b) {
      ctx.save(); ctx.strokeStyle = '#4ea1ff'; ctx.setLineDash([6, 4]); ctx.lineWidth = 2;
      ctx.strokeRect(b.x * W, b.y * H, b.w * W, b.h * H); ctx.restore();
    }
  }
}

function paint(it, W, H, target = ctx) {
  if (!it) return;
  const g = target;
  g.save();
  g.strokeStyle = it.color || '#ff2d55';
  g.fillStyle = it.color || '#ff2d55';
  g.lineWidth = Math.max(1, (it.size || 4) * (W / 1280));
  g.lineCap = 'round'; g.lineJoin = 'round';
  const pts = it.points || [];
  const p = (q) => ({ x: q.x * W, y: q.y * H });
  if (it.tool === 'pen') {
    for(const segment of it.segments || [pts]) {
      if(!segment.length)continue;
      g.beginPath();g.moveTo(p(segment[0]).x,p(segment[0]).y);
      if(segment.length===1){g.lineTo(p(segment[0]).x+0.1,p(segment[0]).y);}
      else for(let i=1;i<segment.length;i++)g.lineTo(p(segment[i]).x,p(segment[i]).y);
      g.stroke();
    }
  } else if (it.tool === 'line' || it.tool === 'rect') {
    if (pts.length >= 2) {
      const a = p(pts[0]), b = p(pts[pts.length - 1]);
      if (it.tool === 'line') {
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
        const ang = Math.atan2(b.y - a.y, b.x - a.x), L = 16 * (W / 1280);
        g.beginPath();
        g.moveTo(b.x, b.y); g.lineTo(b.x - L * Math.cos(ang - 0.4), b.y - L * Math.sin(ang - 0.4));
        g.moveTo(b.x, b.y); g.lineTo(b.x - L * Math.cos(ang + 0.4), b.y - L * Math.sin(ang + 0.4));
        g.stroke();
      } else {
        g.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      }
    }
  } else if (it.tool === 'text') {
    const fs = Math.max(14, (it.size || 4) * 6) * (W / 1280);
    g.font = fs + 'px system-ui,"Microsoft YaHei"';
    g.textBaseline = 'top';
    const q = pts[0] || { x: 0.5, y: 0.5 };
    String(it.text || '').split('\n').forEach((line, i) => g.fillText(line, q.x * W, q.y * H + i * fs * 1.25));
  }
  g.restore();
}

function bounds(it) {
  const pts = it.points || [];
  if (!pts.length) return null;
  let x1 = 1, y1 = 1, x2 = 0, y2 = 0;
  pts.forEach(q => { x1 = Math.min(x1, q.x); y1 = Math.min(y1, q.y); x2 = Math.max(x2, q.x); y2 = Math.max(y2, q.y); });
  if (it.tool === 'text') {
    const lines = String(it.text || '').split('\n');
    const fsPx = Math.max(14, (it.size || 4) * 6);
    const h = (fsPx * 1.5 * lines.length) / (cv.height || 720);
    const w = Math.max(1, ...lines.map(s => s.length)) * (fsPx * 0.62) / (cv.width || 1280);
    x2 = Math.max(x2, x1 + w); y2 = Math.max(y2, y1 + h);
  }
  const pad = 6 / (cv.width || 1280);
  return { x: x1 - pad, y: y1 - pad, w: (x2 - x1) + pad * 2, h: (y2 - y1) + pad * 2 };
}
function hitIn(it, pt) {
  const b = bounds(it);
  if (!b) return false;
  return pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h;
}
function posOf(e) {
  const r = cv.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
}

/* ---------- 画布交互 ---------- */
// Distinguish a tap from an edit before changing playback or annotation data.
let canvasGesture=null, delayedTap=null, suppressCanvasClick=false;
let canvasGroup=new Set();
function visibleAnnotation(a,src){return a.start<=src&&src<=a.end&&S.tracks.some(t=>t.id===a.track&&t.visible!==false);}
function marqueeRect(p,q){return {x:Math.min(p.x,q.x),y:Math.min(p.y,q.y),w:Math.abs(q.x-p.x),h:Math.abs(q.y-p.y)};}
function inMarquee(r,a){const b=bounds(a);return b&&b.x<=r.x+r.w&&b.y<=r.y+r.h&&b.x+b.w>=r.x&&b.y+b.h>=r.y;}
function paintGroupSelection(src,w,h){
  const r=canvasGesture?.box;if(!canvasGroup.size&&!r)return;
  ctx.save();ctx.strokeStyle='#66b7ff';ctx.lineWidth=2;ctx.setLineDash([6,4]);
  for(const a of canvasGroup){if(!visibleAnnotation(a,src))continue;const b=bounds(a);if(b)ctx.strokeRect(b.x*w,b.y*h,b.w*w,b.h*h);}
  if(r){ctx.fillStyle='rgba(70,158,255,.16)';ctx.fillRect(r.x*w,r.y*h,r.w*w,r.h*h);ctx.setLineDash([]);ctx.strokeRect(r.x*w,r.y*h,r.w*w,r.h*h);}
  ctx.restore();
}
function clearCanvasSelection(){canvasGroup.clear();S.selAnn=null;S.selClip=-1;renderFrame();drawTimeline();}
function annotationAt(p,src){return S.anns.findLast(a=>a.start<=src&&src<=a.end&&S.tracks.some(t=>t.id===a.track&&t.visible)&&hitIn(a,p));}
function beginStroke(g){return {id:S.annId++,track:S.curTrack,tool:g.tool,color:$('color').value,size:+$('size').value,points:[g.p],start:g.src,end:g.src,text:''};}
function commitStroke(a){autoPlaceAnnotation(a);S.anns.push(a);S.selAnn=a;S.selClip=-1;pushHist();}
function cancelCanvasTap(){if(delayedTap){clearTimeout(delayedTap);delayedTap=null;}}
cv.tabIndex=-1;
cv.addEventListener('pointerdown',e=>{
  if(!e.isPrimary||e.button!==0||!S.file||S.exporting)return;
  e.preventDefault();cv.focus({preventScroll:true});const p=posOf(e),src=currentSource();suppressCanvasClick=false;
  canvasGesture={id:e.pointerId,x:e.clientX,y:e.clientY,p,src,tool:S.tool,file:S.file,hit:S.tool==='select'?annotationAt(p,src):null};
  cv.setPointerCapture(e.pointerId);
});
function moveCanvasGesture(e){
  const g=canvasGesture;if(!g||g.id!==e.pointerId||g.file!==S.file||S.exporting)return;
  if(!g.moved){
    if(Math.hypot(e.clientX-g.x,e.clientY-g.y)<3)return;
    g.moved=true;cancelCanvasTap();if(g.src<0||g.tool==='text')return;
    pause();if(g.tool==='select'){
      S.selClip=-1;
      if(!g.hit){S.selAnn=null;canvasGroup.clear();g.box=marqueeRect(g.p,g.p);}
      else{
        const members=canvasGroup.has(g.hit)?[...canvasGroup].filter(a=>visibleAnnotation(a,g.src)):[g.hit];
        canvasGroup=new Set(members.length>1?members:[]);S.selAnn=members.length===1?g.hit:null;S.curTrack=g.hit.track;
        g.items=members.map(a=>({a,points:a.points,segments:a.segments}));
      }
    }
    else if(g.tool==='eraser')eraseAt(g.p,g.src);else S.draft=beginStroke(g);
  }
  const p=posOf(e);
  if(g.box){g.box=marqueeRect(g.p,p);canvasGroup=new Set(S.anns.filter(a=>visibleAnnotation(a,g.src)&&inMarquee(g.box,a)));}
  else if(g.items){const shift=q=>({x:q.x+p.x-g.p.x,y:q.y+p.y-g.p.y});for(const it of g.items){it.a.points=it.points.map(shift);if(it.segments)it.a.segments=it.segments.map(s=>s.map(shift));}}
  else if(S.draft){const d=S.draft;if(d.tool==='pen'){const q=d.points.at(-1),r=cv.getBoundingClientRect(),n=Math.ceil(Math.hypot((p.x-q.x)*r.width,(p.y-q.y)*r.height)/2);for(let i=1;i<=n;i++)d.points.push({x:q.x+(p.x-q.x)*i/n,y:q.y+(p.y-q.y)*i/n});}else d.points[1]=p;}
  else if(g.tool==='eraser'&&g.src>=0)eraseAt(p,g.src);
  renderFrame();
}
cv.addEventListener('pointermove',moveCanvasGesture);
cv.addEventListener('pointerup',e=>{
  const g=canvasGesture;if(!g||g.id!==e.pointerId)return;moveCanvasGesture(e);canvasGesture=null;suppressCanvasClick=!!g.moved;
  if(!g.moved)return;
  if(g.box&&canvasGroup.size===1){S.selAnn=[...canvasGroup][0];S.curTrack=S.selAnn.track;canvasGroup.clear();}
  if(S.draft){commitStroke(S.draft);S.draft=null;}else if(g.items||(g.tool==='eraser'&&g.src>=0))pushHist();renderFrame();drawTimeline();
});
cv.addEventListener('pointercancel',()=>{for(const it of canvasGesture?.items||[]){it.a.points=it.points;if(it.segments)it.a.segments=it.segments;}if(canvasGesture?.box)canvasGroup.clear();canvasGesture=null;suppressCanvasClick=true;cancelCanvasTap();});
cv.addEventListener('click',e=>{
  if(suppressCanvasClick||!S.file||S.exporting||e.button!==0)return;
  cancelCanvasTap();if(e.detail===2)return;
  const p=posOf(e),src=currentSource(),tool=S.tool,file=S.file,wasPlaying=S.playing;
  if(tool==='select'){canvasGroup.clear();const hit=annotationAt(p,src);if(hit&&hit!==S.selAnn){S.selAnn=hit;S.selClip=-1;S.curTrack=hit.track;renderFrame();drawTimeline();}else clearCanvasSelection();return;}
  if(S.selAnn||S.selClip>=0){clearCanvasSelection();return;}
  if(src<0||!['text','eraser','pen'].includes(tool))return;
  delayedTap=setTimeout(()=>{delayedTap=null;if(S.file!==file||S.tool!==tool||S.exporting||wasPlaying!==S.playing||(!wasPlaying&&src!==currentSource()))return;
    if(wasPlaying){pause();previewSource(src);}
    if(tool==='text')startText(p,src);else if(tool==='eraser'){eraseAt(p,src);pushHist();}else{const a=beginStroke({p,src,tool});a.points.push({x:p.x+.002,y:p.y});commitStroke(a);}renderFrame();drawTimeline();
  },500);
});
cv.addEventListener('dblclick',e=>{if(e.button!==0||suppressCanvasClick||!S.file||S.exporting)return;e.preventDefault();cancelCanvasTap();clearCanvasSelection();S.playing?pause():play();});

function eraseAt(p,src){
  const r=cv.getBoundingClientRect(),radius=+$('erasize').value||18;
  for(const a of S.anns){if(a.track!==S.curTrack||a.tool!=='pen'||src<a.start||src>a.end)continue;
    const chunks=[];
    for(const segment of a.segments||[a.points]){let chunk=[];for(const q of segment){if(Math.hypot((q.x-p.x)*r.width,(q.y-p.y)*r.height)<=radius){if(chunk.length)chunks.push(chunk);chunk=[];}else chunk.push(q);}if(chunk.length)chunks.push(chunk);}
    a.segments=chunks;
  }
  S.anns=S.anns.filter(a=>!a.segments||a.segments.length);if(S.selAnn&&!S.anns.includes(S.selAnn))S.selAnn=null;renderFrame();
}

function startText(p, src) {
  const box = $('txtbox');
  const wr = $('wrap');
  box.style.display = 'block';
  box.style.left = (p.x * wr.clientWidth - 2) + 'px';
  box.style.top = (p.y * wr.clientHeight - 4) + 'px';
  const ta = box.querySelector('textarea');
  ta.value = ''; ta.style.width = '180px'; ta.style.height = '30px'; ta.focus();
  const done = () => {
    const text = ta.value.trim();
    box.style.display = 'none';
    ta.onblur = null; ta.onkeydown = null;
    if (!text) return;
    if(!S.tracks.length)addAnnotationTrack();if (!S.tracks.some(x => x.id === S.curTrack)) S.curTrack = S.tracks[0].id;
    const a = { id: S.annId++, track: S.curTrack, tool: 'text', color: $('color').value, size: +$('size').value, points: [{ x: p.x, y: p.y }], start: src, end: src, text };
    autoPlaceAnnotation(a); S.anns.push(a); S.selAnn = a;
    pushHist(); renderFrame(); drawTimeline();
  };
  ta.onblur = done;
  ta.onkeydown = (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Escape') { ta.value = ''; done(); }
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); done(); }
  };
}

/* Track headers are real controls; the canvas only handles clips and notes. */
const ROW={ruler:26,group:28,clips:46,track:36},GUTTER=214;
let timelineHits=[],headerKey='';
let snapGuide=null;
function snapTargets(excludeClip,excludeAnn){
  const points=new Set([0,S.t]);
  for(const c of S.clips)if(c!==excludeClip){points.add(c.start);points.add(c.start+clipLen(c));}
  for(const h of timelineHits)if(h.kind==='ann'&&h.a!==excludeAnn&&!(excludeAnn instanceof Set&&excludeAnn.has(h.a))&&editClip(h.c)!==excludeClip){points.add(h.offset+h.from);points.add(h.offset+h.to);}
  return [...points];
}
function snapPosition(value,edges,targets,min,max,disabled){
  value=clamp(value,min,max);snapGuide=null;if(disabled)return value;
  let best=8/S.zoom,result=value;
  for(const edge of edges)for(const target of targets){const candidate=target-edge,distance=Math.abs(candidate-value);if(candidate>=min&&candidate<=max&&distance<=best){best=distance;result=candidate;snapGuide=target;}}
  return result;
}
function updateNoteMarquee(d,p){
  if(!d.box&&Math.hypot(p.x-d.origin.x,p.y-d.origin.y)<4)return;
  const corner={x:clamp(p.x,GUTTER,tl.clientWidth),y:clamp(p.y,trackTop(),tl.clientHeight)};
  const box=d.box=marqueeRect(d.origin,corner);
  canvasGroup.clear();
  for(const hit of timelineHits){
    if(hit.kind==='ann'&&hit.x2>=box.x&&hit.x1<=box.x+box.w&&
       hit.y+hit.h-4>=box.y&&hit.y+4<=box.y+box.h)canvasGroup.add(hit.a);
  }
  renderFrame();drawTimeline();
}
function beginGroupTrim(h,side){
  const key=side==='in'?'start':'end';
  const members=S.anns.filter(a=>canvasGroup.has(a)).map(a=>({ann:a,original:a[key]}));
  let minDelta=-Infinity,maxDelta=Infinity;
  for(const {ann} of members){
    minDelta=Math.max(minDelta,side==='in'?-ann.start:ann.start-ann.end);
    maxDelta=Math.min(maxDelta,side==='in'?ann.end-ann.start:S.total-1-ann.end);
  }
  return {type:'group-trim',key,members,minDelta,maxDelta,c:h.c,ann:h.a,t0:h.t,
    edge:h.offset+(side==='in'?h.from:h.to),targets:snapTargets(null,canvasGroup)};
}
function trimNoteGroup(d,p,alt){
  const rate=clipRate(d.c),edge=snapPosition(d.edge+p.t-d.t0,[0],d.targets,
    d.edge+d.minDelta/rate,d.edge+d.maxDelta/rate,alt);
  const delta=clamp(Math.round((edge-d.edge)*rate),d.minDelta,d.maxDelta);
  for(const {ann,original} of d.members)ann[d.key]=original+delta;
  previewSource(d.ann[d.key],d.c);
}
function xOf(t){return GUTTER+(t-S.viewStart)*S.zoom;}
function tOf(x){return Math.round(S.viewStart+(x-GUTTER)/S.zoom);}
function videoTop(){return ROW.ruler+ROW.group;}
function annGroupTop(){return videoTop()+S.videoTracks.length*ROW.clips;}
function trackTop(){return annGroupTop()+ROW.group;}
function trackHeight(){return trackTop()+S.tracks.length*ROW.track+20;}
function resizeTimeline(){const content=Math.max(trackHeight(),$('tlbox').clientHeight);tl.style.height=content+'px';$('playhead').style.height=content+'px';$('trackheaders').style.height=content+'px';const r=tl.getBoundingClientRect(),dpr=devicePixelRatio||1,w=Math.round(r.width*dpr),h=Math.round(content*dpr);if(tl.width!==w)tl.width=w;if(tl.height!==h)tl.height=h;return {w:r.width,h:content,dpr};}
function block(x1,x2,y,h,color,text,selected){const left=Math.max(GUTTER,x1),right=Math.min(tl.clientWidth,x2);if(right<left)return;tctx.fillStyle=color;tctx.fillRect(left,y+4,Math.max(3,right-left-1),h-8);if(selected){tctx.strokeStyle='#f4d178';tctx.lineWidth=2;tctx.strokeRect(left+1,y+5,Math.max(2,right-left-3),h-10);}if(text&&right-left>25){tctx.save();tctx.beginPath();tctx.rect(left+4,y+4,right-left-8,h-8);tctx.clip();tctx.fillStyle='#e5eef9';tctx.font='11px system-ui';tctx.fillText(text,left+7,y+h/2+4);tctx.restore();}}
function headerButton(action,id,label,title,extra=''){return '<button type="button" data-action="'+action+'" data-id="'+id+'" title="'+esc(title)+'" aria-label="'+esc(title)+'" '+extra+'>'+label+'</button>';}
function renderTrackHeaders(){
  const key=JSON.stringify([S.videoTracks,S.tracks,S.curTrack,S.curVideoTrack]);if(key===headerKey)return;headerKey=key;
  let content='<div class="trackhead rulerhead" style="top:0;height:'+ROW.ruler+'px">序列帧</div>';
  content+='<div class="trackhead trackgroup videohead" style="top:'+ROW.ruler+'px;height:'+ROW.group+'px"><b>视频轨</b><span>上层优先</span>'+headerButton('add-video','', '＋','新增视频轨')+'</div>';
  S.videoTracks.forEach((tr,i)=>{content+='<div class="trackhead videohead '+(tr.id===S.curVideoTrack?'current':'')+'" data-kind="video" data-track="'+tr.id+'" style="top:'+(videoTop()+i*ROW.clips)+'px;height:'+ROW.clips+'px">'+headerButton('visible-video',tr.id,tr.visible!==false?'●':'○',tr.visible!==false?'隐藏视频轨':'显示视频轨','aria-pressed="'+(tr.visible!==false)+'"')+'<span class="trackname" title="双击改名">'+esc(tr.name)+'</span>'+headerButton('add-video',tr.id,'＋','新增视频轨')+headerButton('delete-video',tr.id,'−','删除视频轨')+'</div>';});
  content+='<div class="trackhead trackgroup annotationhead" style="top:'+annGroupTop()+'px;height:'+ROW.group+'px"><b>注释轨</b><span>随画面</span>'+headerButton('add-note','','＋','新增注释轨')+'</div>';
  S.tracks.forEach((tr,i)=>{content+='<div class="trackhead annotationhead '+(tr.id===S.curTrack?'current':'')+'" data-kind="note" data-track="'+tr.id+'" style="top:'+(trackTop()+i*ROW.track)+'px;height:'+ROW.track+'px">'+headerButton('visible-note',tr.id,tr.visible!==false?'●':'○',tr.visible!==false?'隐藏注释轨':'显示注释轨','aria-pressed="'+(tr.visible!==false)+'"')+headerButton('onion',tr.id,'洋',tr.onion?'关闭洋葱皮':'开启洋葱皮','aria-pressed="'+!!tr.onion+'"')+'<span class="trackname" style="border-left:3px solid '+esc(tr.color)+'" title="双击改名">'+esc(tr.name)+'</span>'+headerButton('add-note',tr.id,'＋','新增注释轨')+headerButton('delete-note',tr.id,'−','删除注释轨')+'</div>';});
  $('trackheaders').innerHTML=content;
}
function drawTimeline(){
  syncAnnBar();syncClipSpeed();const {w,h,dpr}=resizeTimeline();tctx.setTransform(dpr,0,0,dpr,0,0);tctx.clearRect(0,0,w,h);timelineHits=[];
  tctx.fillStyle='#14171d';tctx.fillRect(0,0,w,h);tctx.font='11px system-ui';
  const steps=[1,2,5,10,20,30,60,120,300,600,1200,3000,6000,12000,36000,72000],step=steps.find(n=>n*S.zoom>=68)||Math.ceil(70/S.zoom);
  for(let t=Math.floor(S.viewStart/step)*step;xOf(t)<w;t+=step){const x=xOf(t);if(x<GUTTER)continue;tctx.fillStyle='#465164';tctx.fillRect(x,18,1,8);tctx.fillStyle='#9ba8bc';tctx.fillText(String(t),x+4,14);}
  tctx.fillStyle='#203849';tctx.fillRect(GUTTER,ROW.ruler,w-GUTTER,ROW.group);tctx.fillStyle='#352d43';tctx.fillRect(GUTTER,annGroupTop(),w-GUTTER,ROW.group);
  for(const [vi,tr]of S.videoTracks.entries()){
    const y=videoTop()+vi*ROW.clips;tctx.fillStyle=tr.id===S.curVideoTrack?'#1c3040':'#172630';tctx.fillRect(GUTTER,y,w-GUTTER,ROW.clips);tctx.fillStyle='#304451';tctx.fillRect(GUTTER,y+ROW.clips-1,w-GUTTER,1);
    for(const [i,c]of S.clips.entries()){if(c.track!==tr.id)continue;const start=c.start,end=start+clipLen(c);block(xOf(start),xOf(end),y,ROW.clips,tr.visible===false?'#35414a':'#285b7b','镜头 '+(i+1)+' · '+Math.floor(c.in)+'–'+Math.floor(c.out)+' · '+clipRate(c)+'×',S.selClip===i);timelineHits.push({kind:'clip',c,index:i,start,end,x1:xOf(start),x2:xOf(end),y,h:ROW.clips});}
  }
  for(const [ti,tr]of S.tracks.entries()){
    const y=trackTop()+ti*ROW.track;tctx.fillStyle=tr.id===S.curTrack?'#30263b':'#231e2b';tctx.fillRect(GUTTER,y,w-GUTTER,ROW.track);tctx.fillStyle='#44344d';tctx.fillRect(GUTTER,y+ROW.track-1,w-GUTTER,1);
    for(const c of liveClips()){
      if(c.gap)continue;
      for(const a of S.anns.filter(a=>a.track===tr.id)){
        const [from,to]=noteRange(a,c);if(to<=from)continue;
        const x1=xOf(c.start+from),x2=xOf(c.start+to);block(x1,x2,y,ROW.track,tr.visible===false?'#4b414f':a.color,a.text||({pen:'画笔',rect:'方框',line:'箭头',text:'文字'})[a.tool],a===S.selAnn||canvasGroup.has(a));
        if(a===S.selAnn||canvasGroup.has(a)){tctx.fillStyle='white';for(const x of [x1,x2-2])if(x>=GUTTER&&x<w)tctx.fillRect(x-2,y+5,4,ROW.track-10);}
        timelineHits.push({kind:'ann',a,tr,c,offset:c.start,x1,x2,y,h:ROW.track,from,to});
      }
    }
  }
  const box=S.drag?.type==='note-marquee'&&S.drag.box;
  if(box){
    tctx.save();tctx.fillStyle='rgba(70,158,255,.16)';tctx.strokeStyle='#66b7ff';tctx.lineWidth=1;
    tctx.fillRect(box.x,box.y,box.w,box.h);tctx.strokeRect(box.x,box.y,box.w,box.h);tctx.restore();
  }
  tctx.fillStyle='#40506a';tctx.fillRect(GUTTER-1,0,1,h);if(snapGuide!==null&&xOf(snapGuide)>=GUTTER){tctx.save();tctx.strokeStyle='#65f6dc';tctx.setLineDash([4,3]);tctx.beginPath();tctx.moveTo(xOf(snapGuide),ROW.ruler);tctx.lineTo(xOf(snapGuide),h);tctx.stroke();tctx.restore();}renderTrackHeaders();drawPlayhead();
}
function drawPlayhead(){const x=xOf(S.t),p=$('playhead');p.style.display=x>=GUTTER&&x<tl.clientWidth?'block':'none';p.style.left=x+'px';}
function tlPos(e){const r=tl.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;return {x,y,t:tOf(x)};}
function tlHit(e){const p=tlPos(e);if(p.y<ROW.ruler)return {...p,kind:'ruler'};for(const h of [...timelineHits].reverse()){if(p.y>=h.y+(h.kind==='ann'?4:0)&&p.y<h.y+h.h-(h.kind==='ann'?4:0)&&p.x>=Math.max(GUTTER,h.x1-3)&&p.x<=h.x2+3){const tol=Math.min(7,Math.max(2,(h.x2-h.x1)/3));return {...h,...p,nearLeft:p.x-h.x1<tol,nearRight:h.x2-p.x<tol};}}return {...p,kind:'blank',ti:Math.floor((p.y-trackTop())/ROW.track),vi:Math.floor((p.y-videoTop())/ROW.clips)};}
tl.tabIndex=-1;
tl.addEventListener('pointerdown',e=>{
  if(!S.file||S.exporting||e.button===2)return;e.preventDefault();tl.focus({preventScroll:true});tl.setPointerCapture(e.pointerId);
  if(e.button===1||e.shiftKey){S.drag={type:'pan',x0:e.clientX,view0:S.viewStart};return;}
  const h=tlHit(e);
  if(h.kind==='blank'&&h.x>=GUTTER&&h.y>=trackTop()){
    canvasGroup.clear();S.selAnn=null;S.selClip=-1;
    S.drag={type:'note-marquee',origin:h};renderFrame();drawTimeline();return;
  }
  if(h.kind!=='ann')canvasGroup.clear();
  pause();scrubbing=true;
  if(h.kind==='clip'){
    S.selClip=h.index;S.selAnn=null;S.curVideoTrack=h.c.track;const side=h.nearLeft?'in':h.nearRight?'out':null;
    S.drag={type:side?'trim':'move-clip',targets:snapTargets(h.c,null),c:h.c,side,x0:e.clientX,y0:e.clientY,t0:h.t,origStart:h.c.start,origIn:h.c.in,origOut:h.c.out,origLen:clipLen(h.c),rate:clipRate(h.c),grab:clamp(h.t-h.start,0,clipLen(h.c)-1)};
    previewSource(side==='in'?h.c.in:side==='out'?sourceAt(h.c,clipLen(h.c)-1):sourceAt(h.c,S.drag.grab),h.c);drawTimeline();return;
  }
  if(h.kind==='ann'){
    S.selAnn=h.a;S.selClip=-1;S.curTrack=h.tr.id;let side=h.nearLeft?'in':h.nearRight?'out':null;if(h.x2-h.x1<=14)side=e.altKey?null:(h.x>h.x1+1?'out':'in');
    if(side&&canvasGroup.size>1&&canvasGroup.has(h.a)){
      S.selAnn=null;S.drag=beginGroupTrim(h,side);
      previewSource(h.a[S.drag.key],h.c);drawTimeline();return;
    }
    canvasGroup.clear();
    S.drag={type:side?'resize-ann':'move-ann-time',targets:snapTargets(null,h.a),ann:h.a,c:h.c,offset:h.offset,side,t0:h.t,origIn:h.a.start,origOut:h.a.end,clickSource:sourceAt(h.c,h.t-h.offset)};
    previewSource(side==='in'?h.a.start:side==='out'?h.a.end:clamp(sourceAt(h.c,h.t-h.offset),h.a.start,h.a.end),h.c);drawTimeline();return;
  }
  if(S.tracks[h.ti])S.curTrack=S.tracks[h.ti].id;if(h.y>=videoTop()&&h.y<annGroupTop()&&S.videoTracks[h.vi])S.curVideoTrack=S.videoTracks[h.vi].id;
  S.selAnn=null;S.selClip=-1;S.drag={type:'scrub'};seekTimeline(h.t);drawTimeline();
});
tl.addEventListener('pointermove',e=>{
  const d=S.drag,p=tlPos(e);if(!d){const h=tlHit(e);tl.style.cursor=(h.kind==='clip'||h.kind==='ann')&&(h.nearLeft||h.nearRight)?'ew-resize':h.kind==='clip'?'grab':h.kind==='ann'?'move':'pointer';return;}
  if(d.type==='note-marquee'){updateNoteMarquee(d,p);return;}
  if(d.type==='group-trim'){trimNoteGroup(d,p,e.altKey);drawTimeline();return;}
  if(d.type==='pan'){S.viewStart=Math.max(0,d.view0-(e.clientX-d.x0)/S.zoom);drawTimeline();return;}if(d.type==='scrub'){seekTimeline(p.t);return;}
  if(d.type==='trim'){
    const change=Math.round((e.clientX-d.x0)/S.zoom);
    if(d.side==='in'){const edge=snapPosition(d.origStart+change,[0],d.targets,Math.max(0,d.origStart-Math.floor(d.origIn/d.rate)),d.origStart+d.origLen-1,e.altKey),actual=edge-d.origStart;d.c.in=d.origIn+actual*d.rate;d.c.start=edge;d.c.frames=d.origLen-actual;}else{const edge=snapPosition(d.origStart+d.origLen+change,[0],d.targets,d.origStart+1,d.origStart+Math.max(1,Math.round((S.total-d.origIn)/d.rate)),e.altKey);d.c.frames=edge-d.origStart;d.c.out=Math.min(S.total,d.origIn+d.c.frames*d.rate)-1;}
    previewSource(d.side==='in'?sourceAt(d.c,0):sourceAt(d.c,clipLen(d.c)-1),d.c);
  }else if(d.type==='move-clip'){
    if(Math.hypot(e.clientX-d.x0,e.clientY-d.y0)>4){d.c.start=snapPosition(d.origStart+Math.round((e.clientX-d.x0)/S.zoom),[0,clipLen(d.c)],d.targets,0,Infinity,e.altKey);const vi=Math.floor((p.y-videoTop())/ROW.clips);if(p.y>=videoTop()&&p.y<annGroupTop()&&S.videoTracks[vi]){d.c.track=S.videoTracks[vi].id;S.curVideoTrack=d.c.track;}}
    previewSource(sourceAt(d.c,d.grab),d.c);
  }else if(d.type==='resize-ann'){
    const rate=clipRate(d.c),base=d.offset-d.c.in/rate,edge=snapPosition(p.t,[0],d.targets,d.side==='in'?Math.ceil(base):Math.ceil(base+(d.ann.start+1)/rate),d.side==='in'?Math.floor(base+d.ann.end/rate):Math.floor(base+S.total/rate),e.altKey),src=clamp(Math.round((edge-base)*rate)-(d.side==='out'?1:0),0,S.total-1);if(d.side==='in')d.ann.start=src;else d.ann.end=src;previewSource(d.side==='in'?d.ann.start:d.ann.end,d.c);
  }else if(d.type==='move-ann-time'){
    const len=d.origOut-d.origIn,rate=clipRate(d.c),base=d.offset-d.c.in/rate,start=snapPosition(base+d.origIn/rate+p.t-d.t0,[0,(len+1)/rate],d.targets,base,base+(S.total-1-len)/rate,e.altKey),delta=Math.round((start-base)*rate)-d.origIn;d.ann.start=clamp(d.origIn+delta,0,S.total-1-len);d.ann.end=d.ann.start+len;const ti=Math.floor((p.y-trackTop())/ROW.track);if(S.tracks[ti]){d.ann.track=S.tracks[ti].id;S.curTrack=d.ann.track;}previewSource(clamp(d.clickSource+delta,d.ann.start,d.ann.end),d.c);
  }drawTimeline();
});
function finishTimeline(e){
  const d=S.drag;
  if(d?.type==='note-marquee'){
    if(e.type==='pointerup')updateNoteMarquee(d,tlPos(e));
    S.drag=null;
    if(e.type==='pointercancel')canvasGroup.clear();
    else if(!d.box){
      if(S.tracks[d.origin.ti])S.curTrack=S.tracks[d.origin.ti].id;
      seekTimeline(d.origin.t);
    }else if(canvasGroup.size===1){S.selAnn=[...canvasGroup][0];S.curTrack=S.selAnn.track;canvasGroup.clear();}
    drawTimeline();renderFrame();return;
  }
  if(d?.type==='group-trim'&&e.type==='pointercancel'){
    for(const {ann,original} of d.members)ann[d.key]=original;
    S.drag=null;snapGuide=null;stopScrub();renderFrame();drawTimeline();return;
  }
  snapGuide=null;if(S.drag){const d=S.drag;if(d.type==='trim'||d.type==='move-clip')settleOverwrite(d.c);if(!['pan','scrub'].includes(d.type))pushHist();S.drag=null;if(d.type!=='pan')stopScrub();drawTimeline();syncSeek();}}
tl.addEventListener('pointerup',finishTimeline);tl.addEventListener('pointercancel',finishTimeline);
tl.addEventListener('dblclick',async e=>{const h=tlHit(e);if(h.kind==='ann'&&h.a.tool==='text'){const text=await askText('修改文字',h.a.text);if(text!==null){h.a.text=text;pushHist();renderFrame();drawTimeline();}}});
$('trackheaders').addEventListener('click',e=>{
  if(S.exporting)return;const button=e.target.closest('button'),row=e.target.closest('[data-track]');
  if(!button){if(row?.dataset.kind==='video')S.curVideoTrack=+row.dataset.track;else if(row)S.curTrack=+row.dataset.track;drawTimeline();return;}
  pause();const id=+button.dataset.id,action=button.dataset.action;
  if(action==='add-video')return addVideoTrack();if(action==='delete-video')return deleteVideoTrack(id);if(action==='add-note')return addAnnotationTrack();if(action==='delete-note')return deleteAnnotationTrack(id);
  const list=action==='visible-video'?S.videoTracks:S.tracks,tr=list.find(t=>t.id===id);if(!tr)return;
  if(action==='onion')tr.onion=!tr.onion;else tr.visible=tr.visible===false;
  pushHist();seekTimeline(S.t);drawTimeline();
});
$('trackheaders').addEventListener('dblclick',async e=>{if(e.target.closest('button')||S.exporting)return;const row=e.target.closest('[data-track]');if(!row)return;const tr=(row.dataset.kind==='video'?S.videoTracks:S.tracks).find(t=>t.id===+row.dataset.track),name=await askText('轨道名称',tr.name);if(name){tr.name=name;pushHist();drawTimeline();}});

document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
function setTool(t){if(canvasGroup.size){canvasGroup.clear();renderFrame();drawTimeline();}S.tool=t;document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('on',b.dataset.tool===t));cv.style.cursor=t==='select'?'default':t==='text'?'text':t==='eraser'?'cell':'crosshair';}
async function persistProject(){if(!S.proj)return true;S.proj.videos=S.videos.map(v=>v.path);S.proj.videoLabels=projectVideoLabels();const r=await window.ink.projectSave(S.proj,S.proj.file);if(!r?.ok){toast(r?.error||'工程保存失败');return false;}return true;}
async function addVideos(items){if(!Array.isArray(items)||!items.length)return;for(const it of items){if(!/\.(mp4|m4v|mov|mkv|webm|avi|flv|ts)$/i.test(it.path))continue;const old=S.videos.find(v=>v.path===it.path);if(old)Object.assign(old,it);else S.videos.push(it);}renderVideos();await persistProject();await computeCoverage();if(!S.file&&S.videos.length)await openFromList(0);}
$('impfiles').onclick=async()=>addVideos(await window.ink.pickFiles());
$('impfolder').onclick=async()=>{const r=await window.ink.pickFolder();if(!r?.files?.length)return toast('这个文件夹里没有视频');await addVideos(r.files);};
$('vq').oninput=renderVideos;
function clearMedia(){applyPreviewView();canvasGroup.clear();pause();S.file='';dirty=false;clearTimeout(saveTimer);S.clips=[];S.anns=[];S.selAnn=null;S.selClip=-1;S.t=0;S.previewSrc=null;S.hist=[];S.histPos=-1;S.tracks=[{id:1,name:'注释 1',color:'#4ea1ff',visible:true,onion:false}];S.videoTracks=[{id:1,name:'视频 1',visible:true}];S.curVideoTrack=1;S.videoTrackId=2;sequenceKey='';S.trackId=2;S.annId=1;S.curTrack=1;V.forEach(v=>{v.removeAttribute('src');v.load();});ctx.clearRect(0,0,cv.width,cv.height);$('drop').style.display='flex';drawTimeline();syncSeek();updateHistoryButtons();}
async function removeVideo(i){const v=S.videos[i];if(!v)return;if(!confirm('从列表移除「'+v.name+'」？原文件会保留。'))return;if(await saveNow()===false)return;S.videos.splice(i,1);if(S.file===v.path){clearMedia();S.vi=-1;}else if(S.vi>i)S.vi--;renderVideos();await persistProject();}
$('vclear').onclick=async()=>{if(!S.videos.length||!confirm('清空视频列表？原文件会保留。'))return;if(await saveNow()===false)return;clearMedia();S.videos=[];S.vi=-1;renderVideos();await persistProject();};
$('play').onclick=()=>S.playing?pause():play();$('undo').onclick=undo;$('redo').onclick=redo;
$('zoomout').onclick=()=>{S.zoom=Math.max(0.001,S.zoom/1.4);drawTimeline();};$('zoomin').onclick=()=>{S.zoom=Math.min(60,S.zoom*1.4);drawTimeline();};
$('fit').onclick=()=>{S.zoom=Math.min(60,Math.max(0.001,(tl.clientWidth-GUTTER-20)/Math.max(1,timelineTotal())));S.viewStart=0;drawTimeline();};
$('seek').onpointerdown=()=>{pause();scrubbing=true;};$('seek').oninput=e=>seekTimeline(+e.target.value);$('seek').onpointerup=stopScrub;$('seek').onpointercancel=stopScrub;
$('jump').onchange=e=>seekTimeline(+e.target.value);
function syncClipSpeed(){const c=S.clips[S.selClip],input=$('rate');input.disabled=!c||S.exporting;if(document.activeElement!==input)input.value=String(clipRate(c));$('resetvideo').disabled=!S.file||S.exporting;}
function setClipSpeed(rate){
  const c=S.clips[S.selClip];if(!c||S.exporting||![.25,.5,.75,1,1.5,2,3,4].includes(rate))return;
  pause();const oldEnd=c.start+clipLen(c),source=currentSource();c.rate=rate;delete c.frames;const delta=c.start+clipLen(c)-oldEnd;
  for(const next of S.clips)if(next!==c&&next.track===c.track&&next.start>=oldEnd)next.start+=delta;
  pushHist();const target=sourceToTimeline(source,c);seekTimeline(target??c.start);drawTimeline();
}
$('resetvideo').onclick=()=>{if(!S.file||S.exporting)return;pause();S.videoTracks=[{id:1,name:'视频 1',visible:true}];S.curVideoTrack=1;S.videoTrackId=2;S.clips=[{in:0,out:S.total-1,start:0,track:1,rate:1}];S.selClip=0;S.selAnn=null;S.previewSrc=null;pushHist();seekTimeline(0);$('fit').click();toast('已恢复完整视频和 1 倍速，注释已保留；Ctrl+Z 可撤销');};
$('rate').onchange=()=>setClipSpeed(+$('rate').value);$('volume').oninput=()=>audioSettings();$('mute').onchange=()=>audioSettings();
$('tlbox').addEventListener('wheel',e=>{if(!S.file)return;e.preventDefault();if(!e.deltaY)return;const x=Math.max(GUTTER,e.clientX-tl.getBoundingClientRect().left),before=S.viewStart+(x-GUTTER)/S.zoom;S.zoom=clamp(S.zoom*(e.deltaY<0?1.18:1/1.18),0.001,60);S.viewStart=Math.max(0,before-(x-GUTTER)/S.zoom);drawTimeline();},{passive:false});
function updateAnnTime(side,value){const a=S.selAnn;if(!a)return;const v=clamp(Math.round(value)||0,0,S.total-1);if(side==='in')a.start=Math.min(v,a.end);else a.end=Math.max(v,a.start);$('annin').value=a.start;$('annout').value=a.end;pause();previewSource(side==='in'?a.start:a.end);pushHist();drawTimeline();}
$('annin').onchange=e=>updateAnnTime('in',+e.target.value);$('annout').onchange=e=>updateAnnTime('out',+e.target.value);
$('anndel').onclick=()=>{if(!S.selAnn)return;S.anns=S.anns.filter(a=>a!==S.selAnn);S.selAnn=null;pushHist();renderFrame();drawTimeline();};
$('edittext').onclick=async()=>{const a=S.selAnn;if(a?.tool!=='text')return;const text=await askText('修改文字',a.text);if(text!==null){a.text=text;pushHist();renderFrame();drawTimeline();}};
$('color').onchange=()=>{if(S.selAnn){S.selAnn.color=$('color').value;pushHist();renderFrame();drawTimeline();}};
$('size').onchange=()=>{if(S.selAnn){S.selAnn.size=clamp(+$('size').value||4,1,30);pushHist();renderFrame();}};
$('cut').onclick=()=>{if(!S.file||S.exporting||!timelineTotal())return;pause();const selected=S.clips[S.selClip],m=timelineToSource(S.t),c=selected&&S.t>selected.start&&S.t<selected.start+clipLen(selected)?selected:editClip(m.clip);if(!c||c.gap||S.t<=c.start||S.t>=c.start+clipLen(c))return toast('把播放头放到片段内部');const offset=S.t-c.start,index=S.clips.indexOf(c),left=sliceClip(c,0,offset),right=sliceClip(c,offset,clipLen(c));S.clips.splice(index,1,left,right);S.selClip=index+1;S.curVideoTrack=c.track;S.previewSrc=null;pushHist();drawTimeline();seekTimeline(S.t);};
$('delsel').onclick=()=>{if(S.exporting)return;pause();if(S.selAnn)return $('anndel').click();if(S.selClip<0)return;const c=S.clips[S.selClip];if(!c)return;S.clips.splice(S.selClip,1);S.selClip=-1;pushHist();seekTimeline(S.t);drawTimeline();};
function duplicateClip(){if(!S.file||S.exporting)return;const c=S.clips[S.selClip]||editClip(timelineToSource(S.t).clip),source=c&&!c.gap?c:{in:0,out:S.total-1};if(!S.videoTracks.length)addVideoTrack();const track=S.videoTracks.some(t=>t.id===S.curVideoTrack)?S.curVideoTrack:S.videoTracks.at(-1).id,start=Math.max(0,...S.clips.filter(c=>c.track===track).map(c=>c.start+clipLen(c)));S.clips.push({in:source.in,out:source.out,rate:clipRate(source),frames:clipLen(source),start,track});S.selClip=S.clips.length-1;pushHist();drawTimeline();seekTimeline(start);}
function nextTrackNumber(tracks,prefix){const used=new Set(tracks.map(t=>t.name));let n=1;while(used.has(prefix+' '+n))n++;return n;}
function addVideoTrack(){if(S.exporting)return;const id=S.videoTrackId++,number=nextTrackNumber(S.videoTracks,'视频');S.videoTracks.unshift({id,name:'视频 '+number,visible:true});S.curVideoTrack=id;pushHist();drawTimeline();}
function deleteVideoTrack(id){if(S.exporting)return;pause();const tr=S.videoTracks.find(t=>t.id===id);if(!tr)return;if(S.clips.some(c=>c.track===id)&&!confirm('删除「'+tr.name+'」及其中片段？可以撤销。'))return;S.clips=S.clips.filter(c=>c.track!==id);S.videoTracks=S.videoTracks.filter(t=>t.id!==id);S.curVideoTrack=S.videoTracks[0]?.id??null;S.selClip=-1;pushHist();seekTimeline(S.t);drawTimeline();}
function addAnnotationTrack(record=true){if(S.exporting)return null;const id=S.trackId++,number=nextTrackNumber(S.tracks,'注释'),colors=['#b78bfa','#efb655','#7ae4b3','#ff8fab','#8cadff'];S.tracks.push({id,name:'注释 '+number,color:colors[(number-1)%colors.length],visible:true,onion:false});S.curTrack=id;if(record){pushHist();drawTimeline();}return id;}
function annotationTrackHasOverlap(trackId,start,end,exclude=null){
  return S.anns.some(a=>a!==exclude&&a.track===trackId&&a.start<=end&&a.end>=start);
}
function chooseAnnotationTrack(start,end,preferred=S.curTrack,exclude=null){
  const ids=[];
  if(S.tracks.some(t=>t.id===preferred))ids.push(preferred);
  for(const t of S.tracks)if(!ids.includes(t.id))ids.push(t.id);
  const free=ids.find(id=>!annotationTrackHasOverlap(id,start,end,exclude));
  if(free!==undefined){S.curTrack=free;return free;}
  return addAnnotationTrack(false);
}
function autoPlaceAnnotation(a){if(!a)return a;a.track=chooseAnnotationTrack(a.start,a.end,a.track,a);return a;}
function deleteAnnotationTrack(id){if(S.exporting)return;pause();const tr=S.tracks.find(t=>t.id===id);if(!tr)return;if(S.anns.some(a=>a.track===id)&&!confirm('删除「'+tr.name+'」及其中注释？可以撤销。'))return;S.anns=S.anns.filter(a=>a.track!==id);S.tracks=S.tracks.filter(t=>t.id!==id);S.curTrack=S.tracks[0]?.id??null;S.selAnn=null;pushHist();drawTimeline();renderFrame();}

let exportId=null,exportCanceled=false,lastExport=null;
function exportProgress(pct,text){$('exportmodal').classList.remove('hide');$('exportprogress').value=pct;$('exportstatus').textContent=text+' · '+Math.round(pct)+'%';}
async function exportVideo(single){
  if(S.exporting||!S.file)return;let clips=liveClips();if(single){const selected=S.clips[S.selClip],c=selected||editClip(timelineToSource(S.t).clip);clips=c&&!c.gap?[{in:c.in,out:c.out,rate:clipRate(c),frames:clipLen(c)}]:[];}if(!clips.length)return toast('时间轴没有片段');
  S.exporting=true;pause();await stopScrub();if(await saveNow()===false){S.exporting=false;return;}
  const withNotes=$('withnotes').checked,copy=JSON.parse(JSON.stringify({clips:clips.map(c=>({in:c.in,out:c.out,gap:!!c.gap,rate:clipRate(c),frames:clipLen(c)})),anns:S.anns,tracks:S.tracks}));
  S.exporting=true;exportCanceled=false;lastExport=null;
  try{
    const job=await window.ink.exportBegin({file:S.file,clips:copy.clips,withNotes});if(job?.canceled)return;if(!job?.ok)throw Error(job?.error||'无法开始导出');exportId=job.id;exportProgress(0,withNotes?'准备注释':'准备导出');
    const intervals=[];
    if(withNotes){
      const canvas=document.createElement('canvas');canvas.width=job.width;canvas.height=job.height;const g=canvas.getContext('2d'),cache=new Map();let imageCount=0,done=0;
      const anns=copy.anns.filter(a=>copy.tracks.find(t=>t.id===a.track)?.visible!==false);
      for(const c of copy.clips){
        const cuts=new Set([0,c.frames]);for(const a of c.gap?[]:anns){const [from,to]=noteRange(a,c);if(to<=from)continue;cuts.add(from);cuts.add(to);}
        const bounds=[...cuts].sort((a,b)=>a-b);
        for(let i=0;i<bounds.length-1;i++){
          if(exportCanceled)throw Error('已取消');const start=bounds[i],end=bounds[i+1],active=c.gap?[]:anns.filter(a=>{const src=sourceAt(c,start);return src>=a.start&&src<=a.end;});const key=active.map(a=>a.id).join(',');let index=cache.get(key);
          if(index===undefined){index=imageCount++;cache.set(key,index);g.clearRect(0,0,canvas.width,canvas.height);for(const a of active)paint(a,canvas.width,canvas.height,g);const r=await window.ink.exportImage(job.id,index,canvas.toDataURL('image/png').split(',')[1]);if(!r?.ok)throw Error(r?.error||'无法准备注释图层');}
          const previous=intervals.at(-1);if(previous?.image===index)previous.frames+=end-start;else intervals.push({image:index,frames:end-start});done+=end-start;exportProgress(done/job.total*20,'准备注释');await new Promise(r=>requestAnimationFrame(r));
        }
      }
    }
    if(exportCanceled)return;exportProgress(20,'正在导出');const r=await window.ink.exportRun(job.id,intervals);if(r?.canceled)return;if(!r?.ok)throw Error(r?.error||'导出失败');lastExport=r.path;toast('导出完成：'+r.path);
  }catch(e){if(!exportCanceled)alert('导出失败：'+e.message);}
  finally{if(exportId)await window.ink.exportCancel(exportId);exportId=null;S.exporting=false;$('exportmodal').classList.add('hide');if(lastExport){$('exportresult').textContent='已导出 · 点击查看';$('exportresult').title=lastExport;}}
}
$('exportclip').onclick=()=>exportVideo(true);$('export').onclick=()=>exportVideo(false);
$('cancelexport').onclick=async()=>{exportCanceled=true;if(exportId)await window.ink.exportCancel(exportId);};
$('exportresult').onclick=()=>{if(lastExport)window.ink.reveal(lastExport);};
window.ink.onExportProgress(p=>{if(p.id===exportId)exportProgress(20+p.pct*.8,p.text);});
let closingNow=false;
$('cancelload').onclick=()=>{if(S.preparing)window.ink.previewCancel(S.preparing);};
window.ink.onPreviewProgress(p=>{if(p.file===S.preparing)$('loadingstatus').textContent='正在准备兼容预览 · '+Math.round(p.pct)+'% · 原视频保持不变';});
window.ink.onBeforeClose(async()=>{if(closingNow)return;closingNow=true;if(S.preparing)await window.ink.previewCancel(S.preparing);if(S.exporting){if(!confirm('正在导出，取消导出并退出？')){closingNow=false;return;}exportCanceled=true;if(exportId)await window.ink.exportCancel(exportId);}pause();await stopScrub();const ok=await saveNow();if(ok===false&&!confirm('保存失败。仍然退出？未保存的修改会丢失。')){closingNow=false;return;}window.ink.closeReady();});

/* Persist panel sizes locally; splitters support dragging and arrow keys. */
let sidebarWidth=240,sidebarHidden=false;
function setSidebarWidth(width){const max=Math.min(620,window.innerWidth*.5);sidebarWidth=clamp(width,160,max);$('vlist').style.width=sidebarWidth+'px';}
function setSidebarHidden(hidden){sidebarHidden=!!hidden;$('vlist').classList.toggle('hide',sidebarHidden);$('sidebar-resizer').classList.toggle('hide',sidebarHidden);$('sidebar-edge').classList.toggle('collapsed',sidebarHidden);const button=$('toggle-videos'),label=sidebarHidden?'展开视频列表':'收起视频列表';button.textContent=sidebarHidden?'›':'‹';button.title=label;button.setAttribute('aria-label',label);button.setAttribute('aria-expanded',String(!sidebarHidden));}
function setTimelineHeight(height){const max=Math.max(130,$('main').clientHeight+$('tlbox').clientHeight-160),value=clamp(height,130,max);$('tlbox').style.flexBasis=value+'px';$('tlbox').style.height=value+'px';}
function savePanelSizes(){try{localStorage.setItem('inkcut-panels',JSON.stringify({sidebar:sidebarWidth,sidebarHidden,timeline:$('tlbox').clientHeight}));}catch{}}
function bindPanelResize(id,axis){const handle=$(id);let drag=null;
  handle.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();handle.setPointerCapture(e.pointerId);drag={coordinate:axis==='x'?e.clientX:e.clientY,size:axis==='x'?$('vlist').clientWidth:$('tlbox').clientHeight};document.body.classList.add(axis==='x'?'resizing-x':'resizing-y');});
  handle.addEventListener('pointermove',e=>{if(!drag)return;if(axis==='x')setSidebarWidth(drag.size+e.clientX-drag.coordinate);else setTimelineHeight(drag.size-e.clientY+drag.coordinate);});
  const finish=()=>{if(!drag)return;drag=null;document.body.classList.remove('resizing-x','resizing-y');savePanelSizes();};handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);
  handle.addEventListener('keydown',e=>{const horizontal=axis==='x';if(!(horizontal?['ArrowLeft','ArrowRight']:['ArrowUp','ArrowDown']).includes(e.key))return;e.preventDefault();if(horizontal)setSidebarWidth($('vlist').clientWidth+(e.key==='ArrowRight'?16:-16));else setTimelineHeight($('tlbox').clientHeight+(e.key==='ArrowUp'?16:-16));savePanelSizes();});
}
bindPanelResize('sidebar-resizer','x');bindPanelResize('timeline-resizer','y');
try{const sizes=JSON.parse(localStorage.getItem('inkcut-panels')||'null');if(sizes){if(Number.isFinite(sizes.sidebar))setSidebarWidth(sizes.sidebar);if(Number.isFinite(sizes.timeline))setTimelineHeight(sizes.timeline);setSidebarHidden(sizes.sidebarHidden);}}catch{}
$('toggle-videos').onclick=()=>{setSidebarHidden(!sidebarHidden);savePanelSizes();};
window.addEventListener('resize',()=>{setSidebarWidth(sidebarWidth);setTimelineHeight($('tlbox').clientHeight);});

let notesOnlyPreview=false;
$('preview-notes').onclick=()=>{
  notesOnlyPreview=!notesOnlyPreview;
  $('wrap').classList.toggle('notes-only',notesOnlyPreview);
  const button=$('preview-notes');button.setAttribute('aria-pressed',String(notesOnlyPreview));
  button.title=notesOnlyPreview?'恢复视频预览':'隐藏预览画面和弹幕，只看注释';
  if(notesOnlyPreview)stopDanmakuAnimation();else{renderDanmaku();if(S.playing)startDanmakuAnimation();}
};

/* ---------- 工程 ---------- */
function setProjName() { $('pname').textContent = S.proj ? (S.proj.name || '未命名工程') : '未建工程'; }

async function showStartup() {
  pause();if(S.file&&dirty&&await saveNow()===false)return;
  $('su-back').style.display=S.file?'inline-block':'none';
  $('startup').classList.remove('hide');
  const box = $('su-list');
  box.innerHTML = '<div class="su-empty">读取工程…</div>';
  let list = [];
  try { list = await window.ink.projectsList() || []; } catch (e) {}
  if (!list.length) {
    box.innerHTML = '<div class="su-empty">还没有工程。<br>点「＋ 新建工程」，或者直接把视频拖进来。</div>';
    return;
  }
  const q = ($('su-search') ? $('su-search').value : '').trim().toLowerCase();
  const shown = list.filter(p => !q || ((p.name || '') + ' ' + (p.file || '')).toLowerCase().includes(q));
  if (!shown.length) { box.innerHTML = '<div class="su-empty">没有匹配的工程</div>'; return; }
  box.innerHTML = '';
  shown.forEach(p => {
    const d = document.createElement('div');
    d.className = 'su-item';
    d.innerHTML = '<div style="flex:1;overflow:hidden">'
      + '<div class="nm">' + esc(p.name || '未命名') + '</div>'
      + '<div class="path">' + esc(p.file || '') + '</div></div>'
      + '<div class="meta">' + (p.count || 0) + ' 个视频</div>'
      + '<div class="ren" title="改工程名">改名</div>'
      + '<div class="del" title="从列表移除">✕</div>';
    d.querySelector('.del').onclick = async (ev) => {
      ev.stopPropagation();
      await window.ink.projectRemove(p.id);
      showStartup();
    };
    d.querySelector('.ren').onclick = async (ev) => {
      ev.stopPropagation();
      const name = await askText('工程名', p.name || '');
      if (!name) return;
      const proj = await window.ink.projectRead(p.file);
      if (!proj) return toast('读不到这个工程');
      proj.name = name;
      await window.ink.projectSave(proj, p.file);
      if (S.proj && S.proj.id === proj.id) { S.proj.name = name; setProjName(); }
      showStartup();
      toast('已改名');
    };
    d.onclick = async () => {
      const proj = await window.ink.projectRead(p.file);
      if (!proj) return toast('读不到这个工程');
      await openProject(proj);
      $('startup').classList.add('hide');
    };
    box.appendChild(d);
  });
}

async function openProject(proj){
  if(!proj||proj.error){toast(proj?.error||'工程文件读取失败');return false;}
  if(await saveNow()===false)return false;clearMedia();S.proj=proj;setProjName();S.videos=[];
  for(const p of Array.isArray(proj.videos)?proj.videos:[]){const st=await window.ink.statPath(p);S.videos.push({path:p,name:p.split(/[\\/]/).pop(),size:st.size||0,missing:!st.exists,hasNote:false});}
  renderVideos();computeCoverage();const index=S.videos.findIndex(v=>v.path===proj.currentPath&&!v.missing),first=S.videos.findIndex(v=>!v.missing);if(index>=0)await openFromList(index);else if(first>=0)await openFromList(first);return true;
}

function askText(title, def) {
  return new Promise((resolve) => {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;inset:0;background:#000a;z-index:400;display:flex;align-items:center;justify-content:center';
    box.innerHTML = '<div style="background:#252a33;border:1px solid #343b47;border-radius:12px;width:460px;padding:18px 20px">'
      + '<div style="font-size:15px;font-weight:600;margin-bottom:10px">' + title + '</div>'
      + '<input id="at-inp" type="text" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid #343b47;background:#2f3642;color:#e6e9ef;font-size:14px">'
      + '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">'
      + '<button id="at-cancel">取消</button><button id="at-ok" style="background:#4ea1ff;border-color:#4ea1ff;color:#06121f;font-weight:600">确定</button></div></div>';
    document.body.appendChild(box);
    const inp = box.querySelector('#at-inp');
    inp.value = def || '';
    setTimeout(() => { inp.focus(); inp.select(); }, 20);
    const done = (v) => { box.remove(); resolve(v); };
    box.querySelector('#at-ok').onclick = () => done(inp.value.trim());
    box.querySelector('#at-cancel').onclick = () => done(null);
    inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') done(inp.value.trim()); if (e.key === 'Escape') done(null); };
  });
}

function showNewProjectDialog() {
  const d = new Date();
  const defName = '新工程 ' + (d.getMonth() + 1) + '-' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
  return new Promise(async (resolve) => {
    let dir = '';
    try { dir = (await window.ink.defaultProjectDir()) || ''; } catch (e) {}
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;inset:0;background:#000a;z-index:400;display:flex;align-items:center;justify-content:center';
    box.innerHTML = '<div style="background:#252a33;border:1px solid #343b47;border-radius:12px;width:520px;padding:18px 20px">'
      + '<div style="font-size:16px;font-weight:600;margin-bottom:16px">新建工程</div>'
      + '<div style="font-size:12.5px;color:#8b93a1;margin-bottom:6px">工程名</div>'
      + '<input id="np-name" type="text" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid #343b47;background:#2f3642;color:#e6e9ef;font-size:14px;margin-bottom:14px">'
      + '<div style="font-size:12.5px;color:#8b93a1;margin-bottom:6px">位置</div>'
      + '<div style="display:flex;gap:8px;margin-bottom:18px">'
      + '<input id="np-dir" type="text" readonly style="flex:1;padding:8px 10px;border-radius:8px;border:1px solid #343b47;background:#2f3642;color:#c9d2e0;font-size:13px">'
      + '<button id="np-browse">浏览…</button></div>'
      + '<div style="display:flex;gap:8px;justify-content:flex-end">'
      + '<button id="np-cancel">取消</button>'
      + '<button id="np-ok" style="background:#4ea1ff;border-color:#4ea1ff;color:#06121f;font-weight:600">创建</button></div></div>';
    document.body.appendChild(box);
    const inpN = box.querySelector('#np-name');
    const inpD = box.querySelector('#np-dir');
    inpN.value = defName;
    inpD.value = dir;
    box.querySelector('#np-browse').onclick = async () => {
      const picked = await window.ink.pickDir('工程保存在哪');
      if (picked) inpD.value = picked;
    };
    const close = (v) => { box.remove(); resolve(v); };
    box.querySelector('#np-cancel').onclick = () => close(null);
    box.querySelector('#np-ok').onclick = () => {
      const name = (inpN.value || '').trim();
      const where = (inpD.value || '').trim();
      if (!name) return toast('给工程起个名字');
      if (!where) return toast('选一个保存位置');
      close({ name, dir: where });
    };
    inpN.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') box.querySelector('#np-ok').click(); };
    setTimeout(() => { inpN.focus(); inpN.select(); }, 30);
  });
}

$('projbtn').onclick = () => showStartup();
$('su-back').onclick=()=>$('startup').classList.add('hide');
$('su-new').onclick = async () => {
  const r = await showNewProjectDialog();
  if (!r) return;
  const file = r.dir.replace(/[\\/]+$/, '') + '\\' + r.name.replace(/[\\/:*?"<>|]/g, '_') + '.project.inkcut.json';
  const proj = { id: 'p' + Date.now(), name: r.name, file, videos: [], currentPath: '' };
  const result=await window.ink.projectSave(proj,file);if(!result?.ok)return toast(result?.error||'无法创建工程');
  if(await saveNow()===false)return;clearMedia();S.proj=proj;
  setProjName();
  S.videos = [];
  renderVideos();
  $('startup').classList.add('hide');
  toast('工程已建：' + file);
};
$('su-openfile').onclick = async () => {
  const proj = await window.ink.projectOpenFile();
  if (!proj) return;
  if (proj.error) return toast('打不开：' + proj.error);
  await openProject(proj);
  $('startup').classList.add('hide');
};
$('su-search').oninput = () => showStartup();

/* ---------- 拖放 ---------- */
window.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
window.addEventListener('drop',async e=>{
  e.preventDefault();if(S.exporting)return;const items=[];
  for(const file of e.dataTransfer.files||[]){const p=window.ink.pathForFile(file);if(!p)continue;const s=await window.ink.statPath(p);if(s.isDir){const videos=await window.ink.listVideos(p);if(Array.isArray(videos))items.push(...videos);}else if(s.exists)items.push({path:p,name:file.name,size:s.size});}
  if(items.length)await addVideos(items);else toast('没有可导入的视频');
});

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

// Advance immediately on a tap; drive repeats independently of the system keyboard delay.
let heldFrameKey=null;
function stopFrameKeys(){if(heldFrameKey)clearTimeout(heldFrameKey.timer);heldFrameKey=null;}
function canStepHere(el){return S.file&&!S.exporting&&!S.preparing&&!el?.closest?.('input,textarea,select,[contenteditable=true]')&&!document.querySelector('#startup:not(.hide),.modal:not(.hide),#at-inp');}
document.addEventListener('keydown',e=>{
  if(!['ArrowLeft','ArrowRight'].includes(e.key))return;
  if(e.ctrlKey||e.altKey||e.metaKey||!canStepHere(e.target)){stopFrameKeys();return;}
  e.preventDefault();e.stopImmediatePropagation();if(e.repeat)return;
  stopFrameKeys();const dir=e.key==='ArrowRight'?1:-1;
  const h=heldFrameKey={key:e.key,file:S.file,start:performance.now()};stepFrame(dir);
  function repeat(){
    if(heldFrameKey!==h)return;
    if(h.file!==S.file||S.playing||!canStepHere(document.activeElement)){stopFrameKeys();return;}
    const ms=performance.now()-h.start,n=ms<800?2:ms<1600?4:8;
    if((dir>0&&S.t>=timelineTotal()-1)||(dir<0&&S.t<=0)){stopFrameKeys();return;}
    stepFrame(dir*n);h.timer=setTimeout(repeat,50);
  }
  h.timer=setTimeout(repeat,260);
},true);
document.addEventListener('keyup',e=>{if(e.key===heldFrameKey?.key)stopFrameKeys();},true);
window.addEventListener('blur',stopFrameKeys);
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopFrameKeys();});
document.addEventListener('pointerdown',stopFrameKeys,true);

// Offsets are fractions of the fitted image, so resizing the panels preserves the view.
const previewView={scale:1,x:0,y:0};
function applyPreviewView(scale=1,x=0,y=0){
  const limit=Math.max(0,(scale-1)/2),wrap=$('wrap'),badge=$('preview-scale');
  Object.assign(previewView,{scale,x:clamp(x,-limit,limit),y:clamp(y,-limit,limit)});
  wrap.style.transform=scale===1?'':`translate(${previewView.x*100}%,${previewView.y*100}%) scale(${scale})`;
  badge.hidden=scale===1;badge.textContent=Math.round(scale*100)+'%';
}
$('stage').addEventListener('wheel',e=>{
  if(!S.file||S.exporting||S.preparing||canvasGesture||!e.deltaY||e.target.closest('textarea,input'))return;
  e.preventDefault();const r=$('wrap').getBoundingClientRect();if(!r.width||!r.height)return;
  const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?$('stage').clientHeight:1);
  const old=previewView.scale;let scale=clamp(old*2**(-clamp(delta,-400,400)/400),.25,8);
  if(Math.abs(scale-1)<1e-6||(old-1)*(scale-1)<0)scale=1;
  if(scale===old)return;
  const u=clamp((e.clientX-r.left)/r.width,0,1),v=clamp((e.clientY-r.top)/r.height,0,1);
  applyPreviewView(scale,previewView.x+(old-scale)*(u-.5),previewView.y+(old-scale)*(v-.5));
},{passive:false});
$('preview-scale').onclick=()=>applyPreviewView();

/* ---------- Shortcuts and initial page ---------- */
document.addEventListener('keydown',e=>{
  if(!(e.code==='Space'||e.key===' ')||e.isComposing||e.keyCode===229||e.ctrlKey||e.altKey||e.metaKey||e.shiftKey)return;
  if(!S.file||S.preparing||S.exporting||document.querySelector('#startup:not(.hide),.modal:not(.hide),#at-inp,#np-name'))return;
  const target=e.target;if(target.isContentEditable||target.closest?.('textarea,input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=color])'))return;
  e.preventDefault();e.stopImmediatePropagation();if(!e.repeat){S.playing?pause():play();}
},true);
document.addEventListener('keydown',e=>{
  const tag=e.target.tagName?.toLowerCase();if(['input','textarea','select'].includes(tag)||e.target.isContentEditable||e.target.getAttribute('role')==='separator'||S.exporting||document.querySelector('#startup:not(.hide)')||document.querySelector('#at-inp')||document.querySelector('#dmmodal:not(.hide)'))return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo();return;}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();dirty=true;saveNow();return;}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='d'){e.preventDefault();duplicateClip();return;}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('cut').click();return;}
  if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();$('delsel').click();return;}
  if(!e.ctrlKey&&!e.metaKey&&e.key.toLowerCase()==='c'){e.preventDefault();$('cut').click();return;}
  const tool={v:'select','1':'pen','2':'text','3':'line','4':'rect','5':'eraser'}[e.key.toLowerCase()];if(tool)setTool(tool);
});
cv.addEventListener('pointercancel',()=>{S.draft=null;S.drag=null;renderFrame();});
new ResizeObserver(()=>{layoutCanvas();drawTimeline();renderFrame();}).observe($('stage'));
new ResizeObserver(()=>drawTimeline()).observe($('tlbox'));
window.addEventListener('resize',()=>{layoutCanvas();drawTimeline();renderFrame();});
setTool('select');drawTimeline();setProjName();renderVideos();updateHistoryButtons();showStartup();
