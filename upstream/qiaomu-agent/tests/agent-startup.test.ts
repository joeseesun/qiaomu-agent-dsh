import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NativeAgentBackend } from "../src/services/native-agent-backend";
import type { ChatRequest, CliDetection } from "../src/types";
const state = vi.hoisted(() => ({ calls: [] as Array<{method:string;params:Record<string,unknown>}>, starts:0, stops:0, legacy:false,
  options: [{id:"model",category:"model",currentValue:"m1",options:[{value:"m1",name:"M1"},{value:"m2",name:"M2"}]}, {id:"effort",category:"thought_level",currentValue:"low",options:[{value:"low"},{value:"high"}]}],
}));
vi.mock("../src/services/runtime-require", () => ({getRuntimeRequire:()=>()=>({env:{}})}));
vi.mock("../src/services/json-rpc-process",()=>({JsonRpcProcess:class {
  running=false;
  start(){this.running=true;state.starts++;} async stop(){this.running=false;state.stops++;}
  async request(method:string,params:Record<string,unknown>){
    state.calls.push({method,params});
    if(method==="initialize")return {protocolVersion:1};
    if(method==="session/new")return {sessionId:"session",...(state.legacy?{models:{currentModelId:"m1",availableModels:[{modelId:"m1",name:"M1"},{modelId:"m2",name:"M2"}]}}:{configOptions:structuredClone(state.options)})};
    if(method==="session/set_config_option") {const config=state.options.find(o=>o.id===params.configId)!;config.currentValue=String(params.value);return {configOptions:structuredClone(state.options)};}
    return {};
  }
}}));
const detection:CliDetection={id:"qwen",label:"Qwen",command:"qwen",path:"/qwen",version:"test",available:true,callable:true};
const req:ChatRequest={prompt:"hello",systemPrompt:"test",cwd:"/vault",permissionMode:"plan",history:[],model:"m1",reasoningEffort:"low"};
const callbacks={onText:vi.fn(),onStatus:vi.fn()};
const send=(b:NativeAgentBackend,r=req)=>b.send(r,callbacks,new AbortController().signal);
beforeEach(()=>{state.calls=[];state.starts=0;state.stops=0;state.legacy=false;state.options[0]!.currentValue="m1";state.options[1]!.currentValue="low";});
afterEach(()=>vi.clearAllMocks());
it("prepares ACP without a session/prompt, then skips unchanged model and effort round trips",async()=>{
 const b=new NativeAgentBackend(detection); await b.prepare(req);
 expect(state.calls.map(c=>c.method)).toEqual(["initialize"]);
 await send(b);await send(b);
 expect(state.starts).toBe(1);
 expect(state.calls.filter(c=>c.method==="session/new")).toHaveLength(1);
 expect(state.calls.filter(c=>c.method.startsWith("session/set_"))).toHaveLength(0);
 await send(b,{...req,model:"m2",reasoningEffort:"high"});await send(b,{...req,model:"m2",reasoningEffort:"high"});
 expect(state.calls.filter(c=>c.method==="session/set_config_option")).toHaveLength(2);
 await b.shutdown();expect(state.stops).toBe(1);
});
it("shares session setup between manual discovery and the first send",async()=>{
 const b=new NativeAgentBackend(detection);
 await Promise.all([b.listModels(req),send(b)]);
 expect(state.starts).toBe(1);expect(state.calls.filter(c=>c.method==="session/new")).toHaveLength(1);
});
it("restarts ACP when its launch permission changes, even after preparation",async()=>{
 const b=new NativeAgentBackend(detection);await b.prepare(req);
 await send(b,{...req,permissionMode:"edit"});
 expect(state.starts).toBe(2);expect(state.stops).toBe(1);
});
it("tracks legacy model changes per session and reapplies after reset",async()=>{
 state.legacy=true;const b=new NativeAgentBackend(detection); const legacy={...req,reasoningEffort:undefined,model:"m2"};
 await send(b,legacy);await send(b,legacy);expect(state.calls.filter(c=>c.method==="session/set_model")).toHaveLength(1);
 b.resetSession();await send(b,legacy);expect(state.calls.filter(c=>c.method==="session/set_model")).toHaveLength(2);
});
it("recreates an ACP session after the requested workspace changes",async()=>{
 const b=new NativeAgentBackend(detection);await send(b);await send(b,{...req,cwd:"/another-vault"});
 expect(state.calls.filter(c=>c.method==="session/new")).toHaveLength(2);
});
