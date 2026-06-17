import fetch from 'node-fetch';
import https from 'https';
import { updateServerCredentials } from '../../repositories/mcpRepository.js';
import type { ServerRecord } from '../../repositories/mcpRepository.js';

const agent = new https.Agent({
  rejectUnauthorized: false
});

export const tokenCache = new Map<string, string>();
export const tokenAcquiredAtCache = new Map<string, number>();

// Headers globais definidos na sessão (serverId -> Record<string, string>)
export const globalSessionHeaders = new Map<string, Record<string, string>>();

export function clearProxyTokenCache(serverId: string, profileId?: string) {
  if (profileId) {
    tokenCache.delete(`${serverId}:${profileId}`);
    tokenAcquiredAtCache.delete(`${serverId}:${profileId}`);
  } else {
    tokenCache.delete(serverId);
    tokenAcquiredAtCache.delete(serverId);
    for (const key of tokenCache.keys()) {
      if (key.startsWith(`${serverId}:`)) {
        tokenCache.delete(key);
        tokenAcquiredAtCache.delete(key);
      }
    }
  }
}

interface ResolvedAuth {
  currentToken: string | undefined;
  activeProfileId: string;
  allowedProfiles: string[];
}

export function resolveActiveAuth(
  server: ServerRecord,
  authReqRaw: any,
  isAutoLogin: boolean,
  isRetry: boolean
): ResolvedAuth {
  const creds = server.auth_credentials;
  const authReqList: string[] = Array.isArray(authReqRaw)
    ? authReqRaw
    : (typeof authReqRaw === 'string' ? [authReqRaw] : ['none']);
  
  const allowedProfiles = authReqList.filter(p => p !== 'none');
  
  if (allowedProfiles.length === 0) {
    return { currentToken: undefined, activeProfileId: 'default', allowedProfiles };
  }

  let currentToken: string | undefined = undefined;
  let activeProfileId = allowedProfiles[0] || 'default';

  for (const profId of allowedProfiles) {
    const cacheKey = `${server.id}:${profId}`;
    let tok = tokenCache.get(cacheKey);

    if (!tok && creds?.profiles && Array.isArray(creds.profiles)) {
      const prof = creds.profiles.find((p: any) => p.id === profId);
      if (prof && prof.token) {
        tok = prof.token as string;
        tokenCache.set(cacheKey, tok);
      }
    }
    if (!tok && creds?.token && profId === 'default') {
      tok = creds.token as string;
      tokenCache.set(cacheKey, tok);
    }

    if (tok && creds?.profiles && Array.isArray(creds.profiles)) {
      const prof = creds.profiles.find((p: any) => p.id === profId);
      if (prof && prof.tokenDurationMinutes) {
        const acquiredAt = tokenAcquiredAtCache.get(cacheKey);
        if (acquiredAt) {
          const elapsedMinutes = (Date.now() - acquiredAt) / (1000 * 60);
          if (elapsedMinutes >= Number(prof.tokenDurationMinutes)) {
            console.error(`[MCP Proxy] Token do perfil ${profId} expirou. Limpando para login...`);
            tokenCache.delete(cacheKey);
            tokenAcquiredAtCache.delete(cacheKey);
            tok = undefined;
          }
        }
      }
    }

    if (tok) {
      currentToken = tok;
      activeProfileId = profId;
      break;
    }
  }

  return { currentToken, activeProfileId, allowedProfiles };
}

