# Fadecandy Node Home Assistant Add-on

Minimal Home Assistant add-on that runs a Node.js service to discover and talk to a Fadecandy LED controller over USB. Built for HAOS on Raspberry Pi where USB passthrough requires a privileged container.

## Features
- Node.js runtime with `usb` library and health endpoint on port 7892
- Privileged container with `/dev/bus/usb` mapped for direct Fadecandy access
- Periodic USB scan logging to confirm the board is detected

## Directory layout
- `fadecandy-node/config.yaml` – add-on manifest (privileged, USB, port mapping)
- `fadecandy-node/Dockerfile` – builds against Home Assistant base image, installs Node + libusb
- `fadecandy-node/rootfs/` – s6 service and init scripts
- `fadecandy-node/src/index.js` – starter Node service; replace with your legacy control logic
- `fadecandy-node/package.json` – service dependencies (no lockfile yet)

## Usage (local add-on)
1) Copy/clone this repo onto your Home Assistant host (e.g., under `/addons/fadecandy-node`).
2) In Home Assistant: **Settings → Add-ons → Add-on Store → ⋮ → Repositories → Add** and enter the local path/URL for this repo.
3) On first install choose **Build** (not pull) so Supervisor builds the image locally. If you see a pull error for `local/fadecandy-node-<arch>`, hit the kebab menu → **Rebuild**.
4) Open the "Fadecandy Node Controller" add-on, set `log_level` if desired, and click **Start**.
5) Check logs for "Fadecandy detected" lines. The `/usb` endpoint reports visible USB devices.

## Notes
- Container runs privileged and maps `/dev/bus/usb`; adjust if your supervisor requires explicit device mapping.
- To add your legacy control code, drop it into `src/` and update `src/index.js` + `package.json` accordingly.
- Add a `package-lock.json` when you are ready; Dockerfile will use it for reproducible builds.
