export function isLocalMutation(request: Request) {
	const origin = request.headers.get("origin");
	if (!origin) return true;
	const url = new URL(request.url);
	// Accept only the actual loopback host and exact origin, including its port.
	const host = request.headers.get("host") ?? url.host;
	const target = new URL(`${url.protocol}//${host}`);
	return ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) && origin === target.origin;
}
