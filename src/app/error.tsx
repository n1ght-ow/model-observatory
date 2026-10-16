"use client";

import { CircleAlert, RefreshCw } from "lucide-react";

export default function Error({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
	return <main className="observatory obs-route-state"><section role="alert"><CircleAlert size={30} /><h1>页面暂时无法打开</h1><p>请重新加载。已保存的模型记录不受影响。</p><button className="obs-button" onClick={retry}><RefreshCw size={14} />重新加载</button></section></main>;
}
