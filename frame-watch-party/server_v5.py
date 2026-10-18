"""Frame v5: stabilized watch-party media proxy plus WebRTC live-lounge signaling."""
import asyncio
import json
import os
import secrets
import string
import time
from urllib.parse import urlparse

from aiohttp import WSMsgType, web

import server_v3 as core

ROOT = core.ROOT
rooms = core.rooms
now = core.now
clean = core.clean
fail = core.fail
media = core.media
timeline = core.timeline


def default_media_state():
    return {'joined': False, 'mic': False, 'camera': False, 'screen': False}


def snapshot(room):
    return {
        'type': 'state',
        'code': room['code'],
        'revision': room['revision'],
        'serverTime': now(),
        'host': room['host'],
        'playback': timeline(room),
        'spotlight': room.get('spotlight'),
        'members': [
            {
                'id': uid,
                'name': member['name'],
                'online': member['ws'] is not None,
                'media': member.get('media', default_media_state()),
            }
            for uid, member in room['members'].items()
        ],
        'playlist': room['playlist'],
        'messages': room['messages'],
        'poll': room['poll'],
    }


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
    room = {
        'code': code,
        'host': None,
        'revision': 0,
        'members': {},
        'playlist': [],
        'messages': [],
        'poll': None,
        'spotlight': None,
        'playback': {
            'url': '',
            'title': 'Choose something to watch',
            'position': 0,
            'playing': False,
            'updated': now(),
        },
        'touched': now(),
    }
    rooms[code] = room
    return room


async def send_to_member(room, target_id, payload):
    target = room['members'].get(target_id)
    if not target or target['ws'] is None or target['ws'].closed:
        fail('That participant is no longer online.')
    await target['ws'].send_json(payload)


def valid_signal_description(value):
    return (
        isinstance(value, dict)
        and value.get('type') in ('offer', 'answer')
        and isinstance(value.get('sdp'), str)
    )


