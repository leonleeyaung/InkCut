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
