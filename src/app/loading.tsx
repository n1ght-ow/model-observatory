import { Radio } from "lucide-react";

export default function Loading() {
	return <main className="observatory obs-route-state" aria-busy="true"><section role="status"><Radio size={30} /><h1>正在打开模型账本</h1><p>页面就绪后将读取本机模型记录。</p></section></main>;
}
