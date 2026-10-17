"""Frame: a single-process, server-authoritative watch party server."""
import asyncio, json, os, secrets, string, time
from pathlib import Path
from urllib.parse import urlparse
from aiohttp import web, WSMsgType

ROOT = Path(__file__).parent
rooms = {}
now = lambda: time.time() * 1000

def fail(message):
    raise ValueError(message)

def clean(value, limit=500):
    return str(value or '').strip()[:limit]

def media(value):
    value = clean(value, 2000)
    if urlparse(value).scheme not in ('https', 'http'):
        fail('Use a direct HTTP(S) video URL.')
    return value

def timeline(room):
    p = room['playback'].copy()
    if p['playing']:
        p['position'] += (now() - p['updated']) / 1000
    return p

def snapshot(room):
    return {'type':'state', 'code':room['code'], 'revision':room['revision'],
        'serverTime':now(), 'host':room['host'], 'playback':timeline(room),
        'members':[{'id':k,'name':v['name'],'online':v['ws'] is not None} for k,v in room['members'].items()],
        'playlist':room['playlist'], 'messages':room['messages'], 'poll':room['poll']}

async def broadcast(room, event=None):
    data = json.dumps(event or snapshot(room))
    for member in list(room['members'].values()):
        ws = member['ws']
        if ws is not None and not ws.closed:
            try:
                await ws.send_str(data)
            except ConnectionError:
                pass

def new_room():
    while True:
        code = ''.join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(6))
        if code not in rooms:
            break
    r = {'code':code,'host':None,'revision':0,'members':{},'playlist':[], 'messages':[], 'poll':None,
         'playback':{'url':'','title':'Choose something to watch','position':0,'playing':False,'updated':now()},'touched':now()}
    rooms[code] = r
    return r

