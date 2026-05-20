import {
  generateRandomCPF,
  generateRandomCNPJ,
  generateRandomEmail,
  generateRandomName,
  generateRandomPhone,
  generateRandomUUID
} from './testDataGenerators.js';

export function resolvePlaceholders(val: any, resultsMap: Map<string, any>): any {
  if (typeof val === 'string') {
    const resolved = val
      .replace(/\{\{\s*\$randomCPF\s*\}\}/g, () => generateRandomCPF())
      .replace(/\{\{\s*\$randomCNPJ\s*\}\}/g, () => generateRandomCNPJ())
      .replace(/\{\{\s*\$randomEmail\s*\}\}/g, () => generateRandomEmail())
      .replace(/\{\{\s*\$randomName\s*\}\}/g, () => generateRandomName())
      .replace(/\{\{\s*\$randomPhone\s*\}\}/g, () => generateRandomPhone())
      .replace(/\{\{\s*\$randomUUID\s*\}\}/g, () => generateRandomUUID());

    return resolved.replace(/\{\{([^}]+)\}\}/g, (match, pathStr) => {
      const trimmedPath = pathStr.trim();
      if (trimmedPath.startsWith('$random')) return match;

      const parts = trimmedPath.split('.');
      const sourceId = parts[0];

      if (!sourceId || !resultsMap.has(sourceId)) return match;

      const sourceResult = resultsMap.get(sourceId);

      if (parts.length === 1) {
        if (sourceResult === null || sourceResult === undefined || typeof sourceResult !== 'object') {
          return String(sourceResult);
        }

        const exactIdKeys: string[] = [];
        const partialIdKeys: string[] = [];

        const scanKeys = (obj: any, prefix = '') => {
          if (!obj || typeof obj !== 'object') return;
          for (const key of Object.keys(obj)) {
            const fullKey = prefix ? `${prefix}.${key}` : key;
            if (key.toLowerCase() === 'id') {
              exactIdKeys.push(fullKey);
            } else if (/id/i.test(key)) {
              partialIdKeys.push(fullKey);
            }
            if (typeof obj[key] === 'object' && !Array.isArray(obj[key]) && prefix === '') {
              scanKeys(obj[key], key);
            }
          }
        };

        scanKeys(sourceResult);

        if (exactIdKeys.length === 1 && exactIdKeys[0]) {
          let cur = sourceResult;
          const pathParts = exactIdKeys[0].split('.');
          for (const p of pathParts) {
            cur = cur?.[p];
          }
          return String(cur);
        }

        if (exactIdKeys.length > 1) {
          throw new Error(`Ambiguidade de ID exato na resposta de "${sourceId}": Foram encontradas múltiplas propriedades "id" (${exactIdKeys.join(', ')}). Por favor, declare o caminho exato desejado.`);
        }

        if (partialIdKeys.length === 1 && partialIdKeys[0]) {
          let cur = sourceResult;
          const pathParts = partialIdKeys[0].split('.');
          for (const p of pathParts) {
            cur = cur?.[p];
          }
          return String(cur);
        }

        if (partialIdKeys.length > 1) {
          throw new Error(`Ambiguidade de ID na resposta de "${sourceId}": Foram encontradas múltiplas propriedades que contêm "id" (${partialIdKeys.join(', ')}). Por favor, declare o caminho exato desejado.`);
        }

        throw new Error(`Nenhum ID detectado automaticamente na resposta de "${sourceId}".`);
      }

      let current = sourceResult;
      for (let i = 1; i < parts.length; i++) {
        if (current === null || current === undefined) return match;
        current = current[parts[i]];
      }

      return current !== undefined ? String(current) : match;
    });
  }

  if (Array.isArray(val)) {
    return val.map(item => resolvePlaceholders(item, resultsMap));
  }

  if (val && typeof val === 'object') {
    const res: any = {};
    for (const [k, v] of Object.entries(val)) {
      res[k] = resolvePlaceholders(v, resultsMap);
    }
    return res;
  }

  return val;
}
