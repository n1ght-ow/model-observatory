/**
 * The page's half of the tray bridge (protocol v1).
 *
 * The tray injects `window.__rmBridge` before any document script runs, so its
 * presence *is* the answer to "am I inside the tray". Everything the page can ask
 * the tray to do goes through here, so there is one place to change when the
 * protocol grows rather than a magic string per feature.
 *
 * Counterpart: `tray/PanelForm.cs` (BridgeScript, OnWebMessage).
 */

export type TrayToPage = { v: 1; type: "state"; pinned: boolean };

type PageToTray =
	| { v: 1; type: "close" }
	| { v: 1; type: "openExternal"; url: string }
	| { v: 1; type: "pin"; pinned: boolean }
	| { v: 1; type: "status"; text: string }
	| { v: 1; type: "ready" };

type TrayBridge = {
	version: number;
	/** Escape hatch for a message shape this module does not model yet. */
	post: (message: PageToTray) => void;
	close: () => void;
	openExternal: (url: string) => void;
	setPinned: (pinned: boolean) => void;
	setStatus: (text: string) => void;
	ready: () => void;
	listen: (fn: (message: TrayToPage) => void) => void;
};

declare global {
	interface Window {
		__rmBridge?: TrayBridge;
	}
}

/** The bridge, or null when the page is in a normal browser tab. */
export function tray(): TrayBridge | null {
	if (typeof window === "undefined") {
		return null;
	}
	return window.__rmBridge ?? null;
}

/** True only inside the tray flyout. Safe to call during render on the server. */
export function isTray(): boolean {
	return tray() !== null;
}

/** Hides the flyout. Does nothing in a browser. */
export function closePanel(): void {
	tray()?.close();
}

/** Opens a URL in the default browser rather than inside the flyout. */
export function openExternal(url: string): void {
	const bridge = tray();
	if (bridge) {
		bridge.openExternal(url);
		return;
	}
	window.open(url, "_blank", "noreferrer");
}

/** Pins the flyout open (it otherwise hides as soon as it loses focus). */
export function setPinned(pinned: boolean): void {
	tray()?.setPinned(pinned);
}

/**
 * Puts a line in the notification-area tooltip. Only the tray owns that, so this is
 * the one way the page can put anything there; it also survives the panel being
 * hidden, which is when a tooltip is actually read.
 */
export function setStatus(text: string): void {
	tray()?.setStatus(text);
}

/** Subscribes to tray to page messages; returns an unsubscribe function. */
export function onTrayMessage(fn: (message: TrayToPage) => void): () => void {
	const bridge = tray();
	if (!bridge) {
		return () => {};
	}
	bridge.listen(fn);
	return () => {};
}

/** Tells the tray the app has hydrated, so it can answer with the current state. */
export function announceReady(): void {
	tray()?.ready();
}
