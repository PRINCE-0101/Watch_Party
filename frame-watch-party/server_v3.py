"""Frame: a single-process, server-authoritative watch party server."""
import asyncio
import ipaddress
import json
import os
import re
import secrets
import socket as pysocket
import string
import time
from html import unescape
from pathlib import Path
from urllib.parse import quote, urljoin, urlparse

from aiohttp import ClientSession, ClientTimeout, WSMsgType, web

ROOT = Path(__file__).parent
rooms = {}
smart_media_cache = {}
smart_media_locks = {}
now = lambda: time.time() * 1000

MEDIA_EXTS = ('.mp4', '.webm', '.m4v', '.mov', '.ogv', '.ogg')
HLS_TYPES = {
    'application/vnd.apple.mpegurl', 'application/x-mpegurl',
    'audio/mpegurl', 'audio/x-mpegurl'
}
REDIRECTS = {301, 302, 303, 307, 308}
SMART_CACHE_TTL_MS = 15 * 60 * 1000
SMART_CACHE_LIMIT = 256


def fail(message):
    raise ValueError(message)


def clean(value, limit=500):
    return str(value or '').strip()[:limit]


def media(value):
    value = clean(value, 4000)
    if urlparse(value).scheme not in ('https', 'http'):
        fail('Use a public HTTP(S) video URL.')
    return value


def timeline(room):
    p = room['playback'].copy()
    if p['playing']:
        p['position'] += (now() - p['updated']) / 1000
    return p


def snapshot(room):
    return {
        'type': 'state', 'code': room['code'], 'revision': room['revision'],
        'serverTime': now(), 'host': room['host'], 'playback': timeline(room),
        'members': [
            {'id': k, 'name': v['name'], 'online': v['ws'] is not None}
            for k, v in room['members'].items()
        ],
        'playlist': room['playlist'], 'messages': room['messages'], 'poll': room['poll']
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
        'code': code, 'host': None, 'revision': 0, 'members': {}, 'playlist': [],
        'messages': [], 'poll': None,
        'playback': {
            'url': '', 'title': 'Choose something to watch', 'position': 0,
            'playing': False, 'updated': now()
        },
        'touched': now()
    }
    rooms[code] = room
    return room


async def public_http_url(value):
    """Allow public HTTP(S) targets only; block localhost/private/link-local destinations."""
    u = urlparse(value)
    if u.scheme not in ('http', 'https') or not u.hostname or u.username or u.password:
        fail('Invalid public video URL.')
    if u.port not in (None, 80, 443):
        fail('Only standard HTTP/HTTPS ports are supported.')
    if u.hostname.lower() in ('localhost', 'localhost.localdomain'):
        fail('Private or local video addresses are not allowed.')

    loop = asyncio.get_running_loop()
    try:
        infos = await loop.getaddrinfo(
            u.hostname,
            u.port or (443 if u.scheme == 'https' else 80),
            type=pysocket.SOCK_STREAM,
        )
    except pysocket.gaierror:
        fail('Could not resolve the video host.')

    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            fail('Private or local video addresses are not allowed.')
    return value


async def open_public(session, target, headers=None, max_redirects=5):
    """GET a public URL while validating every redirect before following it."""
    current = target
    for _ in range(max_redirects + 1):
        await public_http_url(current)
        response = await session.get(current, headers=headers or {}, allow_redirects=False)
        if response.status not in REDIRECTS:
            return response, current
        location = response.headers.get('Location')
        response.release()
        if not location:
            fail('Video host returned an invalid redirect.')
        current = urljoin(current, location)
    fail('Too many redirects from the video host.')


async def stream_upstream(request, upstream, session):
    """Stream an already-open upstream response to the browser without buffering the file."""
    ctype = upstream.headers.get('Content-Type', 'application/octet-stream').split(';')[0]
    headers = {
        'Content-Type': ctype,
        'Accept-Ranges': upstream.headers.get('Accept-Ranges', 'bytes'),
        'Cache-Control': 'public, max-age=300',
    }
    for name in ('Content-Range', 'Content-Length', 'ETag', 'Last-Modified'):
        if name in upstream.headers:
            headers[name] = upstream.headers[name]

    response = web.StreamResponse(status=upstream.status, headers=headers)
    await response.prepare(request)
    try:
        async for chunk in upstream.content.iter_chunked(256 * 1024):
            await response.write(chunk)
    except (ConnectionResetError, asyncio.CancelledError):
        pass
    finally:
        upstream.release()
        await session.close()
    return response


