module.exports = {
	appId: "local.model-observatory.desktop",
	productName: "Model Observatory",
	executableName: "ModelObservatory",
	directories: { app: "desktop", output: "dist/desktop", buildResources: "public" },
	files: ["package.json", "*.cjs", "startup.html", "startup.css", "icon.ico", "!node_modules/**/*"],
	extraResources: [
		{ from: "dist/desktop-server", to: "server", filter: ["**/*", "!**/.env*", "!**/logs/**"] },
	],
	asar: true,
	npmRebuild: false,
	electronDist: "node_modules/electron/dist",
	win: { target: [{ target: "nsis", arch: ["x64"] }, { target: "portable", arch: ["x64"] }], icon: "public/app.ico", signExecutable: false },
	nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: "Model Observatory", artifactName: "Model-Observatory-${version}-Setup.${ext}", deleteAppDataOnUninstall: false },
	portable: { artifactName: "Model-Observatory-${version}-Portable.${ext}" },
};
