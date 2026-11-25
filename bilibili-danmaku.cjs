'use strict';
const path=require('node:path');
function parseLink(input){const value=String(input||'').trim();let token=value,page=1;
  if(/^https?:\/\//i.test(value)){const url=new URL(value);if(!['www.bilibili.com','bilibili.com','m.bilibili.com'].includes(url.hostname)||url.username||url.password)throw Error('请粘贴 bilibili.com 的番剧或视频完整链接');token=url.pathname;page=Math.max(1,Number(url.searchParams.get('p'))||1);}
  const season=/(?:^|\/)(ss|ep)(\d+)(?:\/|$)/i.exec(token),video=/(?:^|\/)(BV[0-9A-Za-z]{10}|av\d+)(?:\/|$)/i.exec(token);
  if(season)return {kind:season[1].toLowerCase(),id:season[2],page};if(video)return {kind:/^BV/.test(video[1])?'bv':'av',id:video[1],page};throw Error('请填写 B站完整链接，或 ss / ep / BV / av 编号；短链接请先在浏览器打开后复制完整地址');
}
function decodeEntities(s){return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(m,x)=>{if(x[0]==='#'){const n=x[1].toLowerCase()==='x'?parseInt(x.slice(2),16):Number(x.slice(1));return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[x]||m;});}
function parseXml(xml,normalize){if(!/<i[\s>]/.test(xml))throw Error('B站未返回有效弹幕，可能暂时限制了请求');const comments=[];for(const m of xml.matchAll(/<d\s+[^>]*\bp="([^"]+)"[^>]*>([\s\S]*?)<\/d>/g)){const p=m[1].split(',');comments.push({time:+p[0],mode:+p[1],color:+p[3],text:decodeEntities(m[2])});if(comments.length>=100000)break;}return normalize(comments);}
// A split episode can anchor the numbering of the season. Never guess a half for another file.
function episodeSlot(e){
  if(Number.isSafeInteger(e.number)&&e.number>0)return e.number;
  const match=/^(\d+)\s*[上中下](?:\s*·|$)/u.exec(e.episodeTitle||'');
  return match&&Number.isSafeInteger(+match[1])&&+match[1]>0?+match[1]:null;
}
function createService(Base,normalize,fileHint){return class BilibiliService extends Base{
  async settings(){return {...await super.settings(),provider:(await this.config()).provider||'bilibili'};}
  async saveSettings(input){if(input.provider!==undefined){if(!['bilibili','dandanplay'].includes(input.provider))throw Error('弹幕来源无效');const c=await this.config();c.provider=input.provider;await this.write(this.configPath(),c);}return super.saveSettings(input);}
  async biliRequest(route,query,xml=false){
    const controller=new AbortController();this.controllers.add(controller);const timer=setTimeout(()=>controller.abort(),15000);
    try{const response=await this.fetch('https://api.bilibili.com/'+route+'?'+new URLSearchParams(query),{headers:{'User-Agent':'Mozilla/5.0','Referer':'https://www.bilibili.com/'},signal:controller.signal,redirect:'error'});if(!response.ok)throw Error('B站暂时无法访问（'+response.status+'），请稍后重试或导入本地弹幕');const chunks=[];let size=0;for await(const b of response.body){size+=b.length;if(size>32*1024*1024){controller.abort();throw Error('弹幕数据过大');}chunks.push(b);}const raw=Buffer.concat(chunks).toString('utf8');if(xml)return parseXml(raw,normalize);let r;try{r=JSON.parse(raw);}catch{throw Error('B站返回的数据格式不正确');}if(r.code!==0)throw Error('B站：'+String(r.message||'暂时无法访问').slice(0,200));return r.result||r.data;
    }catch(e){if(controller.signal.aborted)throw Error('B站请求已取消或超时');if(e.message==='fetch failed')throw Error('无法连接B站，请检查网络；已下载的弹幕仍可离线使用');throw e;}finally{clearTimeout(timer);this.controllers.delete(controller);}
  }
  async biliCatalog(input){const link=parseLink(input),key='bili-catalog-'+link.kind+'-'+link.id;return this.cached(key,async()=>{
    let title,episodes=[],selected;
    if(['ss','ep'].includes(link.kind)){const r=await this.biliRequest('pgc/view/web/season',{[link.kind==='ss'?'season_id':'ep_id']:link.id});title=r.title;const raw=r.episodes||[];episodes=raw.map(e=>({provider:'bilibili',cid:Number(e.cid),episodeId:Number(e.id),animeId:Number(r.season_id),animeTitle:String(title||''),episodeTitle:[e.title,e.long_title].filter(Boolean).join(' · '),number:/^\d+$/.test(String(e.title))?Number(e.title):null,catalog:'ss'+r.season_id,shift:0}));selected=link.kind==='ep'?episodes.find(e=>e.episodeId===Number(link.id)):null;
    }else{const r=await this.biliRequest('x/web-interface/view',link.kind==='bv'?{bvid:link.id}:{aid:link.id.slice(2)});title=r.title;episodes=(r.pages||[]).map(e=>({provider:'bilibili',cid:Number(e.cid),animeTitle:String(title||''),episodeTitle:'P'+e.page+' · '+e.part,number:Number(e.page),catalog:r.bvid,shift:0}));selected=episodes.find(e=>e.number===link.page);}
    episodes=episodes.filter(e=>Number.isSafeInteger(e.cid)&&e.cid>0);if(!episodes.length)throw Error('此链接没有可用的剧集或分P');return {title,episodes,selectedCid:selected?.cid};
  });}
  async search(input,episode=''){if((await this.settings()).provider!=='bilibili')return super.search(input,episode);const r=await this.biliCatalog(input);const matches=r.episodes.slice().sort((a,b)=>Number(b.cid===r.selectedCid)-Number(a.cid===r.selectedCid));return {ok:true,matches,hasMore:false};}
  async comments(binding,refresh=false){if(binding?.provider!=='bilibili')return super.comments(binding,refresh);if(!Number.isSafeInteger(binding.cid)||binding.cid<=0)throw Error('B站弹幕编号无效');return this.cached('bili-comments-'+binding.cid,async()=>({comments:await this.biliRequest('x/v1/dm/list.so',{oid:binding.cid},true)}),{refresh});}
  async rememberFolder(file,binding){if(binding.provider!=='bilibili')return super.rememberFolder(file,binding);const hint=fileHint(file),gen=this.generation;const anchor=episodeSlot(binding);if(!hint.episode||!anchor)throw Error('没有明确数字集数，仅关联当前视频');const r=await this.biliCatalog(binding.catalog);this.check(gen);const episodes={};for(const e of r.episodes)if(e.number){if(episodes[e.number])throw Error('集数重复，仅关联当前视频');episodes[e.number]=e;}const target=path.join(this.root,'danmaku-folders.json'),rules=await this.read(target,{});this.check(gen);rules[hint.key]={title:binding.animeTitle,provider:'bilibili',kind:hint.kind,offset:anchor-hint.episode,episodes};await this.write(target,rules);return {ok:true};}
  async select({file,match,remember}){if(match?.provider!=='bilibili')return super.select({file,match,remember});const gen=this.generation,r=await this.biliCatalog(match.catalog);this.check(gen);const binding=r.episodes.find(e=>e.cid===match.cid);if(!binding)throw Error('剧集信息已变化，请重新读取链接');const data=await this.comments(binding);this.check(gen);let warning=data.warning;if(remember)try{await this.rememberFolder(file,binding);}catch(e){this.check(gen);warning=e.message;}return {ok:true,state:'loaded',binding,...data,warning,hint:await this.folderInfo(file)};}
  async load(opt){const {file,binding,force=false,refresh=false}=opt;
    if(binding?.provider==='bilibili'){const gen=this.generation,data=await this.comments(binding,refresh);this.check(gen);return {ok:true,state:'loaded',binding,...data,hint:await this.folderInfo(file)};}
    const settings=await this.settings();if(settings.provider!=='bilibili'||binding?.episodeId||binding?.localKey)return super.load(opt);
    const gen=this.generation,hint=await this.folderInfo(file);this.check(gen);if(!force&&!settings.automatic)return {ok:true,state:'disabled',hint};
    if(hint.rule?.provider==='bilibili'&&hint.rule.kind===hint.kind&&hint.episode){const match=hint.rule.episodes[String(hint.episode+hint.rule.offset)];if(match){const data=await this.comments(match,refresh);this.check(gen);return {ok:true,state:'loaded',binding:match,...data,hint,inferred:true};}}
    return {ok:true,state:'needs-link',hint};
  }
};}
module.exports={createService,parseLink,parseXml};
