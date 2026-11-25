'use strict';
const {app,BrowserWindow,protocol,dialog,ipcMain,Menu,shell}=require('electron');
const fs=require('node:fs'), fsp=fs.promises, path=require('node:path'), os=require('node:os');
const {Readable}=require('node:stream'),{spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');
const {createHash}=require('node:crypto');
if(process.env.INKCUT_USER_DATA)app.setPath('userData',process.env.INKCUT_USER_DATA);
app.setName('InkCut');
const EXT=new Set(['.mp4','.m4v','.mov','.mkv','.webm','.avi','.flv','.ts']);
const FFMPEG=[process.env.INKCUT_FFMPEG,path.join(__dirname,'tools','ffmpeg.exe')].find(p=>p&&fs.existsSync(p))||'ffmpeg';
const sidecar=p=>path.join(path.dirname(p),path.basename(p,path.extname(p))+'.inkcut.json');
const queues=new Map(),probes=new Map(),jobs=new Map();let win,closing=false;
protocol.registerSchemesAsPrivileged([{scheme:'ink',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,corsEnabled:true}}]);
async function atomic(file,data){
  const task=(queues.get(file)||Promise.resolve()).catch(()=>{}).then(async()=>{
    await fsp.mkdir(path.dirname(file),{recursive:true});const tmp=file+'.'+randomUUID()+'.tmp';
    try{await fsp.writeFile(tmp,JSON.stringify(data,null,2),'utf8');await fsp.rename(tmp,file);}
    finally{await fsp.rm(tmp,{force:true}).catch(()=>{});}
  });queues.set(file,task);try{await task;}finally{if(queues.get(file)===task)queues.delete(file);}
}
async function json(file,fallback=null){try{return JSON.parse(await fsp.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw Error('无法读取 '+file+'：'+e.message);}}
const recentFile=()=>path.join(app.getPath('userData'),'projects.json');let recentQueue=Promise.resolve();
function updateRecent(fn){const task=recentQueue.catch(()=>{}).then(async()=>{const d=await json(recentFile(),{list:[]});d.list=fn(d.list||[]).slice(0,60);await atomic(recentFile(),d);return d.list;});recentQueue=task;return task;}
function validateProject(p){if(!p||typeof p.name!=='string'||!Array.isArray(p.videos)||p.app==='inkcut')throw Error('这个文件不是工程文件');p.id||=randomUUID();return p;}
async function saveProject(p,file){validateProject(p);p.file=path.resolve(file||p.file);p.updatedAt=Date.now();await atomic(p.file,p);const meta={id:p.id,name:p.name,file:p.file,count:p.videos.length,currentPath:p.currentPath,updatedAt:p.updatedAt};await updateRecent(list=>[meta,...list.filter(x=>x.id!==p.id&&x.file!==p.file)]);return {ok:true,file:p.file};}
async function stat(p){try{const s=await fsp.stat(p);return {exists:true,isDir:s.isDirectory(),size:s.size};}catch{return {exists:false,isDir:false};}}
async function item(p,root){const s=await stat(p);return {path:p,name:path.basename(p),rel:root?path.relative(root,p):'',size:s.size,hasNote:fs.existsSync(sidecar(p))};}
const videoNameOrder=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
async function listVideos(root){const files=[];async function walk(dir,depth){if(depth>32||files.length>=20000)return;for(const e of await fsp.readdir(dir,{withFileTypes:true}).catch(()=>[])){const p=path.join(dir,e.name);if(e.isDirectory()&&!['node_modules','.git','$RECYCLE.BIN','System Volume Information'].includes(e.name))await walk(p,depth+1);else if(e.isFile()&&EXT.has(path.extname(p).toLowerCase()))files.push(await item(p,root));}}await walk(root,0);return files.sort((a,b)=>videoNameOrder.compare(a.rel||a.name,b.rel||b.name));}
function run(args,progress){const child=spawn(FFMPEG,['-hide_banner','-nostdin',...args],{windowsHide:true});const promise=new Promise((resolve,reject)=>{let stderr='';child.stderr.on('data',b=>stderr=(stderr+b).slice(-64000));child.stdout.on('data',b=>progress?.(String(b)));child.once('error',reject);child.once('close',code=>code===0?resolve(stderr):reject(Error(stderr.slice(-2500)||'FFmpeg 退出：'+code)));});return {child,promise};}
async function probe(file){const s=await fsp.stat(file),key=file+':'+s.size+':'+s.mtimeMs;if(probes.has(key))return probes.get(key);const text=await run(['-i',file,'-map','0:v:0','-an','-vf','showinfo','-frames:v','1','-f','null','-']).promise;const rate=/frame_rate:\s*(\d+)\/(\d+)/.exec(text),fb=/(\d+(?:\.\d+)?)\s*fps/.exec(text);const num=rate?+rate[1]:(fb?+fb[1]:24),den=rate?+rate[2]:1;const dur=/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text),video=text.split('\n').find(x=>/Stream .*Video:/.test(x))||'',wh=/(\d{2,5})x(\d{2,5})/.exec(video);const info={fps:num/den,fpsNum:num,fpsDen:den,duration:dur?+dur[1]*3600 + +dur[2]*60 + +dur[3]:0,width:wh?+wh[1]:1280,height:wh?+wh[2]:720,hasAudio:/Stream .*Audio:/.test(text)};probes.set(key,info);return info;}
function handle(name,fn){ipcMain.handle(name,async(e,...args)=>{try{return await fn(...args);}catch(err){return {ok:false,error:err.message};}});}
require('./danmaku.cjs').register({app,handle,read:json,write:atomic,dialog,shell,window:()=>win,secure:require('electron').safeStorage});
handle('probe',probe);handle('stat-path',stat);handle('list-videos',listVideos);
const previewJobs=new Map();
handle('preview-cancel',async file=>{const j=previewJobs.get(file);if(j){j.canceled=true;j.child?.kill();}return {ok:true};});
handle('prepare-preview',async file=>{
  const s=await fsp.stat(file),key=createHash('sha256').update(file+':'+s.size+':'+s.mtimeMs).digest('hex');
  const cache=path.join(app.getPath('userData'),'preview-cache'),target=path.join(cache,key+'.mp4');
  if(fs.existsSync(target))return {ok:true,path:target,cached:true};
  const info=await probe(file),j={canceled:false},temp=path.join(cache,key+'.'+randomUUID()+'.mp4');previewJobs.set(file,j);
  try{
    await fsp.mkdir(cache,{recursive:true});const args=['-y','-i',file,'-map','0:v:0','-map','0:a:0?','-vf',"scale='min(1920,iw)':-2",'-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-g',String(Math.max(1,Math.round(info.fps/2))),'-c:a','aac','-b:a','192k','-movflags','+faststart','-progress','pipe:1','-nostats',temp];
    let progress='';const task=run(args,data=>{progress+=data;const m=[...progress.matchAll(/out_time_us=(\d+)/g)];if(m.length&&!win.isDestroyed())win.webContents.send('preview-progress',{file,pct:Math.min(99,+m.at(-1)[1]/1e6/info.duration*100)});progress=progress.slice(-500);});j.child=task.child;await task.promise;if(j.canceled)return {canceled:true};await fsp.rename(temp,target);return {ok:true,path:target};
  }catch(e){return j.canceled?{canceled:true}:{ok:false,error:e.message};}
  finally{previewJobs.delete(file);await fsp.rm(temp,{force:true}).catch(()=>{});}
});
handle('pick-files',async()=>{const r=await dialog.showOpenDialog(win,{title:'导入视频',properties:['openFile','multiSelections'],filters:[{name:'视频',extensions:[...EXT].map(x=>x.slice(1))}]});return r.canceled?[]:Promise.all(r.filePaths.map(p=>item(p)));});
handle('pick-folder',async()=>{const r=await dialog.showOpenDialog(win,{title:'导入文件夹',properties:['openDirectory']});return r.canceled?{files:[]}:{dir:r.filePaths[0],files:await listVideos(r.filePaths[0])};});
handle('pick-video',async()=>{const r=await dialog.showOpenDialog(win,{title:'重新定位视频',properties:['openFile'],filters:[{name:'视频',extensions:[...EXT].map(x=>x.slice(1))}]});return r.canceled?null:r.filePaths[0];});
handle('notes-load',p=>json(sidecar(p)));
handle('notes-save',async(p,d)=>{if(!p||d.app!=='inkcut'||!Array.isArray(d.clips))throw Error('保存内容无效');const target=sidecar(p),existing=await json(target);if(existing&&existing.app!=='inkcut')throw Error('同名文件是工程文件，请更换工程或视频名称');await atomic(target,d);return {ok:true,path:target};});
handle('rename-video',async(old,name)=>{name=String(name||'').trim();if(!name||/[\\/:*?"<>|]/.test(name)||/[. ]$/.test(name))throw Error('文件名无效');const ext=path.extname(old);if(path.extname(name).toLowerCase()!==ext.toLowerCase())name+=ext;const target=path.join(path.dirname(old),name);if(target.toLowerCase()===old.toLowerCase())return {ok:true,...await item(old)};if(fs.existsSync(target)||fs.existsSync(sidecar(target)))throw Error('同名视频或注释文件已存在');await fsp.rename(old,target);try{if(fs.existsSync(sidecar(old)))await fsp.rename(sidecar(old),sidecar(target));}catch(e){await fsp.rename(target,old);throw e;}return {ok:true,...await item(target)};});
handle('projects-list',async()=>{await recentQueue.catch(()=>{});return (await json(recentFile(),{list:[]})).list;});
handle('project-save',saveProject);handle('project-read',async file=>{const p=validateProject(await json(file));p.file=file;return p;});
handle('project-remove',async id=>{await updateRecent(list=>list.filter(p=>p.id!==id));return true;});
handle('project-open-file',async()=>{const r=await dialog.showOpenDialog(win,{title:'打开工程',properties:['openFile'],filters:[{name:'InkCut 工程',extensions:['json']}]});if(r.canceled)return null;const p=validateProject(await json(r.filePaths[0]));p.file=r.filePaths[0];await saveProject(p,p.file);return p;});
handle('default-project-dir',()=>path.join(app.getPath('documents'),'InkCut'));
handle('pick-dir',async title=>{const r=await dialog.showOpenDialog(win,{title,properties:['openDirectory','createDirectory']});return r.canceled?null:r.filePaths[0];});
handle('reveal',p=>{shell.showItemInFolder(p);return true;});
handle('export-begin',async opt=>{
  const info=await probe(opt.file),clips=opt.clips.filter(c=>!c.parked).map(c=>{const rate=c.gap?1:Number(c.rate)||1;return {in:Number(c.in),out:Number(c.out),gap:!!c.gap,rate,frames:Number.isInteger(c.frames)?c.frames:Math.max(1,Math.round((c.out-c.in+1)/rate))};});
  if(!clips.length||clips.some(c=>!Number.isFinite(c.in)||c.in<0||c.out+1<=c.in||!Number.isFinite(c.out)||c.rate<.25||c.rate>4||c.frames<1))throw Error('没有有效片段');
  const r=await dialog.showSaveDialog(win,{title:opt.withNotes?'导出带注释视频':'导出视频',defaultPath:path.join(path.dirname(opt.file),path.basename(opt.file,path.extname(opt.file))+(opt.withNotes?'_标注':'_剪辑')+'.mp4'),filters:[{name:'MP4 视频',extensions:['mp4']}]});
  if(r.canceled)return {canceled:true};if(path.resolve(r.filePath).toLowerCase()===path.resolve(opt.file).toLowerCase())throw Error('导出不能覆盖原视频');
  const id=randomUUID(),dir=await fsp.mkdtemp(path.join(os.tmpdir(),'inkcut-export-')),total=clips.reduce((n,c)=>n+c.frames,0);
  jobs.set(id,{id,dir,opt:{...opt,clips},info,fps:info.fps,total,out:r.filePath,temp:path.join(path.dirname(r.filePath),'.inkcut-'+id+'.mp4'),canceled:false});return {ok:true,id,width:info.width,height:info.height,total};
});
handle('export-image',async(id,index,data)=>{const j=jobs.get(id);if(!j||j.canceled)throw Error('导出已取消');if(!Number.isInteger(index)||index<0)throw Error('图像编号无效');const png=Buffer.from(data,'base64');if(png.readUInt32BE(0)!==0x89504e47)throw Error('不是 PNG 图像');await fsp.writeFile(path.join(j.dir,index+'.png'),png);return {ok:true};});
function sendProgress(j,pct,text){if(win&&!win.isDestroyed())win.webContents.send('export-progress',{id:j.id,pct,text});}
handle('export-cancel',async id=>{const j=jobs.get(id);if(j){j.canceled=true;if(j.child)j.child.kill();else{jobs.delete(id);await fsp.rm(j.dir,{recursive:true,force:true});}}return {ok:true};});
handle('export-run',async(id,intervals)=>{
  const j=jobs.get(id);if(!j)return {ok:false,error:'导出任务不存在'};
  try{
    const {file,clips}=j.opt,{fps,total,info}=j,parts=[],pads=[],hasAudio=info.hasAudio;
    clips.forEach((c,i)=>{const frames=c.frames,duration=(frames/fps).toFixed(12),rate=info.fpsNum+'/'+info.fpsDen;if(c.gap){parts.push(`color=c=black:s=${info.width}x${info.height}:r=${rate}:d=${duration},trim=end_frame=${frames},setsar=1,setpts=PTS-STARTPTS[v${i}]`);if(hasAudio)parts.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${duration},asetpts=PTS-STARTPTS[a${i}]`);}else{
      const phase=(c.in-Math.floor(c.in))/fps,tempo=[];let speed=c.rate;while(speed>2){tempo.push('atempo=2');speed/=2;}while(speed<.5){tempo.push('atempo=0.5');speed/=.5;}tempo.push('atempo='+speed);
      parts.push(`[0:v]trim=start_frame=${Math.floor(c.in)}:end_frame=${Math.ceil(c.out+1)},settb=AVTB,setpts=(PTS-STARTPTS-${phase.toFixed(12)}/TB)/${c.rate},fps=${rate}:round=up:start_time=0,tpad=stop_mode=clone:stop_duration=${duration},trim=end_frame=${frames},setsar=1,setpts=PTS-STARTPTS[v${i}]`);
      if(hasAudio)parts.push(`[0:a]atrim=start=${(c.in/fps).toFixed(12)}:end=${((c.out+1)/fps).toFixed(12)},asetpts=PTS-STARTPTS,${tempo.join(',')},aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=duration=${duration}[a${i}]`);
    }pads.push(`[v${i}]`+(hasAudio?`[a${i}]`:''));});
    parts.push(pads.join('')+`concat=n=${clips.length}:v=1:a=${hasAudio?1:0}[base]`+(hasAudio?'[audio]':''));
    const rate=info.fpsNum+'/'+info.fpsDen,args=['-y','-i',file];
    if(j.opt.withNotes&&intervals?.length){
      let sum=0;const lines=['ffconcat version 1.0'];for(const r of intervals){if(!Number.isInteger(r.image)||!Number.isInteger(r.frames)||r.frames<1||!fs.existsSync(path.join(j.dir,r.image+'.png')))throw Error('注释帧数据无效');sum+=r.frames;lines.push(`file '${r.image}.png'`,`option framerate ${rate}`,`duration ${(r.frames/fps).toFixed(12)}`);}
      if(sum!==total)throw Error('注释时长与剪辑不一致');const last=intervals.at(-1);lines.push(`file '${last.image}.png'`,`option framerate ${rate}`);const list=path.join(j.dir,'overlay.ffconcat');await fsp.writeFile(list,lines.join('\n'));args.push('-safe','0','-f','concat','-i',list);parts.push(`[1:v]fps=${rate},setpts=PTS-STARTPTS[notes]`,`[base][notes]overlay=eof_action=repeat:shortest=0:format=auto,format=yuv420p[video]`);
    }else parts.push('[base]format=yuv420p[video]');
    const script=path.join(j.dir,'filters.txt');await fsp.writeFile(script,parts.join(';'));args.push('-filter_complex_script',script,'-map','[video]');if(hasAudio)args.push('-map','[audio]','-c:a','aac','-b:a','192k');args.push('-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-r',rate,'-frames:v',String(total),'-movflags','+faststart','-progress','pipe:1','-nostats',j.temp);
    let progress='';const task=run(args,data=>{progress+=data;const matches=[...progress.matchAll(/out_time_us=(\d+)/g)];if(matches.length)sendProgress(j,Math.min(99,+matches.at(-1)[1]/1e6/(total/fps)*100),'正在编码');progress=progress.slice(-500);});j.child=task.child;await task.promise;if(j.canceled)return {canceled:true};await fsp.rename(j.temp,j.out);sendProgress(j,100,'导出完成');return {ok:true,path:j.out};
  }catch(e){return j.canceled?{canceled:true}:{ok:false,error:e.message};}
  finally{jobs.delete(id);await fsp.rm(j.dir,{recursive:true,force:true}).catch(()=>{});await fsp.rm(j.temp,{force:true}).catch(()=>{});}
});
ipcMain.on('close-ready',()=>{closing=true;win?.close();});
app.whenReady().then(()=>{
  protocol.handle('ink',async request=>{try{
    const file=new URL(request.url).searchParams.get('p');if(!file||!EXT.has(path.extname(file).toLowerCase()))return new Response('not found',{status:404});const s=await fsp.stat(file);if(!s.isFile())return new Response('not found',{status:404});
    const headers={'Access-Control-Allow-Origin':'*','Accept-Ranges':'bytes','Content-Type':({'.webm':'video/webm','.mov':'video/quicktime','.mkv':'video/x-matroska'})[path.extname(file).toLowerCase()]||'video/mp4'};const range=request.headers.get('range');let start=0,end=s.size-1,status=200;
    if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m||(!m[1]&&!m[2]))return new Response(null,{status:416,headers:{'Access-Control-Allow-Origin':'*','Content-Range':`bytes */${s.size}`}});if(!m[1])start=Math.max(0,s.size-Number(m[2]));else{start=+m[1];if(m[2])end=Math.min(end,+m[2]);}if(start>end||start>=s.size)return new Response(null,{status:416,headers:{'Access-Control-Allow-Origin':'*','Content-Range':`bytes */${s.size}`}});status=206;headers['Content-Range']=`bytes ${start}-${end}/${s.size}`;}
    headers['Content-Length']=String(end-start+1);return new Response(request.method==='HEAD'?null:Readable.toWeb(fs.createReadStream(file,{start,end})),{status,headers});
  }catch{return new Response('not found',{status:404});}});
  Menu.setApplicationMenu(null);win=new BrowserWindow({width:1500,height:950,minWidth:1000,minHeight:650,title:'InkCut · 拉片与标注',backgroundColor:'#14171d',show:false,webPreferences:{preload:path.join(__dirname,'bridge.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});win.loadFile(path.join(__dirname,'index.html'));win.once('ready-to-show',()=>win.show());win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());win.on('close',e=>{if(!closing){e.preventDefault();win.webContents.send('before-close');}});
});
app.on('window-all-closed',()=>app.quit());app.on('before-quit',()=>{for(const j of [...jobs.values(),...previewJobs.values()]){j.canceled=true;j.child?.kill();}});
