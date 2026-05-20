export interface ProxyRequestLog {
  timestamp: string;
  endpoint: string;
  method: string;
  requestHeaders: Record<string, string>;
  requestBody: any;
  queryParams?: Record<string, any> | undefined;
  responseStatus: number;
  responseHeaders: Record<string, string>;
  responseBody: any;
  authProfileId?: string | undefined;
}

export const proxyLogs: ProxyRequestLog[] = [];

export function pushProxyLog(log: ProxyRequestLog) {
  proxyLogs.unshift(log);
  if (proxyLogs.length > 10) {
    proxyLogs.pop();
  }
}
