import { z } from 'zod';

export const mcpServerSchema = z.object({
  id: z.string().uuid(),
  created_at: z.string(),
  name: z.string().min(1, 'Nome do servidor é obrigatório'),
  swagger_url: z.string().url('URL do Swagger inválida').or(z.string().nullable().optional()),
  api_base_url: z.string().url('URL da API inválida').or(z.string().nullable().optional()),
  auth_type: z.enum(['none', 'dashboard_login', 'autonomous']).default('none'),
  auth_credentials: z.record(z.string(), z.any()).default({}),
  user_id: z.string().uuid().optional(),
  type: z.enum(['rest', 'supabase']).default('rest'),
  encrypted_secrets: z.string().nullable().optional(),
});

export type McpServerEntity = z.infer<typeof mcpServerSchema>;

// Schema para criação de servidor recebido pelo frontend
export const createMcpServerInputSchema = z.object({
  name: z.string().min(1, 'Nome do servidor é obrigatório'),
  type: z.enum(['rest', 'supabase']).default('rest'),
  swagger_url: z.string().url('URL do Swagger inválida').optional().or(z.literal('')),
  api_base_url: z.string().url('URL da API inválida').optional().or(z.literal('')),
  
  // Campos específicos do Supabase
  supabase_url: z.string().url('URL do Supabase inválida').optional().or(z.literal('')),
  anon_key: z.string().optional(),
  service_role_key: z.string().optional(),
});

export type CreateMcpServerInput = z.infer<typeof createMcpServerInputSchema>;
