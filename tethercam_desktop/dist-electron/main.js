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
//#region electron/server/network-utils.ts
function getAddressCandidates() {
	const interfaces = node_os.default.networkInterfaces();
	const addresses = [];
	for (const name in interfaces) {
		const iface = interfaces[name];
		if (!iface) continue;
		for (const entry of iface) if (entry.family === "IPv4") addresses.push({
			interfaceName: name,
			address: entry.address
		});
	}
	return addresses;
}
function getPrimaryLocalAddress() {
	const candidates = getAddressCandidates();
	if (candidates.length === 0) return "127.0.0.1";
	const scoreCandidate = (candidate) => {
		const iface = candidate.interfaceName.toLowerCase();
		const ip = candidate.address;
		let score = 0;
		if (iface.includes("wi-fi") || iface.includes("wifi") || iface.includes("wlan") || iface.includes("wireless")) score += 80;
		if (/^en\d/.test(iface) || iface.includes("ethernet")) score += 40;
		if (iface.includes("openvpn") || iface.includes("tailscale") || iface.includes("hyper-v") || iface.includes("vethernet") || iface.includes("virtual") || iface.includes("vmware") || iface.includes("docker") || iface.includes("loopback") || iface.includes("bluetooth")) score -= 70;
		if (ip === "127.0.0.1" || ip === "::1") score -= 100;
		if (/^192\.168\./.test(ip)) score += 30;
		if (/^10\./.test(ip)) score += 20;
		if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) score += 15;
		if (ip.startsWith("169.254.")) score -= 100;
		return score;
	};
	return [...candidates].sort((a, b) => scoreCandidate(b) - scoreCandidate(a))[0].address;
}
function getConnectionUrl() {
	return `ws://${getPrimaryLocalAddress()}:4747`;
}
function getAllLocalAddresses() {
	return getAddressCandidates().map((c) => c.address).filter((a) => a !== "127.0.0.1" && a !== "::1");
}
//#endregion
//#region electron/server/signaling-server.ts
var _dirname$1 = "";
try {
	_dirname$1 = __dirname;
} catch (e) {
	_dirname$1 = node_path.default.dirname((0, node_url.fileURLToPath)({}.url));
}
var SignalingServer = class extends node_events.EventEmitter {
	constructor(port, connectionManager) {
		super();
		this.pendingOffers = /* @__PURE__ */ new Map();
		this.port = port;
		this.connectionManager = connectionManager;
		this.app = (0, express.default)();
		this.app.use((0, cors.default)());
		this.app.use(express.default.json());
		this.server = node_http.default.createServer(this.app);
		this.wss = new ws.WebSocketServer({ server: this.server });
		this.setupHttpRoutes();
		this.setupStaticRoutes();
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
	* Serve static built files from the /dist folder.
	*/
	setupStaticRoutes() {
		const distPath = node_path.default.join(_dirname$1, "../../dist");
		this.app.use(express.default.static(distPath));
		this.app.use((req, res, next) => {
			if (req.path.startsWith("/api")) return next();
			res.sendFile(node_path.default.join(distPath, "index.html"));
		});
	}
	/**
	* WebSocket handler for real-time signaling and control.
	*/
	setupWebSocket() {
		this.wss.on("connection", (ws$1, req) => {
			const clientIp = req.socket.remoteAddress?.replace("::ffff:", "") ?? "unknown";
			console.log(`[SignalingServer] WebSocket connection from ${clientIp}`);
			this.emit("log", `[SignalingServer] WebSocket connection from ${clientIp}`);
			let deviceId = null;
			ws$1.on("message", (data) => {
				try {
					const message = JSON.parse(data.toString());
					this.handleMessage(ws$1, message, clientIp, deviceId, (id) => {
						deviceId = id;
					});
				} catch (err) {
					console.error("[SignalingServer] Invalid message:", err);
					this.emit("log", `[SignalingServer] Invalid message from ${clientIp}: ${String(err)}`);
					ws$1.send(JSON.stringify({
						type: "error",
						message: "Invalid JSON"
					}));
				}
			});
			ws$1.on("close", () => {
				if (deviceId) this.connectionManager.removeDevice(deviceId);
				console.log(`[SignalingServer] WebSocket disconnected: ${clientIp}`);
				this.emit("log", `[SignalingServer] WebSocket disconnected: ${clientIp}`);
			});
			ws$1.on("error", (err) => {
				console.error(`[SignalingServer] WebSocket error from ${clientIp}:`, err.message);
				this.emit("log", `[SignalingServer] WebSocket error from ${clientIp}: ${err.message}`);
			});
			ws$1.send(JSON.stringify({
				type: "server-info",
				hostname: node_os.default.hostname(),
				platform: process.platform,
				version: "1.0.0"
			}));
			const pingInterval = setInterval(() => {
				if (ws$1.readyState === ws$1.OPEN) ws$1.ping();
			}, 15e3);
			ws$1.on("pong", () => {});
			ws$1.on("close", () => clearInterval(pingInterval));
			ws$1.on("error", () => clearInterval(pingInterval));
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
				setTimeout(() => {
					this.connectionManager.sendCommand(device.id, "request-stream", {});
					this.emit("log", `[SignalingServer] Sent request-stream to '${device.name}'`);
				}, 500);
				ws$2.send(JSON.stringify({
					type: "registered",
					deviceId: device.id,
					message: "Device registered successfully"
				}));
				this.emit("log", `[SignalingServer] Registered device '${device.name}' from ${clientIp}`);
				break;
			}
			case "sdp-offer": {
				console.log(`[SignalingServer] Received SDP offer from ${clientIp}`);
				const resolvedDeviceId = message.deviceId ?? activeDeviceId ?? void 0;
				const offerSdp = message.sdp;
				if (resolvedDeviceId && offerSdp) this.pendingOffers.set(resolvedDeviceId, {
					sdp: offerSdp,
					clientIp
				});
				this.emit("sdp-offer", {
					deviceId: resolvedDeviceId,
					sdp: offerSdp,
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
	getLocalAddresses() {
		return getAllLocalAddresses();
	}
	getPrimaryLocalAddress() {
		return getPrimaryLocalAddress();
	}
	/** Returns and clears a cached SDP offer for a device (so late-mounting renderers can replay it) */
	getPendingOffer(deviceId) {
		const offer = this.pendingOffers.get(deviceId) ?? null;
		if (offer) this.pendingOffers.delete(deviceId);
		return offer;
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
var SIGNALING_PORT$1 = 4747;
var QUERY_INTERVAL_MS = 1e4;
/** Unsolicited announcements help Windows clients/phones that miss passive query replies. */
var ANNOUNCE_INTERVAL_MS = 3e3;
var DiscoveryService = class extends node_events.EventEmitter {
	constructor() {
		super();
		this.serviceName = "_TetherCam._tcp.local";
		this.discoveredDevices = /* @__PURE__ */ new Map();
		this.queryInterval = null;
		this.announceInterval = null;
		this.hostname = node_os.default.hostname();
		this.mdns = (0, multicast_dns.default)();
	}
	start() {
		console.log("[DiscoveryService] Starting mDNS discovery and advertisement");
		this.advertise();
		this.mdns.on("response", (response) => {
			this.handleResponse(response);
		});
		this.queryInterval = setInterval(() => this.query(), QUERY_INTERVAL_MS);
		this.announceInterval = setInterval(() => this.announce(), ANNOUNCE_INTERVAL_MS);
		this.query();
		this.announce();
	}
	/**
	* Respond to browse queries and periodically broadcast our service (Windows-friendly).
	*/
	advertise() {
		this.mdns.on("query", (query) => {
			if ((query.questions ?? []).some((q) => q.name === this.serviceName || q.name === "_services._dns-sd._udp.local")) this.announce();
		});
	}
	buildAdvertisementRecords(primaryAddress) {
		const instanceName = `${this.hostname}.${this.serviceName}`;
		const hostTarget = `${this.hostname}.local`;
		return [
			{
				name: this.serviceName,
				type: "PTR",
				ttl: 120,
				data: instanceName
			},
			{
				name: instanceName,
				type: "SRV",
				ttl: 120,
				data: {
					port: SIGNALING_PORT$1,
					target: hostTarget,
					priority: 0,
					weight: 0
				}
			},
			{
				name: hostTarget,
				type: "A",
				ttl: 120,
				data: primaryAddress
			},
			{
				name: hostTarget,
				type: "TXT",
				ttl: 120,
				data: Buffer.from(`app=TetherCam&port=${SIGNALING_PORT$1}`)
			}
		];
	}
	/**
	* Proactive unsolicited mDNS announcement (not only on query).
	*/
	announce() {
		const primaryAddress = this.getPrimaryLocalAddress();
		const answers = this.buildAdvertisementRecords(primaryAddress);
		this.mdns.respond({ answers }, (err) => {
			if (err) console.warn("[DiscoveryService] Announce failed:", err.message);
		});
	}
	query() {
		this.mdns.query({ questions: [{
			name: this.serviceName,
			type: "PTR"
		}] });
	}
	handleResponse(response) {
		const answers = [...response.answers ?? [], ...response.additionals ?? []];
		const ptr = answers.find((a) => a.type === "PTR" && a.name === this.serviceName);
		if (!ptr || typeof ptr.data !== "string") return;
		const srv = answers.find((a) => a.type === "SRV" && a.name === ptr.data);
		const srvTarget = srv && typeof srv.data === "object" && srv.data !== null && "target" in srv.data ? String(srv.data.target) : "";
		const aRecord = answers.find((a) => a.type === "A" && a.name === srvTarget);
		if (srv && aRecord && typeof aRecord.data === "string") {
			const port = typeof srv.data === "object" && srv.data !== null && "port" in srv.data ? Number(srv.data.port) : SIGNALING_PORT$1;
			const device = {
				name: ptr.data.split(".")[0],
				ip: aRecord.data,
				port,
				lastSeen: Date.now()
			};
			const id = `${device.ip}:${device.port}`;
			if (!this.discoveredDevices.has(id)) {
				this.discoveredDevices.set(id, device);
				this.emit("device-discovered", device);
			} else this.discoveredDevices.set(id, device);
		}
	}
	getPrimaryLocalAddress() {
		return getPrimaryLocalAddress();
	}
	getDiscoveredDevices() {
		const now = Date.now();
		for (const [id, device] of this.discoveredDevices.entries()) if (now - device.lastSeen > 3e4) this.discoveredDevices.delete(id);
		return Array.from(this.discoveredDevices.values());
	}
	stop() {
		if (this.queryInterval) {
			clearInterval(this.queryInterval);
			this.queryInterval = null;
		}
		if (this.announceInterval) {
			clearInterval(this.announceInterval);
			this.announceInterval = null;
		}
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
		this.rtspServer = null;
	}
	async createPeerConnection(offer) {
		this.pc = new werift.RTCPeerConnection({ codecs: {
			video: [{
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
			}],
			audio: [{
				mimeType: "audio/OPUS",
				clockRate: 48e3,
				payloadType: 111
			}]
		} });
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
	getPlatformOutputs() {
		switch (node_os.default.platform()) {
			case "win32": return ["video=OBS Virtual Camera", "audio=Virtual Cable"];
			case "darwin": return ["video=TetherCam", "audio=BlackHole"];
			case "linux": return ["video=/dev/video10", "audio=null_sink"];
			default: return ["video=/dev/video10", "audio=null_sink"];
		}
	}
	startFfmpegPipeline(track) {
		console.log("[MediaPipeline] Starting FFmpeg pipeline to Virtual Camera + RTSP");
		this.ffmpegProcess = (0, fluent_ffmpeg.default)().input(track).inputFormat("rtp");
		const platform = node_os.default.platform();
		if (platform === "win32") this.ffmpegProcess.outputFormat("dshow").videoCodec("rawvideo").pixelFormat("yuv420p").output("video=OBS Virtual Camera");
		else if (platform === "darwin") this.ffmpegProcess.outputFormat("avfoundation").videoCodec("rawvideo").pixelFormat("yuv420p").output("TetherCam");
		else this.ffmpegProcess.outputFormat("v4l2").videoCodec("rawvideo").pixelFormat("yuv420p").output("/dev/video10");
		this.ffmpegProcess.output(`tcp://127.0.0.1:8554?listen`).outputFormat("mpegts").videoCodec("libx264").audioCodec("aac").outputOptions([
			"-preset ultrafast",
			"-tune zerolatency",
			"-threads 2"
		]).on("start", (cmd) => console.log("[FFmpeg VirtualCam + Broadcast] Started:", cmd)).on("error", (err) => console.error("[FFmpeg] Error:", err.message));
		this.ffmpegProcess.run();
	}
	async createAudioPeerConnection(offer) {
		const audioPc = new werift.RTCPeerConnection({ codecs: { audio: [{
			mimeType: "audio/OPUS",
			clockRate: 48e3,
			payloadType: 111
		}] } });
		audioPc.onTrack.subscribe((track) => {
			if (track.kind === "audio") this.startAudioPipeline(track);
		});
		await audioPc.setRemoteDescription({
			type: "offer",
			sdp: offer
		});
		const answer = await audioPc.createAnswer();
		await audioPc.setLocalDescription(answer);
		return answer.sdp;
	}
	startAudioPipeline(track) {
		const platform = node_os.default.platform();
		const audioFfmpeg = (0, fluent_ffmpeg.default)().input(track).inputFormat("rtp");
		if (platform === "win32") audioFfmpeg.outputFormat("dshow").audioCodec("pcm_s16le").output("audio=Virtual Cable");
		else if (platform === "darwin") audioFfmpeg.outputFormat("avfoundation").audioCodec("pcm_s16le").output(":TetherCam Audio");
		else audioFfmpeg.outputFormat("pulse").audioCodec("pcm_s16le").output("TetherCam_Audio");
		audioFfmpeg.on("start", () => console.log("[FFmpeg Audio] Started virtual microphone")).on("error", (err) => console.error("[FFmpeg Audio] Error:", err.message)).run();
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
			console.log(`[UsbService] ADB Forward enabled: tcp:${localPort} -> tcp:${remotePort}`);
			try {
				await execAsync(`adb -s ${deviceId} reverse tcp:${localPort} tcp:${remotePort}`);
				console.log(`[UsbService] ADB Reverse enabled: tcp:${localPort} -> tcp:${remotePort}`);
			} catch (revErr) {
				console.warn(`[UsbService] Warning setting up ADB reverse (unsupported on very old Android versions):`, revErr);
			}
			return true;
		} catch (err) {
			console.error("[UsbService] Error setting up USB port forwarding:", err);
			return false;
		}
	}
	async disableForwarding(localPort, deviceId) {
		try {
			await execAsync(`adb ${deviceId ? `-s ${deviceId} ` : ""} forward --remove tcp:${localPort}`);
			console.log(`[UsbService] Removed ADB Forward for tcp:${localPort}`);
		} catch (err) {
			console.error("[UsbService] Error removing ADB Forward:", err);
		}
		try {
			await execAsync(`adb ${deviceId ? `-s ${deviceId} ` : ""} reverse --remove tcp:${localPort}`);
			console.log(`[UsbService] Removed ADB Reverse for tcp:${localPort}`);
		} catch (err) {
			console.error("[UsbService] Error removing ADB Reverse:", err);
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
var projectorWindow = null;
var tray = null;
var signalingServer = null;
var connectionManager = null;
var discoveryService = null;
var mediaPipeline = null;
var usbService = null;
var diagnosticLogs = [];
var SIGNALING_PORT = 4747;
function pushDiagnosticLog(message) {
	const line = `${(/* @__PURE__ */ new Date()).toISOString()} ${message}`;
	diagnosticLogs.push(line);
	if (diagnosticLogs.length > 200) diagnosticLogs.shift();
	mainWindow?.webContents.send("diagnostic-log", line);
}
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
	pushDiagnosticLog("[TetherCam] Signaling and Discovery services running");
	connectionManager.on("device-connected", (device) => {
		mainWindow?.webContents.send("device-connected", device);
		pushDiagnosticLog(`[Connection] Device connected: ${device.name} (${device.ip})`);
	});
	discoveryService.on("device-discovered", (device) => {
		mainWindow?.webContents.send("device-discovered", device);
		pushDiagnosticLog(`[Discovery] Found ${device.name} at ${device.ip}:${device.port}`);
	});
	signalingServer.on("sdp-offer", (data) => {
		mainWindow?.webContents.send("sdp-offer", data);
		pushDiagnosticLog(`[Signaling] SDP offer from ${data.clientIp ?? "unknown"}`);
	});
	signalingServer.on("ice-candidate", (data) => {
		mainWindow?.webContents.send("ice-candidate", data);
		pushDiagnosticLog(`[Signaling] ICE candidate from ${data.clientIp ?? "unknown"}`);
	});
	signalingServer.on("log", (line) => {
		pushDiagnosticLog(String(line));
	});
	connectionManager.on("device-disconnected", (deviceId) => {
		mainWindow?.webContents.send("device-disconnected", deviceId);
		pushDiagnosticLog(`[Connection] Device disconnected: ${deviceId}`);
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
		if (mediaPipeline) {
			const answer = await mediaPipeline.createPeerConnection(offer);
			pushDiagnosticLog(`[Virtual Camera] Started background WebRTC stream for ${deviceId}`);
			return answer;
		}
		throw new Error("Media pipeline not initialized");
	});
	electron.ipcMain.handle("capture-snapshot", async (_event, deviceId) => {
		pushDiagnosticLog(`[Snapshot] Capture requested for ${deviceId}`);
		mainWindow?.webContents.send("capture-snapshot-request", deviceId);
		return true;
	});
	electron.ipcMain.handle("save-snapshot", async (_event, dataUrl) => {
		const filename = `TetherCam_snapshot_${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}.png`;
		const { app } = await import("electron");
		const picturesPath = app.getPath("pictures");
		const filePath = node_path.default.join(picturesPath, filename);
		const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
		(await import("node:fs")).writeFileSync(filePath, base64Data, "base64");
		pushDiagnosticLog(`[Snapshot] Saved to ${filePath}`);
		return filePath;
	});
	electron.ipcMain.handle("stop-virtual-camera", async () => {
		if (mediaPipeline) {
			mediaPipeline.stop();
			pushDiagnosticLog("[Virtual Camera] Stopped stream and background pipeline");
			return true;
		}
		return false;
	});
	electron.ipcMain.handle("get-usb-devices", async () => {
		return await usbService?.getConnectedDevices() ?? [];
	});
	electron.ipcMain.handle("enable-usb-forwarding", async (_event, deviceId) => {
		const ok = await usbService?.enableForwarding(deviceId, 4747, 4747) ?? false;
		pushDiagnosticLog(`[USB] Forwarding for ${deviceId}: ${ok ? "ok" : "failed"}`);
		return ok;
	});
	electron.ipcMain.handle("get-connection-url", () => {
		return getConnectionUrl();
	});
	electron.ipcMain.handle("get-all-addresses", () => {
		return getAllLocalAddresses();
	});
	electron.ipcMain.handle("get-pending-offer", (_event, deviceId) => {
		return signalingServer?.getPendingOffer(deviceId) ?? null;
	});
	electron.ipcMain.handle("get-diagnostic-logs", () => {
		return diagnosticLogs;
	});
	electron.ipcMain.handle("open-projector", (_event, deviceId) => {
		if (projectorWindow) {
			projectorWindow.focus();
			return;
		}
		projectorWindow = new electron.BrowserWindow({
			width: 640,
			height: 360,
			minWidth: 320,
			minHeight: 180,
			frame: false,
			transparent: false,
			alwaysOnTop: true,
			backgroundColor: "#0a0a0f",
			webPreferences: {
				preload: node_path.default.join(_dirname, "preload.js"),
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: false
			}
		});
		if (process.env.VITE_DEV_SERVER_URL) projectorWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}?projector=true&deviceId=${deviceId}`);
		else {
			const fileUrl = new URL(`file://${node_path.default.join(_dirname, "../dist/index.html")}`);
			fileUrl.searchParams.set("projector", "true");
			fileUrl.searchParams.set("deviceId", deviceId);
			projectorWindow.loadURL(fileUrl.toString());
		}
		projectorWindow.on("closed", () => {
			projectorWindow = null;
		});
	});
	electron.ipcMain.handle("close-projector", () => {
		if (projectorWindow) {
			projectorWindow.close();
			projectorWindow = null;
		}
	});
	electron.ipcMain.handle("toggle-projector-always-on-top", () => {
		if (projectorWindow) {
			const state = !projectorWindow.isAlwaysOnTop();
			projectorWindow.setAlwaysOnTop(state, "screen-saver");
			return state;
		}
		return false;
	});
	electron.ipcMain.handle("resize-projector", (_event, width, height) => {
		if (projectorWindow) projectorWindow.setSize(width, height, true);
	});
	electron.ipcMain.handle("snap-projector", (_event, position) => {
		if (!projectorWindow) return;
		const { x, y, width, height } = electron.screen.getPrimaryDisplay().workArea;
		const winBounds = projectorWindow.getBounds();
		let newX = x;
		let newY = y;
		if (position === "top-left") {
			newX = x;
			newY = y;
		} else if (position === "top-right") {
			newX = x + width - winBounds.width;
			newY = y;
		} else if (position === "bottom-left") {
			newX = x;
			newY = y + height - winBounds.height;
		} else if (position === "bottom-right") {
			newX = x + width - winBounds.width;
			newY = y + height - winBounds.height;
		}
		projectorWindow.setBounds({
			x: newX,
			y: newY,
			width: winBounds.width,
			height: winBounds.height
		}, true);
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
