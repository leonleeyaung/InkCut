'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const API='https://api.dandanplay.net',LIMIT=32*1024*1024;
const id=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):null;
const text=x=>String(x??'').slice(0,300);
function signature(appId,secret,timestamp,pathname){return createHash('sha256').update(appId+timestamp+pathname+secret).digest('base64');}
function candidate(c){const episodeId=id(c?.episodeId),animeId=id(c?.animeId);return episodeId?{episodeId,animeId,animeTitle:text(c.animeTitle),episodeTitle:text(c.episodeTitle),shift:Number.isFinite(+c.shift)?Math.max(-36000,Math.min(36000,+c.shift)):0}:null;}
function normalizeComments(items){
  if(!Array.isArray(items))throw Error('弹幕数据格式不正确');
  const seen=new Set(),out=[];
  for(const c of items.slice(0,100000)){const p=String(c.p??'').split(','),time=Number(c.time??p[0]),mode=Number(c.mode??p[1]),color=Number(c.color??p[2]),message=text(c.text??c.m).replace(/[\u0000-\u0008\u000b-\u001f]/g,'');
    if(!Number.isFinite(time)||time<0||time>86400||![1,4,5].includes(mode)||!message.trim())continue;
    const key=time+'|'+mode+'|'+message;if(seen.has(key))continue;seen.add(key);out.push({time,mode,color:Number.isInteger(color)&&color>=0&&color<=0xffffff?color:0xffffff,text:message});
  }return out.sort((a,b)=>a.time-b.time);
}
function fileHint(file){
  const dir=path.dirname(file),stem=path.basename(file,path.extname(file)),folder=path.basename(dir);
  const folderNumber=/^0*(\d{1,3})$/.exec(folder),number=/^(?:第\s*)?0*(\d{1,3})(?:\s*[集话話])?$/.exec(stem)||/(?:^|[ ._\-\[])S\d{1,2}E(\d{1,3})(?:\D|$)/i.exec(stem)||/(?:^|[ ._\-\[])E(?:P)?[ ._-]?(\d{1,3})(?:\D|$)/i.exec(stem)||/[第]\s*(\d{1,3})\s*[集话話]/.exec(stem);
  const scope=folderNumber?path.dirname(dir):dir,episode=Number(folderNumber?.[1]||number?.[1])||null;
  return {scope,key:path.resolve(scope).toLowerCase(),episode,title:path.basename(scope),kind:folderNumber?'folder':'file'};
}
class DanmakuService{
  constructor({root,read,write,secure,fetchImpl=globalThis.fetch}){Object.assign(this,{root,read,write,secure,fetch:fetchImpl});this.controllers=new Set();this.generation=0;}
  configPath(){return path.join(this.root,'danmaku-settings.json');}
  async config(){return await this.read(this.configPath(),{})||{};}
  async settings(){const c=await this.config();return {ok:true,appId:c.appId||'',configured:!!(c.appId&&c.secret),automatic:c.automatic!==false};}
  async saveSettings(input){const c=await this.config();if(input.clear){delete c.appId;delete c.secret;}else if(input.appId!==undefined){const appId=String(input.appId).trim(),secret=String(input.secret||'').trim();if(!appId||appId.length>200||/[\r\n]/.test(appId))throw Error('请填写有效的 AppId');if(secret){if(secret.length>1000)throw Error('密钥长度无效');if(!this.secure.isEncryptionAvailable())throw Error('系统凭证加密暂不可用，未保存密钥');c.secret=this.secure.encryptString(secret).toString('base64');}else if(appId!==c.appId||!c.secret)throw Error('请同时填写 AppSecret');c.appId=appId;}
    if(typeof input.automatic==='boolean')c.automatic=input.automatic;await this.write(this.configPath(),c);return this.settings();
  }
  cancel(){this.generation++;for(const c of this.controllers)c.abort();this.controllers.clear();return {ok:true};}
  check(gen){if(gen!==this.generation)throw Error('操作已取消');}
  async request(route,{body,query}={}){
    const c=await this.config();if(!c.appId||!c.secret)throw Error('请先在「在线服务设置」填写应用凭证');
    let secret;try{secret=this.secure.decryptString(Buffer.from(c.secret,'base64'));}catch{throw Error('无法解密应用凭证，请重新填写');}
    const timestamp=String(Math.floor(Date.now()/1000)),pathname='/api/v2/'+route;
    let url=API+pathname+(query?'?'+new URLSearchParams(query):''),headers={'X-AppId':c.appId,'X-Timestamp':timestamp,'X-Signature':signature(c.appId,secret,timestamp,pathname),'Accept':'application/json','Content-Type':'application/json'},method=body?'POST':'GET';
    const controller=new AbortController();this.controllers.add(controller);const timer=setTimeout(()=>controller.abort(),15000);
    try{for(let redirects=0;redirects<4;redirects++){
      const response=await this.fetch(url,{method,headers,body:body?JSON.stringify(body):undefined,redirect:'manual',signal:controller.signal});
      if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');await response.body?.cancel();if(!location)throw Error('弹幕服务跳转地址缺失');const next=new URL(location,url);if(next.protocol!=='https:')throw Error('弹幕服务跳转地址不安全');url=next.href;headers={Accept:'application/json'};method='GET';body=undefined;continue;}
      if(!response.ok){await response.body?.cancel();throw Error([401,403].includes(response.status)?'应用凭证验证失败，请检查 AppId、AppSecret 和电脑时间':response.status===429?'请求较频繁，请稍后再试':'弹幕服务暂不可用（'+response.status+'）');}
      const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>LIMIT){controller.abort();throw Error('弹幕数据过大');}chunks.push(chunk);}
      let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('弹幕服务返回了无效数据');}
      if(data.success===false)throw Error(text(data.errorMessage)||'弹幕服务拒绝了请求');return data;
    }throw Error('弹幕服务跳转次数过多');
    }catch(e){if(controller.signal.aborted)throw Error('弹幕请求已取消或超时');if(e.message==='fetch failed')throw Error('无法连接弹幕服务，请检查网络');throw e;}finally{clearTimeout(timer);this.controllers.delete(controller);}
  }
  async cached(key,loader,{refresh=false}={}){const file=path.join(this.root,'danmaku-cache',key+'.json');let old;try{old=await this.read(file);}catch{old=null;}
    if(old&&!refresh)return {...old,cached:true};const gen=this.generation;try{const data=await loader();this.check(gen);const entry={...data,savedAt:Date.now()};await this.write(file,entry);return {...entry,cached:false};}catch(e){this.check(gen);if(old)return {...old,cached:true,warning:'更新失败，继续使用缓存：'+e.message};throw e;}}
  async comments(binding,refresh=false){if(binding.localKey&&/^[a-f0-9]{64}$/.test(binding.localKey))return this.cached('local-'+binding.localKey,async()=>{throw Error('本地弹幕缓存已丢失，请重新导入');});const episodeId=id(binding.episodeId);if(!episodeId)throw Error('剧集编号无效');return this.cached('episode-'+episodeId,async()=>{const r=await this.request('comment/'+episodeId,{query:{withRelated:'true'}});return {comments:normalizeComments(r.comments)};},{refresh});}
  async search(title,episode=''){title=String(title||'').trim();if(title.length<2)throw Error('番剧名称至少填写两个字');const query={anime:title.slice(0,200),v2:'true'};if(/^\d{1,4}$/.test(episode))query.episode=episode;
    const key=createHash('sha256').update(JSON.stringify(query)).digest('hex'),cacheFile=path.join(this.root,'danmaku-cache','search-'+key+'.json');let old;try{old=await this.read(cacheFile);}catch{}if(old&&Date.now()-old.savedAt<6*3600000)return old;
    const r=await this.request('search/episodes',{query}),matches=(r.animes||[]).flatMap(a=>(a.episodes||[]).map(e=>candidate({...e,animeId:a.animeId,animeTitle:a.animeTitle}))).filter(Boolean).slice(0,1500);const data={ok:true,matches,hasMore:!!r.hasMore,savedAt:Date.now()};await this.write(cacheFile,data);return data;
  }
  async fingerprint(file){const stat=await fs.stat(file);if(!stat.isFile())throw Error('视频文件不存在');const hash=createHash('md5'),handle=await fs.open(file,'r');try{let pos=0;const size=Math.min(stat.size,16*1024*1024),buffer=Buffer.alloc(256*1024);while(pos<size){const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,size-pos),pos);if(!bytesRead)break;hash.update(buffer.subarray(0,bytesRead));pos+=bytesRead;}}finally{await handle.close();}return {fileName:path.basename(file,path.extname(file)),fileHash:hash.digest('hex'),fileSize:stat.size};}
  async folderInfo(file){const hint=fileHint(file),rules=await this.read(path.join(this.root,'danmaku-folders.json'),{});return {...hint,rule:rules[hint.key]||null};}
  async forgetFolder(file){const hint=fileHint(file),target=path.join(this.root,'danmaku-folders.json'),rules=await this.read(target,{});delete rules[hint.key];await this.write(target,rules);return {ok:true};}
  async rememberFolder(file,binding){const hint=fileHint(file);if(!hint.episode||!id(binding.animeId))throw Error('无法从路径确定集数，请仅关联当前视频');const gen=this.generation;
    const r=await this.cached('anime-'+binding.animeId,()=>this.request('bangumi/'+binding.animeId));this.check(gen);const episodes=r.bangumi?.episodes||[],selected=episodes.find(e=>id(e.episodeId)===binding.episodeId),number=selected&&/^\d+$/.test(selected.episodeNumber)?Number(selected.episodeNumber):null;
    if(!number)throw Error('这集没有明确的数字集数，未记住文件夹');
    const sameSeason=episodes.filter(e=>(e.seasonId||'')===(selected.seasonId||'')&&/^\d+$/.test(e.episodeNumber));const mapping={};for(const e of sameSeason){const n=String(Number(e.episodeNumber));if(mapping[n])throw Error('集数存在重复，未记住文件夹');mapping[n]=candidate({...e,shift:0,animeId:binding.animeId,animeTitle:binding.animeTitle});}
    const target=path.join(this.root,'danmaku-folders.json'),rules=await this.read(target,{});this.check(gen);rules[hint.key]={title:binding.animeTitle,offset:number-hint.episode,kind:hint.kind,episodes:mapping};await this.write(target,rules);return {ok:true};
  }
  async load({file,binding,duration,force=false,refresh=false}){
    const gen=this.generation,settings=await this.settings(),hint=await this.folderInfo(file);this.check(gen);
    if(binding?.episodeId||binding?.localKey){const data=await this.comments(binding,refresh);this.check(gen);return {ok:true,state:'loaded',binding,...data,hint};}
    if(!force&&!settings.automatic)return {ok:true,state:'disabled',hint};
    if(!force&&hint.rule?.kind===hint.kind&&hint.episode){const inferred=hint.rule.episodes[String(hint.episode+hint.rule.offset)];if(inferred){const data=await this.comments(inferred);this.check(gen);return {ok:true,state:'loaded',binding:inferred,...data,hint,inferred:true};}}
    if(!settings.configured)return {ok:true,state:'unconfigured',hint};
    const fingerprint=await this.fingerprint(file);this.check(gen);const key=createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex');
    const r=await this.cached('match-'+key,()=>this.request('match',{body:{...fingerprint,videoDuration:Math.round(Number(duration)||0),matchMode:'hashAndFileName'}}),{refresh:force});this.check(gen);
    const matches=(r.matches||[]).map(candidate).filter(Boolean);
    if(r.isMatched===true&&matches.length===1){const data=await this.comments(matches[0]);this.check(gen);return {ok:true,state:'loaded',binding:matches[0],...data,hint};}
    return {ok:true,state:'choose',matches,hint};
  }
  async select({file,match,remember}){const binding=candidate(match);if(!binding)throw Error('请选择正确的剧集');const gen=this.generation,data=await this.comments(binding);this.check(gen);let warning=data.warning;
    if(remember)try{await this.rememberFolder(file,binding);}catch(e){this.check(gen);warning=(warning?warning+'；':'')+e.message;}
    return {ok:true,state:'loaded',binding,...data,warning,hint:await this.folderInfo(file)};
  }
  async importLocal({name,comments}){const normalized=normalizeComments(comments);if(!normalized.length)throw Error('文件中没有可用的普通、顶部或底部弹幕');const localKey=createHash('sha256').update(JSON.stringify(normalized)).digest('hex');const data={comments:normalized,savedAt:Date.now()};await this.write(path.join(this.root,'danmaku-cache','local-'+localKey+'.json'),data);return {ok:true,state:'loaded',binding:{localKey,animeTitle:'本地弹幕',episodeTitle:text(name),shift:0},...data};}
}
function register({app,handle,read,write,dialog,shell,window,secure}){
  const Provider=require('./bilibili-danmaku.cjs').createService(DanmakuService,normalizeComments,fileHint);
  const service=new Provider({root:app.getPath('userData'),read,write,secure});
  handle('dm-settings',()=>service.settings());handle('dm-settings-save',x=>service.saveSettings(x));handle('dm-cancel',()=>service.cancel());handle('dm-load',x=>service.load(x));handle('dm-search',(t,e)=>service.search(t,e));handle('dm-select',x=>service.select(x));handle('dm-forget-folder',f=>service.forgetFolder(f));handle('dm-import',x=>service.importLocal(x));
  handle('dm-docs',()=>shell.openExternal('https://dev.dandanplay.com'));
  handle('dm-bili-search',title=>shell.openExternal('https://search.bilibili.com/bangumi?keyword='+encodeURIComponent(String(title||'').slice(0,200))));
  handle('dm-pick',async()=>{const r=await dialog.showOpenDialog(window(),{title:'导入弹幕文件',properties:['openFile'],filters:[{name:'弹幕（B站 XML / JSON）',extensions:['xml','json']}]});if(r.canceled)return {canceled:true};const f=r.filePaths[0],s=await fs.stat(f);if(s.size>LIMIT)throw Error('弹幕文件请小于 32 MB');return {ok:true,name:path.basename(f),text:await fs.readFile(f,'utf8')};});
  app.on('before-quit',()=>service.cancel());return service;
}
module.exports={DanmakuService,register,signature,fileHint,normalizeComments};
