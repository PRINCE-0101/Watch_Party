// Multi-source compatibility layer: direct/public web video pages, HLS, YouTube and Vimeo.
// Loads BEFORE app.js so provider playback can participate in the existing room protocol.
const form=document.getElementById('addForm');
const urlInput=document.getElementById('customUrl');
const titleInput=document.getElementById('customTitle');
const playlist=document.getElementById('playlist');
const video=document.getElementById('video');
const screen=document.querySelector('.screen');
const enablePlayback=document.getElementById('enablePlayback');
const seek=document.getElementById('seek');
const timeNode=document.getElementById('time');
const durationNode=document.getElementById('duration');
const muteButton=document.getElementById('mute');
const fullscreenButton=document.getElementById('fullscreen');

const mount=document.createElement('div');
mount.id='providerMount';
mount.hidden=true;
mount.style.cssText='position:absolute;inset:0;width:100%;height:100%;background:#080809;pointer-events:none;z-index:1';
screen.insertBefore(mount,document.getElementById('emptyScreen'));
enablePlayback.style.zIndex='4';

const providerHint=document.createElement('div');
providerHint.hidden=true;
providerHint.textContent='HOST · YouTube controls enabled · use ⚙ for quality';
providerHint.style.cssText='position:absolute;top:10px;right:10px;z-index:3;background:#111115dd;border:1px solid #3a3d31;border-radius:999px;padding:7px 10px;font-size:10px;color:#d3f56b;pointer-events:none';
screen.appendChild(providerHint);

const bridge={
 state:null,receivedAt:0,me:null,socket:null,mode:'html',url:'',ready:false,
 playing:false,time:0,duration:NaN,yt:null,vimeo:null,hls:null,generation:0,
 programmaticUntil:0,programmaticSeekUntil:0,nativeReadyAt:0,
 lastSampleTime:null,lastSampleWall:null,lastSeekSentAt:0
};

function notify(text){const t=document.getElementById('toast');if(!t)return;t.textContent=text;t.style.display='block';setTimeout(()=>{if(t.textContent===text)t.style.display='none'},5200)}
function format(s){if(!Number.isFinite(s)||s<0)return'0:00';return`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`}
function isHttpUrl(value){try{return['http:','https:'].includes(new URL(value).protocol)}catch{return false}}
function isExternalProvider(){return bridge.mode==='youtube'||bridge.mode==='vimeo'}
function isHost(){return !!bridge.state&&bridge.state.host===bridge.me}

