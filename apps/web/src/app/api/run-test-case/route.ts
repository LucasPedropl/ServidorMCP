import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const { serverId, testCaseId, variablesOverride } = await request.json();

    if (!serverId || !testCaseId) {
      return NextResponse.json({ error: 'Parâmetros serverId e testCaseId são obrigatórios.' }, { status: 400 });
    }

    // 1. Carrega o servidor
    const { data: server, error: serverErr } = await supabase
      .from('mcp_servers')
      .select('*')
      .eq('id', serverId)
      .single();

    if (serverErr || !server) {
      return NextResponse.json({ error: 'Servidor não encontrado.' }, { status: 404 });
    }

    // 2. Carrega o caso de teste
    const { data: testCase, error: testCaseErr } = await supabase
      .from('mcp_test_cases')
      .select('*')
      .eq('id', testCaseId)
      .eq('server_id', serverId)
      .single();

    if (testCaseErr || !testCase) {
      return NextResponse.json({ error: 'Caso de teste não encontrado.' }, { status: 404 });
    }

    // 3. Cria um registro pendente em mcp_test_runs
    const { data: testRun, error: testRunErr } = await supabase
      .from('mcp_test_runs')
      .insert([{
        test_case_id: testCaseId,
        status: 'pending',
        duration_ms: 0,
        log_details: []
      }])
      .select()
      .single();

    if (testRunErr || !testRun) {
      console.error('Erro ao cadastrar rodada inicial pendente:', testRunErr);
      return NextResponse.json({ error: 'Erro ao registrar histórico de teste inicial.' }, { status: 500 });
    }

    // Atualiza o Test Case com o status pendente e data
    await supabase
      .from('mcp_test_cases')
      .update({
        last_run_status: 'pending',
        last_run_at: new Date().toISOString()
      })
      .eq('id', testCaseId);

    // 4. Chama a API do Express em background (fire-and-forget)
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    
    fetch(`${backendUrl.replace(/\/$/, '')}/api/v1/run-test-case`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        serverId,
        testCaseId,
        variablesOverride,
        testRunId: testRun.id
      })
    }).catch(err => {
      console.error('[Next.js API route] Erro ao invocar Express API em background:', err);
    });

    // 5. Retorna imediatamente para o frontend
    return NextResponse.json({
      success: true,
      testCaseId,
      status: 'pending',
      testRunId: testRun.id
    });

  } catch (err: any) {
    console.error('Erro na execução do caso de teste no Next:', err);
    return NextResponse.json({ error: err.message || 'Erro interno.' }, { status: 500 });
  }
}
