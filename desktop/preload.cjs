const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopStartup", Object.freeze({
	retry: () => ipcRenderer.invoke("desktop:retry"),
	openLogs: () => ipcRenderer.invoke("desktop:logs"),
	onFailure: (callback) => ipcRenderer.on("desktop:failure", () => callback()),
}));

contextBridge.exposeInMainWorld("desktopWindow", Object.freeze({
	isVisible: () => ipcRenderer.invoke("desktop:visibility"),
	onVisibilityChange: (callback) => {
		const listener = (_event, visible) => callback(visible === true);
		ipcRenderer.on("desktop:visibility", listener);
		return () => ipcRenderer.removeListener("desktop:visibility", listener);
	},
}));
