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
