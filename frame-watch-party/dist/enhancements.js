// URL compatibility layer for the shared player.
const form=document.getElementById('addForm');
const urlInput=document.getElementById('customUrl');
const titleInput=document.getElementById('customTitle');
const playlist=document.getElementById('playlist');
function titleFromUrl(value){try{const u=new URL(value);if(/youtu\.be|youtube\.com/i.test(u.hostname))return 'YouTube video';if(/vimeo\.com/i.test(u.hostname))return 'Vimeo video';const file=decodeURIComponent(u.pathname.split('/').filter(Boolean).pop()||u.hostname||'Shared video');return file.replace(/\.(mp4|webm|ogg|mov|m4v|m3u8)(\?.*)?$/i,'').replace(/[-_]+/g,' ').trim()||'Shared video'}catch{return 'Shared video'}}
function isHttpUrl(value){try{return ['http:','https:'].includes(new URL(value).protocol)}catch{return false}}
function sourceType(value){try{const u=new URL(value),host=u.hostname.toLowerCase(),path=u.pathname;if(host==='youtu.be'||host.endsWith('youtube.com')||host.endsWith('youtube-nocookie.com'))return'youtube';if(host==='vimeo.com'||host.endsWith('.vimeo.com'))return'vimeo';if(/\.m3u8(?:$|[?#])/i.test(value))return'hls';return'web'}catch{return'invalid'}}
function notify(text){const t=document.getElementById('toast');if(!t)return;t.textContent=text;t.style.display='block';setTimeout(()=>{if(t.textContent===text)t.style.display='none'},5000)}
function prepareUrl(original){const type=sourceType(original);if(type==='youtube'||type==='vimeo')return original;if(type==='hls')return `${location.origin}/media-hls?url=${encodeURIComponent(original)}`;return `${location.origin}/media-smart?url=${encodeURIComponent(original)}`;}
titleInput?.removeAttribute('required');if(titleInput)titleInput.placeholder='Video title (optional)';if(urlInput)urlInput.placeholder='Paste MP4, HLS, YouTube, Vimeo or a public video page URL';
urlInput?.addEventListener('paste',()=>setTimeout(()=>{const value=urlInput.value.trim();if(!titleInput.value.trim())titleInput.value=titleFromUrl(value);if(value&&!isHttpUrl(value))notify('Please paste a public HTTP/HTTPS video link.');},0));
form?.addEventListener('submit',()=>{
 const original=urlInput.value.trim();if(!isHttpUrl(original))return;
 if(!titleInput.value.trim())titleInput.value=titleFromUrl(original);
 if(!original.startsWith(location.origin+'/media-smart?')&&!original.startsWith(location.origin+'/media-hls?')&&!original.startsWith(location.origin+'/media-proxy?'))urlInput.value=prepareUrl(original);
 const before=playlist?.querySelectorAll('button[data-load]').length||0;
 let done=false;
 const tryLoad=()=>{if(done)return;const buttons=playlist?.querySelectorAll('button[data-load]');if(buttons&&buttons.length>before){done=true;observer.disconnect();buttons[buttons.length-1].click();const type=sourceType(original);notify(type==='youtube'?'YouTube video loaded. Press Play to sync the room.':type==='vimeo'?'Vimeo video loaded. Press Play to sync the room.':type==='hls'?'HLS stream loaded. Press Play to sync the room.':'Video link resolved through compatibility mode. Press Play to start it.');}};
 const observer=new MutationObserver(tryLoad);if(playlist)observer.observe(playlist,{childList:true,subtree:true});setTimeout(()=>{tryLoad();if(!done)observer.disconnect();},5000);
},true);
