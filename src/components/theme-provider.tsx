"use client";

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useSyncExternalStore,
} from "react";

type Theme = "light" | "dark";

type ThemeContextValue = {
	theme: Theme;
	toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const THEME_STORAGE_KEY = "router-monitor-theme";
const themeListeners = new Set<() => void>();
// Layout effects do not run during static export. Apply the stored theme on the
// client before paint, after hydration has matched the server's dark shell.
const useThemeEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function applyTheme(theme: Theme) {
	const root = document.documentElement;
	root.classList.toggle("dark", theme === "dark");
	root.style.colorScheme = theme;
}

function getStoredTheme(): Theme {
	if (typeof window === "undefined") {
		return "dark";
	}
	return window.localStorage.getItem(THEME_STORAGE_KEY) === "light"
		? "light"
		: "dark";
}

function subscribeTheme(listener: () => void) {
	themeListeners.add(listener);

	const handleStorage = (event: StorageEvent) => {
		if (event.key === THEME_STORAGE_KEY) {
			applyTheme(getStoredTheme());
			listener();
		}
	};

	window.addEventListener("storage", handleStorage);
	return () => {
		themeListeners.delete(listener);
		window.removeEventListener("storage", handleStorage);
	};
}

function getThemeSnapshot(): Theme {
	return getStoredTheme();
}

function getServerThemeSnapshot(): Theme {
	return "dark";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
	const theme = useSyncExternalStore(
		subscribeTheme,
		getThemeSnapshot,
		getServerThemeSnapshot,
	);

	useThemeEffect(() => {
		applyTheme(theme);
	}, [theme]);

	const toggleTheme = useCallback(() => {
		const next: Theme = getStoredTheme() === "dark" ? "light" : "dark";
		applyTheme(next);
		window.localStorage.setItem(THEME_STORAGE_KEY, next);
		themeListeners.forEach((listener) => listener());
	}, []);

	return (
		<ThemeContext.Provider value={{ theme, toggleTheme }}>
			{children}
		</ThemeContext.Provider>
	);
}

export function useTheme() {
	const context = useContext(ThemeContext);
	if (!context) {
		throw new Error("useTheme must be used within a ThemeProvider");
	}
	return context;
}
