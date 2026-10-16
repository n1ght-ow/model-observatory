export {};

declare global {
	interface Window {
		desktopWindow?: {
			isVisible(): Promise<boolean>;
			onVisibilityChange(callback: (visible: boolean) => void): () => void;
		};
	}
}
