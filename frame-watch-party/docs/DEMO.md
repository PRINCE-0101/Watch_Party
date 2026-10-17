# Five-minute presentation

1. **Problem (30 seconds):** Friends watching separately drift out of sync; chat and movie choice happen elsewhere. Frame keeps playback, queue, chat and voting in one room.
2. **Create and invite (30 seconds):** Open two browser profiles. Create a room as Prince. Join the second using its code.
3. **Playback (60 seconds):** Queue Big Buck Bunny, click Watch, then play and seek. Show the second player following. Explain why only the host controls playback.
4. **Social features (60 seconds):** Add a chat message and reaction. Add another film. Create a poll and vote from both browsers. Transfer host.
5. **Reliability (60 seconds):** Reload a viewer to show its identity and position recover. Close the host and wait 15–17 seconds to show failover.
6. **Engineering (60 seconds):** Explain the server timestamp/position pair, ping-based clock estimate, hard seek versus gentle playback-rate correction, and bounded state. Show the measured benchmark file and explicitly call it a loopback test.
7. **Limitations (30 seconds):** In-memory rooms, one backend process, direct media URLs, real-browser/LAN targets still need validation.

## Be ready to answer

**Why not send the video over WebSockets?** Each browser streams the media from its original URL. WebSockets carry small state changes, chat and votes.

**Why do late joiners not start at zero?** The server extrapolates the playback position using elapsed time since the last control.

**How do concurrent actions behave?** One server loop updates authoritative state. Host-only playback avoids conflicting controllers; votes are keyed by member and chat updates are appended.

**What would you improve next?** Persistent rooms, account-based access, shared state for multiple instances, end-to-end browser telemetry and broader media integrations.

**What did you personally build or change?** Answer honestly. Walk through the code, run the tests, and make a meaningful improvement you can explain. Follow the recruitment round's AI-assistance rules.
