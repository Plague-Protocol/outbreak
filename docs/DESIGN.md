# Outbreak — Design & Stage 1 Plan

> Working name. Separate from `plague-celo` (the live social-deduction game), which this does not touch.
> Draft 2026-11-04. Nothing here is built yet.

## Premise

Nobody is infected. Players are survivors in a zombie-overrun city. They have to find a
safe zone before they are caught, by zombies or by other players. Anyone who reaches a
safe zone advances to the next stage; anyone who doesn't is eliminated.

Setting: invented Resident Evil-style districts with a few camps each, not real cities.
(Do not use the Resident Evil name or imagery — Capcom trademark.) Locales can carry
local flavour (Lagos first) and sell local ad inventory.

## Core loop

1. Spawn at a random point in the city.
2. Task chain unlocks the way out: find the map, then find the key, then reach a safe zone.
3. Zombie types (and later animals) hunt the player. Other players can kill you until
   you are inside a safe zone.
4. Reach a safe zone with the key → saved, advance. Otherwise eliminated.
5. Tasks also earn funds, spent at a weapon shop (later: buy with wallet funds).

## Rules decided so far

- **Safe zone requires a key.** Tasks unlock in a chain.
- **Randomized item and task locations** from a server-side seed, so a layout can't be learned.
- **City lock:** a player who clears a city can no longer stake in it; it becomes free to play.
  They may stake in other cities or phases.
- **Ads:** companies can place billboards/posters on roads, shops and houses, per city.

## Phasing

| Phase | Scope | Money | Server |
|---|---|---|---|
| 1 | Free single-player stage, one city | None | None — static site, seed in browser |
| 2 | Free multiplayer, PvP kills until safe | None | Small real-time game server |
| 3 | Staked PvP rooms | Player stakes only | Authoritative server + outcome signer |
| 4 | Sponsored single-player prizes | Ad-funded budget | Same |

## Open problems (must be solved before phase 3)

1. **Single-player "+50% of stake" has no funder.** Multiplayer pots are other players'
   stakes; single-player has no counterparty. Fund it from ad revenue / sponsor prizes with
   a fixed daily budget. Do not fund it from a treasury that bots can drain.
2. **Outcomes are decided off-chain.** Randomized tasks and PvP kills can't be verified
   on-chain, so a backend signs results and a contract pays out. Players trust that backend.
   Anti-cheat (speed hacks, scripted runs) gets harder once money is involved.
3. **New contracts are required.** `PlagueGame` is ~23.4 KB of 24.5 KB and not upgradeable;
   do not extend it. This game gets its own escrow/settlement contract and its own
   MiniPay allowlist submission.
4. **One account per person** is needed for the city lock to mean anything.
   Proof-of-personhood is the likely route.
5. **Real-money skill/PvP games are regulated in many places** and may conflict with
   MiniPay listing rules. Get a view before designing the payout.
6. **Camping safe-zone entrances** will be the first PvP exploit. Plan for it (entry
   cooldowns, no-kill radius, zone capacity).

## Stage 1 technical plan

- **Rendering:** low-poly 3D, flat-shaded, locked isometric camera (reads as 2.5D).
  Three.js. No Unity WebGL — download size is too large for MiniPay.
- **Budget:** small texture budget; test on a mid-range Android phone inside MiniPay.
- **Randomization:** deterministic seed → task/item placement. Same function runs in the
  browser now and on the server in phase 2, so phase 2 doesn't rewrite it.
- **State:** a pure game-state module with no DOM dependencies, so it can move to the server.
- **Hosting:** static build on Vercel or Cloudflare. No server in phase 1.
- **Dependencies:** exact-pinned versions, committed lockfile, `ignore-scripts=true`
  (MiniPay listing requirements). 7-day minimum package age.
- **Success measure:** share of players who finish the level, and share who go on to try a
  second run. If few finish, fix the level before building phase 2.

## Hosting later

Phase 2 server goes in a Docker image with all config via env vars, so it runs on the
existing Lighthouse VPS (with `mem_limit`/`cpus` set) or on Railway (paid plan; trials
expire) without changes. Keep game state recoverable across restarts before phase 3.
Serve 3D assets from a CDN, not the VPS.
