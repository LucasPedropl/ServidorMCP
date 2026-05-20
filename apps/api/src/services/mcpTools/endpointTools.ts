import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  getToolsByServerId,
  getCategoriesByServerId,
  createCategory,
  updateToolConfig
} from '../../repositories/mcpRepository.js';
import type { ServerRecord, CategoryRecord, ToolRecord } from '../../repositories/mcpRepository.js';

export function registerEndpointTools(mcp: McpServer, serverRecord: ServerRecord) {
  // Ferramenta 1: Listar Rotas Resumidas (Visão de Catálogo Limpo com Filtros por Nome)
  mcp.tool(
    'listar_rotas_resumidas',
    `Retorna o catálogo de rotas da API do ${serverRecord.name}, organizado por categorias, com suporte a filtros opcionais de método HTTP e nome de categoria para economizar tokens.`,
    {
      category: z.string().optional().describe('Nome da categoria para filtrar as rotas (ex: Administrador ou WhatsApps)'),
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional().describe('Filtrar pelo verbo HTTP específico (ex: GET ou POST)')
    },
    async (args) => {
      console.error(`[MCP Tool Executada] IA chamou "listar_rotas_resumidas" com args:`, JSON.stringify(args));
      
      let tools = await getToolsByServerId(serverRecord.id);
      const categories = await getCategoriesByServerId(serverRecord.id);

      // Aplicar filtros
      if (args.method) {
        tools = tools.filter(t => t.http_method.toUpperCase() === args.method!.toUpperCase());
      }
      
      let matchedCategory: CategoryRecord | undefined = undefined;
      if (args.category) {
        matchedCategory = categories.find(cat => cat.name.toLowerCase() === args.category!.toLowerCase());
        if (matchedCategory) {
          tools = tools.filter(t => t.category_id === matchedCategory!.id);
        } else if (args.category.toLowerCase() === 'outros' || args.category.toLowerCase() === 'none') {
          tools = tools.filter(t => !t.category_id);
        } else {
          tools = [];
        }
      }

      const catMap = new Map<string, CategoryRecord>();
      for (const cat of categories) {
        catMap.set(cat.id, cat);
      }

      const grupos = new Map<string, ToolRecord[]>();
      const semCategoria: ToolRecord[] = [];

      for (const t of tools) {
        if (t.category_id && catMap.has(t.category_id)) {
          const list = grupos.get(t.category_id) || [];
          list.push(t);
          grupos.set(t.category_id, list);
        } else {
          semCategoria.push(t);
        }
      }

      let sumario = `Catálogo Resumido da API - Total de rotas filtradas: ${tools.length}\n\n`;

      for (const cat of categories) {
        if (args.category && cat.id !== matchedCategory?.id) continue;
        const catTools = grupos.get(cat.id) || [];
        if (catTools.length === 0) continue;

        sumario += `=========================================\n`;
        sumario += `📂 CATEGORIA: ${cat.name}\n`;
        if (cat.custom_prompt) {
          sumario += `📝 INSTRUÇÕES DA CATEGORIA: ${cat.custom_prompt}\n`;
        }
        sumario += `=========================================\n\n`;

        const rotas = catTools.map(t => {
          return `[${t.http_method.toUpperCase()}] ${t.endpoint_path} - ${t.custom_description || 'Sem descrição'}`;
        });

        sumario += rotas.join('\n') + `\n\n\n`;
      }

      if (semCategoria.length > 0 && (!args.category || args.category.toLowerCase() === 'outros' || args.category.toLowerCase() === 'none')) {
        sumario += `=========================================\n`;
        sumario += `📂 CATEGORIA: Outros / Não Categorizados\n`;
        sumario += `=========================================\n\n`;

        const rotas = semCategoria.map(t => {
          return `[${t.http_method.toUpperCase()}] ${t.endpoint_path} - ${t.custom_description || 'Sem descrição'}`;
        });

        sumario += rotas.join('\n') + `\n\n`;
      }

      return {
        content: [
          {
            type: 'text',
            text: sumario,
          },
        ],
      };
    }
  );

  // Ferramenta 1.5: Detalhar Endpoint Específico (Inspeção Profunda)
  mcp.tool(
    'detalhar_endpoint_api',
    `Retorna o contrato detalhado (JSON Schema, campos obrigatórios, contentType e parâmetros) de um endpoint específico da API do ${serverRecord.name}. Use isso após escolher a rota no listar_rotas_resumidas para saber exatamente quais campos enviar no chamar_api_dinamica.`,
    {
      endpoint: z.string().describe('O caminho exato ou base do endpoint para inspecionar. Ex: /api/v1/Plano ou /api/v1/Empresa'),
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).describe('O verbo HTTP do endpoint.')
    },
    async (args) => {
      console.error(`[MCP Tool Executada] IA chamou "detalhar_endpoint_api" para [${args.method}] ${args.endpoint}`);
      const tools = await getToolsByServerId(serverRecord.id);
      
      const cleanTarget = args.endpoint.replace(/\{[^}]+\}/g, '').replace(/\/+$/, '');
      const matched = tools.find(t => {
        if (t.http_method.toUpperCase() !== args.method.toUpperCase()) return false;
        if (t.endpoint_path === args.endpoint) return true;
        const cleanPath = t.endpoint_path.replace(/\{[^}]+\}/g, '').replace(/\/+$/, '');
        return cleanPath === cleanTarget || t.endpoint_path.includes(cleanTarget) || cleanTarget.includes(cleanPath);
      });

      if (!matched) {
        const rotasDoMetodo = tools.filter(t => t.http_method.toUpperCase() === args.method.toUpperCase()).map(t => t.endpoint_path);
        return {
          content: [{
            type: 'text',
            text: `Endpoint "[${args.method}] ${args.endpoint}" não encontrado.\nRotas disponíveis para o método ${args.method}:\n${rotasDoMetodo.join('\n')}`
          }]
        };
      }

      const detalhes = `Detalhes do Endpoint: [${matched.http_method.toUpperCase()}] ${matched.endpoint_path}\n` +
        `Descrição: ${matched.custom_description || 'Sem descrição'}\n` +
        `ContentType Esperado: ${matched.parameters_schema?.contentType || 'application/json'}\n\n` +
        `Schema de Parâmetros e Body:\n${JSON.stringify(matched.parameters_schema || {}, null, 2)}`;

      return {
        content: [{ type: 'text', text: detalhes }]
      };
    }
  );

  // Ferramenta 7: Configurar Endpoint
  mcp.tool(
    'configurar_mcp_endpoint',
    `Permite atualizar o prompt/descrição, categorias associadas (múltiplas) e perfil de autenticação padrão de um endpoint específico.`,
    {
      endpoint: z.string().describe('O caminho do endpoint (ex: /api/v1/User)'),
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).describe('O método HTTP do endpoint'),
      customName: z.string().optional().describe('Novo nome amigável para a ferramenta'),
      customDescription: z.string().optional().describe('Novo prompt/descrição explicativa para a ferramenta'),
      categoryIds: z.array(z.string()).optional().describe('Array com os IDs de categorias às quais associar o endpoint. Mande array vazio para desassociar tudo.'),
      categoryNames: z.array(z.string()).optional().describe('Array com os Nomes das categorias às quais associar o endpoint. Caso alguma categoria não exista pelo nome, ela será criada automaticamente.'),
      authProfileId: z.string().optional().describe('ID do perfil de autenticação necessário para o endpoint (ou "none" para público)'),
      contentType: z.string().optional().describe('Content-Type esperado pelo endpoint (ex: application/json, multipart/form-data, application/x-www-form-urlencoded)')
    },
    async (args) => {
      console.error(`[MCP Tool Executada] IA chamou "configurar_mcp_endpoint" com args:`, JSON.stringify(args));
      try {
        const tools = await getToolsByServerId(serverRecord.id);
        const matched = tools.find(t => t.endpoint_path === args.endpoint && t.http_method.toUpperCase() === args.method.toUpperCase());
        if (!matched) {
          throw new Error(`Endpoint [${args.method}] ${args.endpoint} não encontrado neste servidor.`);
        }

        const updates: any = {};
        if (args.customName !== undefined) updates.custom_name = args.customName;
        if (args.customDescription !== undefined) updates.custom_description = args.customDescription;
        if (args.contentType !== undefined) updates.contentType = args.contentType;
        
        const finalCategoryIds: string[] = args.categoryIds ? [...args.categoryIds] : [];

        if (args.categoryNames && args.categoryNames.length > 0) {
          const existingCategories = await getCategoriesByServerId(serverRecord.id);
          for (const catName of args.categoryNames) {
            const trimmedName = catName.trim();
            if (!trimmedName) continue;
            
            const matchedCat = existingCategories.find(c => c.name.toLowerCase() === trimmedName.toLowerCase());
            if (matchedCat) {
              if (!finalCategoryIds.includes(matchedCat.id)) {
                finalCategoryIds.push(matchedCat.id);
              }
            } else {
              console.error(`[MCP Tool configurar_mcp_endpoint] Criando categoria inexistente pelo nome: "${trimmedName}"`);
              const newCat = await createCategory(serverRecord.id, trimmedName);
              finalCategoryIds.push(newCat.id);
            }
          }
        }

        if (args.categoryIds !== undefined || args.categoryNames !== undefined) {
          updates.category_ids = finalCategoryIds;
          updates.category_id = finalCategoryIds.length > 0 ? finalCategoryIds[0] : null;
        }

        if (args.authProfileId !== undefined) {
          updates.authRequirement = args.authProfileId === 'none' ? 'none' : [args.authProfileId];
        }

        await updateToolConfig(matched.id, updates);
        return {
          content: [{ type: 'text', text: `Endpoint [${args.method}] ${args.endpoint} configurado com sucesso!` }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Erro: ${err.message}` }]
        };
      }
    }
  );
}
