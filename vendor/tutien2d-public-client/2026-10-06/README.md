# TuTien2D public client snapshot

- Source: https://tutien2d.online/
- Snapshot date: 2026-10-06
- Downloaded: 246 same-origin script/style/manifest references plus this index
- Purpose: local protocol/UI analysis and read-only runtime loading by the
  server's headless vendor engine. The snapshot is loaded at runtime exactly as
  checked in; it is never modified or bundled into the core bot build.

The server uses `apps/server/src/headless/vendor-env.ts` to load the snapshot in
Node's `node:vm` with DOM/canvas stand-ins and no `require`, `process`, file
system, `fetch`, or XHR capability exposed to vendor code. This is capability
control for a trusted, reviewed snapshot, not a security sandbox: `node:vm` is
not a hardened isolation boundary. The environment does not draw and the
server owns the real-time update loop.

Relevant files for packet analysis:

- `src/net/gateway.js` — official inbound opcode handlers.
- `src/net/client.js` — browser network client wrapper.
- `src/entities/player.js` — player HP/MP model.
- `src/ui/hud.js` and `src/ui/chiso.js` — official HP/MP rendering.
- `src/net/snapdelta.js` — snapshot v2 transport helper.

Evidence confirmed from `src/net/gateway.js`:

- `you`, `hurt`, and `revived` update the local player's `hp`/`mp`.
- `status.ht/hm/sh/slm` update haste/shield/slow effects, not HP/MP.
- `formation` with `act: "balance"` updates `Progress.stones` from a validated
  non-negative integer.

Do not put credentials, tokens, cookies, or raw live packet logs in this folder.
