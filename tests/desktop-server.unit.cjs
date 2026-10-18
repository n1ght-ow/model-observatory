const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");

test("desktop loopback client rejects failed, oversized and interrupted responses and cancels active work", async () => {
	const { localJson } = require("../desktop/request.cjs");
	const sockets = new Set();
	const server = require("node:http").createServer((request, response) => {
		if (request.url === "/failure") { response.writeHead(503); response.end("unavailable"); }
		else if (request.url === "/large") response.end("x".repeat(65537));
		else if (request.url === "/invalid") response.end("{");
		else if (request.url === "/truncated") { response.writeHead(200, { "Content-Length": "100" }); response.flushHeaders(); response.write("{"); setImmediate(() => response.destroy()); }
		else if (request.url === "/wait") { response.writeHead(200); response.flushHeaders(); }
		else {
			let body = "";
			request.setEncoding("utf8"); request.on("data", (chunk) => { body += chunk; });
			request.on("end", () => response.end(JSON.stringify({ body, origin: request.headers.origin, bytes: request.headers["content-length"] })));
		}
	});
	server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const origin = `http://127.0.0.1:${server.address().port}`;
	try {
		const body = JSON.stringify({ action: "collect", label: "本机" });
		assert.deepEqual(await localJson(origin, { body }), { body, origin, bytes: String(Buffer.byteLength(body)) });
		for (const [route, reason] of [["failure", /503/], ["large", /limit/], ["invalid", /JSON/], ["truncated", /aborted|reset/i]]) await assert.rejects(localJson(`${origin}/${route}`), reason);
		await assert.rejects(localJson(origin + "/wait", { signal: AbortSignal.timeout(50) }), { name: "AbortError" });
		await assert.rejects(localJson(origin, { signal: AbortSignal.abort() }), { name: "AbortError" });
		assert.equal((await localJson(origin)).body, "", "Cancelled work must not prevent the next healthy request");
	} finally {
		for (const socket of sockets) socket.destroy();
		await new Promise((resolve) => server.close(resolve));
	}
});

