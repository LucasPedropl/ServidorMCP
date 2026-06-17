import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { decrypt } from '@/lib/encryption';
import { fetchBypassingTLS, extractSwaggerUrl } from '@/lib/fetchServerUtils';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { serverId } = body;

    if (!serverId) {
      return NextResponse.json({ error: 'ID do servidor é obrigatório.' }, { status: 400 });
    }

    // 1. Busca o servidor
    const { data: server, error: serverErr } = await supabase
      .from('mcp_servers')
      .select('*')
      .eq('id', serverId)
      .single();

    if (serverErr || !server) {
      return NextResponse.json({ error: 'Servidor não encontrado no Supabase.' }, { status: 404 });
    }

    if (!server.swagger_url) {
      return NextResponse.json({ error: 'Servidor não possui URL de Swagger configurada.' }, { status: 400 });
    }

    // Monta headers para fetch do Swagger (com suporte a Supabase)
    const fetchHeaders: Record<string, string> = { 'Accept': 'application/json' };
    
    if (server.type === 'supabase' && server.encrypted_secrets) {
      try {
        const decrypted = decrypt(server.encrypted_secrets);
        const secrets = JSON.parse(decrypted);
        fetchHeaders['apikey'] = secrets.service_role_key || '';
      } catch (e) {
        console.error('Erro ao descriptografar segredos para sincronização:', e);
        return NextResponse.json({ error: 'Falha ao descriptografar credenciais do servidor.' }, { status: 500 });
      }
    }

    // 2. Busca o Swagger
    let targetUrl = server.swagger_url;
    let fetchRes;
    try {
      fetchRes = await fetchBypassingTLS(targetUrl, { headers: fetchHeaders });
    } catch (fetchErr: any) {
      console.error('Erro ao conectar com a URL na sincronizacao:', fetchErr);
      return NextResponse.json(
        { error: `Nao foi possivel conectar com a URL informada: ${fetchErr.message}` },
        { status: 500 }
      );
    }

    if (!fetchRes.ok) {
      return NextResponse.json(
        { error: `Falha ao buscar Swagger: Destino respondeu com status ${fetchRes.status}` },
        { status: fetchRes.status }
      );
    }

    let isHtml = false;
    if (fetchRes.contentType && fetchRes.contentType.includes('text/html')) {
      isHtml = true;
    } else if (fetchRes.text.trim().startsWith('<')) {
      isHtml = true;
    }

    if (isHtml) {
      const specUrl = extractSwaggerUrl(fetchRes.text, targetUrl);
      if (specUrl) {
        targetUrl = specUrl;
        try {
          const fetchResSpec = await fetchBypassingTLS(targetUrl, { headers: fetchHeaders });
          if (fetchResSpec.ok) {
            fetchRes = fetchResSpec;
          } else {
            return NextResponse.json({
              error: `Identificamos a documentacao em ${specUrl}, mas houve erro ao acessa-la (status: ${fetchResSpec.status}).`
            }, { status: 400 });
          }
        } catch (specErr: any) {
          return NextResponse.json({
            error: `Identificamos a documentacao em ${specUrl}, mas nao conseguimos conectar: ${specErr.message}`
          }, { status: 500 });
        }
      } else {
        const commonPaths = ['/v3/api-docs', '/v2/api-docs', '/swagger.json', '/swagger/v1/swagger.json', '/openapi.json'];
        let success = false;
        for (const p of commonPaths) {
          try {
            const probeUrl = new URL(p, targetUrl).toString();
            const probeRes = await fetchBypassingTLS(probeUrl, { headers: fetchHeaders });
            if (probeRes.ok && !probeRes.text.trim().startsWith('<')) {
              fetchRes = probeRes;
              targetUrl = probeUrl;
              success = true;
              break;
            }
          } catch {
            // ignore
          }
        }
        if (!success) {
          return NextResponse.json({
            error: 'A URL informada aponta para uma pagina HTML e nao conseguimos encontrar o link do JSON do Swagger automaticamente. Por favor, forneça o link direto para o JSON/YAML do Swagger.'
          }, { status: 400 });
        }
      }
    }

    let data;
    try {
      data = JSON.parse(fetchRes.text);
    } catch (parseErr) {
      return NextResponse.json({ error: 'O JSON retornado nao e um JSON valido.' }, { status: 400 });
    }

    if (!data.openapi && !data.swagger) {
      return NextResponse.json({ error: 'O JSON retornado nao parece ser um OpenAPI ou Swagger valido.' }, { status: 400 });
    }

    const freshTools: any[] = [];
    const paths = data.paths || {};

    for (const [pathKey, pathItem] of Object.entries(paths)) {
      if (!pathItem || typeof pathItem !== 'object') continue;

      for (const [methodKey, operation] of Object.entries(pathItem)) {
        if (!['get', 'post', 'put', 'delete', 'patch'].includes(methodKey.toLowerCase())) continue;

        const op = operation as any;
        const method = methodKey.toUpperCase();
        const cleanPath = pathKey.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
        const originalName = op.operationId ? op.operationId : `${method.toLowerCase()}_${cleanPath}`;

        const paramsSchema: Record<string, any> = { type: 'object', properties: {}, required: [] };
        if (op.parameters && Array.isArray(op.parameters)) {
          op.parameters.forEach((param: any) => {
            if (param.name) {
              paramsSchema.properties[param.name] = {
                type: param.schema?.type || 'string',
                description: param.description || '',
                in: param.in
              };
              if (param.required) paramsSchema.required.push(param.name);
            }
          });
        }

        if (op.requestBody?.content?.['application/json']?.schema) {
          paramsSchema.properties['body'] = op.requestBody.content['application/json'].schema;
          paramsSchema.required.push('body');
        }

        freshTools.push({
          originalName,
          customName: originalName,
          customDescription: op.summary || op.description || `Chamada ${method} para ${pathKey}`,
          httpMethod: method,
          endpointPath: pathKey,
          parametersSchema: paramsSchema
        });
      }
    }

    // 3. Busca ferramentas existentes
    const { data: existingTools, error: toolsErr } = await supabase
      .from('mcp_tools')
      .select('*')
      .eq('server_id', server.id);

    if (toolsErr) {
      return NextResponse.json({ error: `Erro ao buscar ferramentas existentes: ${toolsErr.message}` }, { status: 500 });
    }

    const existingMap = new Map<string, any>();
    (existingTools || []).forEach(t => {
      existingMap.set(`${t.http_method.toUpperCase()}_${t.endpoint_path}`, t);
    });

    const addedEndpoints: any[] = [];
    const modifiedEndpoints: any[] = [];
    const freshKeys = new Set<string>();
    const newToolsToInsert: any[] = [];

    freshTools.forEach(ft => {
      const key = `${ft.httpMethod.toUpperCase()}_${ft.endpointPath}`;
      freshKeys.add(key);

      if (!existingMap.has(key)) {
        addedEndpoints.push({
          method: ft.httpMethod,
          path: ft.endpointPath,
          name: ft.customName,
          description: ft.customDescription
        });
        newToolsToInsert.push({
          server_id: server.id,
          original_name: ft.originalName,
          custom_name: ft.customName,
          custom_description: ft.customDescription,
          http_method: ft.httpMethod,
          endpoint_path: ft.endpointPath,
          parameters_schema: ft.parametersSchema,
          category_id: null
        });
      } else {
        const existing = existingMap.get(key);
        const oldProps = Object.keys(existing.parameters_schema?.properties || {}).sort().join(',');
        const newProps = Object.keys(ft.parametersSchema?.properties || {}).sort().join(',');
        if (oldProps !== newProps) {
          modifiedEndpoints.push({
            method: ft.httpMethod,
            path: ft.endpointPath,
            old_params: oldProps,
            new_params: newProps
          });
        }
      }
    });

    const removedEndpoints: any[] = [];
    (existingTools || []).forEach(t => {
      const key = `${t.http_method.toUpperCase()}_${t.endpoint_path}`;
      if (!freshKeys.has(key)) {
        removedEndpoints.push({
          method: t.http_method,
          path: t.endpoint_path,
          name: t.custom_name
        });
      }
    });

    // 4. Insere novas ferramentas no banco
    let insertedTools: any[] = [];
    if (newToolsToInsert.length > 0) {
      const { data: insData, error: insErr } = await supabase
        .from('mcp_tools')
        .insert(newToolsToInsert)
        .select();
      
      if (insErr) {
        return NextResponse.json({ error: `Erro ao inserir novas ferramentas: ${insErr.message}` }, { status: 500 });
      }
      insertedTools = insData || [];
    }

    // 5. Monta o resumo em texto
    let summaryText = `Relatório de Sincronização - Servidor: ${server.name}\nData: ${new Date().toISOString()}\n\n`;
    summaryText += `Total de Endpoints no Swagger: ${freshTools.length}\n`;
    summaryText += `Endpoints Adicionados: ${addedEndpoints.length}\n`;
    summaryText += `Endpoints Modificados: ${modifiedEndpoints.length}\n`;
    summaryText += `Endpoints Removidos/Descontinuados: ${removedEndpoints.length}\n\n`;

    if (addedEndpoints.length > 0) {
      summaryText += `--- ADICIONADOS ---\n`;
      addedEndpoints.forEach(a => summaryText += `[${a.method}] ${a.path} (${a.name})\n`);
      summaryText += `\n`;
    }

    if (modifiedEndpoints.length > 0) {
      summaryText += `--- MODIFICADOS ---\n`;
      modifiedEndpoints.forEach(m => summaryText += `[${m.method}] ${m.path} (Parâmetros mudaram de [${m.old_params}] para [${m.new_params}])\n`);
      summaryText += `\n`;
    }

    if (removedEndpoints.length > 0) {
      summaryText += `--- REMOVIDOS ---\n`;
      removedEndpoints.forEach(r => summaryText += `[${r.method}] ${r.path} (${r.name})\n`);
      summaryText += `\n`;
    }

    // 6. Salva no banco de dados
    const { data: reportData, error: reportErr } = await supabase
      .from('mcp_sync_reports')
      .insert([{
        server_id: server.id,
        report_summary: summaryText,
        added_endpoints: addedEndpoints,
        modified_endpoints: modifiedEndpoints,
        removed_endpoints: removedEndpoints
      }])
      .select()
      .single();

    if (reportErr) {
      console.error('Erro ao salvar relatório no Supabase:', reportErr);
    }

    return NextResponse.json({
      success: true,
      report: reportData || {
        report_summary: summaryText,
        added_endpoints: addedEndpoints,
        modified_endpoints: modifiedEndpoints,
        removed_endpoints: removedEndpoints
      },
      insertedTools
    });

  } catch (err: any) {
    console.error('Erro na rota de sincronização:', err);
    return NextResponse.json({ error: err.message || 'Erro interno na sincronização.' }, { status: 500 });
  }
}
