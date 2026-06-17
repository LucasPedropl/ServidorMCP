import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { encrypt } from '@/lib/encryption';
import { createMcpServerInputSchema } from '@/features/servers/schemas/serverSchema';

function getSupabaseUserClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    }
  );
}

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Token de autenticação ausente ou inválido.' }, { status: 401 });
    }
    const token = authHeader.split(' ')[1]!;

    const body = await request.json();
    const result = createMcpServerInputSchema.safeParse(body);
    
    if (!result.success) {
      return NextResponse.json({ error: 'Parâmetros inválidos.', details: result.error.format() }, { status: 400 });
    }

    const input = result.data;
    const supabaseClient = getSupabaseUserClient(token);

    let serverDataToInsert: any = {
      name: input.name,
      type: input.type,
      auth_type: 'none',
      auth_credentials: {}
    };

    if (input.type === 'supabase') {
      if (!input.supabase_url || !input.anon_key || !input.service_role_key) {
        return NextResponse.json({ error: 'Parâmetros Supabase (URL, Anon Key e Service Role Key) são obrigatórios.' }, { status: 400 });
      }

      // Criptografa os segredos sensíveis do Supabase do usuário no servidor
      const secretsObj = {
        project_url: input.supabase_url,
        anon_key: input.anon_key,
        service_role_key: input.service_role_key
      };
      
      const encrypted = encrypt(JSON.stringify(secretsObj));
      const cleanBaseUrl = input.supabase_url.replace(/\/$/, '');

      serverDataToInsert.encrypted_secrets = encrypted;
      serverDataToInsert.api_base_url = `${cleanBaseUrl}/rest/v1`;
      serverDataToInsert.swagger_url = `${cleanBaseUrl}/rest/v1/`; // Seta URL nativa da doc do Supabase
    } else {
      // Tipo REST tradicional
      if (!input.swagger_url || !input.api_base_url) {
        return NextResponse.json({ error: 'Swagger URL e API Base URL são obrigatórios para servidores REST.' }, { status: 400 });
      }
      serverDataToInsert.swagger_url = input.swagger_url;
      serverDataToInsert.api_base_url = input.api_base_url;
    }

    // Insere o servidor respeitando RLS (passando o token do usuário)
    const { data: newServer, error: insertErr } = await supabaseClient
      .from('mcp_servers')
      .insert([serverDataToInsert])
      .select()
      .single();

    if (insertErr || !newServer) {
      console.error('[API Route Servers] Erro ao criar servidor no banco:', insertErr);
      return NextResponse.json({ error: insertErr?.message || 'Falha ao gravar servidor no banco de dados.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, server: newServer });

  } catch (err: any) {
    console.error('[API Route Servers] Erro fatal:', err);
    return NextResponse.json({ error: err.message || 'Erro interno do servidor.' }, { status: 500 });
  }
}