test("lean desktop server preserves API, CSV and aliases while limiting bodies and protecting assets", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "observatory-http-"));
	const worker = `
		const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript');
		require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
		const {ObservationArchive}=require('./src/lib/observatory/archive.ts');
		const {createDesktopServer}=require('./src/server/http.ts');
		const root=process.env.OBSERVATORY_DATA_DIR,assets=path.join(root,'ui'),token='fixture-desktop-session';
		fs.mkdirSync(path.join(assets,'_next','static'),{recursive:true});
		for(const file of ['index.html','requests.html','tools.html'])fs.writeFileSync(path.join(assets,file),'<h1>fixture '+file+'</h1>');
		fs.writeFileSync(path.join(assets,'_next','static','app.js'),'console.log("fixture")');
		fs.writeFileSync(path.join(assets,'requests.txt'),'fixture flight');
		const rows=Array.from({length:257},(_,i)=>({id:'row-'+i,at:new Date(Date.now()-i*1000).toISOString(),model:'fixture-model',rawModel:'fixture-model',client:'fixture-client',upstream:'fixture',input:i===0?null:10,output:i===0?null:2,cache:null,status:'unknown',identity:'configured',duration:null,...(i===0?{scope:'turn'}:{}),evidence:[{id:'row-'+i,source:'fixture-source',kind:'session'}]}));
		const archive=new ObservationArchive(path.join(root,'history.sqlite'));archive.commit(rows,[]);archive.close();
		const server=createDesktopServer(assets,token);
		(async()=>{
			await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
			try{
				const {localJson}=require('./desktop/request.cjs');
				const globals=['fetch','Request','Response','Headers'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]);
				for(const [name] of globals)Object.defineProperty(globalThis,name,{configurable:true,get(){throw new Error('Unexpected Fetch runtime: '+name)}});
				try{
					assert.equal((await localJson(base+'/api/health')).ok,true);
					assert.equal((await localJson(base+'/api/observatory?range=all')).totals.requests,257);
					assert.equal((await localJson(base+'/api/observatory/collection')).paused,false);
					assert.equal((await localJson(base+'/api/observatory/aliases',{body:JSON.stringify({from:'absent',to:''})})).saved,true);
					await assert.rejects(localJson(base+'/api/observatory/events',{body:'{}'}),/400/);
				}finally{for(const [name,descriptor] of globals)Object.defineProperty(globalThis,name,descriptor);}
				assert.equal((await (await fetch(base+'/api/health')).json()).app,'router-monitor-dashboard');
				const healthHead=await fetch(base+'/api/health',{method:'HEAD'});assert.equal(healthHead.status,200);assert.equal(await healthHead.text(),'');
				for(const route of ['/','/models','/requests','/tools','/_next/static/app.js','/requests.txt'])assert.equal((await fetch(base+route)).status,403);
				assert.equal((await fetch(base,{headers:{'X-Observatory-Desktop':'wrong','User-Agent':'Electron'}})).status,403);
				const badHost=await new Promise((resolve,reject)=>require('node:http').get(base,{headers:{Host:'external.example'}},response=>{response.resume();response.once('end',()=>resolve(response.statusCode));}).once('error',reject));assert.equal(badHost,400);
				const headers={'X-Observatory-Desktop':token};
				for(const route of ['/','/requests','/tools'])assert.equal((await fetch(base+route,{headers})).status,200);
				assert.equal((await fetch(base+'/models',{headers,redirect:'manual'})).status,302);
				assert.equal(await (await fetch(base+'/requests.txt',{headers})).text(),'fixture flight');
				const script=await fetch(base+'/_next/static/app.js',{headers});assert.match(script.headers.get('content-type'),/javascript/);assert.match(script.headers.get('cache-control'),/immutable/);
				const head=await fetch(base+'/requests',{headers,method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');assert.ok(Number(head.headers.get('content-length'))>0);
				for(const route of ['/missing','/..%2f..%2fpackage.json','/..%5cpackage.json'])assert.equal((await fetch(base+route,{headers})).status,404);
				const snapshot=await (await fetch(base+'/api/observatory?range=all&page=1')).json();assert.equal(snapshot.totals.requests,257);assert.equal(snapshot.requests.length,50);assert.equal(snapshot.requests[0].id,'row-50');
				const recent=await (await fetch(base+'/api/observatory?range=all&limit=5')).json();assert.equal(recent.requests.length,5);assert.equal(recent.requestCount,257);assert.equal(recent.requests[0].id,'row-0');
				const summary=await (await fetch(base+'/api/observatory?range=all&limit=0')).json();assert.equal(summary.requests.length,0);assert.equal(summary.totals.requests,257);
				const csv=await fetch(base+'/api/observatory?range=all&format=csv');assert.match(csv.headers.get('content-type'),/text\\/csv/);const text=await csv.text();assert.equal(text.trim().split('\\r\\n').length,258);assert.match(text,/会话请求轮次/);
				const exportRequest=new Request(base+'/api/observatory?range=all&format=csv');
				const direct=await require('./src/server/observatory.ts').GET(exportRequest);
				let count=0;for await(const chunk of direct.body){const lines=chunk.toString().split('\\r\\n');count+=lines.length-1;}assert.equal(count,257);
				const cancelled=await require('./src/server/observatory.ts').GET(exportRequest);cancelled.body.destroy();assert.equal(cancelled.body.destroyed,true);
				const csvHead=await fetch(base+'/api/observatory?range=all&format=csv',{method:'HEAD'});assert.equal(csvHead.status,200);assert.equal(await csvHead.text(),'');
				const emptyCsv=await (await fetch(base+'/api/observatory?range=all&format=csv&model=absent')).text();assert.equal(emptyCsv.split('\\r\\n').length,1);
				assert.equal((await fetch(base+'/api/observatory?range=invalid')).status,400);
				assert.equal((await fetch(base+'/api/metrics')).status,404);
				assert.equal((await fetch(base+'/api/health',{method:'POST'})).status,405);
				assert.equal((await fetch(base+'/api/observatory/events',{method:'POST',headers:{'Content-Type':'application/json'},body:'x'.repeat(9000)})).status,413);
				const chunks=require('node:stream').Readable.from(['x'.repeat(5000),'x'.repeat(4000)]);
				assert.equal((await fetch(base+'/api/observatory/events',{method:'POST',headers:{'Content-Type':'application/json'},body:chunks,duplex:'half'})).status,413);
				const post=(endpoint,body,extra={})=>fetch(base+'/api/observatory/'+endpoint,{method:'POST',headers:{'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
				assert.equal((await post('collection',{paused:true},{Origin:'https://untrusted.example'})).status,403);
				assert.equal((await post('events',{id:'x'},{Origin:'https://untrusted.example'})).status,403);
				assert.equal((await post('aliases',{from:'fixture-model',to:'mapped-model'},{Origin:'https://untrusted.example'})).status,403);
				assert.equal((await post('aliases',{from:'fixture-model',to:'mapped-model'})).status,200);
				assert.equal((await (await fetch(base+'/api/observatory?range=all')).json()).models[0].model,'mapped-model');
				assert.equal((await post('aliases',{from:'fixture-model',to:''})).status,200);
				assert.equal((await (await fetch(base+'/api/observatory?range=all')).json()).models[0].model,'fixture-model');
				assert.equal((await (await post('collection',{paused:true})).json()).paused,true);
				const bom=await fetch(base+'/api/observatory/collection',{method:'POST',headers:{'Content-Type':'application/json'},body:'\uFEFF'+JSON.stringify({paused:true})});assert.equal(bom.status,200);assert.equal((await bom.json()).paused,true);
				const event={id:'new',at:new Date().toISOString(),model:'fixture-model',client:'fixture-client',input:4,output:1};
				assert.equal((await post('events',event)).status,202);assert.equal((await post('events',event)).status,202);
				assert.equal((await (await post('collection',{paused:false})).json()).paused,false);
				assert.equal((await (await fetch(base+'/api/observatory?range=all')).json()).totals.requests,258);
				assert.ok(!Object.keys(require.cache).some(file=>file.includes(path.join('node_modules','next'))));
			}finally{await new Promise(resolve=>server.close(resolve));}
		})().catch(error=>{console.error(error);process.exitCode=1});
	`;
	try {
		try {
			execFileSync(process.execPath, ["-e", worker], { cwd: path.dirname(__dirname), env: { ...process.env, USERPROFILE: dir, HOME: dir, APPDATA: dir, OBSERVATORY_DATA_DIR: dir }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 });
		} catch (error) { throw new Error(error.stderr || error.message); }
	} finally { await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }
});
