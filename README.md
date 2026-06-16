# TetherCam

Use an Android phone as a low-latency camera source for desktop production workflows.

## What It Does

- Streams mobile camera to desktop over WebRTC signaling (`ws://<pc-ip>:4747`)
- Supports LAN and USB (ADB port-forward) connection modes
- Provides QR-based onboarding, network discovery, and manual endpoint input
- Exposes device control commands from desktop to mobile

## Project Structure

- `tethercam_desktop`  
  Electron + React desktop app (server, discovery, diagnostics UI)
- `tethercam_mobile`  
  Flutter mobile app (camera capture, signaling client, streaming controls)

## Requirements

### Desktop

- Node.js 18+
- npm
- ADB available in PATH (for USB mode)

### Mobile

- Flutter SDK installed
- Android device with USB debugging enabled (for USB mode)

## Setup

### 1. Desktop

```bash
cd tethercam_desktop
npm install
npm run dev
```

### 2. Mobile

```bash


flutter run -d <device_id>
```

## Connection Methods

### 1. Scan QR

1. Start desktop app.
2. In **Connect**, verify QR is visible.
3. On mobile, tap **Scan QR**.
4. Scan desktop QR and wait for connection.

### 2. Find on Network (LAN)

1. Keep desktop app running.
2. Ensure phone and PC are on the same subnet.
3. On mobile, tap **Find on Network**.
4. Select discovered desktop entry and connect.

### 3. Manual Endpoint

Use mobile **Manual endpoint** with one of:

- `ws://<pc-ip>:4747`
- `tethercam://<pc-ip>:4747`
- `<pc-ip>` (port `4747` assumed)

### 4. USB (ADB)

1. Connect phone via USB and enable USB debugging.
2. On desktop, open **USB (ADB)** and click **Scan & Forward** (or rely on startup auto-forward).
3. On mobile, tap **USB (ADB)** to connect via `ws://127.0.0.1:4747`.

## Diagnostics

### Desktop Diagnostics Panel

The desktop app includes a **Diagnostics** panel showing:

- WebSocket connect/disconnect events
- Device registration events
- Discovery and signaling flow events
- USB forwarding success/failure

Use this to quickly identify routing/firewall issues.

### Mobile Socket Error Overlay

The mobile streaming page now shows exact signaling/socket errors (for example timeout or WebSocket failure) near the top status area.

## Common Troubleshooting

### Desktop shows wrong adapter IP

If desktop shows an unreachable IP, restart the app after disabling VPN/virtual adapters.  
Preferred connection target should match your active Wi-Fi/LAN interface.

### Mobile stuck in connecting

- Confirm desktop URL is reachable from phone subnet
- Test with manual endpoint `ws://<pc-ip>:4747`
- Check desktop **Diagnostics** for connection attempts
- Verify firewall allows inbound `4747` on private network

## Build

### Desktop production build

```bash
cd tethercam_desktop
npm run build
```

### Mobile tests

```bash
cd tethercam_mobile
flutter test
```
