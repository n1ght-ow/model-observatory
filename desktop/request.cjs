const http = require("node:http");

// These two loopback endpoints return small JSON documents. Keep the host on
// Node's existing HTTP stack instead of retaining a second client implementation.
function localJson(url, { signal, body } = {}) {
	return new Promise((resolve, reject) => {
		const request = http.request(url, {
			signal, method: body === undefined ? "GET" : "POST",
			headers: body === undefined ? {} : { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), Origin: new URL(url).origin },
		}, (response) => {
			const chunks = []; let size = 0;
			response.on("error", reject);
			response.on("data", (chunk) => {
				size += chunk.length;
				if (size > 65536) { response.destroy(new Error("Local response exceeded limit")); return; }
				chunks.push(chunk);
			});
			response.on("end", () => {
				try {
					if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`Local service HTTP ${response.statusCode}`);
					resolve(JSON.parse(Buffer.concat(chunks, size).toString("utf8")));
				} catch (error) { reject(error); }
			});
		});
		request.on("error", reject);
		request.end(body);
	});
}

module.exports = { localJson };
