## Project Requirements Document

**Project Name:** FarmKeeper Bot
**Tech Stack:**

- Mineflayer
- Node.js
- Hosted on Render (or Railway)
- Fabric Minecraft Server (Aternos)

---

# 1. Project Overview

FarmKeeper is an autonomous Minecraft assistant bot that joins a multiplayer server continuously and provides:

- Player-following and movement commands
- AFK presence / server companion behavior
- Autonomous multi-crop farming
- Intelligent crop replanting
- Chest storage automation
- Chat-command interaction

Goal:
Create a reliable in-game helper that behaves like a persistent farming worker and utility companion.

---

# 2. Core Functional Requirements

## 2.1 Bot Presence

### Requirements

- Bot automatically joins server on startup.
- Auto reconnect if disconnected.
- Recover from crashes.
- Optional idle behavior to prevent standing frozen.

### Commands

```text
join automatically
reconnect on kick/disconnect
afk
come
follow me
stop
```

---

# 3. Player Interaction Features

## 3.1 Follow Command

Command:

```text
follow me
```

Behavior:

- Follow command sender.
- Maintain configurable distance.
- Pathfind around obstacles.
- Stop when:

```text
stop
```

---

## 3.2 Come Command

Command:

```text
come
```

Behavior:

- Pathfind to player once.
- Wait at destination.

---

## 3.3 AFK Mode

Command:

```text
afk
```

Behavior:

- Stay in designated AFK location.
- Optional periodic movement/jump.

---

# 4. Autonomous Farming System

## 4.1 Supported Crops

Must support:

- Wheat
- Carrot
- Potato

---

## 4.2 Crop Detection

Bot scans farm plots and detects:

- Mature crops only
- Crop type
- Harvestable block coordinates
- Nearby farmland blocks

---

# 5. Smart Same-Crop Replanting (Critical Feature)

## Requirement

When a crop is harvested:

- Record harvested block position
- Identify original crop type
- Replant only that same crop in that same coordinate

Example:

```text
(120,64,-32) harvested carrot
-> replant carrot only there

(121,64,-32) harvested wheat
-> replant wheat seeds only there
```

## Why

Prevents:

- Mixed-up fields
- Random planting
- Crop disorder in shared mega farms

This is **position-based crop memory**.

---

# 6. Multi-Crop Farming Logic

## Proposed Algorithm

### Scan Phase

Loop through farm:

```text
Find mature crops
Queue harvest jobs
Store:
- x,y,z
- crop type
```

---

## Harvest Phase

For each job:

1 Harvest crop
2 Collect drops
3 Replant same crop at same block
4 Continue

---

## Seed Priority Rules

Use correct item:

| Crop   | Replant Item |
| ------ | ------------ |
| Wheat  | Wheat Seeds  |
| Carrot | Carrot       |
| Potato | Potato       |

If required seed missing:

- Skip block
- Log shortage
- Optionally fetch from chest later

---

# 7. Storage Automation

## Chest Deposit

After inventory threshold reached:

- Locate assigned chest
- Open chest
- Deposit harvested produce
- Keep minimum seeds for replanting

Example reserve:

```text
64 wheat seeds
64 carrots
64 potatoes
```

Never deposit below reserve.

---

# 8. Farming Modes

## Manual Mode

Command:

```text
farm
```

Bot starts one farming cycle.

---

## Continuous Mode

Command:

```text
autofarm on
autofarm off
```

Behavior:

- Recheck farm every X minutes
- Harvest mature crops continuously

---

# 9. Safety Requirements

Bot must avoid:

- Trampling farmland
- Harvesting immature crops
- Depositing all seeds accidentally
- Planting wrong crop in wrong plot
- Getting stuck
- Infinite pathfinding loops

Recovery:

```text
stuck detection
path reset
resume task
```

---

# 10. Optional Advanced Features (Phase 2)

Possible upgrades:

### Farmer Zones

Define regions:

```text
/farm zone1
```

Bot farms only inside region.

---

### Crop Statistics

Commands:

```text
farm stats
```

Outputs:

- Crops harvested
- Items stored
- Farming cycles completed

---

### Assistant Commands

Future ideas:

```text
harvest only wheat
bring carrots
guard farm
```

---

# 11. Non Functional Requirements

- 24/7 uptime
- Low CPU usage
- Reconnect resilience
- Works on Aternos
- Expandable command architecture
- Modular codebase

---

# 12. Suggested Architecture

Modules:

```text
bot.js
commands/
  follow.js
  come.js
  afk.js

farming/
  scanner.js
  harvest.js
  replant.js
  chest.js
```

Plugins:

- mineflayer-pathfinder
- mineflayer-collectblock
- mineflayer-tool

---

# 13. MVP Scope (Version 1)

Must have:
✅ Follow
✅ Come
✅ AFK
✅ Multi-crop harvesting
✅ Same-crop replant memory
✅ Chest deposit
✅ Auto reconnect