export async function performAutoLogin(server: ServerRecord, profileId?: string): Promise<{ token: string; profileId: string }> {
  const creds = server.auth_credentials;
  
  // Tratamento específico de login para servidores Supabase
  if (server.type === 'supabase') {
    if (!creds || !creds.anon_key) {
      throw new Error('Credenciais de chave anônima (anon_key) do Supabase ausentes.');
    }

    let profile: any = null;
    if (creds.profiles && Array.isArray(creds.profiles)) {
      if (profileId && profileId !== 'none') {
        profile = creds.profiles.find((p: any) => p.id === profileId);
      }
      if (!profile && creds.profiles.length > 0) {
        profile = creds.profiles[0];
      }
    }

    if (!profile || !profile.email || !profile.password) {
      throw new Error(`Perfil de teste do Supabase (e-mail/senha) não configurado para o ID: ${profileId}`);
    }

    const supabaseUrl = server.api_base_url.replace(/\/rest\/v1\/?$/, '');
    const loginUrl = `${supabaseUrl}/auth/v1/token?grant_type=password`;

    console.error(`[MCP Proxy AutoLogin Supabase] Efetuando login em ${loginUrl} para ${profile.email}...`);

    const res = await fetch(loginUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': creds.anon_key,
      },
      body: JSON.stringify({
        email: profile.email,
        password: profile.password
      }),
      agent: loginUrl.startsWith('https:') ? agent : undefined
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Falha no login do Supabase (${res.status} ${res.statusText}): ${errText}`);
    }

    const data = await res.json() as any;
    const token = data.access_token;

    if (!token || typeof token !== 'string') {
      throw new Error(`Token access_token não retornado pelo Supabase: ${JSON.stringify(data)}`);
    }

    console.error(`[MCP Proxy AutoLogin Supabase] Token obtido com sucesso para o servidor ${server.name} (${profile.email})!`);
    const cacheKey = `${server.id}:${profile.id}`;
    tokenCache.set(cacheKey, token);
    tokenCache.set(server.id, token); // fallback legacy
    tokenAcquiredAtCache.set(cacheKey, Date.now());
    return { token, profileId: profile.id };
  }

  // Comportamento original para servidores REST genéricos
  if (!creds || creds.authMode !== 'auto_login') {
    throw new Error('Servidor não está configurado para auto_login.');
  }

  let profile: any = null;
  if (creds.profiles && Array.isArray(creds.profiles)) {
    if (profileId && profileId !== 'none') {
      profile = creds.profiles.find((p: any) => p.id === profileId);
    }
    if (!profile && creds.profiles.length > 0) {
      profile = creds.profiles[0];
    }
  }

  if (!profile) {
    profile = {
      id: 'default',
      name: 'Padrão',
      loginEndpoint: creds.loginEndpoint || '',
      loginMethod: creds.loginMethod || 'POST',
      loginPayload: creds.loginPayload || '',
      tokenPath: creds.tokenPath || 'token'
    };
  }

  const loginUrl = `${server.api_base_url.replace(/\/$/, '')}/${profile.loginEndpoint.replace(/^\//, '')}`;
  const method = (profile.loginMethod || 'POST').toUpperCase();
  
  let bodyPayload: any = null;
  if (profile.loginPayload) {
    try {
      bodyPayload = typeof profile.loginPayload === 'string' ? JSON.parse(profile.loginPayload) : profile.loginPayload;
    } catch (e) {
      throw new Error(`Falha ao fazer parse do JSON de loginPayload do perfil ${profile.name}.`);
    }
  }

  console.error(`[MCP Proxy AutoLogin] Disparando ${method} para ${loginUrl} (Perfil: ${profile.name})...`);

  const res = await fetch(loginUrl, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: bodyPayload ? JSON.stringify(bodyPayload) : null,
    agent: loginUrl.startsWith('https:') ? agent : undefined
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Falha no AutoLogin (${res.status} ${res.statusText}): ${errText}`);
  }

  const data = await res.json() as any;

  const pathParts = (profile.tokenPath || 'token').split('.');
  let token: any = data;
  for (const part of pathParts) {
    if (token && typeof token === 'object') {
      token = token[part];
    } else {
      token = null;
      break;
    }
  }

  if (!token || typeof token !== 'string') {
    throw new Error(`Token não encontrado no caminho "${profile.tokenPath}" da resposta de login: ${JSON.stringify(data)}`);
  }

  console.error(`[MCP Proxy AutoLogin] Token obtido com sucesso para o servidor ${server.name} (Perfil: ${profile.name})!`);
  const cacheKey = `${server.id}:${profile.id}`;
  tokenCache.set(cacheKey, token);
  tokenCache.set(server.id, token); // fallback legacy
  tokenAcquiredAtCache.set(cacheKey, Date.now());
  return { token, profileId: profile.id };
}
