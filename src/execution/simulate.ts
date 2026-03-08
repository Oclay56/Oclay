import type { SolanaRpc } from "../providers/solanaRpc";

export async function simulateOrThrow(rpc: SolanaRpc, txBase64: string): Promise<{ logs: string[] }> {
  const sim = await rpc.simulateBase64Tx(txBase64);
  if (!sim.ok) {
    const head = sim.logs.slice(-30).join("\n");
    throw new Error(`simulation_failed: ${JSON.stringify(sim.err)}\n${head}`);
  }
  return { logs: sim.logs };
}

