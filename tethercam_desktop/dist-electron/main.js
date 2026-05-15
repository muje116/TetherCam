//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
let electron = require("electron");
let node_path = require("node:path");
node_path = __toESM(node_path);
let node_url = require("node:url");
let express = require("express");
express = __toESM(express);
let node_http = require("node:http");
node_http = __toESM(node_http);
let ws = require("ws");
let cors = require("cors");
cors = __toESM(cors);
let node_os = require("node:os");
node_os = __toESM(node_os);
let node_events = require("node:events");
let uuid = require("uuid");
let multicast_dns = require("multicast-dns");
multicast_dns = __toESM(multicast_dns);
let werift = require("werift");
let fluent_ffmpeg = require("fluent-ffmpeg");
fluent_ffmpeg = __toESM(fluent_ffmpeg);
let ffmpeg_static = require("ffmpeg-static");
ffmpeg_static = __toESM(ffmpeg_static);
let node_child_process = require("node:child_process");
let node_util = require("node:util");
//#region electron/server/signaling-server.ts
var SignalingServer = class extends node_events.EventEmitter {
	constructor(port, connectionManager) {
		super();
		this.port = port;
		this.connectionManager = connectionManager;
		this.app = (0, express.default)();
		this.app.use((0, cors.default)());
		this.app.use(express.default.json());
		this.server = node_http.default.createServer(this.app);
		this.wss = new ws.WebSocketServer({ server: this.server });
		this.setupHttpRoutes();
		this.setupWebSocket();
	}
	/**
	* REST API endpoints for device synchronization.
	*/
	setupHttpRoutes() {
		this.app.get("/api/info", (_req, res) => {
			res.json({
				app: "TetherCam",
				version: "1.0.0",
				platform: process.platform,
				hostname: node_os.default.hostname(),
				port: this.port
			});
		});
		this.app.get("/api/devices", (_req, res) => {
			res.json(this.connectionManager.getDevices());
		});
		this.app.post("/api/devices/:deviceId/command", (req, res) => {
			const { deviceId } = req.params;
			const { command, payload } = req.body;
			if (this.connectionManager.sendCommand(deviceId, command, payload)) res.json({ status: "ok" });
			else res.status(404).json({ error: "Device not found or not connected" });
		});
		this.app.delete("/api/devices/:deviceId", (req, res) => {
			const { deviceId } = req.params;
			this.connectionManager.disconnectDevice(deviceId);
			res.json({ status: "ok" });
		});
		this.app.get("/api/connection-info", (_req, res) => {
			const addresses = this.getLocalAddresses();
			const primaryAddress = this.getPrimaryLocalAddress();
			res.json({
				addresses,
				port: this.port,
				url: `ws://${primaryAddress}:${this.port}`
			});
		});
	}
	/**
	* WebSocket handler for real-time signaling and control.
	*/
	setupWebSocket() {
		this.wss.on("connection", (ws$1, req) => {
			const clientIp = req.socket.remoteAddress?.replace("::ffff:", "") ?? "unknown";
			console.log(`[SignalingServer] WebSocket connection from ${clientIp}`);
			let deviceId = null;
			ws$1.on("message", (data) => {
				try {
					const message = JSON.parse(data.toString());
					this.handleMessage(ws$1, message, clientIp, deviceId, (id) => {
						deviceId = id;
					});
				} catch (err) {
					console.error("[SignalingServer] Invalid message:", err);
					ws$1.send(JSON.stringify({
						type: "error",
						message: "Invalid JSON"
					}));
				}
			});
			ws$1.on("close", () => {
				if (deviceId) this.connectionManager.removeDevice(deviceId);
				console.log(`[SignalingServer] WebSocket disconnected: ${clientIp}`);
			});
			ws$1.on("error", (err) => {
				console.error(`[SignalingServer] WebSocket error from ${clientIp}:`, err.message);
			});
			ws$1.send(JSON.stringify({
				type: "server-info",
				hostname: node_os.default.hostname(),
				platform: process.platform,
				version: "1.0.0"
			}));
		});
	}
	/**
	* Route incoming WebSocket messages by type.
	*/
	handleMessage(ws$2, message, clientIp, activeDeviceId, setDeviceId) {
		switch (message.type) {
			case "register": {
				const device = this.connectionManager.addDevice({
					name: message.name ?? "Unknown Device",
					model: message.model ?? "Unknown",
					platform: message.platform ?? "android",
					ip: clientIp,
					connectionType: message.connectionType ?? "wifi",
					ws: ws$2
				});
				setDeviceId(device.id);
				ws$2.send(JSON.stringify({
					type: "registered",
					deviceId: device.id,
					message: "Device registered successfully"
				}));
				break;
			}
			case "sdp-offer": {
				console.log(`[SignalingServer] Received SDP offer from ${clientIp}`);
				const resolvedDeviceId = message.deviceId ?? activeDeviceId ?? void 0;
				this.emit("sdp-offer", {
					deviceId: resolvedDeviceId,
					sdp: message.sdp,
					clientIp
				});
				break;
			}
			case "ice-candidate": {
				console.log(`[SignalingServer] Received ICE candidate from ${clientIp}`);
				const resolvedDeviceId = message.deviceId ?? activeDeviceId ?? void 0;
				this.emit("ice-candidate", {
					deviceId: resolvedDeviceId,
					candidate: message.candidate,
					clientIp
				});
				break;
			}
			case "device-status": {
				const deviceId = message.deviceId;
				if (deviceId) this.connectionManager.updateDevice(deviceId, {
					battery: message.battery,
					temperature: message.temperature,
					streamSettings: message.streamSettings
				});
				break;
			}
			case "stream-stats":
				this.connectionManager.emit("stream-stats", {
					deviceId: message.deviceId,
					latencyMs: message.latencyMs,
					fps: message.fps,
					bitrate: message.bitrate,
					packetLoss: message.packetLoss,
					resolution: message.resolution
				});
				break;
			default: console.log(`[SignalingServer] Unknown message type: ${message.type}`);
		}
	}
	/**
	* Start listening on the configured port.
	*/
	async start() {
		return new Promise((resolve, reject) => {
			this.server.listen(this.port, "0.0.0.0", () => {
				console.log(`[SignalingServer] HTTP + WebSocket server listening on 0.0.0.0:${this.port}`);
				resolve();
			});
			this.server.on("error", reject);
		});
	}
	/**
	* Stop the server.
	*/
	stop() {
		this.wss.clients.forEach((client) => client.close());
		this.server.close();
		console.log("[SignalingServer] Server stopped");
	}
	/**
	* Get all non-internal IPv4 addresses on this machine.
	*/
	getLocalAddresses() {
		return this.getAddressCandidates().map((entry) => entry.address);
	}
	getAddressCandidates() {
		const interfaces = node_os.default.networkInterfaces();
		const addresses = [];
		for (const name in interfaces) {
			const iface = interfaces[name];
			if (!iface) continue;
			for (const entry of iface) if (entry.family === "IPv4" && !entry.internal) addresses.push({
				interfaceName: name,
				address: entry.address
			});
		}
		return addresses;
	}
	/**
	* Pick the best address for phone-to-PC LAN connections.
	* Prioritize private LAN ranges and avoid link-local addresses when possible.
	*/
	getPrimaryLocalAddress() {
		const candidates = this.getAddressCandidates();
		if (candidates.length === 0) return "127.0.0.1";
		const scoreCandidate = (candidate) => {
			const iface = candidate.interfaceName.toLowerCase();
			const ip = candidate.address;
			let score = 0;
			if (iface.includes("wi-fi") || iface.includes("wifi") || iface.includes("wlan")) score += 80;
			if (iface.includes("ethernet") || iface.includes("en")) score += 40;
			if (iface.includes("local area connection") || iface.includes("openvpn") || iface.includes("tailscale") || iface.includes("hyper-v") || iface.includes("vethernet") || iface.includes("virtual") || iface.includes("vmware") || iface.includes("docker") || iface.includes("loopback")) score -= 70;
			if (/^192\.168\./.test(ip)) score += 30;
			if (/^10\./.test(ip)) score += 20;
			if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) score += 15;
			if (ip.startsWith("169.254.")) score -= 100;
			return score;
		};
		return [...candidates].sort((a, b) => scoreCandidate(b) - scoreCandidate(a))[0].address;
	}
};
//#endregion
//#region electron/server/connection-manager.ts
var ConnectionManager = class extends node_events.EventEmitter {
	constructor() {
		super();
		this.devices = /* @__PURE__ */ new Map();
	}
	/**
	* Register a new device connection from a WebSocket handshake.
	*/
	addDevice(info) {
		const id = (0, uuid.v4)();
		const device = {
			id,
			name: info.name,
			model: info.model,
			platform: info.platform,
			ip: info.ip,
			connectionType: info.connectionType,
			status: "connected",
			connectedAt: /* @__PURE__ */ new Date(),
			streamSettings: {
				resolution: "1080p",
				fps: 30,
				bitrate: 4e3,
				codec: "H.264"
			},
			battery: 100,
			temperature: 25,
			ws: info.ws
		};
		this.devices.set(id, device);
		this.emit("device-connected", this.sanitizeDevice(device));
		console.log(`[ConnectionManager] Device connected: ${device.name} (${device.id})`);
		return device;
	}
	/**
	* Remove a device from the active connections.
	*/
	removeDevice(deviceId) {
		const device = this.devices.get(deviceId);
		if (device) {
			device.status = "disconnected";
			if (device.ws && device.ws.readyState === 1) device.ws.close();
			this.devices.delete(deviceId);
			this.emit("device-disconnected", deviceId);
			console.log(`[ConnectionManager] Device disconnected: ${device.name} (${deviceId})`);
		}
	}
	/**
	* Update device metadata (battery, temp, stream settings, etc.)
	*/
	updateDevice(deviceId, updates) {
		const device = this.devices.get(deviceId);
		if (device) {
			Object.assign(device, updates);
			this.emit("device-updated", this.sanitizeDevice(device));
		}
	}
	/**
	* Send a control command to a specific device via WebSocket.
	*/
	sendCommand(deviceId, command, payload) {
		const device = this.devices.get(deviceId);
		if (device?.ws && device.ws.readyState === 1) {
			device.ws.send(JSON.stringify({
				type: "command",
				command,
				payload
			}));
			console.log(`[ConnectionManager] Sent command '${command}' to ${device.name}`);
			return true;
		}
		return false;
	}
	/**
	* Disconnect a specific device.
	*/
	disconnectDevice(deviceId) {
		this.removeDevice(deviceId);
	}
	/**
	* Get list of all connected devices (sanitized for IPC).
	*/
	getDevices() {
		return Array.from(this.devices.values()).map((d) => this.sanitizeDevice(d));
	}
	/**
	* Find a device by ID.
	*/
	getDevice(deviceId) {
		return this.devices.get(deviceId);
	}
	/**
	* Strip non-serializable fields (ws) before sending over IPC.
	*/
	sanitizeDevice(device) {
		const { ws, ...rest } = device;
		return rest;
	}
};
//#endregion
//#region electron/server/discovery-service.ts
var DiscoveryService = class extends node_events.EventEmitter {
	constructor() {
		super();
		this.serviceName = "_TetherCam._tcp.local";
		this.discoveredDevices = /* @__PURE__ */ new Map();
		this.mdns = (0, multicast_dns.default)();
	}
	start() {
		console.log("[DiscoveryService] Starting mDNS discovery and advertisement");
		this.advertise();
		this.mdns.on("response", (response) => {
			this.handleResponse(response);
		});
		setInterval(() => {
			this.query();
		}, 1e4);
		this.query();
	}
	advertise() {
		const hostname = node_os.default.hostname();
		this.mdns.on("query", (query) => {
			if (query.questions.some((q) => q.name === this.serviceName)) {
				const primaryAddress = this.getPrimaryLocalAddress();
				this.mdns.respond({ answers: [
					{
						name: this.serviceName,
						type: "PTR",
						data: `${hostname}.${this.serviceName}`
					},
					{
						name: `${hostname}.${this.serviceName}`,
						type: "SRV",
						data: {
							port: 4747,
							target: `${hostname}.local`
						}
					},
					{
						name: `${hostname}.local`,
						type: "A",
						data: primaryAddress
					}
				] });
			}
		});
	}
	query() {
		this.mdns.query({ questions: [{
			name: this.serviceName,
			type: "PTR"
		}] });
	}
	handleResponse(response) {
		const ptr = response.answers.find((a) => a.type === "PTR" && a.name === this.serviceName);
		if (!ptr) return;
		const srv = response.answers.find((a) => a.type === "SRV" && a.name === ptr.data);
		const aRecord = response.answers.find((a) => a.type === "A" && a.name === (srv ? srv.data.target : ""));
		if (srv && aRecord) {
			const device = {
				name: ptr.data.split(".")[0],
				ip: aRecord.data,
				port: srv.data.port,
				lastSeen: Date.now()
			};
			const id = `${device.ip}:${device.port}`;
			if (!this.discoveredDevices.has(id)) {
				this.discoveredDevices.set(id, device);
				this.emit("device-discovered", device);
			} else this.discoveredDevices.set(id, device);
		}
	}
	getLocalAddresses() {
		return this.getAddressCandidates().map((entry) => entry.address);
	}
	getAddressCandidates() {
		const interfaces = node_os.default.networkInterfaces();
		const addresses = [];
		for (const name in interfaces) {
			const iface = interfaces[name];
			if (!iface) continue;
			for (const entry of iface) if (entry.family === "IPv4" && !entry.internal) addresses.push({
				interfaceName: name,
				address: entry.address
			});
		}
		return addresses;
	}
	getPrimaryLocalAddress() {
		const candidates = this.getAddressCandidates();
		if (candidates.length === 0) return "127.0.0.1";
		const scoreCandidate = (candidate) => {
			const iface = candidate.interfaceName.toLowerCase();
			const ip = candidate.address;
			let score = 0;
			if (iface.includes("wi-fi") || iface.includes("wifi") || iface.includes("wlan")) score += 80;
			if (iface.includes("ethernet") || iface.includes("en")) score += 40;
			if (iface.includes("local area connection") || iface.includes("openvpn") || iface.includes("tailscale") || iface.includes("hyper-v") || iface.includes("vethernet") || iface.includes("virtual") || iface.includes("vmware") || iface.includes("docker") || iface.includes("loopback")) score -= 70;
			if (/^192\.168\./.test(ip)) score += 30;
			if (/^10\./.test(ip)) score += 20;
			if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) score += 15;
			if (ip.startsWith("169.254.")) score -= 100;
			return score;
		};
		return [...candidates].sort((a, b) => scoreCandidate(b) - scoreCandidate(a))[0].address;
	}
	getDiscoveredDevices() {
		const now = Date.now();
		for (const [id, device] of this.discoveredDevices.entries()) if (now - device.lastSeen > 3e4) this.discoveredDevices.delete(id);
		return Array.from(this.discoveredDevices.values());
	}
	stop() {
		this.mdns.destroy();
	}
};
//#endregion
//#region electron/server/media-pipeline.ts
if (ffmpeg_static.default) fluent_ffmpeg.default.setFfmpegPath(ffmpeg_static.default);
var MediaPipeline = class extends node_events.EventEmitter {
	constructor() {
		super();
		this.pc = null;
		this.ffmpegProcess = null;
	}
	async createPeerConnection(offer) {
		this.pc = new werift.RTCPeerConnection({ codecs: { video: [{
			mimeType: "video/H264",
			clockRate: 9e4,
			payloadType: 102,
			rtcpFeedback: [
				{ type: "nack" },
				{
					type: "nack",
					parameter: "pli"
				},
				{ type: "goog-remb" }
			]
		}] } });
		this.pc.onTrack.subscribe((track) => {
			if (track.kind === "video") this.startFfmpegPipeline(track);
		});
		await this.pc.setRemoteDescription({
			type: "offer",
			sdp: offer
		});
		const answer = await this.pc.createAnswer();
		await this.pc.setLocalDescription(answer);
		return answer.sdp;
	}
	startFfmpegPipeline(track) {
		console.log("[MediaPipeline] Starting FFmpeg pipeline to Virtual Camera and TCP broadcast");
		this.ffmpegProcess = (0, fluent_ffmpeg.default)().input(track).inputFormat("rtp").outputFormat("dshow").videoCodec("rawvideo").pixelFormat("yuv420p").output("video=OBS Virtual Camera").on("start", (cmd) => console.log("[FFmpeg VirtualCam] Started:", cmd)).on("error", (err) => console.error("[FFmpeg VirtualCam] Error:", err.message));
		this.ffmpegProcess.output("tcp://127.0.0.1:8554?listen").outputFormat("mpegts").videoCodec("libx264").outputOptions(["-preset ultrafast", "-tune zerolatency"]).on("start", () => console.log("[FFmpeg Broadcast] Listening on tcp://127.0.0.1:8554")).run();
	}
	stop() {
		this.ffmpegProcess?.kill();
		this.pc?.close();
	}
};
//#endregion
//#region electron/server/usb-service.ts
var execAsync = (0, node_util.promisify)(node_child_process.exec);
var UsbService = class extends node_events.EventEmitter {
	constructor() {
		super();
	}
	async getConnectedDevices() {
		try {
			const { stdout } = await execAsync("adb devices -l");
			const lines = stdout.trim().split("\n");
			const devices = [];
			for (let i = 1; i < lines.length; i++) {
				const line = lines[i].trim();
				if (!line) continue;
				const parts = line.split(/\s+/);
				const id = parts[0];
				const status = parts[1];
				const modelMatch = line.match(/model:(\S+)/);
				const model = modelMatch ? modelMatch[1] : "Unknown";
				devices.push({
					id,
					model,
					status
				});
			}
			return devices;
		} catch (err) {
			console.error("[UsbService] Error listing devices:", err);
			return [];
		}
	}
	async enableForwarding(deviceId, localPort, remotePort) {
		try {
			await execAsync(`adb -s ${deviceId} forward tcp:${localPort} tcp:${remotePort}`);
			console.log(`[UsbService] Port forwarding enabled: ${localPort} -> ${remotePort} for device ${deviceId}`);
			return true;
		} catch (err) {
			console.error("[UsbService] Error setting up port forwarding:", err);
			return false;
		}
	}
	async disableForwarding(localPort) {
		try {
			await execAsync(`adb forward --remove tcp:${localPort}`);
		} catch (err) {
			console.error("[UsbService] Error removing port forwarding:", err);
		}
	}
};
//#endregion
//#region electron/main.ts
var _dirname = "";
try {
	_dirname = __dirname;
} catch (e) {
	_dirname = node_path.default.dirname((0, node_url.fileURLToPath)({}.url));
}
var mainWindow = null;
var tray = null;
var signalingServer = null;
var connectionManager = null;
var discoveryService = null;
var mediaPipeline = null;
var usbService = null;
var SIGNALING_PORT = 4747;
function createWindow() {
	mainWindow = new electron.BrowserWindow({
		width: 1280,
		height: 820,
		minWidth: 960,
		minHeight: 600,
		title: "TetherCam",
		backgroundColor: "#0a0a0f",
		titleBarStyle: "hiddenInset",
		frame: process.platform === "darwin" ? false : true,
		webPreferences: {
			preload: node_path.default.join(_dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false
		}
	});
	if (process.env.VITE_DEV_SERVER_URL) {
		mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
		mainWindow.webContents.openDevTools({ mode: "detach" });
	} else mainWindow.loadFile(node_path.default.join(_dirname, "../dist/index.html"));
	mainWindow.on("close", (event) => {
		if (tray) {
			event.preventDefault();
			mainWindow?.hide();
		}
	});
	mainWindow.on("closed", () => {
		mainWindow = null;
	});
}
function createTray() {
	tray = new electron.Tray(electron.nativeImage.createEmpty());
	tray.setToolTip("TetherCam");
	const contextMenu = electron.Menu.buildFromTemplate([
		{
			label: "Show TetherCam",
			click: () => mainWindow?.show()
		},
		{ type: "separator" },
		{
			label: "Quit",
			click: () => {
				tray?.destroy();
				tray = null;
				electron.app.quit();
			}
		}
	]);
	tray.setContextMenu(contextMenu);
	tray.on("double-click", () => mainWindow?.show());
}
async function startServices() {
	connectionManager = new ConnectionManager();
	discoveryService = new DiscoveryService();
	mediaPipeline = new MediaPipeline();
	usbService = new UsbService();
	signalingServer = new SignalingServer(SIGNALING_PORT, connectionManager);
	await signalingServer.start();
	discoveryService.start();
	console.log(`[TetherCam] Signaling and Discovery services running`);
	connectionManager.on("device-connected", (device) => {
		mainWindow?.webContents.send("device-connected", device);
	});
	discoveryService.on("device-discovered", (device) => {
		mainWindow?.webContents.send("device-discovered", device);
	});
	signalingServer.on("sdp-offer", (data) => {
		mainWindow?.webContents.send("sdp-offer", data);
	});
	signalingServer.on("ice-candidate", (data) => {
		mainWindow?.webContents.send("ice-candidate", data);
	});
	connectionManager.on("device-disconnected", (deviceId) => {
		mainWindow?.webContents.send("device-disconnected", deviceId);
	});
	connectionManager.on("device-updated", (device) => {
		mainWindow?.webContents.send("device-updated", device);
	});
	connectionManager.on("stream-stats", (stats) => {
		mainWindow?.webContents.send("stream-stats", stats);
	});
}
function setupIpcHandlers() {
	electron.ipcMain.handle("get-devices", () => {
		return connectionManager?.getDevices() ?? [];
	});
	electron.ipcMain.handle("get-server-info", () => {
		return {
			port: SIGNALING_PORT,
			addresses: signalingServer?.getLocalAddresses() ?? []
		};
	});
	electron.ipcMain.handle("send-command", (_event, deviceId, command, payload) => {
		return connectionManager?.sendCommand(deviceId, command, payload);
	});
	electron.ipcMain.handle("disconnect-device", (_event, deviceId) => {
		return connectionManager?.disconnectDevice(deviceId);
	});
	electron.ipcMain.handle("start-virtual-camera", async (_event, deviceId, offer) => {
		if (mediaPipeline) return await mediaPipeline.createPeerConnection(offer);
		throw new Error("Media pipeline not initialized");
	});
	electron.ipcMain.handle("get-usb-devices", async () => {
		return await usbService?.getConnectedDevices() ?? [];
	});
	electron.ipcMain.handle("enable-usb-forwarding", async (_event, deviceId) => {
		return await usbService?.enableForwarding(deviceId, 4747, 4747) ?? false;
	});
	electron.ipcMain.handle("get-connection-url", () => {
		return `ws://${signalingServer?.getPrimaryLocalAddress() ?? "127.0.0.1"}:${SIGNALING_PORT}`;
	});
}
electron.app.whenReady().then(async () => {
	setupIpcHandlers();
	createWindow();
	createTray();
	await startServices();
});
electron.app.on("window-all-closed", () => {
	if (process.platform !== "darwin") electron.app.quit();
});
electron.app.on("activate", () => {
	if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
});
electron.app.on("before-quit", () => {
	signalingServer?.stop();
	tray?.destroy();
	tray = null;
});
//#endregion
