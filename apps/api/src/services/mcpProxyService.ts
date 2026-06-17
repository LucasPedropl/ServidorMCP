import fetch from 'node-fetch';
import https from 'https';
import { updateServerCredentials, getToolsByServerId } from '../repositories/mcpRepository.js';
import type { ServerRecord, ToolRecord } from '../repositories/mcpRepository.js';

const agent = new https.Agent({
  rejectUnauthorized: false
});

// Importa e Re-exporta para compatibilidade com outras partes do sistema
import { proxyLogs, pushProxyLog } from './mcpProxy/proxyLogger.js';
import { checkRouteBlock, postProcessProxyResult } from './mcpProxy/proxyBlocker.js';
import {
  tokenCache,
  tokenAcquiredAtCache,
  globalSessionHeaders,
  clearProxyTokenCache,
  resolveActiveAuth,
  performAutoLogin
} from './mcpProxy/proxyAuth.js';

export {
  proxyLogs,
  pushProxyLog,
  tokenCache,
  tokenAcquiredAtCache,
  globalSessionHeaders,
  clearProxyTokenCache,
  resolveActiveAuth,
  performAutoLogin
};

export type { ProxyRequestLog } from './mcpProxy/proxyLogger.js';

export async function executeMcpToolProxy(server: ServerRecord, tool: ToolRecord, args: any, isRetry = false): Promise<any> {
  const blockCheck = checkRouteBlock(server.id, tool.http_method, tool.endpoint_path);
  if (blockCheck.isBlocked) {
    return {
      content: [
        {
          type: 'text',
          text: `[BLOQUEIO DE SEGURANÇA MCP] Esta rota foi temporariamente desativada nesta sessão para evitar loops infinitos de IA e desperdício de tokens. Descreva o cenário atual para o usuário no chat e peça para reiniciar a tarefa.\nRota: [${tool.http_method.toUpperCase()}] ${tool.endpoint_path}`
        }
      ],
      isError: true
    };
  }

  let headers: Record<string, string> = {};
  let bodyPayload: any = undefined;
  let activeProfileId: string | undefined = undefined;
  let queryParamsObj: Record<string, any> = {};

  try {
    let url = `${server.api_base_url.replace(/\/$/, '')}/${tool.endpoint_path.replace(/^\//, '')}`;
    const method = tool.http_method.toUpperCase();
    headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    const sessionHeaders = globalSessionHeaders.get(server.id);
    if (sessionHeaders) {
      for (const [k, v] of Object.entries(sessionHeaders)) {
        headers[k] = v;
      }
    }

    const creds = server.auth_credentials;
    const isAutoLogin = creds && (creds.authMode === 'auto_login' || server.type === 'supabase');
    const authReqRaw = tool.parameters_schema?.authRequirement || 'none';
    const authRes = resolveActiveAuth(server, authReqRaw, isAutoLogin, isRetry);
    let { currentToken, allowedProfiles } = authRes;
    activeProfileId = authRes.activeProfileId;

    if (server.type === 'supabase') {
      headers['apikey'] = creds?.anon_key || '';
      if (allowedProfiles.length > 0) {
        if (!currentToken && !isRetry) {
          console.error(`[MCP Proxy Supabase] Nenhum token em cache para ${server.name} (Perfis: ${allowedProfiles.join(', ')}). Realizando login inicial para ${activeProfileId}...`);
          const loginRes = await performAutoLogin(server, activeProfileId);
          currentToken = loginRes.token;
          activeProfileId = loginRes.profileId;
        }

        if (currentToken) {
          headers['Authorization'] = `Bearer ${currentToken}`;
        } else {
          headers['Authorization'] = `Bearer ${creds?.anon_key}`;
        }
      } else {
        headers['Authorization'] = `Bearer ${creds?.anon_key}`;
      }
    } else {
      if (allowedProfiles.length > 0) {
        if (isAutoLogin && !currentToken && !isRetry) {
          console.error(`[MCP Proxy] Nenhum token em cache para ${server.name} (Perfis: ${allowedProfiles.join(', ')}). Realizando login inicial para ${activeProfileId}...`);
          const loginRes = await performAutoLogin(server, activeProfileId);
          currentToken = loginRes.token;
          activeProfileId = loginRes.profileId;
        }

        if (currentToken) {
          headers['Authorization'] = `Bearer ${currentToken}`;
        } else if (server.auth_type === 'dashboard_login' && creds?.token) {
          headers['Authorization'] = `Bearer ${creds.token}`;
        }
      } else {
        console.error(`[MCP Proxy] Endpoint ${tool.endpoint_path} configurado como Público (Sem Auth). Omitindo header Authorization.`);
        delete headers['Authorization'];
      }
    }

    const queryParams = new URLSearchParams();
    queryParamsObj = {};
    bodyPayload = undefined;

    for (const [key, val] of Object.entries(args)) {
      if (key === 'body') {
        bodyPayload = val;
        continue;
      }
      if (url.includes(`{${key}}`)) {
        url = url.replace(`{${key}}`, encodeURIComponent(String(val)));
      } else {
        queryParams.append(key, String(val));
        queryParamsObj[key] = val;
      }
    }

    const queryString = queryParams.toString();
    if (queryString) {
      url += (url.includes('?') ? '&' : '?') + queryString;
    }

    const expectedContentType = tool.parameters_schema?.contentType || 'application/json';
    let fetchBody: any = null;
    if (bodyPayload) {
      if (expectedContentType === 'multipart/form-data') {
        const { FormData } = await import('node-fetch');
        const form = new FormData();
        for (const [k, v] of Object.entries(bodyPayload)) {
          if (v !== undefined && v !== null) {
            form.append(k, String(v));
          }
        }
        fetchBody = form;
        delete headers['Content-Type'];
      } else if (expectedContentType === 'application/x-www-form-urlencoded') {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(bodyPayload)) {
          if (v !== undefined && v !== null) {
            qs.append(k, String(v));
          }
        }
        fetchBody = qs.toString();
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      } else {
        fetchBody = JSON.stringify(bodyPayload);
        headers['Content-Type'] = 'application/json';
      }
    }

    console.error(`[MCP Proxy] Disparando ${method} para ${url}...`);

    const response = await fetch(url, {
      method,
      headers,
      body: fetchBody,
      agent: url.startsWith('https:') ? agent : undefined
    });

    if (response.status === 401 && isAutoLogin && allowedProfiles.length > 0 && !isRetry) {
      console.error(`[MCP Proxy AVISO] Recebido 401 Unauthorized de ${url}. Renovando token do perfil ${activeProfileId} via AutoLogin...`);
      await performAutoLogin(server, activeProfileId);
      return await executeMcpToolProxy(server, tool, args, true);
    }

    const rawResult = await processResponse(response, server, activeProfileId, tool.endpoint_path, tool.http_method, headers, bodyPayload, queryParamsObj);
    return postProcessProxyResult(server.id, tool.http_method, tool.endpoint_path, rawResult);
  } catch (err: any) {
    console.error(`[MCP Proxy Fatal Error] ${tool.custom_name}:`, err);
    const rawErr = handleError(err, tool.endpoint_path, tool.http_method, headers, bodyPayload, activeProfileId, queryParamsObj);
    return postProcessProxyResult(server.id, tool.http_method, tool.endpoint_path, rawErr);
  }
}