async def proxy_target(request, target, referer=None):
    """Same-origin streaming bridge with Range forwarding for stable HTML5 seeking."""
    try:
        await public_http_url(target)
    except ValueError as exc:
        raise web.HTTPBadRequest(text=str(exc))

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                      'AppleWebKit/537.36 Chrome/155 Safari/537.36',
        'Accept': 'video/*,audio/*,application/octet-stream,*/*;q=0.8',
    }
    if referer:
        headers['Referer'] = referer
    if request.headers.get('Range'):
        headers['Range'] = request.headers['Range']

    timeout = ClientTimeout(total=None, connect=12, sock_read=45)
    session = ClientSession(timeout=timeout, trust_env=False)
    try:
        upstream, _ = await open_public(session, target, headers)
        if upstream.status >= 400:
            status = upstream.status
            upstream.release()
            await session.close()
            raise web.HTTPBadGateway(text=f'Video host returned HTTP {status}.')

        ctype = upstream.headers.get('Content-Type', '').split(';')[0].lower()
        is_media = (
            ctype.startswith(('video/', 'audio/'))
            or ctype in ('application/octet-stream', 'binary/octet-stream')
        )
        if not is_media:
            upstream.release()
            await session.close()
            raise web.HTTPBadGateway(text=f'The resolved URL returned {ctype or "unknown content"}, not a media file.')
        return await stream_upstream(request, upstream, session)
    except web.HTTPException:
        if not session.closed:
            await session.close()
        raise
    except Exception as exc:
        if not session.closed:
            await session.close()
        raise web.HTTPBadGateway(text=f'Could not fetch this video: {type(exc).__name__}')


async def media_proxy(request):
    target = clean(request.query.get('url'), 4000)
    return await proxy_target(request, target)


def extract_media_candidates(html_text, base_url):
    """Find direct media references exposed by ordinary public HTML pages."""
    text = unescape(html_text).replace('\\/', '/')
    candidates = []
    patterns = [
        r'<(?:video|source)[^>]+src=["\']([^"\']+)["\']',
        r'<meta[^>]+(?:property|name)=["\'](?:og:video(?::secure_url)?|twitter:player:stream)["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\'](?:og:video(?::secure_url)?|twitter:player:stream)["\']',
        r'https?://[^"\'<>\s]+?\.(?:mp4|webm|m4v|mov|ogv)(?:\?[^"\'<>\s]*)?',
    ]
    for pattern in patterns:
        for match in re.findall(pattern, text, re.I):
            value = match if isinstance(match, str) else match[0]
            value = value.strip()
            if value.startswith('//'):
                value = 'https:' + value
            absolute = urljoin(base_url, value)
            if absolute not in candidates:
                candidates.append(absolute)

    def score(url):
        path = urlparse(url).path.lower()
        return (0 if path.endswith(MEDIA_EXTS) else 1, len(url))

    return sorted(candidates, key=score)[:30]


