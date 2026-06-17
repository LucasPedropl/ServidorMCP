import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getServerById } from '../repositories/mcpRepository.js';
import type { ServerRecord } from '../repositories/mcpRepository.js';

// Importa funções de registro modulares das ferramentas
import { registerCategoryTools } from './mcpTools/categoryTools.js';
import { registerEndpointTools } from './mcpTools/endpointTools.js';
import { registerExecutionTools } from './mcpTools/executionTools.js';
import { registerAuthTools } from './mcpTools/authTools.js';
import { registerTestTools } from './mcpTools/testTools.js';
import { registerProjectTools } from './mcpTools/projectTools.js';

// Exportações das funções utilitárias do motor de testes e geradores (para compatibilidade e uso externo)
export {
  generateRandomCPF,
  generateRandomCNPJ,
  generateRandomEmail,
  generateRandomName,
  generateRandomPhone,
  generateRandomUUID,
  getValueByPath,
  evaluateAssertion,
  runTestCaseEngine
} from './testEngineService.js';

// Re-exporta teardown global
export { serverTeardownRegistry, executeServerTeardown } from './teardownService.js';

export async function createMcpServerInstance(targetServerId?: string): Promise<{ mcpServer: McpServer; serverRecord: ServerRecord | null }> {
  let serverRecord: ServerRecord | null = null;

  if (targetServerId) {
    serverRecord = await getServerById(targetServerId);
  }

  if (!serverRecord) {
    const mcp = new McpServer({
      name: 'MCP_Generator_Welcome_Server',
      version: '1.0.0',
    });

    mcp.tool(
      'verificar_status_mcp',
      'Retorna o status atual do gerador MCP e instrucoes de como conectar uma API OpenAPI/Swagger',
      {},
      async () => {
        return {
          content: [
            {
              type: 'text',
              text: 'Nenhum servidor OpenAPI conectado ainda. Acesse o painel web em http://localhost:3000, insira a URL do seu arquivo swagger.json e clique em "Salvar Servidor MCP". Em seguida, reinicie o MCP Core.',
            },
          ],
        };
      }
    );

    return { mcpServer: mcp, serverRecord: null };
  }

  const mcp = new McpServer({
    name: serverRecord.name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 64) || 'MCP_Server',
    version: '1.0.0',
  });

  // Registra as ferramentas modularizadas
  registerCategoryTools(mcp, serverRecord);
  registerEndpointTools(mcp, serverRecord);
  registerExecutionTools(mcp, serverRecord);
  registerAuthTools(mcp, serverRecord);
  registerTestTools(mcp, serverRecord);
  registerProjectTools(mcp, serverRecord);

  return { mcpServer: mcp, serverRecord };
}

export async function startMcpEngine(targetServerId?: string) {
  console.error('[MCP Engine] Inicializando motor de busca de servidores...');

  const { mcpServer, serverRecord } = await createMcpServerInstance(targetServerId);

  if (!serverRecord) {
    console.error('[MCP Engine AVISO] Nenhum servidor MCP configurado no banco Supabase ainda.');
    console.error('[MCP Engine] Inicializando Servidor MCP de Boas-Vindas (Welcome Server) no modo Stdio...');
    console.error('[MCP Engine] Conectando transporte Stdio (Modo Boas-Vindas)...');
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    console.error('[MCP Engine] Servidor de Boas-Vindas rodando perfeitamente no Stdio. Acesse http://localhost:3000 no navegador para cadastrar sua API!');
    return;
  }

  console.error(`[MCP Engine] Servidor "${serverRecord.name}" identificado. Inicializando SDK...`);
  console.error('[MCP Engine] Conectando transporte Stdio...');
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  console.error(`[MCP Engine] Servidor "${serverRecord.name}" rodando perfeitamente no Stdio com suporte a categorias dinâmicas.`);
}
