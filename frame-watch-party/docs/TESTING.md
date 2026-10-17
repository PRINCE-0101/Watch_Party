# Verification and honest performance reporting

## Automated verification

Run `python tests/integration.py`. It starts a real aiohttp server on an ephemeral TCP port and ten real WebSocket clients on the same host. A single Python process contains both server and client test tasks. The benchmark measures elapsed time from host send until all ten clients receive each seek snapshot. It is an application-level loopback test, not a LAN propagation or rendered-frame test.

The exact measured values and conditions are in `benchmark.json`. Functional coverage includes 10 viewers, permissions, 60 control events, late joins, reconnect identity, duplicate action IDs, concurrent chat, changing votes, host transfer, disconnect failover and malformed payload recovery.

Run `node --test tests/sync.test.js` for timeline extrapolation, paused state, drift policy and fuzzy-search unit tests.

Browser automation was unavailable in the build environment. The responsive interface and actual video playback have not been browser-verified. No claim is made that the 500 ms browser drift target is proven.

## Reproduce the brief's LAN performance test

1. Run the backend on one laptop. Connect ten active browser windows/devices on the same LAN. Avoid background tabs because browsers throttle their timers. Use the same video and let it buffer.
2. Record OS, browser versions, CPU/RAM, Wi-Fi or wired setup, number of devices, server address, media URL and duration. Record any buffering or dropped connections.
3. Repeat at least 100 play, pause and seek controls after warmup. To measure propagation accurately across devices, use synchronized clocks or server-side send/ack timestamps with explicit uncertainty. The built-in diagnostic ping is round-trip latency, not one-way control propagation. The automated loopback test measures full command-to-all-receipts duration.
4. Sort valid latency samples; p95 is the sample at `ceil(0.95*N)`. Compare with the required 250 ms threshold. Retain raw samples and describe clock uncertainty. Do not substitute diagnostic ping values for control-event latency.
5. For actual playback drift, inspect the video currentTime and authoritative target after each correction on every active browser. Record wall-clock sample time, client ID, media position, target position, buffering state and absolute error. Measure at least 60 seconds including play, pause and seek. Check the <=500 ms requirement after the player has seeked and is ready; separately report transient buffering/seek intervals.
6. Test a late join during playback, disconnect/reconnect, host disconnect for more than 15 seconds, duplicate commands, simultaneous chat, invalid room code and blocked autoplay.
7. Include the raw observations, device list and any failing cases in the final submission. The included correction algorithm is designed to converge, but cannot guarantee timing under arbitrary network or decode stalls.

## Failure behavior

- Bad room code: readable error; room can be retried.
- Missing backend / wrong origin: connection fails; setup instructions remain available.
- Browser autoplay blocked: tap-to-play overlay.
- Invalid or unavailable media: error toast; choose another video.
- Disconnect: local playback pauses; reconnect retries with bounded exponential delay.
- Host disconnect: role is reserved for 15 seconds, then transferred.
- Server restart: rooms are lost; create a new room.
- High input rate: server returns a rate-limit message.