async def resolve_page_media(target):
    """Resolve one public URL to one stable direct media target."""
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                      'AppleWebKit/537.36 Chrome/155 Safari/537.36',
        'Accept': 'text/html,video/*,audio/*,*/*;q=0.8',
    }
    timeout = ClientTimeout(total=20, connect=10, sock_read=10)
    session = ClientSession(timeout=timeout, trust_env=False)
    try:
        upstream, final_url = await open_public(session, target, headers)
        if upstream.status >= 400:
            status = upstream.status
            upstream.release()
            raise ValueError(f'Web page returned HTTP {status}.')

        ctype = upstream.headers.get('Content-Type', '').split(';')[0].lower()
        if ctype.startswith(('video/', 'audio/')) or ctype in ('application/octet-stream', 'binary/octet-stream'):
            upstream.release()
            return final_url, None
        if ctype in HLS_TYPES or urlparse(final_url).path.lower().endswith('.m3u8'):
            upstream.release()
            return final_url, None
        if ctype not in ('text/html', 'application/xhtml+xml', ''):
            upstream.release()
            raise ValueError(f'This link returned {ctype or "unknown content"}, not a webpage/video.')

        raw = await upstream.content.read(2_000_000)
        charset = upstream.charset or 'utf-8'
        upstream.release()
        text = raw.decode(charset, errors='ignore')
        candidates = extract_media_candidates(text, final_url)
        if not candidates:
            raise ValueError(
                'No public HTML5 video was found on this page. YouTube/Vimeo links are '
                'supported directly; DRM/login-only sites are not.'
            )

        for candidate in candidates[:8]:
            try:
                probe, final_candidate = await open_public(
                    session,
                    candidate,
                    {
                        'User-Agent': headers['User-Agent'],
                        'Accept': 'video/*,audio/*,*/*;q=0.8',
                        'Referer': final_url,
                        'Range': 'bytes=0-1',
                    },
                )
                ptype = probe.headers.get('Content-Type', '').split(';')[0].lower()
                status = probe.status
                probe.release()
                if status < 400 and (
                    ptype.startswith(('video/', 'audio/'))
                    or ptype in ('application/octet-stream', 'binary/octet-stream')
                ):
                    return final_candidate, final_url
            except Exception:
                continue
        raise ValueError('The page mentions video, but it does not expose a public browser-playable media file.')
    finally:
        await session.close()


def trim_smart_cache():
    cutoff = now()
    for key, entry in list(smart_media_cache.items()):
        if entry['expires'] <= cutoff:
            smart_media_cache.pop(key, None)
    if len(smart_media_cache) > SMART_CACHE_LIMIT:
        oldest = sorted(smart_media_cache.items(), key=lambda item: item[1]['created'])
        for key, _ in oldest[:len(smart_media_cache) - SMART_CACHE_LIMIT]:
            smart_media_cache.pop(key, None)


async def resolve_smart_cached(target, load_key):
    """Resolve once per playlist load so every Range request hits the exact same media file."""
    key = f'{load_key}|{target}'
    trim_smart_cache()
    cached = smart_media_cache.get(key)
    if cached and cached['expires'] > now():
        return cached['resolved'], cached['referer']

    lock = smart_media_locks.setdefault(key, asyncio.Lock())
    async with lock:
        cached = smart_media_cache.get(key)
        if cached and cached['expires'] > now():
            return cached['resolved'], cached['referer']
        resolved, referer = await resolve_page_media(target)
        smart_media_cache[key] = {
            'resolved': resolved,
            'referer': referer,
            'created': now(),
            'expires': now() + SMART_CACHE_TTL_MS,
        }
        return resolved, referer


async def media_smart(request):
    """Accept a direct media URL or public webpage and keep its resolution stable for the load."""
    target = clean(request.query.get('url'), 4000)
    load_key = clean(request.query.get('key'), 100) or target
    try:
        await public_http_url(target)
        resolved, referer = await resolve_smart_cached(target, load_key)
        if urlparse(resolved).path.lower().endswith('.m3u8'):
            raise web.HTTPUnsupportedMediaType(
                text='This resolved to HLS. Paste the .m3u8 URL directly so the HLS player can be used.'
            )
        return await proxy_target(request, resolved, referer)
    except web.HTTPException:
        raise
    except ValueError as exc:
        raise web.HTTPBadGateway(text=str(exc))


def proxied_hls_url(target):
    return '/media-hls?url=' + quote(target, safe='')


def rewrite_hls(text, base_url):
    output = []
    uri_re = re.compile(r'URI="([^"]+)"', re.I)
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            output.append(raw)
            continue
        if line.startswith('#'):
            def repl(match):
                return 'URI="' + proxied_hls_url(urljoin(base_url, match.group(1))) + '"'
            output.append(uri_re.sub(repl, raw))
            continue
        output.append(proxied_hls_url(urljoin(base_url, line)))
    return '\n'.join(output) + '\n'