async def socket(request):
    # Same-origin by default. Set ALLOWED_ORIGINS for a separately hosted frontend.
    origin = request.headers.get('Origin')
    allowed = os.environ.get('ALLOWED_ORIGINS','').split(',')
    if origin and urlparse(origin).netloc != request.host and origin not in allowed:
        raise web.HTTPForbidden(text='Origin not allowed')
    ws = web.WebSocketResponse(heartbeat=15, max_msg_size=8192)
    await ws.prepare(request)
    room = member = uid = None
    window, count = now(), 0
    try:
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                continue
            try:
                d = json.loads(msg.data)
                if not isinstance(d, dict): fail('Expected an object')
                if now()-window>1000: window,count=now(),0
                count += 1
                if count>35: fail('Slow down for a moment')
                action = d.get('type')
                if action == 'ping':
                    await ws.send_json({'type':'pong','echo':d.get('time'),'serverTime':now()})
                    continue
                if action in ('create','join'):
                    if room: fail('Already in a room')
                    room = new_room() if action=='create' else rooms.get(clean(d.get('code'),6).upper())
                    if room is None: fail('Room not found. Check the six-character code.')
                    token = clean(d.get('token'),100)
                    uid = next((k for k,v in room['members'].items() if token and secrets.compare_digest(v['token'],token)), None)
                    if uid:
                        member = room['members'][uid]
                        old_ws = member['ws']
                        member['ws'] = ws
                        if old_ws is not None: await old_ws.close(code=4001, message=b'Reconnected elsewhere')
                    else:
                        if len(room['members']) >= 50:
                            room=None
                            fail('Room is full (50 members)')
                        uid = secrets.token_hex(8)
                        member = {'name':clean(d.get('name'),24) or 'Guest','token':secrets.token_urlsafe(32),'ws':ws,'left':None,'seen':set()}
                        room['members'][uid] = member
                    member['left'] = None
                    if room['host'] not in room['members']: room['host'] = uid
                    await ws.send_json({'type':'welcome','id':uid,'token':member['token'],'code':room['code']})
                elif not room:
                    fail('Join a room first')
                elif action == 'sync':
                    await ws.send_json(snapshot(room))
                    continue
                else:
                    ident = clean(d.get('actionId'),80)
                    if ident and ident in member['seen']: continue
                    if ident:
                        member['seen'].add(ident)
                        if len(member['seen'])>1000: member['seen']={ident}
                    if action in ('play','pause','seek','load','transfer','remove','closePoll') and room['host'] != uid:
                        fail('Only the host can do that')
                    if action in ('play','pause','seek'):
                        p = timeline(room)
                        if not p['url']: fail('Choose a video first')
                        if action=='seek':
                            position = float(d.get('position',0))
                            if not 0 <= position <= 86400: fail('Invalid playback position')
                            p['position']=position
                        else: p['playing'] = action=='play'
                        p['updated']=now()
                        room['playback']=p
                    elif action=='load':
                        room['playback']={'url':media(d.get('url')),'title':clean(d.get('title'),100) or 'Shared video','position':0,'playing':False,'updated':now()}
                    elif action=='chat':
                        text=clean(d.get('text'))
                        if not text: fail('Write a message first')
                        room['messages'].append({'id':secrets.token_hex(6),'name':member['name'],'text':text,'at':now()})
                        room['messages']=room['messages'][-100:]
                    elif action=='reaction':
                        emoji=d.get('emoji')
                        if emoji not in ['❤️','😂','🔥','👏','😮']: fail('Unknown reaction')
                        await broadcast(room, {'type':'reaction','emoji':emoji,'name':member['name']})
                        continue
                    elif action=='add':
                        if len(room['playlist'])>=50: fail('Playlist is full')
                        room['playlist'].append({'id':secrets.token_hex(6),'url':media(d.get('url')),'title':clean(d.get('title'),100) or 'Shared video','by':member['name']})
                    elif action=='remove': room['playlist']=[x for x in room['playlist'] if x['id']!=d.get('id')]
                    elif action=='transfer':
                        target=room['members'].get(d.get('id'))
                        if not target or target['ws'] is None: fail('Choose an online member')
                        room['host']=d['id']
                    elif action=='poll':
                        if room['poll'] and not room['poll']['closed']: fail('Finish the current poll first')
                        options=[clean(x,80) for x in d.get('options',[])][:6]
                        question=clean(d.get('question'),120)
                        if not question or len(options)<2 or any(not x for x in options) or len(set(options))!=len(options): fail('Provide a question and 2–6 distinct options')
                        room['poll']={'question':question,'options':options,'votes':{},'closed':False}
                    elif action=='vote':
                        poll=room['poll']
                        choice=d.get('choice')
                        if not poll or poll['closed'] or type(choice)!=int or choice not in range(len(poll['options'])): fail('Invalid vote')
                        poll['votes'][uid]=choice
                    elif action=='closePoll':
                        if room['poll']: room['poll']['closed']=True
                    else: fail('Unknown action')
                room['revision']+=1
                room['touched']=now()
                await broadcast(room)
            except (ValueError,TypeError,KeyError,OverflowError) as e:
                await ws.send_json({'type':'error','message':str(e)})
    finally:
        if room and member and member['ws'] is ws:
            member['ws']=None
            member['left']=now()
            await broadcast(room)
    return ws

async def maintenance(app):
    async def loop():
        while True:
            await asyncio.sleep(2)
            for code, room in list(rooms.items()):
                host=room['members'].get(room['host'])
                if not host or (host['left'] and now()-host['left']>15000):
                    online=[k for k,v in room['members'].items() if v['ws'] is not None]
                    if online:
                        room['host']=online[0];room['revision']+=1
                for uid,m in list(room['members'].items()):
                    if m['left'] and now()-m['left']>120000:
                        del room['members'][uid]
                if not room['members'] or (all(m['ws'] is None for m in room['members'].values()) and now()-room['touched']>300000):
                    rooms.pop(code,None)
                else: await broadcast(room)
    task=asyncio.create_task(loop())
    yield
    task.cancel()
    try: await task
    except asyncio.CancelledError: pass

async def index(request): return web.FileResponse(ROOT/'dist/index.html')
async def health(request): return web.json_response({'ok':True,'rooms':len(rooms)})
def make_app():
    app=web.Application(client_max_size=8192)
    app.router.add_get('/ws',socket)
    app.router.add_get('/health',health)
    app.router.add_get('/',index)
    app.router.add_static('/',ROOT/'dist',show_index=False)
    app.cleanup_ctx.append(maintenance)
    return app
if __name__=='__main__': web.run_app(make_app(),host=os.getenv('HOST','0.0.0.0'),port=int(os.getenv('PORT','8000')))
