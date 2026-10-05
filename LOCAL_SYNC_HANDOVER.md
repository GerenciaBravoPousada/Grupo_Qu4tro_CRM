# Atualizações do CRM por sessão

- Clientes e visitas são consultados na lista local durante o atendimento.
- Login, F5, troca de casa e botão Atualizar dados verificam o manifesto antes de baixar tabelas alteradas.
- Leña/Íconico: atualização diária às 18h15. Bravo Café/Café da Bravo Pousada: às 07h15, horário de São Paulo. O relógio local é verificado sem consultar o banco periodicamente; uma aba suspensa verifica o horário quando volta a ficar visível.
- Reservas são filtradas pelas casas autorizadas e pela casa selecionada.
- Clientes, check-ins e reservas são enviados imediatamente, com fila durável para falhas. Operações não são descartadas após tentativas malsucedidas.
- Novas reservas, alterações e exclusões para hoje enviam apenas identificador/revisão por canal da casa. Sim busca os IDs alterados; Não mantém o aviso pendente. Reconexão recupera o histórico de identificadores.
- Alterações concorrentes de clientes usam updated_at e exigem revisão do atendente antes de sobrescrever. Cadastros duplicados não sobrescrevem automaticamente outro cliente.
- Sair aguarda a fila; falhas mantêm a sessão e os dados pendentes.

## Banco

Migration: `supabase/migrations/20261005113021_crm_local_lists_notifications.sql`. As views públicas do CRM apontam para as tabelas de `grupo_qu4tro`; os gatilhos ficam nas tabelas reais. Manifesto e histórico de eventos são somente leitura para o cliente. RPCs de gravação usam SECURITY INVOKER e as permissões existentes. Eventos não contêm nomes ou telefones.

## Validação

`node tests/local-sync.browser.cjs`: login, escopo da casa, ausência de polling, versões inalteradas/alteradas, gravação imediata, F5, aviso adiado, atualização por ID, exclusão, conflito preservado, revisão e saída, horários 07h15/18h15.

Consultas de verificação no banco foram executadas em transação com rollback; não deixaram clientes, visitas ou reservas de teste. Broadcast do banco foi recebido em um navegador num canal temporário de teste. Security Advisors não identificou alertas relacionados aos objetos novos.

## Publicação

Produção: https://crm-grupo-qu4tro.iconiko.com.br/ . Publicar main e gh-pages conforme AGENTS.md; verificar workflow e arquivos servidos. Pedir Ctrl+F5 nos aparelhos que estavam com a versão antiga.

A economia financeira só poderá ser confirmada com uso real posterior; a mudança elimina a busca integral a cada 30 segundos, mas não elimina custos fixos do plano.
