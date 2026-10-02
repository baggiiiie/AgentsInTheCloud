import { listAgentsInTheCloudProcesses, sortAgentsInTheCloudProcesses } from "./processes.ts";

function pad(value: string | number, width: number): string {
  return String(value).padEnd(width, " ");
}

const processes = sortAgentsInTheCloudProcesses(await listAgentsInTheCloudProcesses({ excludePid: process.pid }));

if (processes.length === 0) {
  console.log("No AgentsInTheCloud web servers found.");
} else {
  console.log(`${pad("PID", 8)} ${pad("PPID", 8)} ${pad("KIND", 8)} COMMAND`);
  for (const proc of processes) {
    console.log(`${pad(proc.pid, 8)} ${pad(proc.ppid, 8)} ${pad(proc.kind, 8)} ${proc.command}`);
  }
}
