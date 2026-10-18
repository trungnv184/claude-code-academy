// Report pages wider than a 390px phone viewport (horizontal scroll).
// Needs Google Chrome and a static server on :8765. Usage: node scripts/check-mobile.mjs
import { spawn } from "node:child_process";
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new","--disable-gpu","--remote-debugging-port=9333","--window-size=390,900","about:blank"], {stdio:"ignore"});
await new Promise(r => setTimeout(r, 1500));
const pages = ["index.html","playground.html",...[1,2,3,4,5,6,7,8,9].map(n=>"lessons/"+["01-agent-loop","02-context-claude-md","03-plan-mode","04-goals-loops","05-hooks","06-skills","07-subagents","08-capstone","09-cheatsheet"][n-1]+".html")];
const tab = (await (await fetch("http://127.0.0.1:9333/json/list")).json()).find(t=>t.type==="page");
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r);
let id=0; const pending={}; ws.onmessage=e=>{const m=JSON.parse(e.data); if(pending[m.id]){pending[m.id](m);delete pending[m.id];}};
const send=(method,params={})=>new Promise(r=>{const i=++id;pending[i]=r;ws.send(JSON.stringify({id:i,method,params}));});
await send("Emulation.setDeviceMetricsOverride",{width:390,height:900,deviceScaleFactor:1,mobile:true});
for (const p of pages) {
  await send("Page.navigate",{url:"http://localhost:8765/"+p}); await new Promise(r=>setTimeout(r,1800));
  const r = await send("Runtime.evaluate",{returnByValue:true,expression:`(()=>{const W=document.documentElement.clientWidth;const sw=document.documentElement.scrollWidth;const bad=[...document.querySelectorAll('body *')].filter(e=>{const b=e.getBoundingClientRect();return b.right>W+1&&b.width>0&&!e.closest('pre,.table-wrap,.term-screen,[style*=overflow]')&&getComputedStyle(e).position!=='fixed'&&!e.closest('.sidebar')}).slice(0,4).map(e=>e.tagName+'.'+e.className+' w='+Math.round(e.getBoundingClientRect().width));return {sw,W,bad}})()`});
  const v=r.result.result.value; console.log((v.sw>v.W?"OVERFLOW ":"ok       ")+p+" scrollW="+v.sw+" "+(v.sw>v.W?JSON.stringify(v.bad):""));
}
ws.close(); chrome.kill();
