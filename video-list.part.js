const videoNameOrder=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
function videoListRows(){
  const paths=S.videos.map(v=>String(v.path||'').replaceAll('\\','/').split('/'));
  let shared=paths[0]?.slice(0,-1)||[];
  for(const parts of paths){let i=0;while(i<shared.length&&i<parts.length-1&&shared[i].toLowerCase()===parts[i].toLowerCase())i++;shared=shared.slice(0,i);}
  return S.videos.map((v,i)=>{const relative=paths[i].slice(shared.length).join('\\');return {v,i,label:v.rel||S.proj?.videoLabels?.[v.path]||relative||v.name||v.path};});
}
function projectVideoLabels(){return Object.fromEntries(videoListRows().map(({v,label})=>[v.path,label]));}
