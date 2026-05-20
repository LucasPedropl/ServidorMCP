import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import crypto from 'crypto';
import {
  saveTestCase,
  deleteTestCase,
  getTestCases,
  getTestCaseByName,
  getSyncReports,
  getLatestPlaybook,
  savePlaybookVersion,
  getToolsByServerId
} from '../../repositories/mcpRepository.js';
import type { ServerRecord, TestCaseRecord } from '../../repositories/mcpRepository.js';
import { runTestCaseEngine } from '../testEngineService.js';
import { proxyLogs } from '../mcpProxyService.js';
import { runServerSyncService } from '../mcpSyncService.js';
import { serverTeardownRegistry } from '../teardownService.js';
import { webhookBins } from '../../index.js';
import {
  generateRandomCPF,
  generateRandomCNPJ,
  generateRandomEmail,
  generateRandomName,
  generateRandomPhone,
  generateRandomUUID
} from '../testEngineService.js';

export function registerTestTools(mcp: McpServer, serverRecord: ServerRecord) {
  // Ferramenta 3: Sincronizar Endpoints (Swagger Sync Autônomo)
  mcp.tool(
    'sincronizar_endpoints_api',
    `Sincroniza a lista de endpoints da API com a última versão do Swagger/OpenAPI do ${serverRecord.name}, cadastrando novas rotas e gerando um relatório de mudanças (Changelog). Use isso para atualizar a API de forma autônoma.`,
    {},
    async () => {
      console.error(`[MCP Tool Executada] IA chamou "sincronizar_endpoints_api"`);
      try {
        const report = await runServerSyncService(serverRecord.id);
        return {
          content: [{ type: 'text', text: report }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Erro ao sincronizar API: ${err.message}` }]
        };
      }
    }
  );

  // Ferramenta 4: Consultar Relatório de Sincronização
  mcp.tool(
    'consultar_relatorio_sincronizacao',
    `Consulta os relatórios de sincronização (Changelog) da API do ${serverRecord.name} para entender quais rotas foram adicionadas, modificadas ou removidas. Por padrão retorna o mais recente, mas você pode especificar o parâmetro 'limit' para ver o histórico dos últimos N relatórios.`,
    {
      limit: z.number().optional().describe('Número de relatórios antigos para buscar (padrão: 1, máximo: 10).')
    },
    async (args) => {
      console.error(`[MCP Tool Executada] IA chamou "consultar_relatorio_sincronizacao" com args:`, JSON.stringify(args));
      try {
        const count = args.limit ? Math.min(args.limit, 10) : 1;
        const reports = await getSyncReports(serverRecord.id, count);
        
        if (reports.length === 0) {
          return {
            content: [{ type: 'text', text: 'Nenhum relatório de sincronização encontrado para este servidor ainda.' }]
          };
        }

        if (reports.length === 1) {
          return {
            content: [{ type: 'text', text: reports[0]!.report_summary }]
          };
        }

        let fullText = `=== HISTÓRICO DOS ÚLTIMOS ${reports.length} RELATÓRIOS DE SINCRONIZAÇÃO ===\n\n`;
        reports.forEach((rep, idx) => {
          fullText += `[Relatório #${idx + 1} - Gerado em: ${new Date(rep.created_at).toLocaleString()}]\n`;
          fullText += `${rep.report_summary}\n`;
          fullText += `===================================================================\n\n`;
        });

        return {
          content: [{ type: 'text', text: fullText }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Erro ao consultar relatórios: ${err.message}` }]
        };
      }
    }
  );

  // Ferramenta 9: Consultar Guia de Fluxos (Playbook)
  mcp.tool(
    'consultar_guia_fluxos',
    `Retorna o Playbook (Guia de Fluxos Funcionais e Notas de Integração) atual para o servidor MCP do ${serverRecord.name}. Contém lições aprendidas e exemplos de fluxos descritos por outras IAs.`,
    {},
    async () => {
      console.error(`[MCP Tool Executada] IA chamou "consultar_guia_fluxos"`);
      try {
        const playbook = await getLatestPlaybook(serverRecord.id);
        return {
          content: [{
            type: 'text',
            text: playbook || 'Nenhum guia de fluxo (Playbook) foi escrito para este servidor ainda. Sinta-se livre para iniciar e escrever o primeiro playbook usando atualizar_guia_fluxos para orientar futuras IAs.'
          }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Erro ao buscar playbook: ${err.message}` }]
        };
      }
    }
  );

  // Ferramenta 10: Atualizar Guia de Fluxos (Playbook)
  mcp.tool(
    'atualizar_guia_fluxos',
    `Permite atualizar o Playbook (Guia de Integração e Lições Aprendidas) de IAs para a API do ${serverRecord.name}. A atualização criará uma nova versão versionada no banco, salvando as dicas funcionais, tratamentos de bugs e exemplos de lote.`,
    {
      content: z.string().describe('Conteúdo completo em formato Markdown contendo o Playbook de Integração da API atualizado.')
    },
    async (args) => {
      console.error(`[MCP Tool Executada] IA chamou "atualizar_guia_fluxos"`);
      try {
        await savePlaybookVersion(serverRecord.id, args.content, 'ai');
        return {
          content: [{ type: 'text', text: `Playbook de Integração da API atualizado e versionado com sucesso!` }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Erro ao atualizar playbook: ${err.message}` }]
        };
      }
    }
  );

  // Ferramenta 10.5: Adicionar Nota ao Playbook (Playbook Append)
  mcp.tool(
    'adicionar_nota_playbook',
    `Permite adicionar uma nova nota, dica ou lição aprendida incremental no final do Playbook da API do ${serverRecord.name}, sem risco de apagar ou sobrescrever o conteúdo histórico existente.`,
    {
      title: z.string().describe('Título curto da nova seção/dica a ser adicionada (ex: "Tratamento de ID na Assinatura")'),
      content: z.string().describe('Conteúdo textual em formato Markdown contendo a lição aprendida, exemplo de payload ou dica de integração.')
    },
    async (args) => {
      console.error(`[MCP Tool Executada] IA chamou "adicionar_nota_playbook"`);
      try {
        const currentPlaybook = await getLatestPlaybook(serverRecord.id) || '';
        const timestamp = new Date().toLocaleDateString('pt-BR');
        
        let newContent = currentPlaybook.trim();
        if (newContent) {
          newContent += '\n\n';
        }
        newContent += `## ${args.title} (${timestamp})\n${args.content}\n`;
        
        await savePlaybookVersion(serverRecord.id, newContent, 'ai');
        return {
          content: [{ type: 'text', text: `Nota "${args.title}" adicionada com sucesso no final do Playbook!` }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Erro ao adicionar nota ao playbook: ${err.message}` }]
        };
      }
    }
  );

  // Ferramenta 11: Gerar Dados de Teste
  mcp.tool(
    'gerar_dados_teste',
    'Gera dados cadastrais válidos e dinâmicos para testes, como CPF ou CNPJ válidos (com cálculo correto de dígitos verificadores) para evitar erros de validação da API.',
    {
      cpf: z.boolean().optional().describe('Gera um CPF válido'),
      cnpj: z.boolean().optional().describe('Gera um CNPJ válido'),
      email: z.boolean().optional().describe('Gera um e-mail randômico único'),
      name: z.boolean().optional().describe('Gera um nome completo brasileiro'),
      phone: z.boolean().optional().describe('Gera um número de celular brasileiro no formato DDD + 9 dígitos'),
      uuid: z.boolean().optional().describe('Gera um UUID v4')
    },
    async (args) => {
      console.error(`[MCP Tool Executada] IA chamou "gerar_dados_teste"`);
      const response: any = {};
      if (args.cpf) response.cpf = generateRandomCPF();
      if (args.cnpj) response.cnpj = generateRandomCNPJ();
      if (args.email) response.email = generateRandomEmail();
      if (args.name) response.name = generateRandomName();
      if (args.phone) response.phone = generateRandomPhone();
      if (args.uuid) response.uuid = generateRandomUUID();
      
      if (Object.keys(response).length === 0) {
        response.nome = generateRandomName();
        response.email = generateRandomEmail();
        response.cpf = generateRandomCPF();
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
      };
    }
  );

  // Ferramenta 13: Salvar Caso de Teste
  mcp.tool(
    'salvar_caso_teste',
    'Cria ou atualiza um fluxo/caso de teste de regressão persistido no banco de dados. O caso de teste executa uma lista ordenada de passos de chamadas de endpoint.',
    {
      name: z.string().describe('Nome único do caso de teste (ex: Fluxo_Cadastro_Empresa)'),
      description: z.string().optional().describe('Descrição do propósito do caso de teste'),
      steps: z.array(z.object({
        requestId: z.string().describe('Identificador único do passo dentro do caso de teste (ex: criar_empresa)'),
        endpoint: z.string().describe('Endpoint a ser chamado (pode incluir placeholders {{passo_anterior.campo}} ou {{$randomCPF}})'),
        method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).describe('Método HTTP'),
        body: z.record(z.string(), z.any()).optional().describe('Payload opcional para o body'),
        queryParams: z.record(z.string(), z.any()).optional().describe('Parâmetros de query string opcionais'),
        authProfileId: z.string().optional().describe('ID do perfil de autenticação para este passo'),
        assertions: z.array(z.object({
          path: z.string().describe('Caminho JSONPath do campo (ex: $.data.status)'),
          operator: z.enum(['eq', 'neq', 'contains', 'not_null']).describe('Operador de comparação'),
          value: z.any().optional().describe('Valor esperado (opcional)')
        })).optional().describe('Asserções de validação opcionais')
      })).describe('Array ordenado de chamadas HTTP'),
      variablesSchema: z.record(z.string(), z.any()).optional().describe('Dicionário de variáveis padrão e seus valores')
    },
    async (args) => {
      console.error(`[MCP Tool Executada] IA chamou "salvar_caso_teste" para "${args.name}"`);
      try {
        const testCase = await saveTestCase(serverRecord.id, {
          name: args.name,
          description: args.description || null,
          steps: args.steps,
          variables_schema: args.variablesSchema || {}
        });

        return {
          content: [{ type: 'text', text: `Caso de teste "${testCase.name}" persistido com sucesso! ID: ${testCase.id}` }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Erro ao salvar caso de teste: ${err.message}` }]
        };
      }
    }
  );

  // Ferramenta 14: Listar Casos de Teste
  mcp.tool(
    'listar_casos_teste',
    'Retorna todos os casos de teste salvos para este servidor no banco de dados, incluindo a data e status da última execução.',
    {},
    async () => {
      console.error(`[MCP Tool Executada] IA chamou "listar_casos_teste"`);
      try {
        const testCases = await getTestCases(serverRecord.id);
        if (testCases.length === 0) {
          return {
            content: [{ type: 'text', text: 'Nenhum caso de teste cadastrado para este servidor.' }]
          };
        }

        const list = testCases.map(tc => {
          return `- **Nome**: ${tc.name}\n  Descrição: ${tc.description || 'Sem descrição'}\n  Passos: ${tc.steps.length}\n  Último Status: ${tc.last_run_status || 'Nunca executado'}\n  Última Rodada: ${tc.last_run_at ? new Date(tc.last_run_at).toLocaleString() : 'N/A'}`;
        }).join('\n\n');

        return {
          content: [{ type: 'text', text: `Casos de Teste cadastrados:\n\n${list}` }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Erro ao listar casos de teste: ${err.message}` }]
        };
      }
    }
  );

  // Ferramenta 15: Deletar Caso de Teste
  mcp.tool(
    'deletar_caso_teste',
    'Exclui um caso de teste pelo nome ou pelo ID.',
    {
      nameOrId: z.string().describe('Nome ou ID do caso de teste a ser removido')
    },
    async (args) => {
      console.error(`[MCP Tool Executada] IA chamou "deletar_caso_teste" para: ${args.nameOrId}`);
      try {
        await deleteTestCase(serverRecord.id, args.nameOrId);
        return {
          content: [{ type: 'text', text: `Caso de teste deletado com sucesso.` }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Erro ao deletar caso de teste: ${err.message}` }]
        };
      }
    }
  );

  // Ferramenta 16: Executar Caso de Teste
  mcp.tool(
    'executar_caso_teste',
    'Executa um caso de teste salvo, resolvendo placeholders de dados dinamicamente, salvando o histórico da execução e retornando os dados finais.',
    {
      nameOrId: z.string().describe('Nome ou ID do caso de teste a ser executado'),
      variablesOverride: z.record(z.string(), z.any()).optional().describe('Valores de variáveis para sobrescrever as padrão do caso de teste')
    },
    async (args) => {
      console.error(`[MCP Tool Executada] IA chamou "executar_caso_teste" para: ${args.nameOrId}`);
      try {
        let testCase: TestCaseRecord | null = null;
        if (args.nameOrId.match(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/)) {
          const cases = await getTestCases(serverRecord.id);
          testCase = cases.find(c => c.id === args.nameOrId) || null;
        } else {
          testCase = await getTestCaseByName(serverRecord.id, args.nameOrId);
        }

        if (!testCase) {
          return {
            content: [{ type: 'text', text: `Caso de teste "${args.nameOrId}" não encontrado.` }]
          };
        }

        const runResult = await runTestCaseEngine(serverRecord.id, testCase.id, args.variablesOverride);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              testCaseId: testCase.id,
              name: testCase.name,
              status: runResult.status,
              durationMs: runResult.durationMs,
              steps: runResult.results
            }, null, 2)
          }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Erro na execucao do caso de teste: ${err.message}` }]
        };
      }
    }
  );

  // Ferramenta 17: Cobertura de Testes
  mcp.tool(
    'gerar_relatorio_cobertura',
    'Retorna um relatório de cobertura de testes da API, mostrando quais endpoints já possuem casos de teste salvos associados e quais estão órfãos (não testados).',
    {},
    async () => {
      console.error(`[MCP Tool Executada] IA chamou "gerar_relatorio_cobertura"`);
      try {
        const tools = await getToolsByServerId(serverRecord.id);
        const testCases = await getTestCases(serverRecord.id);

        if (tools.length === 0) {
          return {
            content: [{ type: 'text', text: 'Nenhum endpoint cadastrado para esta API.' }]
          };
        }

        const covered = new Set<string>();
        
        for (const tc of testCases) {
          for (const step of tc.steps) {
            const method = step.method.toUpperCase();
            let pathNormalized = step.endpoint.split('?')[0];
            pathNormalized = pathNormalized.replace(/\{\{([^}]+)\}\}/g, '{$1}');
            covered.add(`${method} ${pathNormalized}`);
          }
        }

        const totalCount = tools.length;
        const missingList: string[] = [];
        let coveredCount = 0;

        for (const t of tools) {
          const method = t.http_method.toUpperCase();
          const path = t.endpoint_path;
          const identifier = `${method} ${path}`;

          let isCovered = false;
          if (covered.has(identifier)) {
            isCovered = true;
          } else {
            const pathRegexStr = '^' + path.replace(/\{[^}]+\}/g, '[^/]+') + '$';
            const pathRegex = new RegExp(pathRegexStr, 'i');
            
            for (const cov of covered) {
              const [covMethod, covPath] = cov.split(' ');
              if (covMethod === method && covPath && pathRegex.test(covPath)) {
                isCovered = true;
                break;
              }
            }
          }

          if (isCovered) {
            coveredCount++;
          } else {
            missingList.push(`- **${method}** ${path} (${t.custom_name || 'Sem nome'})`);
          }
        }

        const coveragePercent = totalCount > 0 ? (coveredCount / totalCount) * 100 : 0;

        const reportText = [
          `# Relatório de Cobertura de Testes da API`,
          `**Total de Endpoints**: ${totalCount}`,
          `**Endpoints Testados**: ${coveredCount}`,
          `**Porcentagem de Cobertura**: ${coveragePercent.toFixed(1)}%`,
          `\n## Endpoints Não Cobertos (${missingList.length}):`,
          missingList.length > 0 ? missingList.join('\n') : '🎉 Todos os endpoints possuem cobertura de teste!'
        ].join('\n');

        return {
          content: [{ type: 'text', text: reportText }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Erro ao gerar relatorio de cobertura: ${err.message}` }]
        };
      }
    }
  );

  // Ferramenta 19: Registrar Entidade Teardown (Coletor de Lixo)
  mcp.tool(
    'registrar_entidade_teardown',
    'Registra um endpoint e método de exclusão (ex: DELETE /api/v1/Usuarios/123) para remoção automática ao encerrar a conexão/sessão SSE ativa, mantendo o banco livre de sujeira de testes avulsos.',
    {
      endpoint: z.string().describe('O caminho relativo do recurso. Ex: /api/v1/Usuarios/123'),
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional().default('DELETE').describe('Método HTTP de exclusão (geralmente DELETE)'),
      authProfileId: z.string().optional().describe('ID opcional de perfil de autenticação para forçar no delete')
    },
    async (args) => {
      console.error(`[MCP Tool Executada] IA chamou "registrar_entidade_teardown" para ${args.method || 'DELETE'} ${args.endpoint}`);
      try {
        if (!serverTeardownRegistry.has(serverRecord.id)) {
          serverTeardownRegistry.set(serverRecord.id, []);
        }
        const cleanupItem: { endpoint: string; method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'; authProfileId?: string } = {
          endpoint: args.endpoint,
          method: args.method || 'DELETE'
        };
        if (args.authProfileId !== undefined) {
          cleanupItem.authProfileId = args.authProfileId;
        }
        serverTeardownRegistry.get(serverRecord.id)!.push(cleanupItem);
        return {
          content: [{
            type: 'text',
            text: `Entidade registrada para remoção automática na desconexão: ${args.method || 'DELETE'} ${args.endpoint}`
          }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Erro ao registrar teardown: ${err.message}` }]
        };
      }
    }
  );

  // Ferramenta 20: Criar Webhook Bin
  mcp.tool(
    'criar_webhook_bin',
    'Gera uma URL única de Webhook temporária para testes assíncronos. Retorna a URL pública/local para ser enviada na chamada HTTP da API testada.',
    {},
    async () => {
      console.error(`[MCP Tool Executada] IA chamou "criar_webhook_bin"`);
      try {
        const binId = crypto.randomUUID();
        webhookBins.set(binId, []);
        const port = process.env.PORT || 3001;
        const baseUrl = process.env.NEXT_PUBLIC_API_URL || `http://localhost:${port}`;
        const webhookUrl = `${baseUrl.replace(/\/$/, '')}/api/v1/webhook-bin/${binId}`;
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ binId, webhookUrl }, null, 2)
          }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Erro ao criar webhook bin: ${err.message}` }]
        };
      }
    }
  );

  // Ferramenta 21: Inspecionar Webhook Bin
  mcp.tool(
    'inspecionar_webhook_bin',
    'Consulta a lista de payloads recebidos no Webhook Bin especificado (útil para auditoria/polling após chamadas assíncronas).',
    {
      binId: z.string().describe('ID do webhook bin gerado anteriormente')
    },
    async (args) => {
      console.error(`[MCP Tool Executada] IA chamou "inspecionar_webhook_bin" para o bin: ${args.binId}`);
      try {
        const payloads = webhookBins.get(args.binId) || [];
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ binId: args.binId, count: payloads.length, webhooks: payloads }, null, 2)
          }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Erro ao inspecionar webhook bin: ${err.message}` }]
        };
      }
    }
  );

  // Ferramenta 22: Inspecionar Últimas Chamadas Proxy
  mcp.tool(
    'inspecionar_ultima_chamada',
    'Retorna os detalhes técnicos brutos (request headers, request body, status code, response headers, response body) das últimas requisições HTTP processadas pelo proxy MCP nesta sessão (padrão: 3 requisições). Útil para depurar erros de cabeçalhos e payloads.',
    {
      limit: z.number().optional().describe('Quantidade de requisições recentes a retornar (padrão 3, máximo 10)')
    },
    async (args) => {
      console.error(`[MCP Tool Executada] IA chamou "inspecionar_ultima_chamada" com limit: ${args.limit}`);
      const limit = args.limit || 3;
      const logs = proxyLogs.slice(0, Math.min(limit, 10));
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ count: logs.length, logs }, null, 2)
        }]
      };
    }
  );

  // Ferramenta 23: Salvar Fluxo Recente (Modo Gravação)
  mcp.tool(
    'salvar_fluxo_recente',
    'Analisa as últimas requisições de proxy bem-sucedidas nesta sessão e cria um Caso de Teste estruturado de regressão, convertendo dinamicamente IDs de respostas anteriores em placeholders de dependência.',
    {
      name: z.string().describe('Nome único do caso de teste (ex: Fluxo_Assinatura_Empresa)'),
      description: z.string().optional().describe('Descrição curta do propósito do teste'),
      limit: z.number().optional().describe('Número de requisições recentes a consolidar (padrão: 5, máximo 15)')
    },
    async (args) => {
      console.error(`[MCP Tool Executada] IA chamou "salvar_fluxo_recente" para o caso de teste: ${args.name}`);
      try {
        const limit = args.limit || 5;
        const successLogs = proxyLogs
          .filter(log => log.responseStatus < 400)
          .slice(0, Math.min(limit, 15))
          .reverse();

        if (successLogs.length === 0) {
          throw new Error('Nenhuma requisição de proxy bem-sucedida encontrada no histórico para gravação.');
        }

        const steps: any[] = [];
        const existingRequestIds = new Set<string>();
        const idMappings = new Map<any, string>();

        for (const log of successLogs) {
          const requestId = generateFriendlyRequestId(log.method, log.endpoint, existingRequestIds);

          let parameterizedEndpoint = log.endpoint;
          for (const [rawVal, placeholder] of idMappings.entries()) {
            if (typeof rawVal === 'string' && rawVal.trim().length > 0) {
              parameterizedEndpoint = parameterizedEndpoint.split(rawVal).join(placeholder);
            } else if (typeof rawVal === 'number') {
              parameterizedEndpoint = parameterizedEndpoint.split(`/${rawVal}`).join(`/${placeholder}`);
              parameterizedEndpoint = parameterizedEndpoint.split(`=${rawVal}`).join(`=${placeholder}`);
            }
          }

          const parameterizedBody = replaceValuesWithPlaceholders(log.requestBody, idMappings);
          const parameterizedQueryParams = replaceValuesWithPlaceholders(log.queryParams, idMappings);

          steps.push({
            requestId,
            endpoint: parameterizedEndpoint,
            method: log.method.toUpperCase(),
            body: parameterizedBody,
            queryParams: parameterizedQueryParams,
            authProfileId: log.authProfileId
          });

          if (log.responseBody && typeof log.responseBody === 'object') {
            const extractedIds = extractIdsFromResponse(log.responseBody);
            for (const { path, value } of extractedIds) {
              const placeholder = `{{${requestId}.${path}}}`;
              if (!idMappings.has(value)) {
                idMappings.set(value, placeholder);
                console.error(`[MCP Gravador] Mapeado valor ${value} para ${placeholder}`);
              }
            }
          }
        }

        const testCase = {
          name: args.name,
          description: args.description || 'Fluxo gravado automaticamente a partir do histórico do proxy.',
          steps,
          variablesSchema: {}
        };

        await saveTestCase(serverRecord.id, testCase);

        return {
          content: [{
            type: 'text',
            text: `Caso de Teste "${args.name}" gravado e persistido com SUCESSO!\n\nPassos Consolidados (${steps.length}):\n${steps.map((s, idx) => `${idx + 1}. [${s.method}] ${s.endpoint} (ID: ${s.requestId}${s.authProfileId ? `, Perfil: ${s.authProfileId}` : ''})`).join('\n')}`
          }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Erro ao gravar fluxo recente: ${err.message}` }]
        };
      }
    }
  );
}

function generateFriendlyRequestId(method: string, endpoint: string, existingIds: Set<string>): string {
  const cleanEndpoint = (endpoint || '').split('?')[0] || '';
  const parts = cleanEndpoint.split('/').filter(Boolean);
  
  let resource = 'request';
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (!part) continue;
    const isId = /^\d+$/.test(part) || 
                 /^[0-9a-fA-F-]{8,}$/.test(part) || 
                 part.length > 20;
    if (!isId) {
      resource = part;
      break;
    }
  }

  let cleanResource = resource
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .toLowerCase();

  const methodPrefix = method.toUpperCase() === 'POST' ? 'criar_' :
                       method.toUpperCase() === 'GET' ? 'obter_' :
                       (method.toUpperCase() === 'PUT' || method.toUpperCase() === 'PATCH') ? 'atualizar_' :
                       method.toUpperCase() === 'DELETE' ? 'remover_' : 'chamada_';

  let baseId = `${methodPrefix}${cleanResource}`;
  if (baseId.endsWith('_')) {
    baseId = baseId.slice(0, -1);
  }

  let finalId = baseId;
  let counter = 2;
  while (existingIds.has(finalId)) {
    finalId = `${baseId}_${counter}`;
    counter++;
  }

  existingIds.add(finalId);
  return finalId;
}

function replaceValuesWithPlaceholders(obj: any, mappings: Map<any, string>): any {
  if (obj === null || obj === undefined) return obj;
  
  if (typeof obj === 'string') {
    let resolved = obj;
    for (const [rawVal, placeholder] of mappings.entries()) {
      if (typeof rawVal === 'string' && rawVal.trim().length > 0) {
        resolved = resolved.split(rawVal).join(placeholder);
      } else if (typeof rawVal === 'number') {
        if (resolved === String(rawVal)) {
          return placeholder;
        }
      }
    }
    return resolved;
  }
  
  if (typeof obj === 'number') {
    if (mappings.has(obj)) {
      return mappings.get(obj);
    }
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => replaceValuesWithPlaceholders(item, mappings));
  }
  
  if (typeof obj === 'object') {
    const newObj: any = {};
    for (const [key, value] of Object.entries(obj)) {
      newObj[key] = replaceValuesWithPlaceholders(value, mappings);
    }
    return newObj;
  }
  
  return obj;
}

function extractIdsFromResponse(obj: any, parentPath = ''): Array<{ path: string; value: string | number }> {
  const ids: Array<{ path: string; value: string | number }> = [];
  if (!obj || typeof obj !== 'object') return ids;

  for (const [key, val] of Object.entries(obj)) {
    const currentPath = parentPath ? `${parentPath}.${key}` : key;
    if (val === null || val === undefined) continue;

    if (typeof val === 'object') {
      ids.push(...extractIdsFromResponse(val, currentPath));
    } else if (typeof val === 'string' || typeof val === 'number') {
      const isIdKey = key.toLowerCase() === 'id' || 
                      key.toLowerCase() === 'uuid' || 
                      key.toLowerCase() === 'code' || 
                      key.toLowerCase().endsWith('id') || 
                      key.toLowerCase().endsWith('_id');
      
      if (isIdKey) {
        if (typeof val === 'string' && val.trim().length === 0) continue;
        ids.push({ path: currentPath, value: val });
      }
    }
  }

  return ids;
}
