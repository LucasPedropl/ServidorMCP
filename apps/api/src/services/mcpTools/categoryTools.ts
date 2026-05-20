import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  getCategoriesByServerId,
  createCategory,
  updateCategory,
  deleteCategory
} from '../../repositories/mcpRepository.js';
import type { ServerRecord } from '../../repositories/mcpRepository.js';

export function registerCategoryTools(mcp: McpServer, serverRecord: ServerRecord) {
  // Ferramenta 0.5: Listar Categorias Cadastradas
  mcp.tool(
    'listar_categorias_api',
    `Retorna a lista de todas as categorias cadastradas na API do ${serverRecord.name}, incluindo instruções/prompts personalizados. Use esta ferramenta para descobrir quais módulos existem.`,
    {},
    async () => {
      console.error(`[MCP Tool Executada] IA chamou "listar_categorias_api"`);
      const categories = await getCategoriesByServerId(serverRecord.id);
      if (categories.length === 0) {
        return {
          content: [{ type: 'text', text: 'Nenhuma categoria cadastrada para este servidor.' }]
        };
      }
      const listagem = categories.map(c => `Nome: ${c.name}${c.custom_prompt ? `\nInstruções: ${c.custom_prompt}` : ''}\n-----------------------------------------`).join('\n\n');
      return {
        content: [{ type: 'text', text: `Categorias cadastradas:\n\n${listagem}` }]
      };
    }
  );

  // Ferramenta 6: Configurar Categoria
  mcp.tool(
    'configurar_mcp_categoria',
    `Permite criar, atualizar ou deletar categorias de ferramentas no servidor MCP.`,
    {
      action: z.enum(['create', 'update', 'delete']).describe('Ação a ser executada'),
      categoryId: z.string().optional().describe('ID da categoria (obrigatório para update e delete)'),
      name: z.string().optional().describe('Nome da categoria (obrigatório para create, opcional para update)'),
      customPrompt: z.string().optional().describe('Prompt/instruções personalizadas para a categoria')
    },
    async (args) => {
      console.error(`[MCP Tool Executada] IA chamou "configurar_mcp_categoria" com args:`, JSON.stringify(args));
      try {
        if (args.action === 'create') {
          if (!args.name) {
            throw new Error('O parâmetro "name" é obrigatório para a criação de categorias.');
          }
          const cat = await createCategory(serverRecord.id, args.name, args.customPrompt);
          return {
            content: [{ type: 'text', text: `Categoria "${cat.name}" criada com sucesso! ID: ${cat.id}` }]
          };
        }

        if (args.action === 'update') {
          if (!args.categoryId) {
            throw new Error('O parâmetro "categoryId" é obrigatório para a atualização.');
          }
          const updates: { name?: string; custom_prompt?: string | null } = {};
          if (args.name !== undefined) updates.name = args.name;
          if (args.customPrompt !== undefined) updates.custom_prompt = args.customPrompt ?? null;
          
          const cat = await updateCategory(args.categoryId, updates);
          return {
            content: [{ type: 'text', text: `Categoria "${cat.name}" (ID: ${cat.id}) atualizada com sucesso!` }]
          };
        }

        if (args.action === 'delete') {
          if (!args.categoryId) {
            throw new Error('O parâmetro "categoryId" é obrigatório para a exclusão.');
          }
          await deleteCategory(args.categoryId);
          return {
            content: [{ type: 'text', text: `Categoria (ID: ${args.categoryId}) removida com sucesso!` }]
          };
        }

        throw new Error('Ação inválida.');
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Erro: ${err.message}` }]
        };
      }
    }
  );
}
