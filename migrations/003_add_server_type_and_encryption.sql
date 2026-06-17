-- Migração 003: Adiciona suporte a múltiplos tipos de servidor e credenciais criptografadas

-- Adiciona a coluna 'type' se ela não existir
ALTER TABLE public.mcp_servers ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'rest';

-- Adiciona a coluna 'encrypted_secrets' se ela não existir
ALTER TABLE public.mcp_servers ADD COLUMN IF NOT EXISTS encrypted_secrets text;

-- Adiciona um comentário explicativo nas colunas
COMMENT ON COLUMN public.mcp_servers.type IS 'Tipo do servidor MCP: rest ou supabase';
COMMENT ON COLUMN public.mcp_servers.encrypted_secrets IS 'JSON contendo as credenciais de acesso criptografadas via AES-256-GCM';
