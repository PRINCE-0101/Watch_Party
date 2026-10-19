// Floating cinema camera dock. Mirrors the live-lounge streams over the movie and stays visible in Frame fullscreen.
const movieScreen=document.querySelector('.screen');
const liveGrid=document.getElementById('rtcGrid');
const fullscreenButton=document.getElementById('fullscreen');
if(movieScreen&&liveGrid){
 const style=document.createElement('style');
 style.textContent=`
 #rtcCinemaOverlay{position:absolute;right:14px;bottom:14px;z-index:24;pointer-events:auto;max-width:min(72%,620px);background:#0b0b0ecc;border:1px solid #ffffff20;border-radius:14px;box-shadow:0 14px 45px #0009;backdrop-filter:blur(10px);overflow:hidden;user-select:none;touch-action:none}
 #rtcFloatBar{height:30px;padding:0 8px 0 10px;display:flex;align-items:center;gap:8px;color:#d3f56b;font-size:9px;letter-spacing:.7px;cursor:grab;background:#15151bd9;border-bottom:1px solid #ffffff12}
 #rtcFloatBar:active{cursor:grabbing}#rtcFloatBar span{flex:1;white-space:nowrap}#rtcFloatBar button{border:0;background:#25252d;color:#d7d7de;border-radius:7px;padding:3px 7px;font-size:10px;line-height:1.2;cursor:pointer}
 #rtcCinemaBubbles{display:flex;gap:7px;align-items:flex-end;flex-wrap:wrap;justify-content:flex-end;padding:8px}
 #rtcCinemaOverlay.minimized #rtcCinemaBubbles{display:none}#rtcCinemaOverlay.minimized{width:auto!important}
 .rtc-cinema-bubble{position:relative;width:126px;aspect-ratio:16/10;border-radius:11px;overflow:hidden;background:#080809;border:1px solid #ffffff2b;box-shadow:0 8px 30px #0008}
 .rtc-cinema-bubble.spotlight{width:205px;border-color:#d3f56b88;box-shadow:0 0 0 1px #d3f56b35,0 8px 30px #0008}.rtc-cinema-bubble video{width:100%;height:100%;object-fit:cover;background:#080809}.rtc-cinema-bubble.local video{transform:scaleX(-1)}.rtc-cinema-bubble.camera-off video{opacity:.12}
 .rtc-cinema-name{position:absolute;left:6px;bottom:5px;background:#08080bd9;border-radius:999px;padding:4px 7px;font-size:9px;color:#f3f2f0;max-width:90%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 .screen:fullscreen #rtcCinemaOverlay{max-width:70vw}.screen:fullscreen #rtcFloatBar{height:34px;font-size:10px}.screen:fullscreen .rtc-cinema-bubble{width:150px}.screen:fullscreen .rtc-cinema-bubble.spotlight{width:240px}
 @media(max-width:700px){#rtcCinemaOverlay{right:8px;bottom:8px;max-width:94%;border-radius:12px}.rtc-cinema-bubble{width:92px}.rtc-cinema-bubble.spotlight{width:145px}.screen:fullscreen .rtc-cinema-bubble{width:105px}.screen:fullscreen .rtc-cinema-bubble.spotlight{width:165px}}
 `;
 document.head.appendChild(style);
 const overlay=document.createElement('section');overlay.id='rtcCinemaOverlay';overlay.hidden=true;overlay.innerHTML='<div id="rtcFloatBar"><span>● LIVE CAMS · drag me</span><button id="rtcFloatMin" type="button" aria-label="Minimize live cameras">−</button></div><div id="rtcCinemaBubbles"></div>';movieScreen.appendChild(overlay);
 const bar=overlay.querySelector('#rtcFloatBar'),bubbleWrap=overlay.querySelector('#rtcCinemaBubbles'),minButton=overlay.querySelector('#rtcFloatMin');
 let drag=null;
 function mirrorTiles(){
  const sources=[...liveGrid.querySelectorAll('.rtc-tile[data-peer]')];
  if(!sources.length){overlay.hidden=true;bubbleWrap.innerHTML='';return}
  overlay.hidden=false;const seen=new Set();
  for(const source of sources){const id=source.dataset.peer;if(!id)continue;seen.add(id);let bubble=bubbleWrap.querySelector(`[data-cinema-peer="${CSS.escape(id)}"]`);if(!bubble){bubble=document.createElement('div');bubble.className='rtc-cinema-bubble';bubble.dataset.cinemaPeer=id;bubble.innerHTML='<video autoplay playsinline muted></video><span class="rtc-cinema-name"></span>';bubbleWrap.appendChild(bubble)}bubble.classList.toggle('local',source.classList.contains('local'));bubble.classList.toggle('spotlight',source.classList.contains('spotlight'));bubble.classList.toggle('camera-off',source.classList.contains('camera-off'));bubble.querySelector('.rtc-cinema-name').textContent=source.querySelector('.rtc-label')?.textContent||'Live';const srcVideo=source.querySelector('video'),dstVideo=bubble.querySelector('video');if(srcVideo?.srcObject&&dstVideo.srcObject!==srcVideo.srcObject){dstVideo.srcObject=srcVideo.srcObject;dstVideo.muted=true;dstVideo.play().catch(()=>{})}}
  for(const bubble of [...bubbleWrap.children])if(!seen.has(bubble.dataset.cinemaPeer))bubble.remove();
 }
 minButton.addEventListener('click',e=>{e.stopPropagation();overlay.classList.toggle('minimized');minButton.textContent=overlay.classList.contains('minimized')?'+':'−'});
 bar.addEventListener('pointerdown',e=>{if(e.target.closest('button'))return;const box=overlay.getBoundingClientRect(),parent=movieScreen.getBoundingClientRect();drag={dx:e.clientX-box.left,dy:e.clientY-box.top,parent};overlay.style.right='auto';overlay.style.bottom='auto';overlay.style.left=`${box.left-parent.left}px`;overlay.style.top=`${box.top-parent.top}px`;bar.setPointerCapture?.(e.pointerId);e.preventDefault()});
 bar.addEventListener('pointermove',e=>{if(!drag)return;const parent=movieScreen.getBoundingClientRect(),box=overlay.getBoundingClientRect(),maxX=Math.max(0,parent.width-box.width),maxY=Math.max(0,parent.height-box.height),x=Math.min(maxX,Math.max(0,e.clientX-parent.left-drag.dx)),y=Math.min(maxY,Math.max(0,e.clientY-parent.top-drag.dy));overlay.style.left=`${x}px`;overlay.style.top=`${y}px`});
 const stopDrag=()=>{drag=null};bar.addEventListener('pointerup',stopDrag);bar.addEventListener('pointercancel',stopDrag);
 function frameFullscreen(){if(!liveGrid.querySelector('.rtc-tile[data-peer]'))return false;if(document.fullscreenElement===movieScreen){document.exitFullscreen?.();return true}movieScreen.requestFullscreen?.().catch(()=>{});return true}
 fullscreenButton?.addEventListener('click',e=>{if(!frameFullscreen())return;e.preventDefault();e.stopImmediatePropagation()},true);
 movieScreen.addEventListener('dblclick',e=>{if(!liveGrid.querySelector('.rtc-tile[data-peer]'))return;e.preventDefault();e.stopImmediatePropagation();frameFullscreen()},true);
 document.addEventListener('fullscreenchange',()=>{setTimeout(()=>{mirrorTiles();const box=overlay.getBoundingClientRect(),parent=movieScreen.getBoundingClientRect();if(!overlay.hidden&&(box.right>parent.right||box.bottom>parent.bottom)){overlay.style.left='auto';overlay.style.top='auto';overlay.style.right='14px';overlay.style.bottom='14px'}},80)});
 new MutationObserver(mirrorTiles).observe(liveGrid,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});setInterval(mirrorTiles,650);mirrorTiles();
}
