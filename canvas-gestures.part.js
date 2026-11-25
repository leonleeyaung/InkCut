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
