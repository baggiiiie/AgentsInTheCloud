import { readFileSync, writeFileSync } from 'node:fs';

export const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
export const workspaceId = () => {
  const file = '/work/.git/ios-sim-id';
  try { return readFileSync(file, 'utf8').trim(); }
  catch { const id = crypto.randomUUID().slice(0, 12); writeFileSync(file, id); return id; }
};
export const portCandidate = (id: string, local: number) => {
  let hash = 2166136261;
  for (const char of `${id}:${local}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return 20000 + (hash >>> 0) % 10000;
};
export const rewriteUrl = (raw: string, port: number) => { const url = new URL(raw); url.port = String(port); return url.toString(); };
export type Sim = { handle: string; name: string; udid: string; model: string; state: string; lastUrl?: string };
export function ownDevices(raw: string, id: string): Sim[] {
  // SAFETY: simctl list devices -j owns this JSON schema.
  const devices = Object.values((JSON.parse(raw) as {devices:Record<string, Array<{name:string;udid:string;state:string;deviceTypeIdentifier:string}>>}).devices).flat();
  return devices.filter(d => /^ios-sim-[a-f0-9-]{12}-\d+$/.test(d.name) && d.name.startsWith(`ios-sim-${id}-`)).map(d => ({ handle:`sim${d.name.split('-').at(-1)}`, name:d.name, udid:d.udid, model:d.deviceTypeIdentifier.split('.').at(-1)!.replaceAll('-', ' '), state:d.state }));
}
export const cleanupScript = (id: string) => `xcrun simctl list devices -j | /usr/bin/ruby -rjson -e 'JSON.parse(STDIN.read).fetch("devices").values.flatten.each { |d| if d.fetch("name").match?(/^ios-sim-${id}-[0-9]+$/); system("xcrun", "simctl", "shutdown", d.fetch("udid")) if d.fetch("state") == "Booted"; system("xcrun", "simctl", "delete", d.fetch("udid")); end }'`;

export class Mac {
  readonly host = process.env.REMOTEMAC || '';
  readonly id = workspaceId();
  readonly socket = `/tmp/ios-sim-${this.id}-${process.pid}.sock`;
  anchor?: Bun.Subprocess;
  #heartbeat?: ReturnType<typeof setInterval>;
  #queue = Promise.resolve();
  #forwarded = new Map<number, number>();
  #processes = new Set<Bun.Subprocess>();
  constructor() { if (!this.host) throw Error('REMOTEMAC is unset. Set it to user@host.'); }
  async start() {
    const heartbeatReader = `while (1) { my $fd = fileno(STDIN); my $ready = ''; vec($ready, $fd, 1) = 1; last unless select($ready, undef, undef, 55); my $bytes = sysread(STDIN, my $message, 4096); last unless $bytes; }`;
    const script = `trap ${quote(cleanupScript(this.id))} EXIT; trap 'exit' HUP TERM; ${cleanupScript(this.id)}; /usr/bin/perl -e ${quote(heartbeatReader)}`;
    this.anchor = Bun.spawn(['ssh','-M','-S',this.socket,'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=4','-T',this.host,`/bin/zsh -c ${quote(script)}`], {stdin:'pipe', stdout:'pipe', stderr:'pipe'});
    // The anchor's stdin must remain open: EOF triggers its cleanup trap.
    for (let n=0;n<100;n++) {
      if (this.anchor.exitCode !== null) throw Error(`SSH anchor exited (${this.anchor.exitCode}): ${await new Response(this.anchor.stderr).text()}`);
      const check = Bun.spawnSync(['ssh','-S',this.socket,'-O','check',this.host], {stdout:'pipe',stderr:'pipe'});
      if (check.exitCode === 0) {
        this.#heartbeat = setInterval(() => { this.anchor!.stdin.write('\n'); void this.anchor!.stdin.flush(); }, 10000);
        return;
      }
      await Bun.sleep(100);
    }
    throw Error('SSH ControlMaster did not become ready');
  }
  spawn(command: string, forward?: {local:number;remote:number}) {
    const args = ['ssh','-S',this.socket,'-o','BatchMode=yes','-T'];
    if (forward) args.push('-L',`127.0.0.1:${forward.local}:127.0.0.1:${forward.remote}`);
    args.push(this.host, command);
    const process = Bun.spawn(args, {stdout:'pipe',stderr:'pipe'});
    this.#processes.add(process);
    void process.exited.then(() => this.#processes.delete(process));
    return process;
  }
  async run(command: string): Promise<string> {
    const process = this.spawn(command);
    const [stdout,stderr,code] = await Promise.all([new Response(process.stdout).text(),new Response(process.stderr).text(),process.exited]);
    if (code !== 0) throw Error(`Mac command failed (${code}): ${command}\n${stderr}\n${stdout}`);
    return stdout.trim();
  }
  serial<T>(task:()=>Promise<T>):Promise<T> {
    const result = this.#queue.then(task);
    this.#queue = result.then(()=>{},()=>{});
    return result;
  }
  async forward(local: number): Promise<number> {
    const existing = this.#forwarded.get(local); if (existing) return existing;
    const first = portCandidate(this.id, local);
    for (let n=0;n<10000;n++) {
      const port = 20000 + (first - 20000 + n) % 10000;
      const p = Bun.spawnSync(['ssh','-S',this.socket,'-O','forward','-R',`127.0.0.1:${port}:127.0.0.1:${local}`,this.host], {stdout:'pipe',stderr:'pipe'});
      if (p.exitCode === 0) { this.#forwarded.set(local,port); return port; }
    }
    throw Error('No reverse forward port available');
  }
  async devices() { return ownDevices(await this.run('xcrun simctl list devices -j'), this.id); }
  async resolve(handleOrUdid: string) {
    const sim = (await this.devices()).find(d=>d.handle === handleOrUdid || d.udid === handleOrUdid);
    if (!sim) throw Error(`No simulator owned by this workspace: ${handleOrUdid}`);
    return sim;
  }
  async models() {
    // SAFETY: simctl list devicetypes -j owns this JSON schema.
    const raw = JSON.parse(await this.run('xcrun simctl list devicetypes -j')) as {devicetypes: Array<{name:string;productFamily:string;identifier:string}>};
    return raw.devicetypes.filter(d=>d.productFamily==='iPhone').map(d=>({name:d.name,identifier:d.identifier}));
  }
  async startSim(model = 'iPhone 17', index?: number) {
    const models = await this.models();
    const type = models.find(d=>d.name === model || d.identifier === model);
    if (!type) throw Error(`Unknown iPhone model: ${model}`);
    // SAFETY: simctl list devices -j owns this JSON schema.
    const all = JSON.parse(await this.run('xcrun simctl list devices -j')) as {devices:Record<string,Array<{state:string}>>};
    if (Object.values(all.devices).flat().filter(d=>d.state==='Booted').length >= 4) throw Error('Mac-wide limit of 4 booted simulators reached');
    const own = await this.devices();
    const n = index ?? Array.from({length:1000},(_,i)=>i+1).find(i=>!own.some(s=>s.handle===`sim${i}`));
    if (!n) throw Error('No simulator handles available');
    // SAFETY: simctl list runtimes -j owns this JSON schema.
    const runtimes = JSON.parse(await this.run('xcrun simctl list runtimes -j')) as {runtimes:Array<{identifier:string;isAvailable:boolean}>};
    const runtime = runtimes.runtimes.find(r=>r.identifier.includes('iOS') && r.isAvailable);
    if (!runtime) throw Error('No available iOS runtime');
    const name = `ios-sim-${this.id}-${n}`;
    const udid = await this.run(`xcrun simctl create ${quote(name)} ${quote(type.identifier)} ${quote(runtime.identifier)}`);
    await this.run(`xcrun simctl boot ${quote(udid)} && xcrun simctl bootstatus ${quote(udid)} -b`);
    await this.run(`xcrun simctl spawn ${quote(udid)} defaults write com.apple.keyboard.preferences AutomaticMinimizationEnabled -bool false; xcrun simctl spawn ${quote(udid)} defaults write com.apple.keyboard.preferences HardwareKeyboardLastSeen -bool false`);
    return (await this.resolve(udid));
  }
  async stopSim(sim:Sim) { if (sim.state === 'Booted') await this.run(`xcrun simctl shutdown ${quote(sim.udid)}`); }
  async deleteSim(sim:Sim) { await this.stopSim(sim); await this.run(`xcrun simctl delete ${quote(sim.udid)}`); }
  async prune() {
    // SAFETY: simctl list devices -j owns this JSON schema.
    const raw = JSON.parse(await this.run('xcrun simctl list devices -j')) as {devices:Record<string,Array<{name:string;udid:string;state:string}>>};
    const stale = Object.values(raw.devices).flat().filter(d=>/^ios-sim-[a-f0-9-]{12}-\d+$/.test(d.name) && d.state !== 'Booted');
    for (const sim of stale) await this.run(`xcrun simctl delete ${quote(sim.udid)}`);
    return stale.map(s=>s.name);
  }
  close() { clearInterval(this.#heartbeat); for(const p of this.#processes) p.kill(); this.anchor?.stdin?.end(); }
}
