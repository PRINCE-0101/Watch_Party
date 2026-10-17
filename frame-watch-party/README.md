# Frame — Watch Party

A real-time watch-party project: create a room, invite friends, queue a video, and watch the same moment together. Built with a responsive vanilla JavaScript frontend and a Python/aiohttp WebSocket server. No database account, API key or frontend build step is required.

## Run it (Windows, macOS or Linux)

Install Python 3.12 or newer, unzip this folder, and open a terminal here:

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
python server.py
```

Open **http://localhost:8000**. Create a room, add a discovery title with **+**, and click **Watch** in the playlist. Press play. Open a second browser/profile and join using the six-character code.

For a LAN demonstration, open `http://YOUR-COMPUTER-LAN-IP:8000` on every device connected to the same network. Allow port 8000 through the host firewall when prompted. Share this LAN URL, not localhost. Keep one Python server process running.

## What works

- Rooms with cryptographically generated six-character invite codes; limit 50 retained members per room.
- Server-authoritative play, pause and seek; only the host can change playback.
- Late joins receive the current extrapolated media position.
- WebSocket broadcasts, clock offset estimation from ping/round-trip measurements, and periodic reconciliation.
- Drift above 350 ms triggers a seek; smaller playing drift is corrected with a 0.96–1.04 playback rate. Browser corrections run every 500 ms.
- Chat, five emoji reactions, shared queue, group polls with one current vote per member.
- Manual host transfer and automatic transfer after a 15-second disconnect grace period.
- Reconnect tokens survive page reload in the same tab; exponential retry up to 15 seconds.
- Categories, length filtering and Levenshtein fuzzy title search over a curated sample catalog.
- Action deduplication, payload limits, input checks, message rate limit and origin checks.
- Direct HTTP(S) video files, including MP4/WebM supported by the browser.

## Hosted frontend versus complete app

The private hosted Site is the frontend. Python/WebSocket hosting is separate and is **not deployed by this project**. A full working room is available immediately when you run `python server.py` locally.

For internet hosting, deploy the included Dockerfile on a platform that supports persistent WebSocket connections. Use **one instance/process** and HTTPS. Its port comes from `PORT`, default 8000. Serve the frontend from that same backend origin for the simplest setup. The container serves both the static files and `/ws`.

If you use the separately hosted frontend, open Connection & diagnostics and enter `wss://YOUR-BACKEND/ws`. On the backend, set `ALLOWED_ORIGINS` to the exact frontend origin (comma-separated for multiple origins), then restart. The browser refuses insecure `ws://` connections from HTTPS pages. Backend settings are per browser; each viewer must configure their connection. The private Site itself is owner-only, so use the local/LAN app for a multi-person demo.

## Tests

```sh
python tests/integration.py
node --test tests/sync.test.js
```

Node.js is only needed for the JavaScript unit tests, not to run the app. Integration tests launch their own ephemeral server and write `docs/benchmark.json`.

See `docs/TESTING.md` for the measured results and LAN/browser acceptance procedure. **Do not present loopback results as LAN results or claim browser drift has been measured.**

## Files

- `server.py`: room state, WebSocket protocol, permissions and reconnect lifecycle.
- `dist/index.html`, `style.css`: responsive interface.
- `dist/app.js`: room UI, discovery, chat, playback and connection handling.
- `dist/sync.js`: pure synchronization and search functions.
- `tests/`: integration and unit tests.
- `docs/`: architecture, benchmark and presentation notes.
- `Dockerfile`: portable full-app deployment.

## Limitations and intentional scope

Room state is in memory. A server restart loses rooms, queues and chat; this is not a persistent messaging service. Multiple server processes need shared state plus a cross-process event bus and are unsupported here. Disconnected member identity is retained for two minutes; empty rooms are eventually removed. Room codes are invitations, not private-user authentication. Do not put confidential information in demo chat.

The media itself is fetched separately by each browser; this server synchronizes playback, not video bytes. YouTube/Netflix page URLs, DRM video, local file paths and arbitrary embedded players are unsupported. Media availability, codecs, buffering, autoplay permissions and background-tab throttling can delay synchronization. A playback permission button appears when a browser blocks autoplay.

Movies are curated examples, not live personalized recommendations. Catalog metadata and durations are approximate. The first four entries are Blender open-movie examples; two additional entries are clearly described as sample clips. Media is linked from Google's sample video bucket and is not bundled. Availability is controlled by that third party. The poster designs are abstract CSS artwork, not official film posters.

## Credits

Big Buck Bunny, Sintel, Tears of Steel and Elephants Dream: Blender open-movie projects and their respective contributors. Sample video URLs: `https://storage.googleapis.com/gtv-videos-bucket/sample/`. Confirm each work's license and credit requirements before redistributing media. This repository distributes only application code and links, not the films. Optional fonts: DM Sans and Space Grotesk through Google Fonts; local system-font fallbacks are included.

## GitHub submission

Create a new repository, upload all the source files (not `.venv`, generated Python caches, or `.openai` Site metadata), and include a short screen recording of two browsers synchronized in one room. Choose a repository name such as `frame-watch-party`. Read `docs/DEMO.md` and understand the implementation before presenting it. Follow your club's rules on AI assistance and attribution.
