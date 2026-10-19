// Premium editorial/cinematic layout inspired by the selected Option 3 concept.
// Reuses the existing functional DOM nodes so playback, polls, chat and WebRTC listeners keep working.
(function(){
  document.body.classList.add('cinema-theme');

  const headerNav=document.querySelector('header nav');
  if(headerNav) headerNav.innerHTML='<a href="#watch">Watch Party</a><a href="#discover">Discover</a><a href="#watch">My Library</a><a href="#watch">Events</a>';

  const grid=document.querySelector('.room-grid');
  if(!grid || grid.classList.contains('cinema-shell')) return;
  const center=grid.firstElementChild;
  const chat=grid.querySelector('.chat');
  if(!center || !chat) return;

  grid.classList.add('cinema-shell');
  center.classList.add('cinema-center');

  const rail=document.createElement('aside');
  rail.className='cinema-rail';
  rail.innerHTML='<div class="cinema-rail-head"><h3>In the Room</h3><span class="cinema-live-dot">● live</span></div><p class="cinema-rail-note">Camera, voice and people — close enough to react together.</p><div class="cinema-rail-live"></div><div class="cinema-rail-people"></div>';
  grid.insertBefore(rail,center);

  const dashboard=document.createElement('section');
  dashboard.className='cinema-dashboard';
  dashboard.innerHTML=`
    <article class="cinema-card queue-card"><div class="cinema-card-head"><div><div class="card-kicker">Up next</div><div class="card-title">In the Queue</div></div><span class="card-kicker">shared playlist</span></div><div class="cinema-queue-mount"></div></article>
    <article class="cinema-card poll-card-shell"><div class="cinema-card-head"><div><div class="card-kicker">Live room choice</div><div class="card-title">Group Poll</div></div><span class="card-kicker">vote together</span></div><div class="cinema-poll-mount"></div></article>
    <article class="cinema-card cinema-social-card"><div><div class="card-kicker">Room energy</div><div class="card-title">Reactions</div></div><div class="cinema-reactions-mount"></div><p class="cinema-quote">Good stories.<br>Better together.<small>Frame · watch together</small></p><div class="cinema-invite-actions"></div></article>`;
  center.appendChild(dashboard);

  const queue=document.getElementById('queue');
  const polls=document.getElementById('polls');
  const people=document.getElementById('people');
  const emoji=document.getElementById('emoji');
  const invite=document.getElementById('invite');
  const leave=document.getElementById('leave');
  const roomActions=document.querySelector('.room-actions');
  const tabs=document.querySelector('.subtabs');

  queue?.removeAttribute('hidden');
  polls?.removeAttribute('hidden');
  people?.removeAttribute('hidden');
  dashboard.querySelector('.cinema-queue-mount')?.appendChild(queue);
  dashboard.querySelector('.cinema-poll-mount')?.appendChild(polls);
  rail.querySelector('.cinema-rail-people')?.appendChild(people);
  dashboard.querySelector('.cinema-reactions-mount')?.appendChild(emoji);
  const inviteMount=dashboard.querySelector('.cinema-invite-actions');
  if(invite) inviteMount?.appendChild(invite);
  if(leave) inviteMount?.appendChild(leave);
  if(tabs) tabs.hidden=true;
  if(roomActions && !roomActions.children.length) roomActions.hidden=true;

  function moveLivePanel(){
    const live=document.querySelector('.live-call');
    const target=rail.querySelector('.cinema-rail-live');
    if(live && target && live.parentElement!==target){target.appendChild(live);return true}
    return !!live;
  }
  if(!moveLivePanel()){
    const observer=new MutationObserver(()=>{if(moveLivePanel()) observer.disconnect()});
    observer.observe(document.body,{childList:true,subtree:true});
    setTimeout(()=>observer.disconnect(),10000);
  }

  const runtime=document.createElement('style');
  runtime.textContent=`
    body.cinema-theme #rtcCinemaOverlay{background:#0d0b08e8!important;border:1px solid #8b7341!important;box-shadow:0 18px 60px #000c,0 0 0 1px #e7c76d18 inset!important;border-radius:14px!important}
    body.cinema-theme #rtcFloatBar{background:#17130edc!important;border-bottom:1px solid #4c3f2a!important;color:#e7c76d!important}
    body.cinema-theme #rtcFloatBar button{background:#241e15!important;color:#eadcae!important;border:1px solid #4c3f2a!important}
    body.cinema-theme .rtc-cinema-bubble{border-color:#6c5734!important;box-shadow:0 10px 34px #000a!important}
    body.cinema-theme .rtc-cinema-bubble.spotlight{border-color:#e7c76d!important;box-shadow:0 0 0 1px #e7c76d44,0 12px 38px #000b!important}
    body.cinema-theme .rtc-cinema-name{background:#0a0806e8!important;color:#f7e8bd!important;border:1px solid #5c4b2f!important}
    body.cinema-theme .screen:fullscreen{background:#000!important}
    body.cinema-theme .screen:fullscreen #rtcCinemaOverlay{z-index:2147483646!important}
    body.cinema-theme .screen:fullscreen #reactions{z-index:2147483647!important}
  `;
  document.head.appendChild(runtime);

  const watchHeading=document.querySelector('#watch .section-heading h2');
  if(watchHeading) watchHeading.textContent='Tonight, we watch together.';
  const eyebrow=document.querySelector('#watch .section-heading .eyebrow');
  if(eyebrow) eyebrow.textContent='PRIVATE SCREENING ROOM';
})();
