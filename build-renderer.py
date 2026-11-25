from pathlib import Path
import re
root=Path(__file__).parent
original=(root/'renderer/base.html').read_text(encoding='utf-8-sig')
html,script=original.split('<script>',1)
script=script.split('</script>',1)[0]
def section(start,end,body):
 global script
 a=script.index(start);b=script.index(end,a);script=script[:a]+body+'\n'+script[b:]
def read(name):return (root/name).read_text(encoding='utf-8')
render=script[script.index('function renderVideos()'):script.index('async function computeCoverage()')]
render=read('video-list.part.js')+'\n'+render
render=render.replace("S.videos.map((v, i) => ({ v, i })).filter(({ v }) => !q || ((v.rel || v.name) + ' ' + v.path).toLowerCase().includes(q))", "videoListRows().sort((a,b)=>videoNameOrder.compare(a.label,b.label)||videoNameOrder.compare(a.v.path,b.v.path)).filter(({v,label})=>!q||(label+' '+v.path).toLowerCase().includes(q))")
render=render.replace('list.forEach(({ v, i }) => {','list.forEach(({ v, i, label }) => {')
render=render.replace('    const label = (v.rel && v.rel !== v.name) ? v.rel : v.name;','')
render=render.replace("v.path + '\">'", "esc(v.path) + '\">'")
render=render.replace("label.replace(/[<>&]/g, '')", "esc(label)")
render=render.replace("(v.hasNote ? '有注释' : '无注释')", "(v.missing ? '文件失联 · 点击重新定位' : v.hasNote ? '有注释' : '无注释')")
section('/* ---------- 存盘 ---------- */','/* ---------- 画面 ---------- */',read('player.part.js')+'\n'+render)
section('/* ---------- 时间轴 ---------- */','/* ---------- 工程 ---------- */',read('timeline-v3.part.js')+'\n'+read('actions.part.js')+'\n'+read('layout.part.js'))
section('const liveClips =','/* ---------- 历史 ---------- */',read('sequence.part.js'))
script=script.replace('const clipLen = (c) => Math.max(1, c.out - c.in + 1);','const clipLen = c => Math.max(1, Number.isInteger(c.frames)?c.frames:Math.round((c.out-c.in+1)/clipRate(c)));')
script=script.replace('tracks: S.tracks, curTrack: S.curTrack });','tracks: S.tracks, curTrack: S.curTrack, videoTracks:S.videoTracks, curVideoTrack:S.curVideoTrack });')
script=script.replace('S.curTrack = d.curTrack;','S.curTrack = d.curTrack; S.videoTracks=d.videoTracks||[];S.curVideoTrack=d.curVideoTrack;S.videoTrackId=Math.max(0,...S.videoTracks.map(t=>t.id))+1;sequenceKey="";')
script=script.replace("const $ = (id)","const esc=s=>String(s??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]));\nconst $ = (id)")
script=script.replace("const src = timelineToSource(S.t).src;", "const src = currentSource();")
script=script.replace('ctx.clearRect(0, 0, cv.width, cv.height);\n  const W', 'ctx.clearRect(0, 0, cv.width, cv.height);\n  if(src<0)return;\n  const W')
script=script.replace('const src = currentSource();\n  if (S.tool', 'const src = currentSource();\n  if(src<0)return;\n  if (S.tool')
script=script.replace('const src = currentSource();\n\n  if (S.tool', 'const src = currentSource();\n  if(src<0)return;\n\n  if (S.tool')
script=script.replace('if (!S.tracks.some(x => x.id === S.curTrack)) S.curTrack = S.tracks[0].id;', 'if(!S.tracks.length)addAnnotationTrack();if (!S.tracks.some(x => x.id === S.curTrack)) S.curTrack = S.tracks[0].id;')
script=script.replace("if (S.selAnn && src >= S.selAnn.start", "if (S.selAnn && S.tracks.find(t=>t.id===S.selAnn.track)?.visible!==false && src >= S.selAnn.start")
script=script.replace("      S.selAnn = hit;", "      S.selAnn = hit;S.curTrack=hit.track;")
script=script.replace("const onionTracks = S.tracks.filter(tr => tr.onion);", "const onionTracks = S.tracks.filter(tr => tr.onion && tr.visible !== false);")
script=script.replace("ids.includes(a.track) && f >= a.start && f <= a.end", "ids.includes(a.track) && !(src >= a.start && src <= a.end) && f >= a.start && f <= a.end")
script=script.replace("function paint(it, W, H) {", "function paint(it, W, H, target = ctx) {")
script=script.replace("const g = ctx;\n  g.save();", "const g = target;\n  g.save();")
a=script.index("  if (it.tool === 'pen') {");b=script.index("  } else if (it.tool === 'line'",a)
script=script[:a]+"""  if (it.tool === 'pen') {
    for(const segment of it.segments || [pts]) {
      if(!segment.length)continue;
      g.beginPath();g.moveTo(p(segment[0]).x,p(segment[0]).y);
      if(segment.length===1){g.lineTo(p(segment[0]).x+0.1,p(segment[0]).y);}
      else for(let i=1;i<segment.length;i++)g.lineTo(p(segment[i]).x,p(segment[i]).y);
      g.stroke();
    }
"""+script[b:]
section("cv.addEventListener('pointerdown', (e) => {",'function eraseAt(p, src) {',read('canvas-gestures.part.js'))
script=script.replace("    S.anns.push(a); S.selAnn = a;\n    pushHist(); renderFrame(); drawTimeline();", "    autoPlaceAnnotation(a); S.anns.push(a); S.selAnn = a;\n    pushHist(); renderFrame(); drawTimeline();")
section('function eraseAt(p, src) {','function startText(p, src) {',"""function eraseAt(p,src){
  const r=cv.getBoundingClientRect(),radius=+$('erasize').value||18;
  for(const a of S.anns){if(a.track!==S.curTrack||a.tool!=='pen'||src<a.start||src>a.end)continue;
    const chunks=[];
    for(const segment of a.segments||[a.points]){let chunk=[];for(const q of segment){if(Math.hypot((q.x-p.x)*r.width,(q.y-p.y)*r.height)<=radius){if(chunk.length)chunks.push(chunk);chunk=[];}else chunk.push(q);}if(chunk.length)chunks.push(chunk);}
    a.segments=chunks;
  }
  S.anns=S.anns.filter(a=>!a.segments||a.segments.length);if(S.selAnn&&!S.anns.includes(S.selAnn))S.selAnn=null;renderFrame();
}
""")
script=script.replace("eraseAt(p, timelineToSource(S.t).src)","eraseAt(p,currentSource())")
script=script.replace("  if (S.drag) { S.drag = null; pushHist(); }", "  if (S.drag) { S.drag = null; pushHist();drawTimeline(); }")
script=script.replace("  bar.style.display = 'flex';", "  bar.style.display = 'flex';\n  $('edittext').style.display=S.selAnn.tool==='text'?'inline-block':'none';")
script=script.replace("  $('annin').value = S.selAnn.start;", "  if(document.activeElement!==$('annin'))$('annin').value=S.selAnn.start;")
script=script.replace("  $('annout').value = S.selAnn.end;", "  if(document.activeElement!==$('annout'))$('annout').value=S.selAnn.end;")
script=script.replace("  drawTimeline(); renderFrame(); syncSeek(); scheduleSave();", "  canvasGroup.clear();S.trackId=Math.max(0,...S.tracks.map(t=>t.id))+1;S.annId=Math.max(0,...S.anns.map(a=>a.id))+1;pause();seekTimeline(S.t);drawTimeline();scheduleSave();updateHistoryButtons();")
script=script.replace("  scheduleSave();\n}\nfunction restoreHist", "  scheduleSave();updateHistoryButtons();\n}\nfunction updateHistoryButtons(){$('undo').disabled=S.histPos<=0;$('redo').disabled=S.histPos>=S.hist.length-1;}\nfunction restoreHist")
script=script.replace("async function showStartup() {", "async function showStartup() {\n  pause();if(S.file&&dirty&&await saveNow()===false)return;\n  $('su-back').style.display=S.file?'inline-block':'none';")
script=script.replace("(p.name || '未命名') + '</div>'", "esc(p.name || '未命名') + '</div>'")
script=script.replace("(p.file || '') + '</div></div>'", "esc(p.file || '') + '</div></div>'")
section('async function openProject(proj) {','function askText(title, def) {',"""async function openProject(proj){
  if(!proj||proj.error){toast(proj?.error||'工程文件读取失败');return false;}
  if(await saveNow()===false)return false;clearMedia();S.proj=proj;setProjName();S.videos=[];
  for(const p of Array.isArray(proj.videos)?proj.videos:[]){const st=await window.ink.statPath(p);S.videos.push({path:p,name:p.split(/[\\\\/]/).pop(),size:st.size||0,missing:!st.exists,hasNote:false});}
  renderVideos();computeCoverage();const index=S.videos.findIndex(v=>v.path===proj.currentPath&&!v.missing),first=S.videos.findIndex(v=>!v.missing);if(index>=0)await openFromList(index);else if(first>=0)await openFromList(first);return true;
}
""")
script=script.replace("  S.proj = proj;\n  setProjName();\n  S.videos = [];", "  if(await saveNow()===false)return;clearMedia();S.proj=proj;\n  setProjName();\n  S.videos = [];")
script=script.replace("  await window.ink.projectSave(proj, file);", "  const result=await window.ink.projectSave(proj,file);if(!result?.ok)return toast(result?.error||'无法创建工程');")
script=script.replace("$('projbtn').onclick = () => showStartup();", "$('projbtn').onclick = () => showStartup();\n$('su-back').onclick=()=>$('startup').classList.add('hide');")
script=script.replace("  const firstPath = pathOf(files[0]);", "  if(S.exporting)return;\n  const firstPath = pathOf(files[0]);")
script=script.replace("+ '.inkcut.json';\n  const proj", "+ '.project.inkcut.json';\n  const proj")
script=script.replace("  addVideos(items);\n  const idx", "  await addVideos(items);\n  const idx")
section("window.addEventListener('drop', async (e) => {",'/* ---------- 键盘 ---------- */',"""window.addEventListener('drop',async e=>{
  e.preventDefault();if(S.exporting)return;const items=[];
  for(const file of e.dataTransfer.files||[]){const p=window.ink.pathForFile(file);if(!p)continue;const s=await window.ink.statPath(p);if(s.isDir){const videos=await window.ink.listVideos(p);if(Array.isArray(videos))items.push(...videos);}else if(s.exists)items.push({path:p,name:file.name,size:s.size});}
  if(items.length)await addVideos(items);else toast('没有可导入的视频');
});
""")
start=script.index('/* ---------- 键盘 ---------- */')
script=script[:start]+"""/* ---------- Shortcuts and initial page ---------- */
document.addEventListener('keydown',e=>{
  if(!(e.code==='Space'||e.key===' ')||e.isComposing||e.keyCode===229||e.ctrlKey||e.altKey||e.metaKey||e.shiftKey)return;
  if(!S.file||S.preparing||S.exporting||document.querySelector('#startup:not(.hide),.modal:not(.hide),#at-inp,#np-name'))return;
  const target=e.target;if(target.isContentEditable||target.closest?.('textarea,input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=color])'))return;
  e.preventDefault();e.stopImmediatePropagation();if(!e.repeat){S.playing?pause():play();}
},true);
document.addEventListener('keydown',e=>{
  const tag=e.target.tagName?.toLowerCase();if(['input','textarea','select'].includes(tag)||e.target.isContentEditable||e.target.getAttribute('role')==='separator'||S.exporting||document.querySelector('#startup:not(.hide)')||document.querySelector('#at-inp'))return;
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
"""
# All drawing calculations are normalized against the actual video rectangle.
script=script.replace("    const dt=Math.round((e.clientX-d.x0)/S.zoom);","")
html=html.replace('<title>InkCut</title>', '''<title>InkCut · 拉片与标注</title><meta http-equiv="Content-Security-Policy" content="default-src 'self' ink: data:; script-src 'self'; style-src 'self' 'unsafe-inline'; media-src ink:; connect-src ink:; img-src 'self' data:">''')
html=html.replace('</style>',"""
  body{display:flex;flex-direction:column}
  #top{flex:none;gap:6px}#pname{max-width:140px}
  #main{height:auto;flex:1;min-height:160px;overflow:hidden}
  #wrap{flex:none;max-width:none;aspect-ratio:auto}
  #tlbox{flex:0 0 230px;height:230px;min-height:130px;overflow:auto;resize:none;background:var(--bg);overscroll-behavior:contain}
  *{scrollbar-width:auto;scrollbar-color:#fff var(--bg)}
  ::-webkit-scrollbar{width:12px;height:12px;background:var(--bg)}
  ::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:var(--bg)}
  ::-webkit-scrollbar-thumb{background:#fff;border:3px solid var(--bg);border-radius:8px;min-height:24px}
  ::-webkit-scrollbar-thumb:hover{background:#fff}
  #videos{scrollbar-width:auto;scrollbar-color:auto}
  #videos::-webkit-scrollbar{width:6px;height:6px;background:var(--panel)}
  #videos::-webkit-scrollbar-track,#videos::-webkit-scrollbar-corner{background:var(--panel)}
  #videos::-webkit-scrollbar-thumb{background:#657080;border:1px solid var(--panel);border-radius:6px}
  #videos::-webkit-scrollbar-thumb:hover{background:#95a0af}
  #vlist{min-width:0;border-right:0}
  #sidebar-resizer{width:7px;flex:none;cursor:col-resize;background:#1c212a;border-left:1px solid #303946;border-right:1px solid #303946;touch-action:none}
  #sidebar-edge{position:relative;width:7px;flex:none;z-index:12}
  #sidebar-edge.collapsed{width:0}
  #sidebar-edge #sidebar-resizer{height:100%}
  #toggle-videos{position:absolute;left:0;top:50%;transform:translateY(-50%);width:18px;height:42px;padding:0;border:1px solid #3b4654;border-left:0;border-radius:0 5px 5px 0;background:#222a34;color:#a8b5c6;font-size:22px;line-height:38px;cursor:pointer}
  #toggle-videos:hover,#toggle-videos:focus-visible{background:#354457;color:#fff}
  #timeline-resizer{height:8px;flex:none;cursor:row-resize;background:#222a34;border-top:1px solid #36404e;border-bottom:1px solid #36404e;touch-action:none}
  #sidebar-resizer:hover,#sidebar-resizer:focus-visible,#timeline-resizer:hover,#timeline-resizer:focus-visible{background:#678fb4;outline:none}
  body.resizing-x,body.resizing-x *{cursor:col-resize!important}body.resizing-y,body.resizing-y *{cursor:row-resize!important}
  #trackheaders{position:absolute;left:0;top:0;width:214px;pointer-events:none;z-index:11}
  .trackhead{position:absolute;left:0;width:214px;display:flex;align-items:center;gap:3px;padding:0 7px;pointer-events:auto;border-right:1px solid #455264;border-bottom:1px solid #36404c;font-size:12px}
  .rulerhead{background:#1b222d;color:#a4b2c5;font-size:11px}
  .videohead{background:#1a3040;color:#b7dff7}.videohead.current{background:#284c65;box-shadow:inset 3px 0 #6bbcff}
  .annotationhead{background:#30243c;color:#e0bff9}.annotationhead.current{background:#493454;box-shadow:inset 3px 0 #d1a0ff}
  .trackhead button{padding:0;min-width:22px;width:22px;height:24px;border-radius:4px;background:#ffffff0a;border:1px solid #ffffff20;color:inherit;line-height:20px;font-size:16px;flex:none}
  .trackhead button:hover{background:#ffffff24}.trackhead button[data-action=onion]{font-size:11px}.trackhead button[aria-pressed=false]{opacity:.45}
  .trackname{min-width:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-left:5px;cursor:default}
  .trackgroup{border-bottom:1px solid #647185}.trackgroup b{font-size:12px}.trackgroup span{font-size:10px;opacity:.65;flex:1;margin-left:3px}
  #tl{position:relative;display:block;inset:auto;width:100%;height:200px;touch-action:none}
  #playhead{position:absolute;top:0;width:2px;background:#f4d178;pointer-events:none;z-index:9}
  #playhead:before{content:'';position:absolute;left:-4px;top:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:8px solid #f4d178}
  #bar{flex:none;flex-wrap:wrap;gap:6px}#seek{min-width:120px}#tc{min-width:190px;font-variant-numeric:tabular-nums}
  #annbar{flex-wrap:wrap}#help{padding:3px 10px;color:#8b93a1;font-size:11px;flex:none;background:#111720}
  #wrap.notes-only{background:#000}
  #wrap.notes-only video,#wrap.notes-only #dmcanvas{visibility:hidden}
  #preview-notes[aria-pressed=true]{background:#344e68;border-color:#86bdf2;color:#fff}
  #draw{touch-action:none}#exportresult{cursor:pointer;color:#93d4a1;font-size:11px}
  button:disabled{opacity:.35;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #6aaeff;outline-offset:2px}
  select{background:#273240;color:#dfe6f2;border:1px solid #405069;border-radius:5px;padding:3px}
  .hide{display:none!important}.modal{position:fixed;inset:0;z-index:500;background:#000b;display:flex;align-items:center;justify-content:center}
  .modalcard{width:420px;padding:28px;background:#202936;border:1px solid #405069;border-radius:14px}
  progress{width:100%;height:14px;accent-color:#4ea1ff}
</style>""")
html=html.replace('<button id="exportclip">', '<label class="tag" title="开启后将可见注释轨的内容合成到视频中"><input type="checkbox" id="withnotes">带注释</label><button id="exportclip">')
a=html.index('<div id="tlbox">');b=html.index('<div id="bar">',a)
html=html[:a]+'<div id="timeline-resizer" role="separator" aria-label="拖动调整轨道栏高度" aria-orientation="horizontal" tabindex="0"></div><div id="tlbox"><canvas id="tl"></canvas><div id="playhead"></div><div id="trackheaders"></div></div>\n\n'+html[b:]
html=html.replace('  <div id="stage">','  <div id="sidebar-edge"><div id="sidebar-resizer" role="separator" aria-label="拖动调整视频列表宽度" aria-orientation="vertical" tabindex="0"></div><button id="toggle-videos" aria-controls="vlist" aria-expanded="true" aria-label="收起视频列表" title="收起视频列表">‹</button></div>\n  <div id="stage">')
html=html.replace('<span class="tag">帧率</span>', '<span class="tag">跳到</span><input id="jump" type="number" min="0" value="0" style="width:76px"><span class="tag">帧率</span>')
html=re.sub(r'<button id="(?:addtrack|addclip)">.*?</button>','',html)
html=html.replace('<button id="cut">切分</button>','<button id="cut" title="切分所选片段或播放头处的上层片段（C / Ctrl+K）">切分 C</button>')
html=html.replace('<button id="play">播放</button>', '<button id="play">播放</button><button id="preview-notes" aria-controls="wrap" aria-pressed="false" title="隐藏预览画面和弹幕，只看注释">只看注释</button>')
html=html.replace('<button id="anndel"', '<button id="edittext">改文字</button><button id="anndel"')
html=html.replace('<button class="su-btn primary" id="su-new">','<button class="su-btn" id="su-back" style="display:none">返回剪辑</button><button class="su-btn primary" id="su-new">')
html=html.replace('<span id="annbar"', '''<label class="tag"><input type="checkbox" id="scrubaudio">拖拽声音</label>
  <label class="tag"><input type="checkbox" id="mute">静音</label><input id="volume" type="range" min="0" max="1" step="0.01" value="1" style="width:60px" title="音量">
  <label class="tag" for="rate">片段速度</label><select id="rate" title="选中视频片段后设置；预览与导出均生效" disabled><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.5">1.5×</option><option value="2">2×</option><option value="3">3×</option><option value="4">4×</option></select><button id="resetvideo" title="恢复完整原视频和 1 倍速，保留注释，可撤销">重置视频</button>
  <span id="exportresult"></span><span id="annbar"''')
