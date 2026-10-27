import { afterEach, expect, it, vi } from "vitest";
import { discoverLocalClis } from "../src/services/cli-discovery";
import { CLI_PROFILES } from "../src/services/cli-profiles";
import { Platform } from "obsidian";
const state=vi.hoisted(()=>({exec:vi.fn(),active:0,maximum:0,exists:new Set<string>(),versions:[] as string[]}));
vi.mock("../src/services/runtime-require",()=>({getRuntimeRequire:()=> (name:string)=>{
 if(name==="child_process")return {execFile:state.exec};
 if(name==="fs")return {existsSync:(path:string)=>state.exists.has(path),readdirSync:()=>state.versions};
 if(name==="os")return {homedir:()=>"/home/test"};
 if(name==="path")return {join:(...parts:string[])=>parts.join("/")};
 return {};
}}));
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();state.active=0;state.maximum=0;state.exists.clear();state.versions=[];Platform.isDesktopApp=true;});
it("bounds parallel probes, preserves auto-selection order, and shares overlapping scans",async()=>{
 vi.useFakeTimers();
 state.exec.mockImplementation((command:string,_args:unknown,_options:unknown,callback:(e:Error|null,out:string,err:string)=>void)=>{
  state.active++;state.maximum=Math.max(state.maximum,state.active);
  setTimeout(()=>{state.active--;callback(null,command==="agent"?"Cursor 1.0":"1.0","");},100);
 });
 const start=Date.now(); const first=discoverLocalClis(); const second=discoverLocalClis();
 await vi.runAllTimersAsync();const [a,b]=await Promise.all([first,second]);
 expect(a).toBe(b);expect(state.maximum).toBe(4);expect(a.slice(0,-1).map(d=>d.id)).toEqual(CLI_PROFILES.map(p=>p.id));
 expect(Date.now()-start).toBeLessThan(1000);
 const count=state.exec.mock.calls.length;const fresh=discoverLocalClis();await vi.runAllTimersAsync();await fresh;
 expect(state.exec.mock.calls.length).toBeGreaterThan(count);
});
it("does not probe on mobile",async()=>{Platform.isDesktopApp=false;expect(await discoverLocalClis()).toEqual([]);expect(state.exec).not.toHaveBeenCalled();});

it("桌面 PATH 缺少 Node 时，通过 nvm 的同目录 Node 检测 Pi", async () => {
  const bin = "/home/test/.nvm/versions/node/v22.22.2/bin";
  const script = `${bin}/pi`;
  const node = `${bin}/node`;
  state.versions = ["v22.22.2"];
  state.exists.add(script);
  state.exists.add(node);
  state.exec.mockImplementation((command: string, args: string[], _options: unknown, callback: (error: Error | null, out: string, err: string) => void) => {
    if (command === node && args[0] === script) callback(null, "1.0.2", "");
    else callback(new Error("env: node: No such file or directory"), "", "");
  });
  const pi = (await discoverLocalClis()).find((agent) => agent.id === "pi");
  expect(pi).toMatchObject({ command: "pi", path: node, argsPrefix: [script], version: "1.0.2", available: true, callable: true });
});
