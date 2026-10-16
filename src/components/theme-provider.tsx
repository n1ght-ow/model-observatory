"use client";

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
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

function applyTheme(theme: Theme) {
	const root = document.documentElement;
	root.classList.toggle("dark", theme === "dark");
	root.style.colorScheme = theme;
}

function getStoredTheme(): Theme {
	if (typeof window === "undefined") {
		return "light";
	}
	return window.localStorage.getItem(THEME_STORAGE_KEY) === "dark"
		? "dark"
		: "light";
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
	return "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
	const theme = useSyncExternalStore(
		subscribeTheme,
		getThemeSnapshot,
		getServerThemeSnapshot,
	);

	useEffect(() => {
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

/** Injected before hydration so the stored theme applies without a flash. */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='dark'){document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark';}}catch(e){}})();`;
