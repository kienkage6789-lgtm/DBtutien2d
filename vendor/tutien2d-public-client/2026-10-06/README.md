# TuTien2D public client snapshot

- Source: https://tutien2d.online/
- Snapshot date: 2026-10-06
- Downloaded: 246 same-origin script/style/manifest references plus this index
- Purpose: local protocol and UI analysis only; this snapshot is not imported by
  the bot build.

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