function sourceInfo(value){
 try{
  const u=new URL(value,location.href),host=u.hostname.toLowerCase(),parts=u.pathname.split('/').filter(Boolean);
  if(host==='youtu.be'){if(parts[0])return{kind:'youtube',id:parts[0]}}
  if(host.endsWith('youtube.com')||host.endsWith('youtube-nocookie.com')){
   const id=u.searchParams.get('v')||(['shorts','embed','live'].includes(parts[0])?parts[1]:null);
   if(id)return{kind:'youtube',id};
  }
  if(host==='vimeo.com'||host.endsWith('.vimeo.com')){const id=parts.find(x=>/^\d+$/.test(x));if(id)return{kind:'vimeo',id}}
  if(/\.m3u8(?:$|[?#])/i.test(value)||u.pathname==='/media-hls')return{kind:'hls'};
 }catch{}
 return{kind:'html'};
}

function titleFromUrl(value){
 try{
  const info=sourceInfo(value);
  if(info.kind==='youtube')return'YouTube video';
  if(info.kind==='vimeo')return'Vimeo video';
  const u=new URL(value),file=decodeURIComponent(u.pathname.split('/').filter(Boolean).pop()||u.hostname||'Shared video');
  return file.replace(/\.(mp4|webm|ogg|mov|m4v|m3u8)(\?.*)?$/i,'').replace(/[-_]+/g,' ').trim()||'Shared video';
 }catch{return'Shared video'}
}

function prepareUrl(original){
 const type=sourceInfo(original).kind;
 if(type==='youtube'||type==='vimeo')return original;
 if(type==='hls')return`${location.origin}/media-hls?url=${encodeURIComponent(original)}`;
 const key=crypto.randomUUID();
 return`${location.origin}/media-smart?key=${encodeURIComponent(key)}&url=${encodeURIComponent(original)}`;
}

function loadScript(src,ready){
 return new Promise((resolve,reject)=>{
  if(ready?.())return resolve();
  const existing=[...document.scripts].find(s=>s.src===src);
  if(existing){
   const poll=setInterval(()=>{if(ready?.()){clearInterval(poll);resolve()}},50);
   setTimeout(()=>{clearInterval(poll);ready?.()?resolve():reject(new Error('Player library timed out'))},10000);
   return;
  }
  const s=document.createElement('script');s.src=src;s.async=true;s.onload=()=>resolve();s.onerror=()=>reject(new Error('Could not load player library'));document.head.appendChild(s);
 });
}

let ytApiPromise;
function loadYouTubeApi(){
 if(window.YT?.Player)return Promise.resolve();
 if(ytApiPromise)return ytApiPromise;
 ytApiPromise=new Promise((resolve,reject)=>{
  const old=window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady=()=>{try{old?.()}catch{}resolve()};
  const s=document.createElement('script');s.src='https://www.youtube.com/iframe_api';s.async=true;s.onerror=()=>reject(new Error('Could not load YouTube player'));document.head.appendChild(s);
  setTimeout(()=>{if(window.YT?.Player)resolve()},5000);
 });
 return ytApiPromise;
}

function sendRoomAction(type,data={}){
 if(!isHost()||bridge.socket?.readyState!==1||!bridge.state?.playback)return;
 const playback=bridge.state.playback;
 if(type==='play'){playback.playing=true;bridge.receivedAt=performance.now()}
 if(type==='pause'){playback.position=providerCurrent();playback.playing=false;bridge.receivedAt=performance.now()}
 if(type==='seek'){playback.position=Math.max(0,Number(data.position)||0);bridge.receivedAt=performance.now()}
 bridge.socket.send(JSON.stringify({type,...data,actionId:crypto.randomUUID()}));
}

// Observe room state and retain the active socket for native YouTube host controls.
const NativeWebSocket=window.WebSocket;
window.WebSocket=class FrameObservedWebSocket extends NativeWebSocket{
 constructor(...args){
  super(...args);bridge.socket=this;
  this.addEventListener('message',event=>{
   try{
    const data=JSON.parse(event.data);
    if(data.type==='welcome')bridge.me=data.id;
    if(data.type==='state'){
     bridge.state=data;bridge.receivedAt=performance.now();
     updateProviderInteractivity();syncProvider();
    }
   }catch{}
  });
 }
};

function resetProviderSampling(){bridge.lastSampleTime=null;bridge.lastSampleWall=null;bridge.lastSeekSentAt=0}
function updateProviderInteractivity(){
 const ytHost=bridge.mode==='youtube'&&isHost();
 mount.style.pointerEvents=ytHost?'auto':'none';
 providerHint.hidden=!ytHost;
}

function cleanupProvider(){
 bridge.generation++;bridge.ready=false;bridge.playing=false;bridge.time=0;bridge.duration=NaN;
 if(bridge.hls){try{bridge.hls.destroy()}catch{}bridge.hls=null}
 if(bridge.yt){try{bridge.yt.destroy()}catch{}bridge.yt=null}
 if(bridge.vimeo){try{bridge.vimeo.destroy?.()}catch{}bridge.vimeo=null}
 mount.innerHTML='';mount.hidden=true;mount.style.pointerEvents='none';providerHint.hidden=true;
 video.hidden=false;video.dataset.providerMode='html';bridge.mode='html';bridge.url='';enablePlayback.hidden=true;resetProviderSampling();
}

function handleYouTubeState(event){
 bridge.playing=event.data===YT.PlayerState.PLAYING;
 bridge.time=Number(bridge.yt?.getCurrentTime?.())||bridge.time;
 bridge.duration=Number(bridge.yt?.getDuration?.())||bridge.duration;
 if(!isHost()||performance.now()<bridge.programmaticUntil)return;
 if(event.data===YT.PlayerState.PLAYING&&!bridge.state?.playback?.playing)sendRoomAction('play');
 if(event.data===YT.PlayerState.PAUSED&&bridge.state?.playback?.playing)sendRoomAction('pause');
 if(event.data===YT.PlayerState.ENDED&&bridge.state?.playback?.playing)sendRoomAction('pause');
}

async function startYouTube(url,id){
 cleanupProvider();const generation=++bridge.generation;bridge.mode='youtube';bridge.url=url;video.dataset.providerMode='youtube';
 video.hidden=true;mount.hidden=false;mount.innerHTML='<div id="frameYoutube"></div>';bridge.nativeReadyAt=performance.now()+2500;updateProviderInteractivity();
 try{
  await loadYouTubeApi();if(generation!==bridge.generation)return;
  bridge.yt=new YT.Player('frameYoutube',{
   videoId:id,width:'100%',height:'100%',
   playerVars:{playsinline:1,controls:1,disablekb:0,rel:0,fs:1,origin:location.origin},
   events:{
    onReady:()=>{if(generation!==bridge.generation)return;bridge.ready=true;bridge.duration=Number(bridge.yt.getDuration?.())||NaN;resetProviderSampling();updateProviderInteractivity();syncProvider()},
    onStateChange:handleYouTubeState,
    onError:()=>notify('YouTube refused this video. It may be private, age-restricted, unavailable, or embedding may be disabled.')
   }
  });
 }catch(e){notify(e.message||'Could not initialize YouTube playback.')}
}

async function startVimeo(url,id){
 cleanupProvider();const generation=++bridge.generation;bridge.mode='vimeo';bridge.url=url;video.dataset.providerMode='vimeo';
 video.hidden=true;mount.hidden=false;mount.innerHTML=`<iframe id="frameVimeo" src="https://player.vimeo.com/video/${encodeURIComponent(id)}?autoplay=0&controls=0&title=0&byline=0&portrait=0" allow="autoplay; fullscreen; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" style="width:100%;height:100%;border:0"></iframe>`;updateProviderInteractivity();
 try{
  await loadScript('https://player.vimeo.com/api/player.js',()=>window.Vimeo?.Player);if(generation!==bridge.generation)return;
  bridge.vimeo=new Vimeo.Player(document.getElementById('frameVimeo'));await bridge.vimeo.ready();if(generation!==bridge.generation)return;
  bridge.ready=true;bridge.duration=await bridge.vimeo.getDuration().catch(()=>NaN);
  bridge.vimeo.on('timeupdate',d=>{bridge.time=d.seconds;bridge.duration=d.duration||bridge.duration});
  bridge.vimeo.on('play',()=>bridge.playing=true);bridge.vimeo.on('pause',()=>bridge.playing=false);bridge.vimeo.on('ended',()=>bridge.playing=false);
  bridge.vimeo.on('error',()=>notify('Vimeo refused this video. It may be private or embedding may be disabled.'));
  syncProvider();
 }catch(e){notify(e.message||'Could not initialize Vimeo playback.')}
}

async function startHls(url){
 cleanupProvider();const generation=++bridge.generation;bridge.mode='hls';bridge.url=url;video.dataset.providerMode='html';video.hidden=false;mount.hidden=true;
 if(video.canPlayType('application/vnd.apple.mpegurl')){originalSrcSet.call(video,url);bridge.mode='html';return}
 try{
  await loadScript('https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js',()=>window.Hls);if(generation!==bridge.generation)return;
  if(!Hls.isSupported())throw new Error('HLS is not supported by this browser');
  bridge.hls=new Hls({enableWorker:true,lowLatencyMode:false,maxBufferLength:30});bridge.hls.loadSource(url);bridge.hls.attachMedia(video);
  bridge.hls.on(Hls.Events.ERROR,(_,data)=>{if(data?.fatal)notify(`HLS playback failed: ${data.type||'stream error'}`)});
 }catch(e){notify(e.message||'Could not initialize HLS playback.')}
}

function providerTarget(){const s=bridge.state;if(!s?.playback)return 0;return Math.max(0,Number(s.playback.position||0)+(s.playback.playing?(performance.now()-bridge.receivedAt)/1000:0))}
function providerCurrent(){if(bridge.mode==='youtube'){try{return Number(bridge.yt?.getCurrentTime?.())||0}catch{return 0}}if(bridge.mode==='vimeo')return Number(bridge.time)||0;return Number(nativeCurrentTimeGet.call(video))||0}
function providerDuration(){if(bridge.mode==='youtube'){try{return Number(bridge.yt?.getDuration?.())||bridge.duration}catch{return bridge.duration}}if(bridge.mode==='vimeo')return Number(bridge.duration);return Number(nativeDurationGet.call(video))}
function providerIsPlaying(){if(bridge.mode==='youtube'){try{return bridge.yt?.getPlayerState?.()===YT.PlayerState.PLAYING}catch{return bridge.playing}}if(bridge.mode==='vimeo')return bridge.playing;return!nativePausedGet.call(video)&&!nativeEndedGet.call(video)}
function providerSeek(value){
 const p=Math.max(0,Number(value)||0);bridge.programmaticSeekUntil=performance.now()+1200;
 if(bridge.mode==='youtube'){try{bridge.yt?.seekTo?.(p,true)}catch{}}
 else if(bridge.mode==='vimeo'){bridge.vimeo?.setCurrentTime?.(p).catch(()=>{});bridge.time=p}
 else nativeCurrentTimeSet.call(video,p);
}
function providerPlay(){
 bridge.programmaticUntil=performance.now()+900;
 if(bridge.mode==='youtube'){
  try{bridge.yt?.playVideo?.();setTimeout(()=>{try{const ok=bridge.yt?.getPlayerState?.()===YT.PlayerState.PLAYING;bridge.playing=ok;enablePlayback.hidden=ok||!bridge.state?.playback?.playing}catch{enablePlayback.hidden=false}},550)}catch{enablePlayback.hidden=false}
  return Promise.resolve();
 }
 if(bridge.mode==='vimeo')return bridge.vimeo?.play?.().then(()=>{bridge.playing=true;enablePlayback.hidden=true}).catch(()=>{enablePlayback.hidden=false;throw new Error('Autoplay blocked')})||Promise.resolve();
 return nativePlay();
}
function providerPause(){
 bridge.programmaticUntil=performance.now()+900;
 if(bridge.mode==='youtube'){try{bridge.yt?.pauseVideo?.()}catch{}bridge.playing=false;return}
 if(bridge.mode==='vimeo'){bridge.vimeo?.pause?.().catch(()=>{});bridge.playing=false;return}
 return nativePause();
}

// Media-element shims make app.js read the provider timeline instead of a hidden stale HTML-video timeline.
const mediaProto=HTMLMediaElement.prototype;
const currentTimeDescriptor=Object.getOwnPropertyDescriptor(mediaProto,'currentTime');
const durationDescriptor=Object.getOwnPropertyDescriptor(mediaProto,'duration');
const pausedDescriptor=Object.getOwnPropertyDescriptor(mediaProto,'paused');
const endedDescriptor=Object.getOwnPropertyDescriptor(mediaProto,'ended');
const readyStateDescriptor=Object.getOwnPropertyDescriptor(mediaProto,'readyState');
const srcDescriptor=Object.getOwnPropertyDescriptor(mediaProto,'src')||Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype,'src');
const nativeCurrentTimeGet=currentTimeDescriptor.get,nativeCurrentTimeSet=currentTimeDescriptor.set;
const nativeDurationGet=durationDescriptor.get,nativePausedGet=pausedDescriptor.get,nativeEndedGet=endedDescriptor.get,nativeReadyStateGet=readyStateDescriptor.get;
const originalSrcGet=srcDescriptor.get,originalSrcSet=srcDescriptor.set;
const nativePlay=video.play.bind(video),nativePause=video.pause.bind(video),nativeLoad=video.load.bind(video);

Object.defineProperty(video,'src',{configurable:true,get(){return isExternalProvider()&&bridge.url?bridge.url:originalSrcGet.call(video)},set(value){const v=String(value||''),info=sourceInfo(v);if(bridge.mode==='hls'&&v.startsWith('blob:')){originalSrcSet.call(video,v);return}if(info.kind==='youtube'){startYouTube(v,info.id);return}if(info.kind==='vimeo'){startVimeo(v,info.id);return}if(info.kind==='hls'){startHls(v);return}if(isExternalProvider())cleanupProvider();video.dataset.providerMode='html';originalSrcSet.call(video,v)}});
try{Object.defineProperty(video,'currentTime',{configurable:true,get(){return isExternalProvider()?providerCurrent():nativeCurrentTimeGet.call(video)},set(v){if(isExternalProvider())providerSeek(v);else nativeCurrentTimeSet.call(video,v)}})}catch{}
try{Object.defineProperty(video,'duration',{configurable:true,get(){return isExternalProvider()?providerDuration():nativeDurationGet.call(video)}})}catch{}
try{Object.defineProperty(video,'paused',{configurable:true,get(){return isExternalProvider()?!providerIsPlaying():nativePausedGet.call(video)}})}catch{}
try{Object.defineProperty(video,'ended',{configurable:true,get(){return isExternalProvider()?false:nativeEndedGet.call(video)}})}catch{}
try{Object.defineProperty(video,'readyState',{configurable:true,get(){return isExternalProvider()?0:nativeReadyStateGet.call(video)}})}catch{}
video.play=function(){return isExternalProvider()?providerPlay():nativePlay()};
video.pause=function(){return isExternalProvider()?providerPause():nativePause()};
video.load=function(){if(isExternalProvider())return;return nativeLoad()};

function syncProvider(){
 if(!isExternalProvider()||!bridge.ready||!bridge.state?.playback)return;
 const target=providerTarget(),current=providerCurrent(),drift=target-current;
 const hardSeek=Math.abs(drift)>(bridge.state.playback.playing?1.6:0.55);
 if(hardSeek&&performance.now()>bridge.programmaticSeekUntil)providerSeek(target);
 if(bridge.state.playback.playing&&!providerIsPlaying())providerPlay();
 else if(!bridge.state.playback.playing&&providerIsPlaying())providerPause();
}

function detectHostYouTubeSeek(){
 if(bridge.mode!=='youtube'||!bridge.ready||!isHost()||performance.now()<bridge.nativeReadyAt)return false;
 const wall=performance.now(),current=providerCurrent();
 if(bridge.lastSampleTime===null){bridge.lastSampleTime=current;bridge.lastSampleWall=wall;return false}
 const elapsed=Math.max(0,(wall-bridge.lastSampleWall)/1000),expected=providerIsPlaying()?elapsed:0;
 const jump=(current-bridge.lastSampleTime)-expected;
 bridge.lastSampleTime=current;bridge.lastSampleWall=wall;
 if(performance.now()<bridge.programmaticSeekUntil||Math.abs(jump)<2.0||wall-bridge.lastSeekSentAt<1200)return false;
 bridge.lastSeekSentAt=wall;sendRoomAction('seek',{position:current});return true;
}

// Host gets native YouTube controls (including the quality gear); viewers remain read-only.
enablePlayback.addEventListener('click',e=>{if(!isExternalProvider())return;e.preventDefault();e.stopImmediatePropagation();providerPlay()},true);
muteButton.addEventListener('click',e=>{if(!isExternalProvider())return;e.preventDefault();e.stopImmediatePropagation();if(bridge.mode==='youtube'){try{if(bridge.yt.isMuted())bridge.yt.unMute();else bridge.yt.mute();muteButton.textContent=bridge.yt.isMuted()?'⊘':'♫'}catch{}}else bridge.vimeo?.getMuted?.().then(m=>bridge.vimeo.setMuted(!m)).catch(()=>{})},true);
fullscreenButton.addEventListener('click',e=>{if(!isExternalProvider())return;e.preventDefault();e.stopImmediatePropagation();screen.requestFullscreen?.().catch(()=>notify('Fullscreen is unavailable.'))},true);
video.addEventListener('error',e=>{if(isExternalProvider()){e.preventDefault();e.stopImmediatePropagation()}},true);

setInterval(()=>{
 if(isExternalProvider()){
  const manualSeek=detectHostYouTubeSeek();if(!manualSeek)syncProvider();
  const current=providerCurrent(),duration=providerDuration();timeNode.textContent=format(current);durationNode.textContent=format(duration);
  if(Number.isFinite(duration)&&duration>0)seek.max=duration;if(document.activeElement!==seek)seek.value=current;
 }
},350);

// Smart URL form: providers stay as provider URLs; HLS/pages/direct files use same-origin compatibility endpoints.
titleInput?.removeAttribute('required');
if(titleInput)titleInput.placeholder='Video title (optional)';
if(urlInput)urlInput.placeholder='Paste MP4, HLS, YouTube, Vimeo or a public video page URL';
urlInput?.addEventListener('paste',()=>setTimeout(()=>{const value=urlInput.value.trim();if(!titleInput.value.trim())titleInput.value=titleFromUrl(value);if(value&&!isHttpUrl(value))notify('Please paste a public HTTP/HTTPS video link.')},0));
form?.addEventListener('submit',()=>{
 const original=urlInput.value.trim();if(!isHttpUrl(original))return;
 if(!titleInput.value.trim())titleInput.value=titleFromUrl(original);
 if(!original.startsWith(location.origin+'/media-smart?')&&!original.startsWith(location.origin+'/media-hls?')&&!original.startsWith(location.origin+'/media-proxy?'))urlInput.value=prepareUrl(original);
 const before=playlist?.querySelectorAll('button[data-load]').length||0;let done=false;
 const tryLoad=()=>{
  if(done)return;const buttons=playlist?.querySelectorAll('button[data-load]');
  if(buttons&&buttons.length>before){
   done=true;observer.disconnect();buttons[buttons.length-1].click();const type=sourceInfo(original).kind;
   notify(type==='youtube'?'YouTube link loaded. Host can use the in-player ⚙ menu for local quality.':type==='vimeo'?'Vimeo link loaded. Press Play to sync the room.':type==='hls'?'HLS stream loaded. Press Play to sync the room.':'Video link loaded through stable compatibility mode. Press Play to start it.');
  }
 };
 const observer=new MutationObserver(tryLoad);if(playlist)observer.observe(playlist,{childList:true,subtree:true});setTimeout(()=>{tryLoad();if(!done)observer.disconnect()},5000);
},true);
