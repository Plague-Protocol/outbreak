# Outbreak — Design & Stage 1 Plan

> Working name. Separate from `plague-celo` (the live social-deduction game), which this does not touch.
> Draft 2026-11-04. Nothing here is built yet.

## Premise

Nobody is infected. Players are survivors in a zombie-overrun city. They have to find a
safe zone before they are caught, by zombies or by other players. Anyone who reaches a
safe zone advances to the next stage; anyone who doesn't is eliminated.

Setting: a zombie-virus outbreak in invented cities, universal on purpose so it reads anywhere
(decided 2026-11-06; earlier drafts were Lagos-first). Resident Evil-style districts, not real
cities. (Do not use the Resident Evil name or imagery — Capcom trademark.) City 1 is Port Halden.

## Design principle: fun first, money second

The game must be fun in its own right. Staking and earnings are an optional layer on top,
never the reason to play. Where earning is possible it is a small bonus, not the hook.

## Access: trial, then sign-in

- **Trial (no sign-in):** a short sample, such as the first part of city 1, so a new
  visitor can try the loop in seconds. No saved progress.
- **Full game (sign-in required):** sign in with Google or a passkey through thirdweb
  in-app wallets, so non-crypto users get a wallet without knowing they have one.
  Progress, funds, gear and city unlocks are tied to that account.
- **Inside MiniPay:** the wallet is already connected (zero-click). Do not show a sign-in
  UI there. Reach MiniPay's provider with `EIP1193.fromProvider({ provider: window.ethereum })`
  (see `plague-celo` notes on thirdweb v5 and `createWallet('io.metamask')`).
- **MiniPay is the easy path:** no sign-in step at all, so MiniPay users go straight to
  playing. Sign-in is for everyone outside MiniPay.
- **Why:** traction and retention need an account to attach progress to, and the same
  account is the base for staking and the one-account-per-person city lock later.
- **Limits:** a Google or passkey account is friction against multi-accounting, not proof
  of personhood. Do not treat it as sybil resistance for real-money rewards.
- **Gas:** an in-app wallet has no CELO. Anything that goes on-chain for these users
  needs sponsored gas. Not needed until phase 3.

## Core loop

1. Spawn at a random point in the city.
2. A **countdown** starts (GTA-style pressure): reach a safehouse before it hits zero.
3. A task chain unlocks the way out. Map → key is one example, not a fixed script; the
   chain is built per run from a pool of tasks (see below), with extra tasks in between.
4. Zombie types (and later animals) hunt the player. The longer the run, the more the
   city escalates (more zombies, louder, tougher types). In multiplayer, other players
   can kill you until you are inside a safe zone.
5. Reach a safehouse in time with what it requires → saved, advance. Out of time or dead
   → eliminated.
6. Tasks also earn in-game funds, spent at a weapon shop.

### Task pool (illustrative, to be tuned in play)

Locate the map · find a key · restore power to a gate · find fuel for a vehicle · rescue
an NPC · retrieve a keycard · tune a radio to learn which safehouse is open · gather
medical supplies. A run picks a seeded subset and order, with locations randomized.
Some tasks are required to open the safehouse; others are optional and trade time for
gear or funds.

### Countdown rules (draft)

- One clock per stage, set by city size and the length of the task chain.
- Optional tasks cost time. Skipping them is faster but leaves you weaker.
- Escalation tied to the clock, not just to time spent, so a slow run gets harder.
- Tuning target: a skilled player finishes with a little time left; a new player can
  finish with practice. Pace is found by playtesting, not decided here.

## Rules decided so far

- **Safehouse needs to be unlocked** by completing its required tasks (not necessarily a key).
- **Randomized item and task locations** from a seed, so a layout can't be learned.
- **City lock (staked mode, later):** a player who clears a city can no longer stake in
  it; it becomes free to play. They may stake in other cities or phases.
- **Ads: deferred.** Billboards in the world remain an idea only. Not part of the build
  plan; revisit once there are players.

## Phasing

| Phase | Scope | Money | Server |
|---|---|---|---|
| 1 | Free single-player, **up to 3 cities** (trial without sign-in, full game with it) | None | Minimal: auth + progress storage. Game itself runs in the browser |
| 2 | Free multiplayer, PvP kills until safe | None | Small real-time game server |
| 3 | Staked PvP rooms | Player stakes only | Authoritative server + outcome signer |
| 4 | Optional small earnings in single player | Needs a funder (see below) | Same |

