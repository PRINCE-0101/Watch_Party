// Floating cinema camera bubbles. The original live tiles stay in the lounge for controls/audio;
// these muted visual mirrors appear over the movie while playback is running.
const movieScreen=document.querySelector('.screen');
const playButton=document.getElementById('play');
const liveGrid=document.getElementById('rtcGrid');
const fullscreenButton=document.getElementById('fullscreen');
if(movieScreen&&playButton&&liveGrid){
 const style=document.createElement('style');
 style.textContent=`
 #rtcCinemaOverlay{position:absolute;right:12px;bottom:12px;z-index:8;display:flex;gap:7px;align-items:flex-end;max-width:72%;pointer-events:none;flex-wrap:wrap;justify-content:flex-end}
 .rtc-cinema-bubble{position:relative;width:126px;aspect-ratio:16/10;border-radius:11px;overflow:hidden;background:#080809;border:1px solid #ffffff2b;box-shadow:0 8px 30px #0008}
 .rtc-cinema-bubble.spotlight{width:205px;border-color:#d3f56b88}
 .rtc-cinema-bubble video{width:100%;height:100%;object-fit:cover;background:#080809}
 .rtc-cinema-bubble.local video{transform:scaleX(-1)}
 .rtc-cinema-bubble.camera-off video{opacity:.12}
 .rtc-cinema-name{position:absolute;left:6px;bottom:5px;background:#08080bd9;border-radius:999px;padding:4px 7px;font-size:9px;color:#f3f2f0;max-width:90%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 @media(max-width:700px){#rtcCinemaOverlay{right:8px;bottom:8px;max-width:95%;gap:5px}.rtc-cinema-bubble{width:92px}.rtc-cinema-bubble.spotlight{width:145px}.rtc-host-tools{opacity:1}}
 `;
 document.head.appendChild(style);
 const overlay=document.createElement('div');overlay.id='rtcCinemaOverlay';overlay.hidden=true;movieScreen.appendChild(overlay);
 const playing=()=>playButton.textContent.includes('❚');
 function mirrorTiles(){
  if(!playing()){overlay.hidden=true;overlay.innerHTML='';return}
  const sources=[...liveGrid.querySelectorAll('.rtc-tile[data-peer]')];
  if(!sources.length){overlay.hidden=true;overlay.innerHTML='';return}
  overlay.hidden=false;
  const seen=new Set();
  for(const source of sources){
   const id=source.dataset.peer;if(!id)continue;seen.add(id);
   let bubble=overlay.querySelector(`[data-cinema-peer="${CSS.escape(id)}"]`);
   if(!bubble){bubble=document.createElement('div');bubble.className='rtc-cinema-bubble';bubble.dataset.cinemaPeer=id;bubble.innerHTML='<video autoplay playsinline muted></video><span class="rtc-cinema-name"></span>';overlay.appendChild(bubble)}
   bubble.classList.toggle('local',source.classList.contains('local'));
   bubble.classList.toggle('spotlight',source.classList.contains('spotlight'));
   bubble.classList.toggle('camera-off',source.classList.contains('camera-off'));
   bubble.querySelector('.rtc-cinema-name').textContent=source.querySelector('.rtc-label')?.textContent||'Live';
   const srcVideo=source.querySelector('video'),dstVideo=bubble.querySelector('video');
   if(srcVideo?.srcObject&&dstVideo.srcObject!==srcVideo.srcObject){dstVideo.srcObject=srcVideo.srcObject;dstVideo.muted=true;dstVideo.play().catch(()=>{})}
  }
  for(const bubble of [...overlay.children])if(!seen.has(bubble.dataset.cinemaPeer))bubble.remove();
 }
 fullscreenButton?.addEventListener('click',e=>{if(!liveGrid.querySelector('.rtc-tile[data-peer]'))return;e.preventDefault();e.stopImmediatePropagation();movieScreen.requestFullscreen?.().catch(()=>{})},true);
 new MutationObserver(mirrorTiles).observe(playButton,{childList:true,characterData:true,subtree:true});
 new MutationObserver(mirrorTiles).observe(liveGrid,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
 setInterval(mirrorTiles,700);mirrorTiles();
}