async def media_hls(request):
    """Proxy HLS manifests and rewrite segment/key URIs through the safe bridge."""
    target = clean(request.query.get('url'), 4000)
    headers = {'User-Agent': 'Mozilla/5.0 FrameWatchParty/3.0', 'Accept': '*/*'}
    if request.headers.get('Range'):
        headers['Range'] = request.headers['Range']

    timeout = ClientTimeout(total=None, connect=12, sock_read=45)
    session = ClientSession(timeout=timeout, trust_env=False)
    try:
        upstream, final_url = await open_public(session, target, headers)
        if upstream.status >= 400:
            status = upstream.status
            upstream.release()
            await session.close()
            raise web.HTTPBadGateway(text=f'HLS host returned HTTP {status}.')

        ctype = upstream.headers.get('Content-Type', '').split(';')[0].lower()
        is_manifest = ctype in HLS_TYPES or urlparse(final_url).path.lower().endswith(('.m3u8', '.m3u'))
        if is_manifest:
            raw = await upstream.content.read(3_000_000)
            upstream.release()
            await session.close()
            text = raw.decode('utf-8', errors='ignore')
            return web.Response(
                text=rewrite_hls(text, final_url),
                content_type='application/vnd.apple.mpegurl',
                headers={'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*'},
            )
        return await stream_upstream(request, upstream, session)
    except web.HTTPException:
        if not session.closed:
            await session.close()
        raise
    except ValueError as exc:
        if not session.closed:
            await session.close()
        raise web.HTTPBadRequest(text=str(exc))
    except Exception as exc:
        if not session.closed:
            await session.close()
        raise web.HTTPBadGateway(text=f'Could not fetch this HLS resource: {type(exc).__name__}')


async def socket(request):
    origin = request.headers.get('Origin')
    allowed = [x.strip() for x in os.environ.get('ALLOWED_ORIGINS', '').split(',') if x.strip()]
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
                data = json.loads(msg.data)
                if not isinstance(data, dict):
                    fail('Expected an object')
                if now() - window > 1000:
                    window, count = now(), 0
                count += 1
                if count > 35:
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
                        (k for k, v in room['members'].items()
                         if token and secrets.compare_digest(v['token'], token)),
                        None,
                    )
                    if uid:
                        member = room['members'][uid]
                        old_ws = member['ws']
                        member['ws'] = ws
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
                        p = timeline(room)
                        if not p['url']:
                            fail('Choose a video first')
                        if action == 'seek':
                            position = float(data.get('position', 0))
                            if not 0 <= position <= 86400:
                                fail('Invalid playback position')
                            p['position'] = position
                        else:
                            p['playing'] = action == 'play'
                        p['updated'] = now()
                        room['playback'] = p

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
                            'id': secrets.token_hex(6), 'name': member['name'],
                            'text': text, 'at': now()
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
                        if (
                            not question or len(options) < 2 or any(not x for x in options)
                            or len(set(options)) != len(options)
                        ):
                            fail('Provide a question and 2–6 distinct options')
                        room['poll'] = {
                            'question': question, 'options': options, 'votes': {}, 'closed': False
                        }
                    elif action == 'vote':
                        poll = room['poll']
                        choice = data.get('choice')
                        if (
                            not poll or poll['closed'] or type(choice) is not int
                            or choice not in range(len(poll['options']))
                        ):
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
            await broadcast(room)
    return ws


async def maintenance(app):
    async def loop():
        while True:
            await asyncio.sleep(2)
            trim_smart_cache()
            for code, room in list(rooms.items()):
                host = room['members'].get(room['host'])
                if not host or (host['left'] and now() - host['left'] > 15000):
                    online = [k for k, v in room['members'].items() if v['ws'] is not None]
                    if online:
                        room['host'] = online[0]
                        room['revision'] += 1
                for member_id, member in list(room['members'].items()):
                    if member['left'] and now() - member['left'] > 120000:
                        del room['members'][member_id]
                if (
                    not room['members']
                    or (all(m['ws'] is None for m in room['members'].values()) and now() - room['touched'] > 300000)
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
    return web.json_response({'ok': True, 'rooms': len(rooms), 'smartCache': len(smart_media_cache)})


def make_app():
    app = web.Application(client_max_size=8192)
    app.router.add_get('/ws', socket)
    app.router.add_get('/health', health)
    app.router.add_get('/media-proxy', media_proxy)
    app.router.add_get('/media-smart', media_smart)
    app.router.add_get('/media-hls', media_hls)
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