async def socket(request):
    origin = request.headers.get('Origin')
    allowed = os.environ.get('ALLOWED_ORIGINS', '').split(',')
    if origin and urlparse(origin).netloc != request.host and origin not in allowed:
        raise web.HTTPForbidden(text='Origin not allowed')

    ws = web.WebSocketResponse(heartbeat=15, max_msg_size=32768)
    await ws.prepare(request)
    room = member = uid = None
    window, count = now(), 0

    try:
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                continue
            try:
                data = json.loads(msg.data)
                if not isinstance(data, dict):
                    fail('Expected an object')

                if now() - window > 1000:
                    window, count = now(), 0
                count += 1
                if count > 160:
                    fail('Slow down for a moment')

                action = data.get('type')
                if action == 'ping':
                    await ws.send_json({'type': 'pong', 'echo': data.get('time'), 'serverTime': now()})
                    continue

                if action in ('create', 'join'):
                    if room:
                        fail('Already in a room')
                    room = new_room() if action == 'create' else rooms.get(clean(data.get('code'), 6).upper())
                    if room is None:
                        fail('Room not found. Check the six-character code.')

                    token = clean(data.get('token'), 100)
                    uid = next(
                        (
                            key for key, value in room['members'].items()
                            if token and secrets.compare_digest(value['token'], token)
                        ),
                        None,
                    )

                    if uid:
                        member = room['members'][uid]
                        old_ws = member['ws']
                        member['ws'] = ws
                        member.setdefault('media', default_media_state())
                        if old_ws is not None:
                            await old_ws.close(code=4001, message=b'Reconnected elsewhere')
                    else:
                        if len(room['members']) >= 50:
                            room = None
                            fail('Room is full (50 members)')
                        uid = secrets.token_hex(8)
                        member = {
                            'name': clean(data.get('name'), 24) or 'Guest',
                            'token': secrets.token_urlsafe(32),
                            'ws': ws,
                            'left': None,
                            'seen': set(),
                            'media': default_media_state(),
                        }
                        room['members'][uid] = member

                    member['left'] = None
                    if room['host'] not in room['members']:
                        room['host'] = uid
                    await ws.send_json({'type': 'welcome', 'id': uid, 'token': member['token'], 'code': room['code']})

                elif not room:
                    fail('Join a room first')

                elif action == 'sync':
                    await ws.send_json(snapshot(room))
                    continue

                elif action in ('rtc-offer', 'rtc-answer', 'rtc-ice'):
                    target = clean(data.get('target'), 64)
                    channel = clean(data.get('channel'), 16)
                    session = clean(data.get('session'), 100)
                    if channel not in ('av', 'screen') or not session:
                        fail('Invalid live-media signal.')

                    payload = {
                        'type': action,
                        'from': uid,
                        'name': member['name'],
                        'channel': channel,
                        'session': session,
                    }
                    if action in ('rtc-offer', 'rtc-answer'):
                        description = data.get('sdp')
                        if not valid_signal_description(description):
                            fail('Invalid WebRTC description.')
                        payload['sdp'] = {
                            'type': description['type'],
                            'sdp': description['sdp'][:24000],
                        }
                    else:
                        candidate = data.get('candidate')
                        if not isinstance(candidate, dict):
                            fail('Invalid ICE candidate.')
                        payload['candidate'] = candidate

                    await send_to_member(room, target, payload)
                    continue

                elif action == 'rtc-state':
                    member['media'] = {
                        'joined': bool(data.get('joined')),
                        'mic': bool(data.get('mic')),
                        'camera': bool(data.get('camera')),
                        'screen': bool(data.get('screen')),
                    }
                    if not member['media']['joined'] and room.get('spotlight') == uid:
                        room['spotlight'] = None

                elif action == 'rtc-command':
                    if room['host'] != uid:
                        fail('Only the host can manage live participants.')
                    target = clean(data.get('target'), 64)
                    command = clean(data.get('command'), 32)
                    if command not in ('mute', 'camera-off'):
                        fail('Unsupported live-participant command.')
                    await send_to_member(
                        room,
                        target,
                        {'type': 'rtc-command', 'command': command, 'from': uid},
                    )
                    continue

                elif action == 'rtc-spotlight':
                    if room['host'] != uid:
                        fail('Only the host can spotlight a participant.')
                    target = clean(data.get('target'), 64)
                    if target:
                        participant = room['members'].get(target)
                        if not participant or participant['ws'] is None or not participant.get('media', {}).get('joined'):
                            fail('Choose a live participant to spotlight.')
                    room['spotlight'] = target or None

                else:
                    ident = clean(data.get('actionId'), 80)
                    if ident and ident in member['seen']:
                        continue
                    if ident:
                        member['seen'].add(ident)
                        if len(member['seen']) > 1000:
                            member['seen'] = {ident}

                    if action in ('play', 'pause', 'seek', 'load', 'transfer', 'remove', 'closePoll') and room['host'] != uid:
                        fail('Only the host can do that')

                    if action in ('play', 'pause', 'seek'):
                        playback = timeline(room)
                        if not playback['url']:
                            fail('Choose a video first')
                        if action == 'seek':
                            position = float(data.get('position', 0))
                            if not 0 <= position <= 86400:
                                fail('Invalid playback position')
                            playback['position'] = position
                        else:
                            playback['playing'] = action == 'play'
                        playback['updated'] = now()
                        room['playback'] = playback

                    elif action == 'load':
                        room['playback'] = {
                            'url': media(data.get('url')),
                            'title': clean(data.get('title'), 100) or 'Shared video',
                            'position': 0,
                            'playing': False,
                            'updated': now(),
                        }

                    elif action == 'chat':
                        text = clean(data.get('text'))
                        if not text:
                            fail('Write a message first')
                        room['messages'].append({
                            'id': secrets.token_hex(6),
                            'name': member['name'],
                            'text': text,
                            'at': now(),
                        })
                        room['messages'] = room['messages'][-100:]

                    elif action == 'reaction':
                        emoji = data.get('emoji')
                        if emoji not in ['❤️', '😂', '🔥', '👏', '😮']:
                            fail('Unknown reaction')
                        await broadcast(room, {'type': 'reaction', 'emoji': emoji, 'name': member['name']})
                        continue

                    elif action == 'add':
                        if len(room['playlist']) >= 50:
                            fail('Playlist is full')
                        room['playlist'].append({
                            'id': secrets.token_hex(6),
                            'url': media(data.get('url')),
                            'title': clean(data.get('title'), 100) or 'Shared video',
                            'by': member['name'],
                        })

                    elif action == 'remove':
                        room['playlist'] = [x for x in room['playlist'] if x['id'] != data.get('id')]

                    elif action == 'transfer':
                        target = room['members'].get(data.get('id'))
                        if not target or target['ws'] is None:
                            fail('Choose an online member')
                        room['host'] = data['id']

                    elif action == 'poll':
                        if room['poll'] and not room['poll']['closed']:
                            fail('Finish the current poll first')
                        options = [clean(x, 80) for x in data.get('options', [])][:6]
                        question = clean(data.get('question'), 120)
                        if not question or len(options) < 2 or any(not x for x in options) or len(set(options)) != len(options):
                            fail('Provide a question and 2–6 distinct options')
                        room['poll'] = {
                            'question': question,
                            'options': options,
                            'votes': {},
                            'closed': False,
                        }

                    elif action == 'vote':
                        poll = room['poll']
                        choice = data.get('choice')
                        if not poll or poll['closed'] or type(choice) is not int or choice not in range(len(poll['options'])):
                            fail('Invalid vote')
                        poll['votes'][uid] = choice

                    elif action == 'closePoll':
                        if room['poll']:
                            room['poll']['closed'] = True

                    else:
                        fail('Unknown action')

                room['revision'] += 1
                room['touched'] = now()
                await broadcast(room)

            except (ValueError, TypeError, KeyError, OverflowError) as exc:
                await ws.send_json({'type': 'error', 'message': str(exc)})

    finally:
        if room and member and member['ws'] is ws:
            member['ws'] = None
            member['left'] = now()
            member['media'] = default_media_state()
            if room.get('spotlight') == uid:
                room['spotlight'] = None
            room['revision'] += 1
            await broadcast(room)
    return ws


