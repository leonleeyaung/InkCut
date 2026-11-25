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
