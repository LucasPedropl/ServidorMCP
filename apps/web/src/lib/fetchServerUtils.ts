import https from 'https';
import http from 'http';

export function fetchBypassingTLS(targetUrl: string, options: { headers?: Record<string, string>; method?: string; body?: any } = {}): Promise<{ status: number; ok: boolean; text: string; contentType?: string }> {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(targetUrl);
      const isHttps = parsedUrl.protocol === 'https:';
      const client = isHttps ? https : http;

      const reqOptions = {
        method: options.method || 'GET',
        headers: options.headers || {},
        rejectUnauthorized: false, // Bypass TLS certificate validation (essential for dev APIs)
      };

      const req = client.request(targetUrl, reqOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode || 200,
            ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
            text: data,
            contentType: res.headers['content-type'],
          });
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      if (options.body) {
        req.write(options.body);
      }

      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

export function extractSwaggerUrl(html: string, originalUrl: string): string | null {
  // Pattern 1: url: "..." (SwaggerUI bundle configuration)
  const urlRegex = /url\s*:\s*["']([^"']+)["']/i;
  const match = html.match(urlRegex);
  if (match && match[1]) {
    try {
      return new URL(match[1], originalUrl).toString();
    } catch {
      // ignore
    }
  }

  // Pattern 2: SwaggerUI urls config list
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
