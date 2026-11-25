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
