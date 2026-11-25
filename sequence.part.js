/* Editable clips keep their own sequence position. Playback resolves only the
   highest visible full-frame clip at each boundary, so only one decoder plays. */
S.videoTracks=[{id:1,name:'视频 1',visible:true}];S.curVideoTrack=1;S.videoTrackId=2;
let sequenceKey='',sequenceCache=[];
function clipRate(c){return c?.gap?1:clamp(Number(c?.rate)||1,.25,4);}
function sourceAt(c,offset){return Math.floor(Math.min(c.in+Math.max(0,offset)*clipRate(c),Math.ceil(c.out+1)-1)+1e-7);}
function sourceBoundary(c,offset){return Math.min(c.out+1,c.in+offset*clipRate(c));}
function sliceClip(c,from,to){return {...c,in:sourceBoundary(c,from),out:sourceBoundary(c,to)-1,start:c.start+from,frames:to-from};}
function noteRange(a,c){const rate=clipRate(c),length=clipLen(c);return [clamp(Math.ceil((a.start-c.in)/rate-1e-7),0,length),clamp(Math.ceil((a.end+1-c.in)/rate-1e-7),0,length)];}
function migrateSequence(saved){
  const modern=Array.isArray(saved?.videoTracks);
  S.videoTracks=modern?saved.videoTracks.map(t=>({...t} )):[{id:1,name:'视频 1',visible:true}];
  let offset=0,oldOffset=0;
  if(!modern&&S.clips.some(c=>c.parked))S.videoTracks.unshift({id:2,name:'视频 2',visible:false});
  S.clips=S.clips.map(c=>{const parked=!!c.parked,track=modern?c.track:(parked?2:1),start=modern?Math.max(0,Math.round(c.start)||0):(parked?oldOffset:offset);if(parked)oldOffset+=clipLen(c);else offset+=clipLen(c);const result={...c,track,start};delete result.parked;return result;}).filter(c=>S.videoTracks.some(t=>t.id===c.track));
  S.videoTrackId=Math.max(0,...S.videoTracks.map(t=>t.id))+1;
  S.curVideoTrack=S.videoTracks.some(t=>t.id===saved?.curVideoTrack)?saved.curVideoTrack:(S.videoTracks.at(-1)?.id??null);
  sequenceKey='';
}
function sequenceClips(){
  const key=S.videoTracks.map(t=>t.id+':'+(t.visible!==false)).join(',')+'|'+S.clips.map(c=>[c.track,c.start,c.in,c.out,c.rate,c.frames].join(':')).join(',');
  if(key===sequenceKey)return sequenceCache;sequenceKey=key;
  const tracks=S.videoTracks.filter(t=>t.visible!==false),eligible=S.clips.filter(c=>tracks.some(t=>t.id===c.track)),end=Math.max(0,...S.clips.map(c=>c.start+clipLen(c)));
  const boundaries=[...new Set([0,end,...eligible.flatMap(c=>[c.start,c.start+clipLen(c)])])].sort((a,b)=>a-b),result=[];
  for(let i=0;i<boundaries.length-1;i++){
    const start=boundaries[i],to=boundaries[i+1];if(to<=start)continue;
    let winner=null;for(const tr of tracks){winner=eligible.findLast(c=>c.track===tr.id&&start>=c.start&&start<c.start+clipLen(c));if(winner)break;}
    winner=winner||null;const previous=result.at(-1);
    if(previous&&previous.origin===winner){previous.frames+=to-start;previous.out=winner?sourceBoundary(winner,to-winner.start)-1:previous.frames-1;continue;}
    result.push(winner?{...sliceClip(winner,start-winner.start,to-winner.start),origin:winner,gap:false}:{in:0,out:to-start-1,frames:to-start,start,origin:null,gap:true});
  }
  sequenceCache=result;return result;
}
const liveClips=()=>sequenceClips();
const timelineTotal=()=>{const clips=sequenceClips();return clips.length?clips.at(-1).start+clipLen(clips.at(-1)):0;};
function timelineToSource(t){const clips=liveClips();for(let i=0;i<clips.length;i++){const c=clips[i];if(t<c.start+clipLen(c)||i===clips.length-1)return {src:c.gap?-1:sourceAt(c,t-c.start),clip:c,index:i,offset:c.start};}return {src:-1,clip:null,index:-1,offset:0};}
function editClip(c){return c?.origin||c;}
function settleOverwrite(c){
  const start=c.start,end=start+clipLen(c),result=[];
  for(const old of S.clips){if(old===c||old.track!==c.track||old.start>=end||old.start+clipLen(old)<=start){result.push(old);continue;}
    const oldEnd=old.start+clipLen(old);
    if(old.start<start)result.push(sliceClip(old,0,start-old.start));
    if(oldEnd>end)result.push(sliceClip(old,end-old.start,clipLen(old)));
  }S.clips=result;S.selClip=S.clips.indexOf(c);sequenceKey='';
}
