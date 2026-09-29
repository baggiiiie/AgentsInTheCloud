#!/usr/bin/env bun
import { workspaceId } from './core';

const help = `ios-sim — shared remote iOS simulators for web/PWA work
Usage: bun tools/ios-sim/cli.ts <command> [arguments]
Setup: export REMOTEMAC=user@host; bun tools/ios-sim/cli.ts doctor
This tool manages this workspace's simulators only. Mac account and sudo are shared; isolation is by convention, not security. SSH to the Mac for investigation using UDIDs shown by list.
Commands:
  doctor                      Check/setup Mac prerequisites
  models                      List available iPhone models
  start [--model "iPhone 17"]  Create and boot a simulator
  list                        Show handles, names, UDIDs, models, state
  stop <sim> | delete <sim>    Shut down or remove a simulator
  model <sim> <model>          Recreate under same handle (wipes site data)
  open <sim> <url>            Open local dev URL via SSH reverse forward
  install-pwa <sim> <url>     Add page to Home Screen
  launch-pwa <sim> <title>    Launch Home Screen app
  tap <sim> <x> <y> | swipe <sim> <x1> <y1> <x2> <y2>
  type <sim> <text> | button <sim> <name> | describe <sim>
  screenshot <sim> [file]     Save simulator PNG
  web <sim> targets | eval <js> | query <selector> | wait-for <selector>
  web <sim> click <selector> | fill <selector> <text> | logs
       [--target pwa|<url-substring>] [--touch for click/fill]
  prune                       Delete shut-down leftover ios-sim-* devices
  serve                       Run workspace server (automatically started)
Viewer: http://localhost:4100/
Xcode installation requires Apple ID, 2FA and sudo; install manually with xcodes install <ver> --experimental-unxip --select.
`;
const [command,...args] = process.argv.slice(2);
if (!command || command === '--help' || command === 'help') { console.log(help); process.exit(0); }
if (command === 'serve') { await import('./server'); }
else {
  const port = 4100;
  const health = async () => { try { return (await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(800)})).ok; } catch {return false;} };
  if (!(await health())) {
    const session = `ios-sim-${workspaceId()}`;
    const run = Bun.spawnSync(['tmux','new-session','-d','-s',session,'-c','/work',`bun tools/ios-sim/cli.ts serve`],{stdout:'pipe',stderr:'pipe'});
    if (run.exitCode !== 0 && !new TextDecoder().decode(run.stderr).includes('duplicate session')) throw Error(new TextDecoder().decode(run.stderr));
    let ready = false;
    for(let i=0;i<150;i++) {if(await health()) {ready=true;break;} await Bun.sleep(200);}
    if(!ready) throw Error(`ios-sim serve did not start; inspect: tmux capture-pane -pt ${session}`);
  }
  const response = await fetch(`http://127.0.0.1:${port}/api/command`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({command,args})});
  if(!response.ok) { console.error(await response.text()); process.exit(1); }
  if (command === 'screenshot') {
    const file = args[1] || `${args[0]}.png`;
    await Bun.write(file, await response.arrayBuffer()); console.log(file);
  } else {
    const body = await response.text();
    if (body) console.log(body);
  }
}
