// Click every lab control, quiz option and terminal hint on every page; report JS errors.
// Needs Google Chrome and a static server on :8765. Usage: node scripts/check-labs.mjs
import { spawn } from "node:child_process";
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new","--disable-gpu","--remote-debugging-port=9333","--window-size=390,900","about:blank"], {stdio:"ignore"});
await new Promise(r => setTimeout(r, 1500));
const pages = ["index.html","playground.html",...[1,2,3,4,5,6,7,8,9].map(n=>"lessons/"+["01-agent-loop","02-context-claude-md","03-plan-mode","04-goals-loops","05-hooks","06-skills","07-subagents","08-capstone","09-cheatsheet"][n-1]+".html")];
const tab = (await (await fetch("http://127.0.0.1:9333/json/list")).json()).find(t=>t.type==="page");
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r);
let id=0; const pending={}; ws.onmessage=e=>{const m=JSON.parse(e.data); if(pending[m.id]){pending[m.id](m);delete pending[m.id];}};
const send=(method,params={})=>new Promise(r=>{const i=++id;pending[i]=r;ws.send(JSON.stringify({id:i,method,params}));});
await send("Emulation.setDeviceMetricsOverride",{width:1360,height:1000,deviceScaleFactor:1,mobile:true});
for (const p of pages) {
  await send("Page.navigate",{url:"http://localhost:8765/"+p}); await new Promise(r=>setTimeout(r,1800));
  const r = await send("Runtime.evaluate",{awaitPromise:true,returnByValue:true,expression:`(async()=>{const bs=[...document.querySelectorAll(".lab button, .term-hints button, .quiz .opt, [data-widget] button, [data-widget] input[type=checkbox]")];for(const b of bs){try{b.click()}catch(e){}await new Promise(r=>setTimeout(r,30))}document.querySelectorAll(".lab textarea, .lab input[type=text]").forEach(i=>{i.value+=" deploy release notes";i.dispatchEvent(new Event("input",{bubbles:true}))});await new Promise(r=>setTimeout(r,2500));return {n:bs.length,err:document.documentElement.getAttribute("data-js-errors")||""}})()`});
  const v=r.result.result.value; console.log((v.err?"FAIL ":"ok   ")+p+" clicked="+v.n+" "+v.err);
}
ws.close(); chrome.kill();
