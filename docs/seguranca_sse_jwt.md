# Planejamento de Segurança: Autenticação JWT para Conexões SSE

Este documento detalha a arquitetura proposta para fechar a brecha de segurança no gateway SSE do MCP, impedindo que usuários conectem-se a servidores MCP de terceiros sabendo apenas o seu ID de UUID.

---

## 1. O Problema de Segurança Atual
Atualmente, qualquer cliente de IA (como a extensão Cursor) pode iniciar uma conexão com o gateway no endpoint:
`GET /mcp/:serverId`

Como o gateway no backend não valida quem é o usuário que está solicitando o estabelecimento do túnel de eventos SSE, basta conhecer ou adivinhar o UUID de um servidor cadastrado para conseguir expor suas ferramentas e chamar suas APIs.

---

## 2. Solução Proposta: Validação de Tokens JWT
Para blindar as conexões, adicionaremos autenticação baseada no token JWT de sessão do próprio Supabase Auth. 

### A URL de Conexão com Token
Como muitos clientes de IA possuem suporte limitado para cabeçalhos HTTP na conexão SSE inicial, passaremos o token JWT por meio de um parâmetro de query string na URL gerada para o cliente de IA:

`http://localhost:3001/mcp/:serverId?token=<JWT_DE_SESSAO>`

### Fluxo de Validação no Backend (`apps/api`)

1. **Aperto de Mão (Handshake SSE)**:
   * Na rota `GET /mcp/:serverId`, extrair o token da query string (`req.query.token`) ou do cabeçalho de autorização.
   * Invocar o método `supabase.auth.getUser(token)` para validar a assinatura do JWT.
   * Se o token for inválido, rejeitar a requisição imediatamente com status `401 Unauthorized`.
   * Se o token for válido, extrair o `user.id`.

2. **Validação de Propriedade do Servidor**:
   * Buscar o servidor solicitado no banco de dados.
   * Verificar se `serverRecord.user_id === user.id`.
   * Se não for o proprietário, rejeitar imediatamente com `403 Forbidden`.
   * Se for o proprietário, conectar a sessão normalmente e permitir o tráfego de dados.

3. **Validação nas Mensagens (POST)**:
   * A rota de postagem de respostas e mensagens (`POST /mcp/:serverId/message`) deve seguir a mesma verificação do token JWT para evitar injeções arbitrárias de pacotes por terceiros.
