# Frame — Watch Party

A real-time movie night app with synchronized playback, room codes, chat, emoji reactions, shared playlists, group polls and host transfer.

## Run locally

Requires Python 3.12+.

```bash
python -m pip install -r frame-watch-party/requirements.txt
cd frame-watch-party
python server.py
```

Open http://localhost:8000. Create a room, then join from a second browser using the six-character code. For LAN demos, use the server computer's LAN IP and port 8000.

## Project files

The complete source is in [`frame-watch-party/`](frame-watch-party/). The downloadable bundle is [`frame-watch-party.zip`](frame-watch-party.zip). See the project [README](frame-watch-party/README.md) for detailed setup, deployment, limitations, and credits.

## Verification

- 10-client WebSocket integration test
- Synchronization and fuzzy-search unit tests
- Loopback p95 event delivery: 2.74 ms in the recorded run. This is not a LAN measurement, and browser playback drift remains to be verified.

Run tests with `python frame-watch-party/tests/integration.py` and `node --test frame-watch-party/tests/sync.test.js`.

The hosted frontend requires a separate WebSocket backend. Running `server.py` serves both the frontend and backend together.
