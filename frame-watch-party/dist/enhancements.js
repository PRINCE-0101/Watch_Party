// Playback improvements layered over the core room/sync app.
const form=document.getElementById('addForm');
const urlInput=document.getElementById('customUrl');
const titleInput=document.getElementById('customTitle');
const playlist=document.getElementById('playlist');
function titleFromUrl(value){try{const u=new URL(value);const file=decodeURIComponent(u.pathname.split('/').filter(Boolean).pop()||'Shared video');return file.replace(/\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i,'').replace(/[-_]+/g,' ').trim()||'Shared video'}catch{return 'Shared video'}}
function isHttpUrl(value){try{return ['http:','https:'].includes(new URL(value).protocol)}catch{return false}}
function notify(text){const t=document.getElementById('toast');if(!t)return;t.textContent=text;t.style.display='block';setTimeout(()=>{if(t.textContent===text)t.style.display='none'},5000)}
titleInput?.removeAttribute('required');if(titleInput)titleInput.placeholder='Video title (optional)';if(urlInput)urlInput.placeholder='Paste a public MP4 / WebM video URL';
urlInput?.addEventListener('paste',()=>setTimeout(()=>{const value=urlInput.value.trim();if(!titleInput.value.trim())titleInput.value=titleFromUrl(value);if(value&&!isHttpUrl(value))notify('Please paste a public HTTP/HTTPS video URL.')},0));
// Capture submit before app.js. For user-pasted URLs, store our same-origin proxy URL
// in the shared playlist. This bypasses many hotlink/CORS/header restrictions and
// preserves HTTP Range requests for seeking.
form?.addEventListener('submit',()=>{
 const original=urlInput.value.trim();
 if(!titleInput.value.trim())titleInput.value=titleFromUrl(original);
 if(isHttpUrl(original)&&!original.startsWith(`${location.origin}/media-proxy?`)) urlInput.value=`${location.origin}/media-proxy?url=${encodeURIComponent(original)}`;
 let attempts=0;const timer=setInterval(()=>{attempts++;const buttons=playlist?.querySelectorAll('button[data-load]');const newest=buttons?.[buttons.length-1];if(newest){clearInterval(timer);newest.click();notify('Video loaded through compatibility mode. Press Play to start it for the room.')}else if(attempts>=25)clearInterval(timer)},150);
},true);
// Built-in catalog is already curated/browser-compatible; do not proxy it.