Phase 1 earnings are in-game only (funds for the weapon shop, cosmetics, progress).
Real-money earnings wait until there is a funded source for them.

## Open problems (must be solved before phase 3)

1. **Single-player earnings have no funder.** Multiplayer pots are other players'
   stakes; single-player has no counterparty. Any real-money bonus needs a fixed daily
   budget from a defined source (sponsors, ads if revived, or a treasury with hard caps).
   Do not fund it from an open treasury that bots can drain.
2. **Outcomes are decided off-chain.** Randomized tasks and PvP kills can't be verified
   on-chain, so a backend signs results and a contract pays out. Players trust that backend.
   Anti-cheat (speed hacks, scripted runs) gets harder once money is involved.
3. **New contracts are required, and they must be upgradable.** `PlagueGame` is ~23.4 KB
   of 24.5 KB and not upgradeable; do not extend it. This game gets its own
   escrow/settlement contracts behind proxies (UUPS or transparent), and its own MiniPay
   allowlist submission. Notes:
   - MiniPay allowlists by contract address and selector. A proxy keeps one stable address
     across upgrades, so the address-level submission survives. **New or changed
     selectors still need re-submitting**, so keep the external interface small and stable.
   - Upgrade authority can redirect staked funds. Put it behind a multisig plus a
     timelock, and say so publicly. Do not give it to a single EOA.
   - Keep each implementation under the 24,576-byte limit (split into modules rather than
     one large contract), and plan storage layout (gaps, no reordering) from day one.
   - Consider holding funds in a minimal escrow with a narrow settlement interface, so
     most game-logic upgrades never touch custody.
4. **One account per person** is needed for the city lock to mean anything.
   Proof-of-personhood is the likely route.
5. **Real-money skill/PvP games are regulated in many places** and may conflict with
   MiniPay listing rules. Get a view before designing the payout.
6. **Camping safe-zone entrances** will be the first PvP exploit. Plan for it (entry
   cooldowns, no-kill radius, zone capacity).

## Stage 1 technical plan

- **Rendering:** low-poly 3D, three.js. Camera: fixed-angle perspective follow camera (yaw locked
  at 45 degrees, steeper than isometric, cinematic dolly in the intro), so touch controls stay
  simple. Night, fog, flashlight, a few pooled street lights. No Unity WebGL: download size is too
  large for MiniPay.
- **Story:** told like Eko Lockdown (title card, cutscene, speaker lines, radio briefs, endings),
  wrapped around the seeded task chain. Text in `src/core/story.ts`.
- **City 1 (Port Halden):** 8x8 blocks with districts (downtown, residential, park, docklands on a
  harbour, outskirts with a gas station), drivable vehicles, supply crates, weapon pickups and a gun
  store (in-game money only), a minimap and full map rotated to match the camera.
- **Combat:** pistol, shotgun, assault rifle with aim assist (touch first), reloads, and gunfire
  noise that draws zombies. Player health; lunges can be dodged or interrupted.
- **Budget:** small texture budget; test on a mid-range Android phone inside MiniPay.
- **Randomization:** deterministic seed → task/item placement. Same function runs in the
  browser now and on the server in phase 2, so phase 2 doesn't rewrite it.
- **State:** a pure game-state module with no DOM dependencies, so it can move to the server.
- **Hosting:** static build on Vercel or Cloudflare for the game itself. Because the full
  game needs saved progress per account, phase 1 also needs a small backend (auth
  verification + progress store). It is not a real-time server.
- **Dependencies:** exact-pinned versions, committed lockfile, `ignore-scripts=true`
  (MiniPay listing requirements). 7-day minimum package age.
- **Scope for phase 1:** up to 3 cities, each with its own layout, task pool and
  countdown tuning. Build city 1 fully first; add 2 and 3 only if people finish city 1.
- **Success measure:** share of players who finish a city, and share who go on to the next
  city or try a second run. If few finish, fix the level before building more.

## Hosting later

Phase 2 server goes in a Docker image with all config via env vars, so it runs on the
existing Lighthouse VPS (with `mem_limit`/`cpus` set) or on Railway (paid plan; trials
expire) without changes. Keep game state recoverable across restarts before phase 3.
Serve 3D assets from a CDN, not the VPS.
