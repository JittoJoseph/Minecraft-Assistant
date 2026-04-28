# Minecraft Assistant Bot (TypeScript)

A modular Mineflayer bot for offline-mode servers with:

- `follow me`, `come`, `afk`, `stop`
- manual farming (`farm`)
- continuous farming (`autofarm on` / `autofarm off`)
- mature crop harvesting for wheat, carrots, potatoes
- position-based same-crop replanting
- chest deposit automation with seed reserves
- reconnect on disconnect

## Setup

1. Copy env template:
   - `Copy-Item .env.example .env`
2. Edit `.env` values as needed.
3. Start bot:
   - `npm start`
4. Optional production build:
   - `npm run build`

## Important username limitation

Minecraft account usernames cannot contain spaces.  
So while project branding can be **Minecraft Assistant** and label can be **Tiger Baby**, the actual login username must be valid (default: `Tiger_Baby`).

## Default server config

The env template already includes:

- `MINECRAFT_SERVER=fullcrewserver.aternos.me:25172`
- `MINECRAFT_AUTH=offline`

## Commands

- `follow me`
- `come`
- `afk`
- `stop`
- `farm`
- `autofarm on`
- `autofarm off`
- `help`
