-- =======================================================
-- Migração: Criação de Usuário Padrão, RLS e Políticas
-- =======================================================

-- 1. Ativar as extensões necessárias
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Criar o usuário padrão no Supabase Auth se não existir
DO $$
DECLARE
  new_user_id uuid := gen_random_uuid();
  user_exists boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM auth.users WHERE email = 'pedrolucasmota2005@gmail.com') INTO user_exists;
  
  IF NOT user_exists THEN
    -- Inserir usuário
    INSERT INTO auth.users (
      id,
      instance_id,
      email,
      encrypted_password,
      email_confirmed_at,
      created_at,
      updated_at,
      raw_app_meta_data,
      raw_user_meta_data,
      aud,
      role,
      is_sso_user
    ) VALUES (
      new_user_id,
      '00000000-0000-0000-0000-000000000000',
      'pedrolucasmota2005@gmail.com',
      crypt('plm200510', gen_salt('bf')),
      now(),
      now(),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{}',
      'authenticated',
      'authenticated',
      false
    );
    
    -- Inserir identidade
    INSERT INTO auth.identities (
      id,
      user_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    ) VALUES (
      new_user_id,
      new_user_id,
      jsonb_build_object('sub', new_user_id::text, 'email', 'pedrolucasmota2005@gmail.com'),
      'email',
      now(),
      now(),
      now()
    );
    
    RAISE NOTICE 'Usuário pedrolucasmota2005@gmail.com criado com ID %', new_user_id;
  ELSE
    RAISE NOTICE 'Usuário pedrolucasmota2005@gmail.com já existe.';
  END IF;
END $$;

-- 3. Adicionar coluna user_id na tabela mcp_servers
ALTER TABLE public.mcp_servers 
ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- 4. Vincular todos os servidores existentes (que não têm dono) ao usuário padrão
UPDATE public.mcp_servers
SET user_id = (SELECT id FROM auth.users WHERE email = 'pedrolucasmota2005@gmail.com')
WHERE user_id IS NULL;

-- 5. Configurar valor padrão para user_id (herdar o usuário logado)
ALTER TABLE public.mcp_servers 
ALTER COLUMN user_id SET DEFAULT auth.uid();

-- 6. Habilitar RLS em todas as tabelas do sistema
ALTER TABLE public.mcp_servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_sync_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_playbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_test_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_test_runs ENABLE ROW LEVEL SECURITY;

-- 7. Limpar políticas antigas se existirem para evitar conflitos
DROP POLICY IF EXISTS "service_role_full_access" ON public.mcp_playbooks;
DROP POLICY IF EXISTS "service_role_full_access" ON public.mcp_test_cases;
DROP POLICY IF EXISTS "service_role_full_access" ON public.mcp_test_runs;

DROP POLICY IF EXISTS "user_all_mcp_servers" ON public.mcp_servers;
DROP POLICY IF EXISTS "user_all_mcp_tools" ON public.mcp_tools;
DROP POLICY IF EXISTS "user_all_mcp_categories" ON public.mcp_categories;
DROP POLICY IF EXISTS "user_all_mcp_sync_reports" ON public.mcp_sync_reports;
DROP POLICY IF EXISTS "user_all_mcp_playbooks" ON public.mcp_playbooks;
DROP POLICY IF EXISTS "user_all_mcp_test_cases" ON public.mcp_test_cases;
DROP POLICY IF EXISTS "user_all_mcp_test_runs" ON public.mcp_test_runs;

-- 8. Criar políticas RLS para permitir acesso total apenas aos proprietários dos dados

-- Tabela: mcp_servers
CREATE POLICY "user_all_mcp_servers" ON public.mcp_servers
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Tabela: mcp_tools
CREATE POLICY "user_all_mcp_tools" ON public.mcp_tools
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.mcp_servers WHERE id = server_id AND user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.mcp_servers WHERE id = server_id AND user_id = auth.uid()));

-- Tabela: mcp_categories
CREATE POLICY "user_all_mcp_categories" ON public.mcp_categories
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.mcp_servers WHERE id = server_id AND user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.mcp_servers WHERE id = server_id AND user_id = auth.uid()));

-- Tabela: mcp_sync_reports
CREATE POLICY "user_all_mcp_sync_reports" ON public.mcp_sync_reports
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.mcp_servers WHERE id = server_id AND user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.mcp_servers WHERE id = server_id AND user_id = auth.uid()));

-- Tabela: mcp_playbooks
CREATE POLICY "user_all_mcp_playbooks" ON public.mcp_playbooks
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.mcp_servers WHERE id = server_id AND user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.mcp_servers WHERE id = server_id AND user_id = auth.uid()));

-- Tabela: mcp_test_cases
CREATE POLICY "user_all_mcp_test_cases" ON public.mcp_test_cases
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.mcp_servers WHERE id = server_id AND user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.mcp_servers WHERE id = server_id AND user_id = auth.uid()));

-- Tabela: mcp_test_runs
CREATE POLICY "user_all_mcp_test_runs" ON public.mcp_test_runs
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.mcp_test_cases tc
    JOIN public.mcp_servers s ON tc.server_id = s.id
    WHERE tc.id = test_case_id AND s.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.mcp_test_cases tc
    JOIN public.mcp_servers s ON tc.server_id = s.id
    WHERE tc.id = test_case_id AND s.user_id = auth.uid()
  ));

-- 9. Recarregar o cache do PostgREST
NOTIFY pgrst, 'reload schema';
