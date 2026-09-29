import { Mac, quote, type Sim } from './core';
import * as native from './native';
import { handleViewerRequest } from './viewer';
import { startInspectorProxy, type WebInspector } from './inspector';

const mac = new Mac();
await mac.start();
void mac.anchor!.exited.then(code=>{ console.error(`iOS simulator SSH anchor exited (${code})`); process.exit(1); });
const lastUrls = new Map<string,string>();
const inspectors = new Map<string, { inspector: WebInspector; process: Bun.Subprocess }>();
const streams = new Map<string,{process:Bun.Subprocess; clients:Set<ReadableStreamDefaultController<Uint8Array>>}>();
function releaseSimulator(s:Sim) {
  inspectors.get(s.udid)?.process.kill(); inspectors.delete(s.udid);
  streams.get(s.udid)?.process.kill(); streams.delete(s.udid);
}
process.on('SIGTERM',()=>{ mac.close(); process.exit(); });
process.on('SIGINT',()=>{ mac.close(); process.exit(); });

const sim = (arg:string) => mac.resolve(arg);
const remote = (cmd:string) => mac.run(cmd);
async function open(s: Sim, raw: string) {
  const url = new URL(raw);
  if (!['http:','https:'].includes(url.protocol)) throw Error('Only HTTP(S) URLs may be opened');
  let destination = raw;
  if (['localhost','127.0.0.1'].includes(url.hostname)) {
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
    const forwarded = await mac.forward(port);
    url.hostname = 'localhost'; url.port = String(forwarded); destination = url.toString();
  }
  await mac.run(`xcrun simctl openurl ${quote(s.udid)} ${quote(destination)}`);
  if (!lastUrls.has(s.handle) && await native.dismissSafariOnboarding(remote,s.udid))
    await mac.run(`xcrun simctl openurl ${quote(s.udid)} ${quote(destination)}`);
  lastUrls.set(s.handle, raw);
  return destination;
}
async function inspector(s:Sim) {
  if (s.state !== 'Booted') throw Error('Simulator must be booted for Web Inspector');
  let instance = inspectors.get(s.udid);
  if (!instance) {
    const offset=41000 + Number(s.handle.slice(3))*2;
    instance = await startInspectorProxy(s.udid, offset, offset+1000, remote, (command,forward)=>mac.spawn(command,forward));
    inspectors.set(s.udid,instance);
  }
  return instance.inspector;
}
async function run(command:string, args:string[]):Promise<string | Uint8Array> {
  if (command === 'doctor') {
    await mac.run('command -v brew && xcode-select -p && xcodebuild -license check && xcrun simctl list runtimes && sudo -n true');
    await mac.run('brew list --formula axe >/dev/null 2>&1 || brew install cameroncooke/axe/axe');
    await mac.run('brew list --formula ios-webkit-debug-proxy >/dev/null 2>&1 || brew install ios-webkit-debug-proxy');
    await mac.run(`grep -F 'brew shellenv' ~/.zshenv >/dev/null 2>&1 || printf '%s\\n' ${quote('eval "$(/opt/homebrew/bin/brew shellenv)"')} >> ~/.zshenv`);
    const config = 'ClientAliveInterval 15\nClientAliveCountMax 4\n';
    await mac.run(`printf %s ${quote(config)} | sudo -n tee /etc/ssh/sshd_config.d/100-ios-sim.conf >/dev/null && sudo -n /usr/sbin/sshd -t`);
    const checks = await mac.run('command -v axe; command -v ios_webkit_debug_proxy; sudo -n /usr/sbin/sshd -T | grep -E "allowtcpforwarding|clientaliveinterval|clientalivecountmax"');
    const port = await mac.forward(4100);
    return `${checks}\nReverse SSH forwarding available on Mac port ${port}. SSH keepalive configured (15 s × 4).`;
  }
  if(command==='models') return (await mac.models()).map(x=>x.name).join('\n');
  if(command==='list') return (await mac.devices()).map(s=>`${s.handle}\t${s.name}\t${s.udid}\t${s.model}\t${s.state}`).join('\n') || '(none)';
  if(command==='prune') return (await mac.prune()).join('\n') || '(none)';
  if(command==='start') return JSON.stringify(await mac.startSim(args[0]==='--model'?args[1]:args[0] || 'iPhone 17'),null,2);
  const s = await sim(args[0] || '');
  if(command==='stop') { releaseSimulator(s); await mac.stopSim(s); return `Stopped ${s.handle}`; }
  if(command==='delete') { releaseSimulator(s); await mac.deleteSim(s); lastUrls.delete(s.handle); return `Deleted ${s.handle}`; }
  if(command==='model') {
    const oldUrl = lastUrls.get(s.handle);
    releaseSimulator(s);
    await mac.deleteSim(s);
    lastUrls.delete(s.handle);
    const replacement = await mac.startSim(args.slice(1).join(' '),Number(s.handle.slice(3)));
    if(oldUrl) await open(replacement,oldUrl);
    return JSON.stringify(replacement,null,2);
  }
  if(command==='open') return open(s,args[1]);
  if(command==='describe') return native.describe(remote,s.udid);
  if(command==='tap') return native.tap(remote,s.udid,Number(args[1]),Number(args[2]));
  if(command==='swipe') return native.swipe(remote,s.udid,Number(args[1]),Number(args[2]),Number(args[3]),Number(args[4]));
  if(command==='type') return native.typeText(remote,s.udid,args.slice(1).join(' '));
  if(command==='button') return native.button(remote,s.udid,args[1]);
  if(command==='screenshot') return native.screenshot(remote,s.udid);
  if(command==='install-pwa') {
    const destination = await open(s,args[1]);
    const title = await (await inspector(s)).eval('document.querySelector("meta[name=apple-mobile-web-app-title]")?.content || document.title',destination);
    if(!title) throw Error('Page must have a title to install and verify a Home Screen app');
    await native.installPwa(remote,s.udid,destination);
    await Bun.sleep(1800);
    await native.launchPwa(remote,s.udid,title);
    await native.button(remote,s.udid,'home');
    return `Installed and verified Home Screen app ${title} from ${destination}`;
  }
  if(command==='launch-pwa') { const title=args.slice(1).join(' '); await native.launchPwa(remote,s.udid,title); return `Launched ${title}`; }
  if(command==='web') {
    const sub=args[1], targetIndex=args.indexOf('--target'), target=targetIndex>=0?args[targetIndex+1]:undefined;
    const touch=args.includes('--touch');
    const params=args.slice(2).filter((_,i)=>{ const original=i+2; return original !== targetIndex && original !== targetIndex+1 && args[original]!=='--touch'; });
    const web = await inspector(s);
    if(sub==='targets') return JSON.stringify(await web.targets(),null,2);
    if(sub==='eval') return JSON.stringify(await web.eval(params.join(' '),target),null,2);
    if(sub==='query') return JSON.stringify(await web.query(params[0],target),null,2);
    if(sub==='wait-for') return JSON.stringify(await web.waitFor(params[0],target),null,2);
    if(sub==='logs') return JSON.stringify(await web.logs(target),null,2);
    if(sub==='click'||sub==='fill') {
      if(touch) {
        const {rect,viewport}=await web.touchRect(params[0],target);
        // iOS viewport coordinates begin below the Dynamic Island/status region;
        // WebKit's visual viewport supplies the zoom and scroll transform.
        const topInset=viewport.screenHeight * (62/874);
        const x=(rect.x+rect.width/2-viewport.visualOffsetLeft)*viewport.visualScale;
        const y=(rect.y+rect.height/2-viewport.visualOffsetTop)*viewport.visualScale+topInset;
        await native.tap(remote,s.udid,x,y);
        if(sub==='fill') return native.typeText(remote,s.udid,params.slice(1).join(' '));
        return `Tapped ${params[0]}`;
      }
      return JSON.stringify(sub==='click'?await web.click(params[0],target):await web.fill(params[0],params.slice(1).join(' '),target),null,2);
    }
    throw Error(`Unknown web command: ${sub}`);
  }
  throw Error(`Unknown command: ${command}`);
}
async function stream(s:Sim):Promise<Response> {
  let active = streams.get(s.udid);
  if (!active) {
    const process = mac.spawn(`exec axe stream-video --udid ${quote(s.udid)} --format mjpeg --scale 0.5 --fps 20`);
    active={process,clients:new Set()}; streams.set(s.udid,active);
    const current=active;
    void (async()=>{try {
      let header = new Uint8Array(); let started = false;
      // SAFETY: Bun pipes stdout as a byte ReadableStream.
      for await(const chunk of process.stdout as ReadableStream<Uint8Array>) {
        let data=chunk;
        if (!started) {
          const combined=new Uint8Array(header.length+chunk.length); combined.set(header); combined.set(chunk,header.length);
          const marker=new TextEncoder().encode('\r\n\r\n');
          const position=combined.findIndex((_,i)=>i+4<=combined.length && marker.every((byte,j)=>combined[i+j]===byte));
          if(position<0) {header=combined; continue;}
          data=combined.slice(position+4); started=true;
        }
        for(const client of current.clients) client.enqueue(data);
      }
    } catch(e) { console.error('stream:',e); }
      finally { for(const client of current.clients) {try {client.close();}catch{}} streams.delete(s.udid); process.kill(); }
    })();
  }
  const current=active;
  let subscriber: ReadableStreamDefaultController<Uint8Array>;
  const body=new ReadableStream<Uint8Array>({ start(controller){subscriber=controller;current.clients.add(controller);},cancel(){current.clients.delete(subscriber); if(!current.clients.size){current.process.kill();streams.delete(s.udid);} } });
  return new Response(body,{headers:{'content-type':'multipart/x-mixed-replace; boundary=mjpegstream','cache-control':'no-store'}});
}
const server = Bun.serve({port:4100,hostname:'0.0.0.0',idleTimeout:255,async fetch(request) {
  const url=new URL(request.url);
  if(url.pathname==='/health') return new Response('ok');
  try {
    if(url.pathname==='/api/command' && request.method==='POST') {
      // SAFETY: CLI and viewer are the only callers of this localhost command endpoint.
      const {command,args} = await request.json() as {command:string;args:string[]};
      const result=await mac.serial(()=>run(command,args));
      return result instanceof Uint8Array ? new Response(result,{headers:{'content-type':'image/png'}}) : new Response(result);
    }
    return await handleViewerRequest(request,{
      list:async()=> (await mac.devices()).map(s=>({...s,lastUrl:lastUrls.get(s.handle)})),
      models:async()=> (await mac.models()).map(m=>m.name),
      stream:async handle=>stream(await sim(handle)),
      action:async(handle,action,data)=>mac.serial(async()=>{
        const s=await sim(handle);
        if(action==='home') await native.button(remote,s.udid,'home');
        else if(action==='open') await open(s,data.url);
        else if(action==='screenshot') return new Response(await native.screenshot(remote,s.udid),{headers:{'content-type':'image/png'}});
        else if(action==='type') await native.typeText(remote,s.udid,data.text);
        else if(action==='tap' || action==='swipe') {
          const {width,height}=await native.screenDimensions(remote,s.udid);
          const coordinate=(key:string,size:number)=>{
            const fraction=Number(data[key]);
            if(data[key] === undefined || data[key].trim() === '' || !Number.isFinite(fraction) || fraction<0 || fraction>1)
              throw Error(`Invalid normalized coordinate: ${key}`);
            return fraction*size;
          };
          if(action==='tap') await native.tap(remote,s.udid,coordinate('x',width),coordinate('y',height));
          else await native.swipe(remote,s.udid,coordinate('x1',width),coordinate('y1',height),coordinate('x2',width),coordinate('y2',height));
          return new Response(null,{status:204});
        }
        else if(action==='model') await run('model',[handle,data.model]);
      })
    });
  } catch(error) { console.error(error); return new Response(String(error),{status:400}); }
}});
console.log(`ios-sim ${mac.id} listening at http://localhost:${server.port}`);
