interface FailureStats {
  consecutiveFailures: number;
  lastError: string;
}

// Chave: serverId:method:endpoint (endpoint normalizado sem query params e barras finais)
const routeFailureTracker = new Map<string, FailureStats>();

export function trackRouteExecution(
  serverId: string,
  method: string,
  endpoint: string,
  isSuccess: boolean,
  errorMessage?: string
): FailureStats {
  const cleanEndpoint = (endpoint.split('?')[0] ?? '').replace(/\/+$/, '');
  const key = `${serverId}:${method.toUpperCase()}:${cleanEndpoint}`;

  if (isSuccess) {
    routeFailureTracker.delete(key);
    return { consecutiveFailures: 0, lastError: '' };
  }

  const existing = routeFailureTracker.get(key) || { consecutiveFailures: 0, lastError: '' };
  const updated = {
    consecutiveFailures: existing.consecutiveFailures + 1,
    lastError: errorMessage || 'Erro desconhecido'
  };
  routeFailureTracker.set(key, updated);
  return updated;
}

export function checkRouteBlock(serverId: string, method: string, endpoint: string): { isBlocked: boolean; count: number } {
  const cleanEndpoint = (endpoint.split('?')[0] ?? '').replace(/\/+$/, '');
  const key = `${serverId}:${method.toUpperCase()}:${cleanEndpoint}`;
  const tracker = routeFailureTracker.get(key);
  if (tracker && tracker.consecutiveFailures >= 8) {
    return { isBlocked: true, count: tracker.consecutiveFailures };
  }
  return { isBlocked: false, count: tracker ? tracker.consecutiveFailures : 0 };
}

export function postProcessProxyResult(serverId: string, method: string, endpoint: string, result: any): any {
  if (!result || !result.content || !Array.isArray(result.content) || result.content.length === 0) {
    return result;
  }

  const isSuccess = !result.isError;
  const errorText = result.isError ? result.content[0].text : '';
  const stats = trackRouteExecution(serverId, method, endpoint, isSuccess, errorText);

  if (!isSuccess) {
    if (stats.consecutiveFailures === 3) {
      const prefix = `[AVISO MCP] Você já falhou 3 vezes consecutivas nesta rota.\nDica: Use a ferramenta 'detalhar_endpoint_api' para validar o schema ou verifique se há dependências de dados não resolvidas (como IDs incorretos ou falta de autenticação).\n\n`;
      result.content[0].text = prefix + result.content[0].text;
    } else if (stats.consecutiveFailures >= 5 && stats.consecutiveFailures < 8) {
      const prefix = `[ALERTA DE SEGURANÇA MCP] Você falhou ${stats.consecutiveFailures} vezes consecutivas nesta rota.\nRecomendamos fortemente que você interrompa as tentativas automáticas, relate os detalhes técnicos e payloads testados ao usuário no chat, e solicite orientação.\n\n`;
      result.content[0].text = prefix + result.content[0].text;
    }
  }

  return result;
}
