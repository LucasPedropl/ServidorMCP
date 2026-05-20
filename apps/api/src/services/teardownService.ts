import { getServerById } from '../repositories/mcpRepository.js';
import { executeGenericMcpProxy } from './mcpProxyService.js';

export interface TeardownItem {
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  authProfileId?: string;
}

// Entidades registradas para teardown automático na desconexão (serverId -> Array<TeardownItem>)
export const serverTeardownRegistry = new Map<string, Array<TeardownItem>>();

export async function executeServerTeardown(serverId: string): Promise<void> {
  const registry = serverTeardownRegistry.get(serverId);
  if (!registry || registry.length === 0) return;

  console.error(`[Teardown Coletor de Lixo] Executando limpeza de ${registry.length} entidades para o servidor ${serverId}...`);
  const freshServer = await getServerById(serverId);
  if (!freshServer) return;

  // Processa na ordem inversa de criação (LIFO)
  const itemsToClean = [...registry].reverse();
  
  // Limpa o registro imediatamente para evitar execuções concorrentes duplicadas
  serverTeardownRegistry.set(serverId, []);

  for (const item of itemsToClean) {
    try {
      console.error(`[Teardown Coletor de Lixo] Removendo: ${item.method} ${item.endpoint}`);
      await executeGenericMcpProxy(
        freshServer,
        item.endpoint,
        item.method,
        undefined, // body
        undefined, // query
        false,
        item.authProfileId
      );
    } catch (err: any) {
      console.error(`[Teardown Coletor de Lixo Erro] Falha ao remover ${item.endpoint}:`, err.message);
    }
  }
}
