import { NextResponse } from 'next/server';
import { fetchBypassingTLS, extractSwaggerUrl } from '@/lib/fetchServerUtils';

function resolveRefs(schema: any, root: any, visited = new Set<string>()): any {
  if (!schema || typeof schema !== 'object') return schema;

  if (schema.$ref && typeof schema.$ref === 'string') {
    const refPath = schema.$ref;
    if (visited.has(refPath)) {
      return { type: 'object', description: `Circular reference to ${refPath}` };
    }
    if (refPath.startsWith('#/')) {
      const parts = refPath.substring(2).split('/');
      let current = root;
      for (const part of parts) {
        current = current?.[part];
      }
      if (current) {
        const nextVisited = new Set(visited);
        nextVisited.add(refPath);
        return resolveRefs(current, root, nextVisited);
      }
    }
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map(item => resolveRefs(item, root, visited));
  }

  const resolved: any = {};
  for (const [key, val] of Object.entries(schema)) {
    resolved[key] = resolveRefs(val, root, visited);
  }
  return resolved;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { url } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL invalida fornecida.' }, { status: 400 });
    }

    let targetUrl = url;
    let fetchRes;

    try {
      fetchRes = await fetchBypassingTLS(targetUrl, { 'Accept': 'application/json, text/html, */*' });
    } catch (fetchErr: any) {
      console.error('Erro ao conectar com a URL:', fetchErr);
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
          const fetchResSpec = await fetchBypassingTLS(targetUrl, { 'Accept': 'application/json' });
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
            const probeRes = await fetchBypassingTLS(probeUrl, { 'Accept': 'application/json' });
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

    // Validação básica se é OpenAPI/Swagger
    if (!data.openapi && !data.swagger) {
      return NextResponse.json({ error: 'O JSON retornado nao parece ser um OpenAPI ou Swagger valido.' }, { status: 400 });
    }

    const resolvedData = resolveRefs(data, data);
    const title = resolvedData.info?.title || 'API_Sem_Titulo';
    // Tenta inferir a baseUrl dos servers ou da propria URL do swagger
    let baseUrl = '';
    if (resolvedData.servers && resolvedData.servers.length > 0) {
      baseUrl = resolvedData.servers[0].url;
    } else {
      const urlObj = new URL(targetUrl);
      baseUrl = `${urlObj.protocol}//${urlObj.host}`;
    }

    const tools = [];
    const paths = resolvedData.paths || {};

    // Percorre caminhos e metodos para montar as ferramentas
    for (const [pathKey, pathItem] of Object.entries(paths)) {
      if (!pathItem || typeof pathItem !== 'object') continue;

      for (const [methodKey, operation] of Object.entries(pathItem)) {
        // Ignora chaves que nao sao metodos HTTP
        if (!['get', 'post', 'put', 'delete', 'patch'].includes(methodKey.toLowerCase())) continue;

        const op = operation as any;
        const method = methodKey.toUpperCase();
        
        // Monta um nome limpo se nao houver operationId
        const cleanPath = pathKey.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
        const originalName = op.operationId ? op.operationId : `${method.toLowerCase()}_${cleanPath}`;

        // Mapeia parametros (Query, Path) e RequestBody para um schema simplificado
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

        tools.push({
          originalName,
          customName: originalName,
          customDescription: op.summary || op.description || `Chamada ${method} para ${pathKey}`,
          httpMethod: method,
          endpointPath: pathKey,
          parametersSchema: paramsSchema
        });
      }
    }

    return NextResponse.json({
      title,
      baseUrl,
      swaggerUrl: url,
      tools
    });

  } catch (err: any) {
    console.error('Erro no proxy de parse do Swagger:', err);
    return NextResponse.json({ error: err.message || 'Erro interno ao processar o Swagger.' }, { status: 500 });
  }
}
