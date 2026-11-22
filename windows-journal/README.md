# Diário local do CRM no Windows

O Chrome chama um componente do Windows pela extensão em `windows-journal/extension`. A extensão aceita pedidos apenas da tela principal do domínio do CRM. O componente não abre uma porta de rede e não tem API para exportar ou devolver dados de clientes ao navegador.

## Instalação para o piloto

1. No perfil do Chrome usado pelo CRM, carregar a extensão da pasta `windows-journal/extension` e copiar o ID exibido pelo Chrome. Para distribuição aos terminais, usar uma extensão empacotada e administrada pela equipe responsável.
2. Na conta do Windows usada pelo terminal, executar `Install-Journal.ps1 -ExtensionId ID_DA_EXTENSAO` com o Windows PowerShell. O instalador compila o componente, registra a extensão autorizada e agenda a limpeza.
3. Reabrir o CRM com a versão de teste que inclui `crm-journal.js`. Validar com dados fictícios. O diário fica em `%LOCALAPPDATA%\Grupo Qu4tro\Diario CRM\operacoes.jsonl`.

O arquivo guarda uma linha por operação. O conteúdo da operação é criptografado pelo Windows (DPAPI vinculado à conta que gravou). A pasta é restrita à conta do terminal e ao sistema local. O histórico persiste após limpar os dados do Chrome. Pode ser perdido com a remoção do perfil do Windows, perda do disco ou exclusão da pasta.

O registro é tentado antes do envio habitual. Se o componente falhar, o CRM mantém o fluxo existente e exibe um aviso persistente de operação sem proteção. Após uma resposta de sucesso do Supabase, o CRM tenta marcar a confirmação no arquivo. Com o app aberto, o CRM avisa quando houver operações ainda sem confirmação a até 12 horas do vencimento. A limpeza ocorre a cada acesso ao componente, no logon do Windows e em intervalos de cinco minutos enquanto a conta do terminal está em sessão.

Este componente não reenvia o diário, não transmite dados com o CRM fechado e não acrescenta serviços ou tabelas no Supabase. A recuperação de eventos e a prevenção de duplicidades no servidor pertencem à etapa de conciliação.

Nos terminais onde a extensão ainda não foi instalada, o CRM mantém o fluxo anterior e não espera o componente. Ao detectar a extensão no perfil do Chrome, o CRM ativa o diário e avisa se o componente do Windows estiver indisponível.