html+='''<div id="help">空格 播放/暂停 · 双击画面播放/暂停 · ← → 逐帧（长按加速） · 选择工具拖框多选 · C / Ctrl+K 切分 · Ctrl+D 复制 · Delete 删除 · Ctrl+Z 撤销 · 滚轮缩放 · 右侧滚动条上下移动轨道 · Shift/中键拖动平移</div>
<div id="exportmodal" class="modal hide"><div class="modalcard"><h3>导出视频</h3><p id="exportstatus">准备导出</p><progress id="exportprogress" max="100" value="0"></progress><p>导出期间请稍候，原视频会保留。</p><button id="cancelexport">取消导出</button></div></div>
<div id="loadingmodal" class="modal hide"><div class="modalcard"><h3>准备视频</h3><p id="loadingstatus">正在准备兼容预览…</p><p>仅在无法直接播放时处理。结果会缓存，原视频保持不变。</p><button id="cancelload">取消</button></div></div>
<script src="app.js"></script></body></html>'''
# Danmaku stays below the drawing canvas and never enters the export overlay.
html=html.replace('<canvas id="draw">','<canvas id="dmcanvas" aria-hidden="true"></canvas><canvas id="draw">')
html=html.replace('<span class="tag" id="savehint">','<button id="dm-toggle" aria-pressed="true" title="显示或隐藏弹幕">隐藏弹幕</button><button id="dm-open" aria-label="弹幕设置" title="弹幕设置、匹配与导入">⚙</button><span class="tag" id="savehint">')
html=html.replace('<script src="app.js"></script>',read('danmaku.html')+'<script src="app.js"></script>')
script=script.replace('/* ---------- Shortcuts and initial page ---------- */',read('danmaku.part.js')+'\n/* ---------- Shortcuts and initial page ---------- */')
script=script.replace('function renderFrame() {','function renderFrame() {\n  if(!S.playing)renderDanmaku();')
script=script.replace("function clearMedia(){pause();S.file='';", "function clearMedia(){pause();S.file='';resetDanmaku();")
script=script.replace("document.querySelector('#at-inp')", "document.querySelector('#at-inp')||document.querySelector('#dmmodal:not(.hide)')")
script=script.replace('/* ---------- Shortcuts and initial page ---------- */',read('frame-keys.part.js')+'\n/* ---------- Shortcuts and initial page ---------- */')
script=script.replace('if (S.draft) paint(S.draft, W, H);','if (S.draft) paint(S.draft, W, H);\n  paintGroupSelection(src,W,H);')
html=html.replace('<div id="drop">','<button type="button" id="preview-scale" title="恢复适应窗口" aria-label="恢复适应窗口" hidden></button><div id="drop">')
html=html.replace('#wrap.notes-only{', '#stage{overflow:clip}#preview-scale{position:absolute;right:8px;bottom:8px;z-index:9;font-variant-numeric:tabular-nums}#wrap.notes-only{')
script=script.replace('/* ---------- Shortcuts and initial page ---------- */',read('preview-zoom.part.js')+'\n/* ---------- Shortcuts and initial page ---------- */')
script=script.replace("const wr = $('wrap').getBoundingClientRect();", "const wr = $('wrap');").replace('p.x * wr.width','p.x * wr.clientWidth').replace('p.y * wr.height','p.y * wr.clientHeight')
(root/'index.html').write_text(html,encoding='utf-8')
(root/'app.js').write_text(script,encoding='utf-8')
print('Built renderer:',len(script),'characters')
