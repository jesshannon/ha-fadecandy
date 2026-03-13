# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Home Assistant add-on that controls a [Fadecandy](https://github.com/scanlime/fadecandy) LED controller (USB VID `1d50`, PID `607a`) over USB. It runs as a privileged HA OS container on Raspberry Pi, targeting a physical bookshelf with 3 columns × 6 shelves of LEDs. The service is a Node.js ESM app (`"type": "module"`).

## Running the service

```bash
cd fadecandy-node
npm install
npm start          # node src/index.js, PORT defaults to 7890
```

`LOG_LEVEL` env var overrides the winston log level (default `debug`).

## Deploying to Home Assistant

The add-on is a **local build** — no published image. Deploy by:
1. Copying/cloning the repo onto the HA host under `/addons/`.
2. Adding the local path as a repository in HA → Add-on Store.
3. Using **Build** (not pull) on first install. If the pull error appears, use the kebab menu → **Rebuild**.

The container requires `SYS_RAWIO`/`SYS_ADMIN` privileges and maps `/dev/bus/usb` for direct USB access.

## Architecture

```
src/index.js              — entry point; wires up the three main objects
src/fadecandy/
  FadeCandyManager.js     — central state machine; owns the frame buffer,
                            shelf state, and mode lifecycle
  modes/                  — animation modes (BreatheMode, SparkleMode,
                            FadeQueueMode, RainbowColumnsMode)
src/fa/
  FadeCandy.js            — thin EventEmitter wrapper over the USB device
  lib/USBInterface.js     — node-usb driver layer
  lib/Pixels.js           — writes RGB VideoFrame packets to USB
  lib/ColorLUT.js         — uploads the gamma-correction CLUT on startup
  lib/Configuration.js    — sends configuration packets (e.g. disable interpolation)
src/ha/
  HomeAssistantBridge.js  — Express router mounted at /ha; REST endpoints
                            for HA to call (set shelf color, start/stop mode)
src/server/
  MonitorServer.js        — Express + WebSocket server; serves the debug UI,
                            REST API (/api/*), and /health
  public/                 — browser-side debug dashboard (HTML/CSS/JS)
src/config/
  bookshelfMap.js         — BOOKSHELF_MAP: 3-column × 6-shelf LED index ranges
                            (the only place physical wiring is encoded)
```

### Data flow

`FadeCandyManager` holds a flat `Uint8Array` frame buffer (pixelCount × 3 bytes). `setShelfColor`/`setShelfSideColor` write into the buffer using index ranges from `bookshelfMap.js`. `pushFrame()` is called every 100 ms by `startPushingFrames()` and sends the buffer to the device via `FadeCandy.send()`. Animation modes call `setAllShelves`/`setShelfColor` on a timer and return a stop function.

### Mode contract

Each mode class has:
- `id` (string) — used as the key in `manager.modes`
- `name` (string) — display name
- `start(options)` — begins animation, **must return a cleanup function** (called by `manager.stopMode()`)

### WebSocket events

`MonitorServer` broadcasts JSON messages on `/ws`:
- `{ type: 'state', data }` — full state snapshot
- `{ type: 'shelf', shelf }` — single shelf update
- `{ type: 'mode', running, name }` — mode start/stop
- `{ type: 'ready', ready: true }` — device ready

### Key config

- **Port**: 7890 (add-on exposes this via `config.yaml`; `PORT` env var overrides)
- **Pixel count**: auto-inferred from `BOOKSHELF_MAP` max index, floored at 512
- **HA API**: `homeassistant_api: true` in `config.yaml` — supervisor token is available as `SUPERVISOR_TOKEN`

## Changing the LED layout

Edit `src/config/bookshelfMap.js`. `BOOKSHELF_MAP[columnIndex][shelfIndex]` is an array of `[start, end]` inclusive LED index ranges (each shelf has two sides = two ranges).