export async function executeGenericMcpProxy(
  server: ServerRecord,
  endpoint: string,
  method: string,
  body?: any,
  queryParams?: Record<string, any>,
  isRetry = false,
  forcedProfileId?: string
): Promise<any> {
  const blockCheck = checkRouteBlock(server.id, method, endpoint);
  if (blockCheck.isBlocked) {
    return {
      content: [
        {
          type: 'text',
          text: `[BLOQUEIO DE SEGURANÇA MCP] Esta rota foi temporariamente desativada nesta sessão para evitar loops infinitos de IA e desperdício de tokens. Descreva o cenário atual para o usuário no chat e peça para reiniciar a tarefa.\nRota: [${method.toUpperCase()}] ${endpoint}`
        }
      ],
      isError: true
    };
  }

  let headers: Record<string, string> = {};
  let activeProfileId: string | undefined = undefined;

  try {
    let url = `${server.api_base_url.replace(/\/$/, '')}/${endpoint.replace(/^\//, '')}`;
    headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    const sessionHeaders = globalSessionHeaders.get(server.id);
    if (sessionHeaders) {
      for (const [k, v] of Object.entries(sessionHeaders)) {
        headers[k] = v;
      }
    }

    const creds = server.auth_credentials;
    const isAutoLogin = creds && (creds.authMode === 'auto_login' || server.type === 'supabase');

    const tools = await getToolsByServerId(server.id);
    const matchedTool = tools.find(t => t.http_method.toUpperCase() === method.toUpperCase() && t.endpoint_path === endpoint);
    
    let authReqRaw = matchedTool?.parameters_schema?.authRequirement || 'none';
    if (forcedProfileId) {
      if (forcedProfileId === 'none') {
        authReqRaw = 'none';
      } else {
        authReqRaw = [forcedProfileId];
      }
    }

    const expectedContentType = matchedTool?.parameters_schema?.contentType || 'application/json';

    const authRes = resolveActiveAuth(server, authReqRaw, isAutoLogin, isRetry);
    let { currentToken, allowedProfiles } = authRes;
    activeProfileId = authRes.activeProfileId;

    if (server.type === 'supabase') {
      headers['apikey'] = creds?.anon_key || '';
      if (allowedProfiles.length > 0) {
        if (!currentToken && !isRetry) {
          console.error(`[MCP Proxy Genérico Supabase] Nenhum token em cache para ${server.name} (Perfis: ${allowedProfiles.join(', ')}). Realizando login inicial para ${activeProfileId}...`);
          const loginRes = await performAutoLogin(server, activeProfileId);
          currentToken = loginRes.token;
          activeProfileId = loginRes.profileId;
        }

        if (currentToken) {
          headers['Authorization'] = `Bearer ${currentToken}`;
        } else {
          headers['Authorization'] = `Bearer ${creds?.anon_key}`;
        }
      } else {
        headers['Authorization'] = `Bearer ${creds?.anon_key}`;
      }
    } else {
      if (allowedProfiles.length > 0) {
        if (isAutoLogin && !currentToken && !isRetry) {
          console.error(`[MCP Proxy Genérico] Nenhum token em cache para ${server.name} (Perfis: ${allowedProfiles.join(', ')}). Realizando login inicial para ${activeProfileId}...`);
          const loginRes = await performAutoLogin(server, activeProfileId);
          currentToken = loginRes.token;
          activeProfileId = loginRes.profileId;
        }

        if (currentToken) {
          headers['Authorization'] = `Bearer ${currentToken}`;
        } else if (server.auth_type === 'dashboard_login' && creds?.token) {
          headers['Authorization'] = `Bearer ${creds.token}`;
        }
      } else {
        console.error(`[MCP Proxy Genérico] Endpoint ${endpoint} configurado como Público (Sem Auth). Omitindo header Authorization.`);
        delete headers['Authorization'];
      }
    }

    if (queryParams && Object.keys(queryParams).length > 0) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(queryParams)) {
        qs.append(k, String(v));
      }
      url += (url.includes('?') ? '&' : '?') + qs.toString();
    }

    let fetchBody: any = null;
    if (body) {
      if (expectedContentType === 'multipart/form-data') {
        const { FormData } = await import('node-fetch');
        const form = new FormData();
        for (const [k, v] of Object.entries(body)) {
          if (v !== undefined && v !== null) {
            form.append(k, String(v));
          }
        }
        fetchBody = form;
        delete headers['Content-Type'];
      } else if (expectedContentType === 'application/x-www-form-urlencoded') {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(body)) {
          if (v !== undefined && v !== null) {
            qs.append(k, String(v));
          }
        }
        fetchBody = qs.toString();
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      } else {
        fetchBody = JSON.stringify(body);
        headers['Content-Type'] = 'application/json';
      }
    }

    console.error(`[MCP Proxy Genérico] Disparando ${method.toUpperCase()} para ${url} (ContentType: ${expectedContentType})...`);
    console.error(`[MCP Proxy Debug] Headers enviados para a API:`, JSON.stringify(headers));

    const response = await fetch(url, {
      method: method.toUpperCase(),
      headers,
      body: fetchBody,
      agent: url.startsWith('https:') ? agent : undefined
    });

    if (response.status === 401 && isAutoLogin && allowedProfiles.length > 0 && !isRetry) {
      console.error(`[MCP Proxy AVISO] Recebido 401 Unauthorized de ${url}. Renovando token do perfil ${activeProfileId} via AutoLogin...`);
      await performAutoLogin(server, activeProfileId);
      return await executeGenericMcpProxy(server, endpoint, method, body, queryParams, true, forcedProfileId);
    }

    if ((response.status === 401 || response.status === 403) && !forcedProfileId && allowedProfiles.length === 0) {
      const allProfiles = creds?.profiles && Array.isArray(creds.profiles) ? creds.profiles : [];
      console.error(`[MCP Proxy Fallback] Endpoint público retornou ${response.status}. Iniciando varredura por ${allProfiles.length} perfis alternativos...`);

      for (const profile of allProfiles) {
        try {
          const cacheKey = `${server.id}:${profile.id}`;
          let token = tokenCache.get(cacheKey) || profile.token;

          if (!token && isAutoLogin) {
            const loginRes = await performAutoLogin(server, profile.id);
            token = loginRes.token;
          }

          if (token) {
            const fallbackHeaders = { ...headers, 'Authorization': `Bearer ${token}` };
            console.error(`[MCP Proxy Fallback] Testando perfil "${profile.name}" (ID: ${profile.id})...`);
            
            const fallbackResponse = await fetch(url, {
              method: method.toUpperCase(),
              headers: fallbackHeaders,
              body: fetchBody,
              agent: url.startsWith('https:') ? agent : undefined
            });

            if (fallbackResponse.ok) {
              console.error(`[MCP Proxy Fallback] SUCESSO com o perfil "${profile.name}"!`);
              const processed = await processResponse(fallbackResponse, server, profile.id, endpoint, method, headers, body, queryParams);
              if (!processed.isError && processed.content && processed.content[0]) {
                processed.content[0].text = `[AVISO DO SERVIDOR MCP: Este endpoint não possui autenticação cadastrada (público), mas a requisição retornou status ${response.status}. O servidor tentou autenticar automaticamente e obteve SUCESSO utilizando o perfil "${profile.name}" (ID: ${profile.id}). Por favor, informe ao usuário para atualizar as configurações de autenticação desta ferramenta no dashboard.]\n\nResposta da API:\n${processed.content[0].text}`;
              }
              return postProcessProxyResult(server.id, method, endpoint, processed);
            } else {
              console.error(`[MCP Proxy Fallback] Perfil "${profile.name}" falhou com status ${fallbackResponse.status}.`);
            }
          }
        } catch (e: any) {
          console.error(`[MCP Proxy Fallback] Erro ao testar perfil "${profile.name}":`, e.message);
        }
      }
    }

    const rawResult = await processResponse(response, server, activeProfileId, endpoint, method, headers, body, queryParams);
    return postProcessProxyResult(server.id, method, endpoint, rawResult);
  } catch (err: any) {
    console.error(`[MCP Proxy Fatal Error] generico:`, err);
    const rawErr = handleError(err, endpoint, method, headers, body, activeProfileId, queryParams);
    return postProcessProxyResult(server.id, method, endpoint, rawErr);
  }
}