async def maintenance(app):
    async def loop():
        while True:
            await asyncio.sleep(2)
            for code, room in list(rooms.items()):
                host = room['members'].get(room['host'])
                if not host or (host['left'] and now() - host['left'] > 15000):
                    online = [uid for uid, member in room['members'].items() if member['ws'] is not None]
                    if online:
                        room['host'] = online[0]
                        room['revision'] += 1

                for member_id, room_member in list(room['members'].items()):
                    if room_member['left'] and now() - room_member['left'] > 120000:
                        if room.get('spotlight') == member_id:
                            room['spotlight'] = None
                        del room['members'][member_id]

                if not room['members'] or (
                    all(member['ws'] is None for member in room['members'].values())
                    and now() - room['touched'] > 300000
                ):
                    rooms.pop(code, None)
                else:
                    await broadcast(room)

    task = asyncio.create_task(loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


async def index(request):
    return web.FileResponse(ROOT / 'dist/index.html')


async def health(request):
    return web.json_response({'ok': True, 'rooms': len(rooms), 'liveLounge': True})


async def rtc_config(request):
    servers = [{
        'urls': [
            'stun:stun.l.google.com:19302',
            'stun:stun1.l.google.com:19302',
        ]
    }]
    turn_url = clean(os.environ.get('TURN_URL'), 500)
    if turn_url:
        turn = {'urls': turn_url}
        username = clean(os.environ.get('TURN_USERNAME'), 200)
        credential = clean(os.environ.get('TURN_CREDENTIAL'), 500)
        if username:
            turn['username'] = username
        if credential:
            turn['credential'] = credential
        servers.append(turn)
    return web.json_response({'iceServers': servers})


def make_app():
    app = web.Application(client_max_size=32768)
    app.router.add_get('/ws', socket)
    app.router.add_get('/health', health)
    app.router.add_get('/rtc-config', rtc_config)
    app.router.add_get('/media-proxy', core.media_proxy)
    app.router.add_get('/media-smart', core.media_smart)
    app.router.add_get('/media-hls', core.media_hls)
    app.router.add_get('/', index)
    app.router.add_static('/', ROOT / 'dist', show_index=False)
    app.cleanup_ctx.append(maintenance)
    return app


if __name__ == '__main__':
    web.run_app(
        make_app(),
        host=os.getenv('HOST', '0.0.0.0'),
        port=int(os.getenv('PORT', '8000')),
    )
