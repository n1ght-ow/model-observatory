const api = window.desktopStartup;
const status = document.getElementById("status");
const actions = document.getElementById("actions");
api.onFailure(() => {
	status.textContent = "本机服务未能启动。请重试，或查看诊断日志。";
	actions.hidden = false;
});
document.getElementById("retry").addEventListener("click", async () => {
	actions.hidden = true;
	status.textContent = "正在重新打开本机账本…";
	await api.retry();
});
document.getElementById("logs").addEventListener("click", () => api.openLogs());
