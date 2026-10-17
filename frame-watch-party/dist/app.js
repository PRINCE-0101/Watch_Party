import {targetPosition,correction,distance} from './sync.js';
const $=id=>document.getElementById(id), video=$('video');
const films=[
 {title:'Big Buck Bunny',genre:'Animation',minutes:10,year:2008,color:'linear-gradient(145deg,#667a45,#263b24)',symbol:'✳',description:'A gentle giant. Three tiny troublemakers. One very big afternoon.',file:'BigBuckBunny'},
 {title:'Sintel',genre:'Adventure',minutes:15,year:2010,color:'linear-gradient(150deg,#ad7858,#442e3f)',symbol:'◇',description:'An unlikely friendship and a journey beyond the mountains.',file:'Sintel'},
 {title:'Tears of Steel',genre:'Sci-fi',minutes:12,year:2012,color:'linear-gradient(145deg,#637c8f,#263243)',symbol:'◎',description:'A future Amsterdam. A rescue mission. A second chance.',file:'TearsOfSteel'},
 {title:'Elephants Dream',genre:'Animation',minutes:11,year:2006,color:'linear-gradient(145deg,#ae894f,#48402b)',symbol:'◈',description:'Two explorers lost inside a strange, sprawling machine.',file:'ElephantsDream'},
 {title:'For Bigger Fun',genre:'Adventure',minutes:1,year:2013,color:'linear-gradient(145deg,#746492,#34304f)',symbol:'✺',description:'A short sample clip for testing a quick shared screening.',file:'ForBiggerFun'},
 {title:'For Bigger Escape',genre:'Adventure',minutes:1,year:2013,color:'linear-gradient(145deg,#437d7d,#183f44)',symbol:'↗',description:'A bite-size sample for checking your room connection.',file:'ForBiggerEscapes'}
].map(f=>({...f,url:`https://storage.googleapis.com/gtv-videos-bucket/sample/${f.file}.mp4`}));
let ws,state=null,me=null,retry=0,reconnectTimer,roomCode='',manual=false,offset=0,bestRtt=Infinity,rtt=0,drift=0,genre='All',loadedUrl='',toastTimer;
const samples=[];
const saved=JSON.parse(sessionStorage.getItem('frame-session')||'null');
$('name').value=localStorage.getItem('frame-name')||'';
$('code').value=new URLSearchParams(location.search).get('room')||saved?.code||'';
$('backend').value=localStorage.getItem('frame-backend')||'';
function toast(text){$('toast').textContent=text;$('toast').style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').style.display='none',4500);}
function send(type,data={}){if(ws?.readyState!==1||!state){toast('Create or join a room first.');return;}ws.send(JSON.stringify({type,...data,actionId:crypto.randomUUID()}));}
function endpoint(){const custom=localStorage.getItem('frame-backend');if(custom)return custom;if(location.hostname.endsWith('.chatgpt.site'))throw Error('Open Connection & diagnostics and enter your running WSS backend, or run the downloaded project locally.');return `${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`;}
function connect(create=false,automatic=false){
 clearTimeout(reconnectTimer);if(ws&&[0,1].includes(ws.readyState))return;
 const name=$('name').value.trim()||'Guest';roomCode=$('code').value.trim().toUpperCase();
 if(!create&&!/^[A-Z0-9]{6}$/.test(roomCode)){toast('Enter a six-character room code.');return;}
 let url;try{url=endpoint();if(!/^wss?:\/\//.test(url))throw Error('Use ws:// or wss:// for the backend.');if(location.protocol==='https:'&&!url.startsWith('wss:'))throw Error('This HTTPS page requires a secure wss:// backend. For LAN testing, open the local server directly.');}catch(e){toast(e.message);document.querySelector('.setup').open=true;return;}
 manual=false;localStorage.setItem('frame-name',name);$('connection').textContent=automatic?'Reconnecting…':'Connecting…';ws=new WebSocket(url);
 ws.onopen=()=>{retry=0;bestRtt=Infinity;const session=JSON.parse(sessionStorage.getItem('frame-session')||'null');ws.send(JSON.stringify({type:create?'create':'join',name,code:roomCode,token:session?.code===roomCode?session.token:undefined}));ping();};
 ws.onmessage=event=>{let d;try{d=JSON.parse(event.data)}catch{return;}
  if(d.type==='welcome'){me=d.id;roomCode=d.code;$('code').value=d.code;sessionStorage.setItem('frame-session',JSON.stringify(d));history.replaceState(null,'',`?room=${d.code}`);$('connection').textContent='Connected';$('dot').classList.add('on');$('lobby').hidden=true;toast(`You're in. Room ${d.code}`);}
  if(d.type==='state'){if(state&&d.revision<state.revision)return;state=d;render();synchronize();}
  if(d.type==='pong'){rtt=Date.now()-d.echo;if(rtt<bestRtt){bestRtt=rtt;offset=d.serverTime-(d.echo+rtt/2);}samples.push(rtt);if(samples.length>100)samples.shift();}
  if(d.type==='error'){toast(d.message);if(!state){manual=true;ws.close();}}
  if(d.type==='reaction'){const node=document.createElement('span');node.textContent=d.emoji;node.title=d.name;$('reactions').append(node);node.animate([{transform:'translateY(0)',opacity:1},{transform:'translateY(-160px)',opacity:0}],{duration:1800});setTimeout(()=>node.remove(),1800);}
 };
 ws.onerror=()=>toast('Cannot reach the room server. Check that it is running and the backend URL is correct.');
 ws.onclose=e=>{$('dot').classList.remove('on');$('connection').textContent='Disconnected';video.pause();if(!manual&&e.code!==4001&&roomCode&&me){$('sync').textContent='Reconnecting — playback paused';reconnectTimer=setTimeout(()=>connect(false,true),Math.min(1000*2**retry++,15000));}else if(e.code===4001){manual=true;toast('This session was opened elsewhere.');}else if(!me){$('lobby').hidden=false;}};
}
function ping(){if(ws?.readyState===1)ws.send(JSON.stringify({type:'ping',time:Date.now()}));}
function escapeText(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function render(){
 const host=state.host===me;$('roomTag').textContent=`ROOM ${state.code} · ${state.members.filter(x=>x.online).length} online`;$('videoTitle').textContent=state.playback.title;
 $('play').disabled=!host;$('seek').disabled=!host;$('play').textContent=state.playback.playing?'❚❚':'▶';$('queueCount').textContent=state.playlist.length;
 if(state.playback.url!==loadedUrl){loadedUrl=state.playback.url;if(loadedUrl){video.src=loadedUrl;video.load();}$('emptyScreen').hidden=!!loadedUrl;}
 $('playlist').innerHTML=state.playlist.length?state.playlist.map((x,i)=>`<div class="queue-item"><span class="number">${String(i+1).padStart(2,'0')}</span><div><b>${escapeText(x.title)}</b><small>Added by ${escapeText(x.by)}</small></div>${host?`<button data-load="${x.id}">Watch ▷</button><button data-remove="${x.id}" aria-label="Remove video">×</button>`:''}</div>`).join(''):'A good night starts with a good queue.';
 $('members').innerHTML=state.members.map(m=>`<div class="member"><span>${escapeText(m.name)} ${m.id===me?'(you)':''} ${m.online?'●':'○'}</span>${m.id===state.host?'<small>HOST</small>':host&&m.online?`<button data-transfer="${m.id}">Make host</button>`:''}</div>`).join('');
 const signature=state.messages.map(x=>x.id).join();if($('messages').dataset.signature!==signature){const nearBottom=$('messages').scrollHeight-$('messages').scrollTop-$('messages').clientHeight<80;$('messages').dataset.signature=signature;if(state.messages.length)$('messages').innerHTML=state.messages.map(m=>`<div class="message"><b>${escapeText(m.name)}</b><time>${new Date(m.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time><p>${escapeText(m.text)}</p></div>`).join('');if(nearBottom)$('messages').scrollTop=$('messages').scrollHeight;}
 const p=state.poll;if(p){$('pollContent').innerHTML=`<h3>${escapeText(p.question)}</h3>`+p.options.map((x,i)=>`<button data-vote="${i}" ${p.closed?'disabled':''}>${p.votes[me]===i?'✓ ':''}${escapeText(x)} <span style="float:right">${Object.values(p.votes).filter(v=>v===i).length} votes</span></button>`).join('')+(p.closed?'<small>Poll closed</small>':host?'<button id="closePoll">Close poll</button>':'<small>Choose an option. You can change your vote.</small>');}
}
function synchronize(){
 if(!state||!loadedUrl||video.readyState<1||ws?.readyState!==1)return;
 const target=targetPosition(state.playback,state.serverTime,Date.now()+offset), bounded=Number.isFinite(video.duration)?Math.min(target,video.duration):target;
 const c=correction(video.currentTime,bounded);drift=c.drift;
 if(c.seek){video.currentTime=bounded;video.playbackRate=1;}else video.playbackRate=state.playback.playing?c.rate:1;
 if(state.playback.playing&&video.paused&&!video.ended){video.play().then(()=>$('enablePlayback').hidden=true).catch(()=>$('enablePlayback').hidden=false);}else if(!state.playback.playing&&!video.paused)video.pause();
 $('sync').textContent=`${Math.abs(drift)<.5?'● In sync':'↻ Correcting'} · ${Math.round(Math.abs(drift)*1000)} ms`;
}
function format(s){if(!Number.isFinite(s))return '0:00';return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;}
function renderFilms(){const query=$('search').value.trim().toLowerCase(),length=$('length').value;const filtered=films.filter(f=>(genre==='All'||f.genre===genre)&&(length==='all'||(length==='short'?f.minutes<10:f.minutes>=10))&&(!query||f.title.toLowerCase().includes(query)||f.title.toLowerCase().split(' ').some(w=>distance(w,query)<=Math.max(1,Math.floor(query.length/4)))));$('films').innerHTML=filtered.length?filtered.map(f=>`<article><div class="poster" style="--poster:${f.color}"><span class="year">${f.year} / ${f.genre.toUpperCase()}</span><span class="symbol">${f.symbol}</span><h3>${f.title}</h3><button data-film="${f.file}" aria-label="Add ${f.title} to queue">+</button></div><div class="film-info">${f.title}<span>${f.minutes} MIN</span></div><div class="film-description">${f.description}</div></article>`).join(''):'<p class="muted">No matches. Try another title or reset your filters.</p>';}
$('create').onclick=()=>connect(true);$('join').onclick=()=>connect();$('code').onkeydown=e=>{if(e.key==='Enter')connect();};
$('saveBackend').onclick=()=>{const url=$('backend').value.trim();if(url&&!/^wss?:\/\//.test(url))return toast('Use a ws:// or wss:// URL.');localStorage.setItem('frame-backend',url);toast('Connection saved. Reload the page before joining.');};
$('leave').onclick=()=>{manual=true;clearTimeout(reconnectTimer);ws?.close();sessionStorage.removeItem('frame-session');location.href=location.pathname;};
$('invite').onclick=async()=>{if(!state)return toast('Create a room first.');try{await navigator.clipboard.writeText(`${location.origin}${location.pathname}?room=${state.code}`);toast('Invite copied. Share it with your people.');}catch{toast(`Room code: ${state.code}`);}};
$('play').onclick=()=>send(state?.playback.playing?'pause':'play');$('seek').onchange=()=>send('seek',{position:Number($('seek').value)});$('mute').onclick=()=>{video.muted=!video.muted;$('mute').textContent=video.muted?'⊘':'♫';};$('fullscreen').onclick=()=>video.requestFullscreen?.().catch(()=>toast('Fullscreen is unavailable.'));$('enablePlayback').onclick=()=>video.play().then(()=>$('enablePlayback').hidden=true).catch(()=>toast('The video could not play. Check the media URL.'));
video.onloadedmetadata=synchronize;video.oncanplay=synchronize;video.onerror=()=>toast('This media could not load. Try another direct video link.');video.onended=()=>{if(state?.host===me)send('pause');};
$('emoji').onclick=e=>{if(e.target.tagName==='BUTTON')send('reaction',{emoji:e.target.textContent});};
$('chatForm').onsubmit=e=>{e.preventDefault();if(!state)return toast('Join a room first.');send('chat',{text:$('message').value});$('message').value='';};
$('addForm').onsubmit=e=>{e.preventDefault();if(!state)return toast('Join a room first.');send('add',{title:$('customTitle').value,url:$('customUrl').value});e.target.reset();};
$('pollForm').onsubmit=e=>{e.preventDefault();send('poll',{question:$('question').value,options:$('options').value.split(',').map(x=>x.trim())});};
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.load){const film=state.playlist.find(x=>x.id===b.dataset.load);send('load',film);}if(b.dataset.remove)send('remove',{id:b.dataset.remove});if(b.dataset.transfer)send('transfer',{id:b.dataset.transfer});if(b.dataset.vote!==undefined)send('vote',{choice:Number(b.dataset.vote)});if(b.id==='closePoll')send('closePoll');if(b.dataset.film){const f=films.find(x=>x.file===b.dataset.film);send('add',{title:f.title,url:f.url});}if(b.dataset.panel){document.querySelectorAll('.panel').forEach(p=>p.hidden=p.id!==b.dataset.panel);document.querySelectorAll('.subtabs button').forEach(t=>t.classList.toggle('active',t===b));}if(b.dataset.genre){genre=b.dataset.genre;document.querySelectorAll('#genres button').forEach(t=>t.classList.toggle('active',t===b));renderFilms();}});
$('search').oninput=renderFilms;$('length').onchange=renderFilms;
setInterval(()=>{synchronize();$('time').textContent=format(video.currentTime);$('duration').textContent=format(video.duration);if(Number.isFinite(video.duration))$('seek').max=video.duration;if(document.activeElement!==$('seek'))$('seek').value=video.currentTime;const sorted=[...samples].sort((a,b)=>a-b);$('metrics').textContent=`Ping RTT: ${Math.round(rtt)} ms · p95 RTT: ${sorted[Math.ceil(sorted.length*.95)-1]||0} ms · estimated drift: ${Math.round(Math.abs(drift)*1000)} ms · ${samples.length} ping samples. RTT is not a one-way propagation measurement.`;},500);
setInterval(ping,3000);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state){ping();send('sync');}});renderFilms();if(saved&&$('code').value===saved.code)connect();
