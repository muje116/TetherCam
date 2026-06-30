# TetherCam

Use an Android phone as a low-latency camera source for desktop production workflows.

## What It Does

- Streams mobile camera to desktop over WebRTC signaling (`ws://<pc-ip>:4747`)
- Supports **WiFi**, **USB (ADB)**, and **Bluetooth-assisted** pairing
- Desktop can **scan for phones**, **invite by IP**, or wait for mobile to connect
- Provides QR-based onboarding, mDNS discovery, and manual endpoint input
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
cd tethercam_mobile
flutter pub get
flutter run -d <device_id>
```

## Connection Methods

Phones always connect **to the desktop** WebSocket server (`ws://<pc-ip>:4747`). The desktop can discover phones and send invites; the phone can also connect on its own.

### 1. Desktop adds a phone (WiFi)

1. Start desktop and mobile apps (phone on same Wi‑Fi).
2. On desktop **Add Phone**, click **Scan All** — phones running TetherCam appear in the list.
3. Click **Invite** next to a phone, or enter the phone IP manually and click **Invite**.
4. The phone receives the invite and connects automatically.

### 2. Mobile finds desktop (WiFi / QR / manual)

1. **WiFi**: On mobile, tap **WiFi → Find on network** and select the desktop.
2. **QR**: Scan the QR shown in the desktop **Connect** panel.
3. **Manual**: Enter `ws://<pc-ip>:4747` or just `<pc-ip>` on the phone.

### 3. USB (ADB)

1. Connect phone via USB with USB debugging enabled.
2. On desktop, **USB (ADB) → Scan & Forward** (also runs at startup).
3. On mobile, tap **USB** or wait for auto-connect via `127.0.0.1:4747`.

### 4. Bluetooth (pairing aid)

Bluetooth does not carry the video stream directly. Use it to pair phone and PC, then:

1. Run **WiFi scan** on the phone (matches a paired PC name to a LAN desktop), **or**
2. Use **desktop Invite** while the phone app is open on Wi‑Fi.

### 5. Scan QR (mobile-initiated)

1. Start desktop app.
2. In **Connect**, verify QR is visible.
3. On mobile, tap **Scan QR**.
4. Scan desktop QR and wait for connection.

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
