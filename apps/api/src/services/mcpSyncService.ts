import fetch from 'node-fetch';
import https from 'https';
import { getServerById, getToolsByServerId, saveSyncReport, insertToolsBatch, updateToolSchema } from '../repositories/mcpRepository.js';

const agent = new https.Agent({
  rejectUnauthorized: false
});

function extractSwaggerUrl(html: string, originalUrl: string): string | null {
  const urlRegex = /url\s*:\s*["']([^"']+)["']/i;
  const match = html.match(urlRegex);
  if (match && match[1]) {
    try {
      return new URL(match[1], originalUrl).toString();
    } catch {
      // ignore
    }
  }

  const urlsRegex = /urls\s*:\s*\[\s*\{\s*url\s*:\s*["']([^"']+)["']/i;
  const matchUrls = html.match(urlsRegex);
  if (matchUrls && matchUrls[1]) {
    try {
      return new URL(matchUrls[1], originalUrl).toString();
    } catch {
      // ignore
    }
  }

  return null;
}

async function fetchBypassingTLS(targetUrl: string, headers: Record<string, string> = {}): Promise<{ status: number; ok: boolean; text: string; contentType?: string }> {
  const options: any = {
    method: 'GET',
    headers: headers,
  };
  if (targetUrl.startsWith('https:')) {
    options.agent = agent;
  }
  const response = await fetch(targetUrl, options);
  const text = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    text,
    contentType: response.headers.get('content-type') || undefined,
  };
}

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

export async function runServerSyncService(serverId: string): Promise<string> {
  const server = await getServerById(serverId);
  if (!server.swagger_url) {
    throw new Error(`Servidor ${server.name} nao possui uma URL de Swagger configurada.`);
  }

  // 1. Busca o Swagger
  let targetUrl = server.swagger_url;
  let fetchRes;
  try {
    fetchRes = await fetchBypassingTLS(targetUrl, { 'Accept': 'application/json, text/html, */*' });
  } catch (fetchErr: any) {
    console.error('Erro ao conectar com a URL na sincronizacao backend:', fetchErr);
    throw new Error(`Nao foi possivel conectar com a URL informada: ${fetchErr.message}`);
  }

  if (!fetchRes.ok) {
    throw new Error(`Falha ao buscar Swagger em ${targetUrl} (Status: ${fetchRes.status})`);
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
          throw new Error(`Identificamos a documentacao em ${specUrl}, mas houve erro ao acessa-la (Status: ${fetchResSpec.status}).`);
        }
      } catch (specErr: any) {
        throw new Error(`Identificamos a documentacao em ${specUrl}, mas nao conseguimos conectar: ${specErr.message}`);
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
        throw new Error('A URL informada aponta para uma pagina HTML e nao conseguimos encontrar o link do JSON do Swagger automaticamente. Por favor, forneça o link direto para o JSON/YAML do Swagger.');
      }
    }
  }

  let data: any;
  try {
    data = JSON.parse(fetchRes.text);
  } catch (parseErr) {
    throw new Error('O JSON retornado nao e um JSON valido.');
  }

  if (!data.openapi && !data.swagger) {
    throw new Error('O JSON retornado nao parece ser um OpenAPI ou Swagger valido.');
  }

  const resolvedData = resolveRefs(data, data);
  const freshTools: any[] = [];
  const paths = resolvedData.paths || {};


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

      const content = op.requestBody?.content;
      if (content) {
        const jsonContent = content['application/json'];
        const multipartContent = content['multipart/form-data'];
        const formUrlContent = content['application/x-www-form-urlencoded'];

        const bodyContent = jsonContent || multipartContent || formUrlContent;
        if (bodyContent?.schema) {
          paramsSchema.properties['body'] = bodyContent.schema;
          paramsSchema.required.push('body');
          if (multipartContent) {
            paramsSchema.contentType = 'multipart/form-data';
          } else if (formUrlContent) {
            paramsSchema.contentType = 'application/x-www-form-urlencoded';
          } else {
            paramsSchema.contentType = 'application/json';
          }
        }
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

  // 2. Compara com as ferramentas existentes
  const existingTools = await getToolsByServerId(server.id);
  const existingMap = new Map<string, any>();
  existingTools.forEach(t => {
    existingMap.set(`${t.http_method.toUpperCase()}_${t.endpoint_path}`, t);
  });

  const addedEndpoints: any[] = [];
  const modifiedEndpoints: any[] = [];
  const freshKeys = new Set<string>();

  const newToolsToInsert: any[] = [];
  const toolsToUpdate: any[] = [];

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
      const oldPropsStr = JSON.stringify(existing.parameters_schema || {});
      const newPropsStr = JSON.stringify(ft.parametersSchema || {});

      if (oldPropsStr !== newPropsStr) {
        modifiedEndpoints.push({
          method: ft.httpMethod,
          path: ft.endpointPath,
          old_params: Object.keys(existing.parameters_schema?.properties || {}).sort().join(','),
          new_params: Object.keys(ft.parametersSchema?.properties || {}).sort().join(',')
        });
        toolsToUpdate.push({
          id: existing.id,
          parameters_schema: ft.parametersSchema
        });
      }
    }
  });

  const removedEndpoints: any[] = [];
  existingTools.forEach(t => {
    const key = `${t.http_method.toUpperCase()}_${t.endpoint_path}`;
    if (!freshKeys.has(key)) {
      removedEndpoints.push({
        method: t.http_method,
        path: t.endpoint_path,
        name: t.custom_name
      });
    }
  });

  // 3. Insere novas ferramentas no banco
  if (newToolsToInsert.length > 0) {
    await insertToolsBatch(newToolsToInsert);
  }

  if (toolsToUpdate.length > 0) {
    for (const tu of toolsToUpdate) {
      await updateToolSchema(tu.id, tu.parameters_schema);
    }
  }

  // 4. Monta o resumo em texto
  let summaryText = `Relatorio de Sincronizacao - Servidor: ${server.name}\nData: ${new Date().toISOString()}\n\n`;
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
    modifiedEndpoints.forEach(m => summaryText += `[${m.method}] ${m.path} (Parametros mudaram de [${m.old_params}] para [${m.new_params}])\n`);
    summaryText += `\n`;
  }

  if (removedEndpoints.length > 0) {
    summaryText += `--- REMOVIDOS ---\n`;
    removedEndpoints.forEach(r => summaryText += `[${r.method}] ${r.path} (${r.name})\n`);
    summaryText += `\n`;
  }

  // 5. Salva no banco de dados
  await saveSyncReport({
    server_id: server.id,
    report_summary: summaryText,
    added_endpoints: addedEndpoints,
    modified_endpoints: modifiedEndpoints,
    removed_endpoints: removedEndpoints
  });

  return summaryText;
}
