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
