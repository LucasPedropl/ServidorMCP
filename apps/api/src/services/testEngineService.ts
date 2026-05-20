import {
  getServerById,
  getTestCases,
  saveTestRun,
  updateTestRun
} from '../repositories/mcpRepository.js';
import { executeGenericMcpProxy } from './mcpProxyService.js';
import { evaluateAssertion } from './testEngine/assertionEvaluator.js';
import { resolvePlaceholders } from './testEngine/placeholderResolver.js';

// Re-exportações públicas de geradores e avaliadores de asserções para compatibilidade
export {
  generateRandomCPF,
  generateRandomCNPJ,
  generateRandomEmail,
  generateRandomName,
  generateRandomPhone,
  generateRandomUUID
} from './testEngine/testDataGenerators.js';

export {
  getValueByPath,
  evaluateAssertion
} from './testEngine/assertionEvaluator.js';

export async function runTestCaseEngine(
  serverId: string,
  testCaseId: string,
  variablesOverride?: Record<string, any>,
  existingTestRunId?: string
): Promise<{ status: string; durationMs: number; results: any[] }> {
  const freshServer = await getServerById(serverId);
  
  const cases = await getTestCases(serverId);
  const testCase = cases.find(c => c.id === testCaseId);
  if (!testCase) {
    throw new Error(`Caso de teste com ID ${testCaseId} não encontrado.`);
  }

  const finalVariables = {
    ...(testCase.variables_schema || {}),
    ...(variablesOverride || {})
  };

  const results: any[] = [];
  const resultsMap = new Map<string, any>();
  
  for (const [k, v] of Object.entries(finalVariables)) {
    resultsMap.set(k, v);
  }

  const startTime = Date.now();
  let status = 'success';
  let failedStepIndex = -1;

  for (let i = 0; i < testCase.steps.length; i++) {
    const step = testCase.steps[i];
    try {
      const resolvedEndpoint = resolvePlaceholders(step.endpoint, resultsMap);
      const resolvedBody = step.body ? resolvePlaceholders(step.body, resultsMap) : undefined;
      const resolvedQuery = step.queryParams ? resolvePlaceholders(step.queryParams, resultsMap) : undefined;

      const res = await executeGenericMcpProxy(
        freshServer,
        resolvedEndpoint,
        step.method,
        resolvedBody,
        resolvedQuery,
        false,
        step.authProfileId
      );

      const isError = res.isError || (res.content && res.content[0] && res.content[0].text && /erro/i.test(res.content[0].text));
      let data: any = null;

      if (!isError && res.content && res.content[0]) {
        try {
          const text = res.content[0].text;
          const jsonText = text.replace(/^\[AVISO DO SERVIDOR MCP:[^\]]+\]\n\nResposta da API:\n/, '');
          data = JSON.parse(jsonText);
        } catch {
          data = res.content[0].text;
        }
      }

      let assertionFailed = false;
      let assertionErrorMessage = '';

      if (!isError && (step as any).assertions && Array.isArray((step as any).assertions)) {
        for (const assertion of (step as any).assertions) {
          const evalRes = evaluateAssertion(data, assertion);
          if (!evalRes.success) {
            assertionFailed = true;
            assertionErrorMessage = evalRes.message;
            break;
          }
        }
      }

      const hasFailed = isError || assertionFailed;

      results.push({
        requestId: step.requestId,
        status: hasFailed ? 400 : 200,
        success: !hasFailed,
        data: isError ? null : data,
        error: isError 
          ? (res.content?.[0]?.text || 'Erro desconhecido') 
          : (assertionFailed ? assertionErrorMessage : null)
      });

      resultsMap.set(step.requestId, data);

      if (hasFailed) {
        status = 'failed';
        failedStepIndex = i;
        break;
      }
    } catch (err: any) {
      results.push({
        requestId: step.requestId,
        status: 500,
        success: false,
        data: null,
        error: err.message
      });
      status = 'failed';
      failedStepIndex = i;
      break;
    }
  }

  // --- FASE DE TEARDOWN EM CASO DE FALHA ---
  if (status === 'failed' && failedStepIndex !== -1) {
    console.error(`[MCP Engine] Teste falhou no passo ${failedStepIndex + 1}. Iniciando fase de Teardown...`);
    for (let i = failedStepIndex + 1; i < testCase.steps.length; i++) {
      const step = testCase.steps[i];
      if (step.method.toUpperCase() === 'DELETE') {
        try {
          const resolvedEndpoint = resolvePlaceholders(step.endpoint, resultsMap);
          const resolvedBody = step.body ? resolvePlaceholders(step.body, resultsMap) : undefined;
          const resolvedQuery = step.queryParams ? resolvePlaceholders(step.queryParams, resultsMap) : undefined;

          console.error(`[MCP Engine Teardown] Executando limpeza no passo: ${step.requestId}`);
          const res = await executeGenericMcpProxy(
            freshServer,
            resolvedEndpoint,
            step.method,
            resolvedBody,
            resolvedQuery,
            false,
            step.authProfileId
          );

          const isError = res.isError || (res.content && res.content[0] && res.content[0].text && /erro/i.test(res.content[0].text));
          let data: any = null;
          if (!isError && res.content && res.content[0]) {
            try {
              const text = res.content[0].text;
              const jsonText = text.replace(/^\[AVISO DO SERVIDOR MCP:[^\]]+\]\n\nResposta da API:\n/, '');
              data = JSON.parse(jsonText);
            } catch {
              data = res.content[0].text;
            }
          }

          results.push({
            requestId: `${step.requestId}_teardown`,
            status: isError ? 400 : 200,
            success: !isError,
            data: isError ? null : data,
            error: isError ? res.content?.[0]?.text || 'Teardown falhou' : null,
            isTeardown: true
          });
        } catch (teardownErr: any) {
          console.error(`[MCP Engine Teardown] Ignorando passo de teardown ${step.requestId} devido a erro:`, teardownErr.message);
        }
      }
    }
  }

  const durationMs = Date.now() - startTime;

  if (existingTestRunId) {
    await updateTestRun(existingTestRunId, status, durationMs, results);
  } else {
    await saveTestRun(testCase.id, status, durationMs, results);
  }

  return { status, durationMs, results };
}
