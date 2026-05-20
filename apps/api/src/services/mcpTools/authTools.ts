import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { updateServerCredentials } from '../../repositories/mcpRepository.js';
import type { ServerRecord } from '../../repositories/mcpRepository.js';
import { globalSessionHeaders, clearProxyTokenCache } from '../mcpProxyService.js';

export function registerAuthTools(mcp: McpServer, serverRecord: ServerRecord) {
  // Ferramenta 5: Listar Perfis de Autenticação
  mcp.tool(
    'listar_perfis_autenticacao',
    `Retorna todos os perfis de autenticação cadastrados no servidor (nome e ID). Use para saber quais IDs de perfis você pode forçar/configurar nos endpoints.`,
    {},
    async () => {
      console.error(`[MCP Tool Executada] IA chamou "listar_perfis_autenticacao"`);
      const creds = serverRecord.auth_credentials;
      const profiles = creds?.profiles && Array.isArray(creds.profiles) ? creds.profiles : [];
      if (profiles.length === 0) {
        return {
          content: [{ type: 'text', text: 'Nenum perfil de autenticação configurado para este servidor.' }]
        };
      }
      const listagem = profiles.map((p: any) => `Nome: ${p.name}\nID: ${p.id}\n-----------------------------------------`).join('\n\n');
      return {
        content: [{ type: 'text', text: `Perfis de autenticação disponíveis:\n\n${listagem}` }]
      };
    }
  );

  // Ferramenta 7.5: Atualizar Perfil de Autenticação (Session Manager)
  mcp.tool(
    'atualizar_perfil_autenticacao',
    'Cadastra ou atualiza um perfil de autenticação para auto-login (ex: Admin, Cliente, etc.) no servidor MCP. Isso limpa o token em cache para forçar a renovação na próxima chamada proxy.',
    {
      profileId: z.string().describe('ID único do perfil (ex: "cliente", "estabelecimento")'),
      name: z.string().describe('Nome legível do perfil (ex: "Perfil Cliente E2E")'),
      loginEndpoint: z.string().describe('Endpoint relativo para fazer login (ex: "/api/v1/User/login-cliente")'),
      loginMethod: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional().describe('Método HTTP para a requisição de login (padrão: POST)'),
      loginPayload: z.record(z.string(), z.any()).describe('JSON contendo o payload de body para o login (ex: e-mail e senha de teste)'),
      tokenPath: z.string().optional().describe('Caminho no JSON da resposta contendo o token (ex: "token" ou "data.accessToken")'),
      tokenDurationMinutes: z.number().optional().describe('Duração em minutos do token antes de expirar (padrão: 60)')
    },
    async (args) => {
      console.error(`[MCP Tool Executada] IA chamou "atualizar_perfil_autenticacao" para o perfil: ${args.profileId}`);
      try {
        const creds = serverRecord.auth_credentials || {};
        const profiles: any[] = creds.profiles && Array.isArray(creds.profiles) ? [...creds.profiles] : [];

        const existingProfileIndex = profiles.findIndex((p: any) => p.id === args.profileId);
        const newProfile = {
          id: args.profileId,
          name: args.name,
          loginEndpoint: args.loginEndpoint,
          loginMethod: args.loginMethod || 'POST',
          loginPayload: args.loginPayload,
          tokenPath: args.tokenPath || 'token',
          tokenDurationMinutes: args.tokenDurationMinutes || 60,
          token: undefined
        };

        if (existingProfileIndex >= 0) {
          profiles[existingProfileIndex] = newProfile;
        } else {
          profiles.push(newProfile);
        }

        const newCreds = {
          ...creds,
          authMode: 'auto_login',
          profiles
        };

        await updateServerCredentials(serverRecord.id, 'dashboard_login', newCreds);
        clearProxyTokenCache(serverRecord.id, args.profileId);

        return {
          content: [{
            type: 'text',
            text: `Perfil de Autenticação "${args.name}" (ID: ${args.profileId}) cadastrado com SUCESSO!\nAutenticação do servidor atualizada para auto_login.`
          }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Erro ao cadastrar perfil: ${err.message}` }]
        };
      }
    }
  );

  // Ferramenta 18: Configurar Headers Globais
  mcp.tool(
    'configurar_headers_globais',
    'Permite registrar cabeçalhos (headers) HTTP globais na sessão atual (ex: X-Tenant-ID ou IDs de inquilinos). Esses cabeçalhos serão injetados de forma invisível em todas as requisições subsequentes do proxy MCP.',
    {
      headers: z.record(z.string(), z.string()).describe('Dicionário de cabeçalhos chave-valor')
    },
    async (args) => {
      console.error(`[MCP Tool Executada] IA chamou "configurar_headers_globais"`);
      try {
        globalSessionHeaders.set(serverRecord.id, args.headers);
        return {
          content: [{
            type: 'text',
            text: `Headers globais configurados com sucesso para o servidor: ${JSON.stringify(args.headers)}`
          }]
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Erro ao configurar headers globais: ${err.message}` }]
        };
      }
    }
  );
}
