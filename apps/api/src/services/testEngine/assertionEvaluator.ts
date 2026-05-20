export function getValueByPath(obj: any, path: string): any {
  if (obj === null || obj === undefined) return undefined;
  const normalizedPath = path.replace(/^\$\.?/, '');
  if (!normalizedPath) return obj;

  const parts = normalizedPath.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

export function evaluateAssertion(
  data: any,
  assertion: { path: string; operator: string; value?: any }
): { success: boolean; message: string } {
  const actualValue = getValueByPath(data, assertion.path);
  const operator = assertion.operator;
  const expectedValue = assertion.value;

  switch (operator) {
    case 'eq':
      if (actualValue === expectedValue) {
        return { success: true, message: `Asserção OK: ${assertion.path} é igual a ${expectedValue}` };
      }
      return {
        success: false,
        message: `Asserção FALHOU: esperado ${assertion.path} ser igual a ${expectedValue}, mas obteve ${actualValue}`
      };
    case 'neq':
      if (actualValue !== expectedValue) {
        return { success: true, message: `Asserção OK: ${assertion.path} é diferente de ${expectedValue}` };
      }
      return {
        success: false,
        message: `Asserção FALHOU: esperado ${assertion.path} ser diferente de ${expectedValue}, mas obteve ${actualValue}`
      };
    case 'contains':
      if (typeof actualValue === 'string' && actualValue.includes(String(expectedValue))) {
        return { success: true, message: `Asserção OK: ${assertion.path} contém '${expectedValue}'` };
      }
      if (Array.isArray(actualValue) && actualValue.includes(expectedValue)) {
        return { success: true, message: `Asserção OK: array ${assertion.path} contém ${expectedValue}` };
      }
      return {
        success: false,
        message: `Asserção FALHOU: esperado ${assertion.path} conter ${expectedValue}, mas obteve ${JSON.stringify(actualValue)}`
      };
    case 'not_null':
      if (actualValue !== null && actualValue !== undefined && actualValue !== '') {
        return { success: true, message: `Asserção OK: ${assertion.path} não é nulo/vazio` };
      }
      return {
        success: false,
        message: `Asserção FALHOU: esperado ${assertion.path} não ser nulo/vazio, mas obteve ${actualValue}`
      };
    default:
      return { success: false, message: `Asserção FALHOU: operador desconhecido '${operator}'` };
  }
}
