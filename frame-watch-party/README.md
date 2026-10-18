# Frame — Watch Party

A real-time watch-party project: create a room, invite friends, queue a video, watch the same moment together, chat, react, and hang out on live camera/voice while the film plays.

The frontend is responsive vanilla JavaScript. The backend is Python/aiohttp with WebSockets for room state and WebRTC signaling. No frontend build step is required.

## Current feature set

- Shared rooms with six-character invite codes.
- Host-authoritative synchronized play, pause and seek.
- MP4/WebM and other browser-playable media through a compatibility proxy.
- Public video-page resolving where a page exposes HTML5 media.
- HLS `.m3u8` playback.
- YouTube and Vimeo player modes.
- Chat, emoji reactions, playlist and group polls.
- Host transfer and reconnect handling.
- **Live lounge with WebRTC camera + microphone.**
- **Voice-only join mode.**
- **Mic and camera on/off controls.**
- **Front/rear camera switching on supported devices.**
- **Screen sharing alongside the camera/voice call.**
- **Automatic compact/cinema camera-tile layout while the movie is playing.**
- **Host spotlight controls.**
- **Host mute and camera-off controls.** A host can turn another participant's media off, but the app never remotely turns somebody's microphone or camera on.
- Optional TURN configuration for networks where peer-to-peer WebRTC cannot connect directly.

## Live lounge architecture

Camera, microphone and screen media use **WebRTC**. The existing room WebSocket carries only signaling messages (offer/answer/ICE), presence/media state, spotlight state and host moderation commands.

For a small watch party this uses a mesh topology: each live participant sends media directly to the other live participants. This is a good fit for a demo/small room. For a large production room with many simultaneous cameras, use an SFU such as LiveKit, mediasoup, Janus or similar infrastructure.

Frame uses public STUN servers by default. For restrictive NAT/firewall environments, configure a TURN server on the backend:

```text
TURN_URL=turn:your-turn-server:3478
TURN_USERNAME=your-username
TURN_CREDENTIAL=your-password
```

The browser obtains the ICE configuration from `/rtc-config`.

## Run locally

Install Python 3.12 or newer, then:

```sh
python -m venv .venv
```

Windows PowerShell:

```powershell
.venv\Scripts\Activate.ps1
```

macOS/Linux:

```sh
source .venv/bin/activate
```

Then:

```sh
python -m pip install -r requirements.txt
python server_v5.py
```

Open **http://localhost:8000**. Camera/microphone access works on localhost. For internet deployment, use HTTPS because modern browsers require a secure context for camera, microphone and screen sharing.

## Render / Docker deployment

The included Dockerfile runs `server_v5.py` and serves the frontend, `/ws`, media compatibility routes and `/rtc-config` from the same origin.

Use one Render instance/process because room state is currently in memory. The service port comes from `PORT` (default `8000`).

If a separately hosted frontend is used, set its WSS backend URL and add that exact frontend origin to `ALLOWED_ORIGINS` on the backend.

## Video source notes

Frame supports the built-in catalog, public direct media URLs, many public HTML5 video pages, HLS streams, YouTube and Vimeo. Provider restrictions still apply. Private/login-only video, DRM services such as Netflix/Prime/Hotstar/JioHotstar, and provider videos with embedding disabled cannot be generically bypassed or embedded.

YouTube quality selection is exposed through YouTube's own player controls for the host. YouTube does not provide a supported API that lets this project force one fixed quality on every viewer.

## Privacy and host controls

Joining the Live lounge is explicit. Camera/microphone permission is requested by the browser when a participant chooses camera or voice mode. Screen sharing always uses the browser's native screen-picker permission flow.

The host can mute a participant or turn their camera off. The host cannot remotely enable a participant's microphone, camera or screen share.

## Tests / project structure

Existing synchronization/integration tests remain under `tests/`. The important runtime files are:

- `server_v3.py`: stabilized media proxy / smart public-video resolving / HLS support.
- `server_v5.py`: current room server, WebRTC signaling and live-lounge state.
- `dist/app.js`: core room UI, playback, chat and playlist logic.
- `dist/enhancements-v3.js`: stabilized multi-source / YouTube / Vimeo playback layer.
- `dist/rtc.js`: camera, mic, voice-only, screen share, spotlight and WebRTC peer connections.
- `dist/sync.js`: playback synchronization helpers.
- `Dockerfile`: current production entry point (`server_v5.py`).

## Limitations

Room state is in memory, so a backend restart loses current rooms, queues and chat. The WebRTC live lounge is mesh-based and is intended for a small group rather than dozens of simultaneous camera streams. Some networks require TURN even when normal website/WebSocket access works.

Browser autoplay policies can require a user click before remote audio starts; Frame shows an **Enable live audio** control when that happens. Screen-share system audio availability depends on the browser/OS and what the participant selects in the share dialog.

## GitHub submission

For a strong demo, record two browser profiles/devices in one room showing synchronized playback, chat, camera/voice, a screen share and a host spotlight. Keep secrets such as TURN credentials in Render environment variables rather than committing them to GitHub.
