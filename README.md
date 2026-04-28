# Minecraft Assistant Bot (TypeScript)

A modular Mineflayer bot for offline-mode servers with:

- `follow me`, `come`, `afk`, `stop`
- manual farming (`farm`)
- continuous farming (`autofarm on` / `autofarm off`)
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

- `MINECRAFT_SERVER=fullcrewserver.aternos.me:25172`
- `MINECRAFT_AUTH=offline`

## Commands

- `follow me`
- `come`
- `afk`
- `stop`
- `setspawnpoint`
- `sleep`
- `farm`
- `autofarm on`
- `autofarm off`
- `help`

`setspawnpoint` saves the bot's own bed location persistently, and `sleep` always uses that saved bed only.
