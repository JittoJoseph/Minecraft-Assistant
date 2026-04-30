# Minecraft Assistant Bot

A modular Mineflayer bot for offline-mode servers with:

- `follow me`, `come`, `afk`, `stop`
- default patrol mode when no other task is active
- manual farming (`farm`)
- continuous farming (`autofarm on` / `autofarm off`)
- optional automatic night sleeping (`autosleep on` / `autosleep off`)
- damage-triggered evade mode (always switches to the latest attacker, resets 60s timer, then resumes prior task)
- Discord webhook activity reports (join/leave events and online-player list command)
- mature crop harvesting for wheat, carrots, potatoes
- position-based same-crop replanting
- chest deposit automation with seed reserves
- auto-eat support while farming
- reconnect on disconnect

## Setup

1. Copy env template:
   - `Copy-Item .env.example .env`
2. Edit `.env` values as needed (minimal: BOT_USERNAME, MINECRAFT_AUTH, MINECRAFT_SERVER).
3. Start bot:
   - `npm start`
4. Optional production build:
   - `npm run build`
5. Local TypeScript dev mode:
   - `npm run dev`

## Bot identity default

Default username and label are set to `TigerBaby`.

## Default server config

The env template already includes:

- `MINECRAFT_SERVER=serveraddress:port`
- `MINECRAFT_AUTH=offline`
- `COMMAND_PREFIX=bot`
- `DEPOSIT_POINT=-106,52,124`
- `AUTOFARM_ON_START=false`
- `DISCORD_WEBHOOK_URL=`

Every command must include the prefix. Without it, bots ignore the message.
Example: `b1 come`, `b2 afk`, `bot help`.

## Commands

- `<prefix> follow me`
- `<prefix> come`
- `<prefix> afk`
- `<prefix> stop`
- `<prefix> setspawnpoint`
- `<prefix> sleep`
- `<prefix> farm`
- `<prefix> autofarm on`
- `<prefix> autofarm off`
- `<prefix> autosleep on`
- `<prefix> autosleep off`
- `<prefix> discord players`
- `<prefix> help`

`sleep` and `autosleep` use the current configured spawn bed and resume the previous activity after wake-up.

Spawn bed config options:

- set defaults in env: `SPAWN_BED_X`, `SPAWN_BED_Y`, `SPAWN_BED_Z`
- or run `setspawnpoint` while standing on a bed to update the in-memory spawn bed for the current run (the bot prints the bed coordinates)

Storage deposit config:

- `DEPOSIT_POINT` sets the storage hall anchor for all deposits (`x,y,z`)
- bot scans chests only within the configured storage radius around that point
