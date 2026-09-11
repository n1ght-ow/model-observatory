"use client";

import { Button } from "@/components/ui/button";
import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "@/components/theme-provider";

export function ThemeToggle() {
	const { theme, toggleTheme } = useTheme();
	const isDark = theme === "dark";

	return (
		<Button
			aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
			size="icon-sm"
			variant="outline"
			onClick={toggleTheme}
		>
			{isDark ? <SunIcon /> : <MoonIcon />}
		</Button>
	);
}
