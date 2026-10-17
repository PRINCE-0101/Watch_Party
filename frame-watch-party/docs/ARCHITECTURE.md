# How Frame works

The browser opens a WebSocket to the Python server. One server event loop owns every room. Room changes update the shared state before broadcasting a snapshot. A monotonically increasing revision lets clients ignore older snapshots. Host-only controls avoid competing play/seek commands; other members can add queue items, chat and vote.

Playback is a tuple: video URL, title, media position, playing flag and server timestamp. While playing, current position equals the stored position plus elapsed server time. Pause stores that extrapolated position. Seek replaces it. Joining never resets it.

Browsers estimate clock offset using a ping: `serverTime - (clientSend + clientReceive)/2`. The smallest observed round-trip sample provides the offset estimate to reduce queueing bias. A snapshot carries its send-time position; clients advance it by estimated transit/elapsed time. Every 500 ms the client compares its actual media position to the target. It seeks for drift above 350 ms, adjusts rate gently for drift between 80 and 350 ms, and returns to normal rate within 80 ms. This is a correction policy, not a measured upper bound: buffering and browser scheduling can exceed it.

Server snapshots are sent on actions and every two seconds. On disconnect, browsers pause playback. On reconnect they use a random session token stored in sessionStorage to reclaim their member identity, then receive fresh state. Tokens are never included in public room snapshots. The server reserves the host role for 15 seconds, then chooses an online member. A direct host transfer updates the role immediately.

Every action may carry a random actionId. The server retains a bounded per-member deduplication set so a duplicated action does not append twice. Votes are keyed by member ID, so changing a vote replaces the previous choice. Chat and playlist sizes are capped to keep snapshots bounded.

All messages are rendered as escaped text. WebSocket upgrades check the browser Origin. Remote video URLs are used by the browser only and are never fetched by the Python server. This prototype uses invitation-code access rather than accounts, and has no durable storage.

## Extending this project

A durable version would add room persistence, authenticated membership, Redis pub/sub or equivalent for multi-instance fan-out, a room-state transaction/serialization mechanism, and stored per-client latency/drift telemetry. Those features are not implemented here.