async function processResponse(
  response: any,
  server: ServerRecord,
  profileId: string,
  endpoint: string,
  method: string,
  requestHeaders: Record<string, string>,
  requestBody: any,
  queryParams?: Record<string, any>
) {
  const contentType = response.headers.get('content-type') || '';
  let responseData: any;

  if (contentType.includes('application/json')) {
    try {
      responseData = await response.json();
    } catch {
      responseData = null;
    }
  } else {
    responseData = await response.text();
  }

  try {
    const responseHeaders: Record<string, string> = {};
    if (response.headers && typeof response.headers.forEach === 'function') {
      response.headers.forEach((v: string, k: string) => {
        responseHeaders[k] = v;
      });
    }

    const safeHeaders = { ...requestHeaders };
    if (safeHeaders['Authorization'] && typeof safeHeaders['Authorization'] === 'string') {
      const parts = safeHeaders['Authorization'].split(' ');
      if (parts[1]) {
        safeHeaders['Authorization'] = `${parts[0]} ${parts[1].substring(0, 10)}... (truncated)`;
      }
    }

    pushProxyLog({
      timestamp: new Date().toISOString(),
      endpoint,
      method,
      requestHeaders: safeHeaders,
      requestBody,
      queryParams,
      responseStatus: response.status,
      responseHeaders,
      responseBody: responseData,
      authProfileId: profileId
    });
  } catch (logErr: any) {
    console.error('[MCP Proxy Logger Erro] Falha ao registrar log no buffer:', logErr.message);
  }

  if (response.ok && responseData && typeof responseData === 'object') {
    const possibleToken = responseData.token || responseData.accessToken || responseData.access_token || responseData.jwt;
    if (possibleToken && typeof possibleToken === 'string') {
      console.error(`[MCP Proxy Interceptor] Token JWT identificado na resposta! Salvando no tokenCache para o servidor ${server.name} (Perfil: ${profileId})...`);
      tokenCache.set(`${server.id}:${profileId}`, possibleToken);
      tokenCache.set(server.id, possibleToken); // fallback
      tokenAcquiredAtCache.set(`${server.id}:${profileId}`, Date.now());

      const creds = server.auth_credentials || {};
      let updatedProfiles = creds.profiles;
      if (updatedProfiles && Array.isArray(updatedProfiles)) {
        updatedProfiles = updatedProfiles.map((p: any) => p.id === profileId ? { ...p, token: possibleToken } : p);
      }
      const newCreds = { ...creds, token: possibleToken, profiles: updatedProfiles };
      await updateServerCredentials(server.id, 'dashboard_login', newCreds);
      console.error(`[MCP Proxy Interceptor] Token persistido no Supabase com sucesso para o servidor ${server.name}!`);
    }
  }

  if (!response.ok) {
    return {
      content: [
        {
          type: 'text',
          text: `Erro na API Destino (${response.status} ${response.statusText}): ${typeof responseData === 'object' ? JSON.stringify(responseData) : responseData}`,
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: typeof responseData === 'object' ? JSON.stringify(responseData, null, 2) : responseData,
      },
    ],
  };
}

function handleError(
  err: any,
  endpoint: string,
  method: string,
  requestHeaders: Record<string, string>,
  requestBody: any,
  profileId?: string,
  queryParams?: Record<string, any>
) {
  try {
    const safeHeaders = { ...requestHeaders };
    if (safeHeaders['Authorization'] && typeof safeHeaders['Authorization'] === 'string') {
      const parts = safeHeaders['Authorization'].split(' ');
      if (parts[1]) {
        safeHeaders['Authorization'] = `${parts[0]} ${parts[1].substring(0, 10)}... (truncated)`;
      }
    }

    pushProxyLog({
      timestamp: new Date().toISOString(),
      endpoint,
      method,
      requestHeaders: safeHeaders,
      requestBody,
      queryParams,
      responseStatus: 500,
      responseHeaders: {},
      responseBody: { error: err.message, stack: err.stack },
      authProfileId: profileId
    });
  } catch (logErr: any) {
    console.error('[MCP Proxy Logger Erro] Falha ao registrar log de erro no buffer:', logErr.message);
  }

  return {
    content: [{ type: 'text', text: `Falha interna no proxy MCP: ${err.message}` }],
    isError: true,
  };
}
