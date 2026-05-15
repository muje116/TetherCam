let electron = require("electron");
//#region electron/preload.ts
electron.contextBridge.exposeInMainWorld("electronAPI", {
	getDevices: () => electron.ipcRenderer.invoke("get-devices"),
	getServerInfo: () => electron.ipcRenderer.invoke("get-server-info"),
	getConnectionUrl: () => electron.ipcRenderer.invoke("get-connection-url"),
	disconnectDevice: (deviceId) => electron.ipcRenderer.invoke("disconnect-device", deviceId),
	getUsbDevices: () => electron.ipcRenderer.invoke("get-usb-devices"),
	enableUsbForwarding: (deviceId) => electron.ipcRenderer.invoke("enable-usb-forwarding", deviceId),
	sendCommand: (deviceId, command, payload) => electron.ipcRenderer.invoke("send-command", deviceId, command, payload),
	onDeviceConnected: (callback) => {
		const listener = (_event, device) => callback(device);
		electron.ipcRenderer.on("device-connected", listener);
		return () => electron.ipcRenderer.removeListener("device-connected", listener);
	},
	onDeviceDiscovered: (callback) => {
		const listener = (_event, device) => callback(device);
		electron.ipcRenderer.on("device-discovered", listener);
		return () => electron.ipcRenderer.removeListener("device-discovered", listener);
	},
	onDeviceDisconnected: (callback) => {
		const listener = (_event, deviceId) => callback(deviceId);
		electron.ipcRenderer.on("device-disconnected", listener);
		return () => electron.ipcRenderer.removeListener("device-disconnected", listener);
	},
	onDeviceUpdated: (callback) => {
		const listener = (_event, device) => callback(device);
		electron.ipcRenderer.on("device-updated", listener);
		return () => electron.ipcRenderer.removeListener("device-updated", listener);
	},
	onStreamStats: (callback) => {
		const listener = (_event, stats) => callback(stats);
		electron.ipcRenderer.on("stream-stats", listener);
		return () => electron.ipcRenderer.removeListener("stream-stats", listener);
	},
	onSdpOffer: (callback) => {
		const listener = (_event, data) => callback(data);
		electron.ipcRenderer.on("sdp-offer", listener);
		return () => electron.ipcRenderer.removeListener("sdp-offer", listener);
	},
	onIceCandidate: (callback) => {
		const listener = (_event, data) => callback(data);
		electron.ipcRenderer.on("ice-candidate", listener);
		return () => electron.ipcRenderer.removeListener("ice-candidate", listener);
	}
});
//#endregion
