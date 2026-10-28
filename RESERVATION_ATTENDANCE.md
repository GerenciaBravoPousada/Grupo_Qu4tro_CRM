# Comparecimento de reservas

A coluna Comparecimento e os indicadores da tela Reservas usam check-ins salvos, não o status legado Convertida. Abrir o formulário não modifica a reserva. Concluir a chegada pela reserva salva o vínculo e envia ambas as gravações pela fila existente. O check-in comum também vincula uma única reserva ativa do mesmo cliente, data e casa; ambiguidades precisam de conferência.

Reservas de datas anteriores a hoje sem check-in vinculado são automaticamente classificadas como Não compareceu, inclusive na coluna de status e no filtro. Reservas de hoje e futuras ficam Aguardando. Cancelamentos continuam separados. Conferir presença oferece registros do mesmo cliente (ID ou telefone normalizado), data e casa para confirmação. O mesmo check-in não pode ser vinculado duas vezes. Não há associação por nome apenas. A falta é automática quando a data já passou; não exige confirmação da recepção. Desfazer conferência preserva a visita.

Comparecimento e não comparecimento usam como denominador apenas compareceram + não compareceram. Cancelamento usa todas as reservas filtradas. Aguardando e cancelamentos ficam fora da taxa de comparecimento. Cards compactos exibem apenas quantidades de reservas e taxas, sem texto auxiliar. Os filtros existentes delimitam os indicadores; o novo filtro de presença só restringe a lista, sem enviesar as taxas.

O vínculo e a conferência são preservados em uma marca estruturada no campo notes da reserva, compatível com os RPCs atuais. Não há migração nem alteração em massa dos dados antigos. O formulário de edição oculta essa marca e a preserva ao salvar. Visita ausente, excluída ou com data/casa divergente não comprova presença. Este controle documenta o registro da recepção; não é uma comprovação física independente da chegada.

Validação: `node tests/reservation-attendance.cjs` e `node tests/reservation-attendance.browser.cjs` (Playwright). O teste browser usa dados fictícios e RPCs simulados: abertura sem conversão, check-in pela reserva e comum, payload persistido, releitura, conferência histórica, falta, percentuais, filtro e desfazer. Nenhum dado de teste é enviado à produção.

O teste preexistente `tests/local-sync.browser.cjs` falha em `unchanged manifest reuses lists` também no código original, sem esta alteração; essa falha não foi modificada neste trabalho.

Publicação: seguir AGENTS.md para main e gh-pages e verificar o workflow e o conteúdo servido. Cache do service worker atualizado para v1.0.50.
