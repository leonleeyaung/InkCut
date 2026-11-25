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
