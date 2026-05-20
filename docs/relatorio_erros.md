# Relatório de Erros e Problemas - API PagWebV1
**Data**: 20 de Maio de 2026
**Status do Ambiente**: Desenvolvimento

## 1. Bugs Críticos (500 Internal Server Error)
Identificamos falhas graves de codificação (NullReferenceException) em fluxos essenciais:

*   **UserAdminController.Login**: Erro ao tentar realizar login administrativo após um usuário cliente cadastrar uma empresa. (Linha 39 do Controller).
*   **UserAdminController.ConectaAdmin**: Falha ao tentar conectar um administrador a um usuário cliente. (Linha 51 do Controller).
*   **UserBloqueioController.BloquearEmpresa**: Crash do servidor quando um usuário com status 'Inativo' tenta realizar um bloqueio. (Linha 24 do Controller).
*   **UserBloqueioController.DeletarBloqueioEmpresa/Plano**: Falhas similares de referência nula ao tentar remover bloqueios.

## 2. Falhas de Fluxo e Regras de Negócio
*   **Gestão de WhatsApp**: Retornou `403 Forbidden` para usuários recém-promovidos a estabelecimento, indicando possível delay na propagação de permissões ou erro na validação do nível de acesso `Estabelecimento`.
*   **Mensalidades**: O endpoint `GET /api/v1/Mensalidade/empresa` retornou `404 Not Found` mesmo existindo assinaturas ativas no sistema (conforme verificado via lista-assinaturas dev).

## 3. Infraestrutura de Testes (MCP)
*   **Tokens Expirados**: 95% dos casos de teste de regressão falharam com `401 Unauthorized` devido ao uso de perfis de autenticação com tokens JWT antigos.
*   **Injeção de Headers**: Observamos inconsistência na ferramenta `chamar_api_dinamica` ao tentar injetar `Authorization` via `configurar_headers_globais`.

---
*Relatório gerado automaticamente por Gemini CLI.*
