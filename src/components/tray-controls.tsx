"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { PinIcon, PinOffIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
	announceReady,
	closePanel,
	isTray,
	onTrayMessage,
	setPinned,
} from "@/lib/tray/bridge";

/** The bridge either exists for the life of the document or never does. */
const subscribeToNothing = () => () => {};

/** False on the server, so the server and the first client render agree. */
const notInTray = () => false;

/**
 * Controls that only mean anything inside the tray flyout: the flyout has no
 * window chrome, and it hides as soon as it loses focus unless it is pinned.
 * Renders nothing in a browser.
 */
export function TrayControls() {
	const inTray = useSyncExternalStore(subscribeToNothing, isTray, notInTray);
	const [pinned, setPinnedState] = useState(false);

	useEffect(() => {
		if (!inTray) {
			return;
		}
		const unsubscribe = onTrayMessage((message) => {
			if (message.type === "state") {
				setPinnedState(message.pinned);
			}
		});
		// Ask the tray what it thinks, now that the page can receive the answer.
		announceReady();
		return unsubscribe;
	}, [inTray]);

	if (!inTray) {
		return null;
	}

	const label = pinned ? "取消固定面板" : "固定面板";

	return (
		<>
			<Button
				aria-label={label}
				aria-pressed={pinned}
				onClick={() => {
					const next = !pinned;
					setPinnedState(next);
					setPinned(next);
				}}
				size="icon-sm"
				title={label}
				variant={pinned ? "secondary" : "ghost"}
			>
				{pinned ? <PinIcon /> : <PinOffIcon />}
			</Button>
			<Button
				aria-label="关闭面板"
				onClick={() => closePanel()}
				size="icon-sm"
				title="关闭面板（Esc）"
				variant="ghost"
			>
				<XIcon />
			</Button>
			<Separator
				className="h-4 data-[orientation=vertical]:self-center"
				orientation="vertical"
			/>
		</>
	);
}
