import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getServerById } from '../../repositories/mcpRepository.js';
import type { ServerRecord } from '../../repositories/mcpRepository.js';
import { executeGenericMcpProxy } from '../mcpProxyService.js';
import {
  generateRandomCPF,
  generateRandomCNPJ,
  generateRandomEmail,
  generateRandomName,
  generateRandomPhone,
  generateRandomUUID
} from '../testEngineService.js';

export function registerExecutionTools(mcp: McpServer, serverRecord: ServerRecord) {
  // Ferramenta 2: Chamar API Genérica
  mcp.tool(
    'chamar_api_dinamica',
    `Executa uma requisição HTTP dinâmica contra a API do ${serverRecord.name}. Use a rota exata descoberta no listar_rotas_resumidas e inspecionada no detalhar_endpoint_api. Você DEVE substituir os parâmetros de rota na string (ex: altere /users/{id} para /users/123).`,
    {
      endpoint: z.string().describe('O caminho do endpoint para chamar. Ex: /api/v1/Assinatura ou /api/v1/Empresa/123'),
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).describe('O verbo HTTP para a requisição.'),
      body: z.record(z.string(), z.any()).optional().describe('Um objeto JSON contendo o payload do body, se aplicável.'),
      queryParams: z.record(z.string(), z.any()).optional().describe('Um objeto JSON contendo os parâmetros de query string, se aplicável.'),
      authProfileId: z.string().optional().describe('ID opcional de perfil de autenticação para forçar o uso de um token específico.')
    },
    async (args) => {
      console.error(`[MCP Tool Executada] IA chamou "chamar_api_dinamica" com args:`, JSON.stringify(args));
      const freshServer = await getServerById(serverRecord.id);
      return await executeGenericMcpProxy(freshServer, args.endpoint, args.method, args.body, args.queryParams, false, args.authProfileId);
    }
  );

  // Ferramenta 8: Chamar Endpoints em Lote
  mcp.tool(
    'chamar_endpoints_lote',
    `Executa uma lista de requisições HTTP de forma sequencial ou paralela (com concorrência limitada) permitindo a passagem inteligente de variáveis de respostas anteriores via sintaxe {{requestId}} ou {{requestId.data.campo}}.`,
    {
      requests: z.array(z.object({
        requestId: z.string().describe('ID único para identificar este passo no fluxo (ex: criar_cliente)'),
        endpoint: z.string().describe('Caminho da API (ex: /api/v1/User)'),
        method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).describe('Método HTTP'),
        body: z.record(z.string(), z.any()).optional().describe('Corpo da requisição'),
        queryParams: z.record(z.string(), z.any()).optional().describe('Query params'),
        authProfileId: z.string().optional().describe('ID opcional de perfil de autenticação para forçar')
      })).describe('Lista de requisições do lote'),
      stopOnError: z.boolean().optional().describe('Interromper todo o lote caso alguma requisição retorne erro (padrão: true)'),
      maxConcurrency: z.number().optional().describe('Concorrência máxima para processamento paralelo (padrão: 3). Caso use referências {{requestId}}, o lote rodará em concorrência 1 (sequencial) automaticamente.')
    },
    async (args) => {
      console.error(`[MCP Tool Executada] IA chamou "chamar_endpoints_lote" com ${args.requests.length} requisições.`);
      const stopOnError = args.stopOnError !== false;
      let maxConcurrency = args.maxConcurrency || 3;

      // Detectar se há dependências cruzadas (ex: {{criar_cliente.id}})
      const hasDependencies = args.requests.some(req => {
        const bodyStr = req.body ? JSON.stringify(req.body) : '';
        const queryStr = req.queryParams ? JSON.stringify(req.queryParams) : '';
        const endpointStr = req.endpoint || '';
        
        const hasDep = /\{\{([^$][^}]+)\}\}/.test(bodyStr) || 
                       /\{\{([^$][^}]+)\}\}/.test(queryStr) || 
                       /\{\{([^$][^}]+)\}\}/.test(endpointStr);
        return hasDep;
      });

      if (hasDependencies) {
        console.error(`[MCP Lote] Dependências detectadas. Forçando execução sequencial (maxConcurrency = 1)`);
        maxConcurrency = 1;
      }

      const results: any[] = [];
      const resultsMap = new Map<string, any>();

      // Helper para resolver placeholders
      function resolvePlaceholders(val: any): any {
        if (typeof val === 'string') {
          let resolved = val
            .replace(/\{\{\s*\$randomCPF\s*\}\}/g, () => generateRandomCPF())
            .replace(/\{\{\s*\$randomCNPJ\s*\}\}/g, () => generateRandomCNPJ())
            .replace(/\{\{\s*\$randomEmail\s*\}\}/g, () => generateRandomEmail())
            .replace(/\{\{\s*\$randomName\s*\}\}/g, () => generateRandomName())
            .replace(/\{\{\s*\$randomPhone\s*\}\}/g, () => generateRandomPhone())
            .replace(/\{\{\s*\$randomUUID\s*\}\}/g, () => generateRandomUUID());

          return resolved.replace(/\{\{([^}]+)\}\}/g, (match, pathStr) => {
            const trimmedPath = pathStr.trim();

            if (trimmedPath.startsWith('$random')) {
              return match;
            }

            const parts = trimmedPath.split('.');
            const sourceId = parts[0];

            if (!resultsMap.has(sourceId)) {
              throw new Error(`Placeholder de requisição inválido: "${sourceId}" não foi executada ainda no lote.`);
            }

            const sourceResult = resultsMap.get(sourceId);

            if (parts.length === 1) {
              if (sourceResult === null || sourceResult === undefined || typeof sourceResult !== 'object') {
                return String(sourceResult);
              }

              const exactIdKeys: string[] = [];
              const partialIdKeys: string[] = [];

              const scanKeys = (obj: any, prefix = '') => {
                if (!obj || typeof obj !== 'object') return;
                for (const key of Object.keys(obj)) {
                  const fullKey = prefix ? `${prefix}.${key}` : key;
                  if (key.toLowerCase() === 'id') {
                    exactIdKeys.push(fullKey);
                  } else if (/id/i.test(key)) {
                    partialIdKeys.push(fullKey);
                  }
                  if (typeof obj[key] === 'object' && !Array.isArray(obj[key]) && prefix === '') {
                    scanKeys(obj[key], key);
                  }
                }
              };

              scanKeys(sourceResult);

              if (exactIdKeys.length === 1 && exactIdKeys[0]) {
                let cur = sourceResult;
                const pathParts = exactIdKeys[0].split('.');
                for (const p of pathParts) {
                  cur = cur?.[p];
                }
                return String(cur);
              }

              if (exactIdKeys.length > 1) {
                throw new Error(`Ambiguidade de ID exato na resposta de "${sourceId}": Foram encontradas múltiplas propriedades "id" (${exactIdKeys.join(', ')}). Por favor, declare o caminho exato desejado.`);
              }

              if (partialIdKeys.length === 1 && partialIdKeys[0]) {
                let cur = sourceResult;
                const pathParts = partialIdKeys[0].split('.');
                for (const p of pathParts) {
                  cur = cur?.[p];
                }
                return String(cur);
              }

              if (partialIdKeys.length > 1) {
                throw new Error(`Ambiguidade de ID na resposta de "${sourceId}": Foram encontradas múltiplas propriedades que contêm "id" (${partialIdKeys.join(', ')}). Por favor, declare o caminho exato desejado (ex: {{${sourceId}.${partialIdKeys[0]}}}).`);
              }

              throw new Error(`Nenhum ID detectado automaticamente na resposta de "${sourceId}". Propriedades disponíveis: [${Object.keys(sourceResult).join(', ')}].`);
            }

            let current = sourceResult;
            for (let i = 1; i < parts.length; i++) {
              if (current === null || current === undefined) {
                throw new Error(`Caminho inválido "${trimmedPath}": propriedade "${parts[i]}" inexistente.`);
              }
              current = current[parts[i]];
            }

            return current !== undefined ? String(current) : match;
          });
        }

        if (Array.isArray(val)) {
          return val.map(resolvePlaceholders);
        }

        if (val && typeof val === 'object') {
          const res: any = {};
          for (const [k, v] of Object.entries(val)) {
            res[k] = resolvePlaceholders(v);
          }
          return res;
        }

        return val;
      }

      const freshServer = await getServerById(serverRecord.id);

      if (maxConcurrency === 1) {
        for (const req of args.requests) {
          try {
            const resolvedEndpoint = resolvePlaceholders(req.endpoint);
            const resolvedBody = req.body ? resolvePlaceholders(req.body) : undefined;
            const resolvedQuery = req.queryParams ? resolvePlaceholders(req.queryParams) : undefined;

            const res = await executeGenericMcpProxy(freshServer, resolvedEndpoint, req.method, resolvedBody, resolvedQuery, false, req.authProfileId);

            const isError = res.isError || (res.content && res.content[0] && res.content[0].text && /erro/i.test(res.content[0].text));
            let data: any = null;

            if (!isError && res.content && res.content[0]) {
              try {
                const text = res.content[0].text;
                const jsonText = text.replace(/^\[AVISO DO SERVIDOR MCP:[^\]]+\]\n\nResposta da API:\n/, '');
                data = JSON.parse(jsonText);
              } catch {
                data = res.content[0].text;
              }
            }

            results.push({
              requestId: req.requestId,
              status: isError ? 400 : 200,
              success: !isError,
              data: isError ? null : data,
              error: isError ? res.content?.[0]?.text || 'Erro desconhecido' : null
            });

            resultsMap.set(req.requestId, data);

            if (isError && stopOnError) {
              console.error(`[MCP Lote] Interrompendo lote por erro no passo "${req.requestId}"`);
              break;
            }
          } catch (err: any) {
            results.push({
              requestId: req.requestId,
              status: 500,
              success: false,
              data: null,
              error: err.message
            });
            if (stopOnError) break;
          }
        }
      } else {
        const chunks: typeof args.requests[] = [];
        for (let i = 0; i < args.requests.length; i += maxConcurrency) {
          chunks.push(args.requests.slice(i, i + maxConcurrency));
        }

        let stopExecution = false;

        for (const chunk of chunks) {
          if (stopExecution) break;

          const promises = chunk.map(async (req) => {
            try {
              const res = await executeGenericMcpProxy(freshServer, req.endpoint, req.method, req.body, req.queryParams, false, req.authProfileId);
              const isError = res.isError;
              let data: any = null;

              if (!isError && res.content && res.content[0]) {
                try {
                  data = JSON.parse(res.content[0].text);
                } catch {
                  data = res.content[0].text;
                }
              }

              return {
                requestId: req.requestId,
                status: isError ? 400 : 200,
                success: !isError,
                data: isError ? null : data,
                error: isError ? res.content?.[0]?.text || 'Erro de proxy' : null
              };
            } catch (err: any) {
              return {
                requestId: req.requestId,
                status: 500,
                success: false,
                data: null,
                error: err.message
              };
            }
          });

          const chunkResults = await Promise.all(promises);
          results.push(...chunkResults);

          for (const r of chunkResults) {
            if (!r.success) {
              resultsMap.set(r.requestId, null);
              if (stopOnError) {
                stopExecution = true;
              }
            } else {
              resultsMap.set(r.requestId, r.data);
            }
          }
        }
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
      };
    }
  );

  // Ferramenta 12: Teste de Carga / Estresse
  mcp.tool(
    'stress_test_endpoint',
    'Executa testes de concorrência controlada (estresse) contra um endpoint específico para medir tempos de resposta, resiliência do servidor e identificar race conditions.',
    {
      endpoint: z.string().describe('O caminho do endpoint para chamar. Ex: /api/v1/Assinatura'),
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).describe('O método HTTP'),
      body: z.record(z.string(), z.any()).optional().describe('JSON Payload para o body'),
      queryParams: z.record(z.string(), z.any()).optional().describe('Parâmetros de query string'),
      concurrency: z.number().optional().describe('Concorrência simultânea de requisições (padrão: 5, máximo: 20)'),
      count: z.number().optional().describe('Total de requisições a serem disparadas (padrão: 10, máximo: 50)'),
      authProfileId: z.string().optional().describe('ID do perfil de autenticação para as chamadas')
    },
    async (args) => {
      console.error(`[MCP Tool Executada] IA chamou "stress_test_endpoint" no endpoint ${args.endpoint}`);
      const freshServer = await getServerById(serverRecord.id);
      const concurrency = Math.min(args.concurrency || 5, 20);
      const total = Math.min(args.count || 10, 50);

      const durations: number[] = [];
      let successCount = 0;
      let failureCount = 0;
      const errorSummary = new Map<string, number>();

      const runRequest = async () => {
        const start = Date.now();
        try {
          const resolvedBody = args.body ? resolvePlaceholdersInObject(args.body) : undefined;
          const resolvedQuery = args.queryParams ? resolvePlaceholdersInObject(args.queryParams) : undefined;
          
          const res = await executeGenericMcpProxy(
            freshServer,
            args.endpoint,
            args.method,
            resolvedBody,
            resolvedQuery,
            false,
            args.authProfileId
          );
          const duration = Date.now() - start;
          durations.push(duration);

          const isError = res.isError || (res.content && res.content[0] && res.content[0].text && /erro/i.test(res.content[0].text));
          if (isError) {
            failureCount++;
            const errMsg = res.content?.[0]?.text?.substring(0, 100) || 'Erro desconhecido';
            errorSummary.set(errMsg, (errorSummary.get(errMsg) || 0) + 1);
          } else {
            successCount++;
          }
        } catch (err: any) {
          const duration = Date.now() - start;
          durations.push(duration);
          failureCount++;
          errorSummary.set(err.message, (errorSummary.get(err.message) || 0) + 1);
        }
      };

      function resolvePlaceholdersInObject(obj: any): any {
        if (typeof obj === 'string') {
          return obj
            .replace(/\{\{\s*\$randomCPF\s*\}\}/g, () => generateRandomCPF())
            .replace(/\{\{\s*\$randomCNPJ\s*\}\}/g, () => generateRandomCNPJ())
            .replace(/\{\{\s*\$randomEmail\s*\}\}/g, () => generateRandomEmail())
            .replace(/\{\{\s*\$randomName\s*\}\}/g, () => generateRandomName())
            .replace(/\{\{\s*\$randomPhone\s*\}\}/g, () => generateRandomPhone())
            .replace(/\{\{\s*\$randomUUID\s*\}\}/g, () => generateRandomUUID());
        }
        if (Array.isArray(obj)) return obj.map(resolvePlaceholdersInObject);
        if (obj && typeof obj === 'object') {
          const res: any = {};
          for (const [k, v] of Object.entries(obj)) {
            res[k] = resolvePlaceholdersInObject(v);
          }
          return res;
        }
        return obj;
      }

      for (let i = 0; i < total; i += concurrency) {
        const batch = [];
        for (let j = 0; j < concurrency && (i + j) < total; j++) {
          batch.push(runRequest());
        }
        await Promise.all(batch);
      }

      durations.sort((a, b) => a - b);
      const min = durations[0] || 0;
      const max = durations[durations.length - 1] || 0;
      const avg = durations.reduce((a, b) => a + b, 0) / (durations.length || 1);
      
      const getPercentile = (p: number) => {
        if (durations.length === 0) return 0;
        const index = Math.ceil((p / 100) * durations.length) - 1;
        return durations[index];
      };

      const report = {
        totalRequests: total,
        concurrency,
        successRate: `${((successCount / total) * 100).toFixed(1)}%`,
        successCount,
        failureCount,
        responseTimeMs: {
          min,
          max,
          avg: Math.round(avg),
          p50: getPercentile(50),
          p90: getPercentile(90),
          p99: getPercentile(99)
        },
        errorsBreakdown: Object.fromEntries(errorSummary.entries())
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(report, null, 2) }]
      };
    }
  );
}
