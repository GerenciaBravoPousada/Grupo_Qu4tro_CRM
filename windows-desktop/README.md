# Grupo Qu4tro Desktop

O instalador x64 reúne o CRM e o componente do diário de 72 horas. Usa o Microsoft Edge WebView2 Runtime já instalado no Windows. A versão web continua disponível pelo navegador. O aplicativo Desktop usa os arquivos empacotados na versão do instalador e mantém a conexão com o projeto existente. Para atualizar os arquivos empacotados, gere e distribua uma nova versão do instalador.

## Instalação

Execute GrupoQu4tro-Desktop-Setup.exe na conta Windows usada pela recepção. O instalador verifica o WebView2 e faz uma escrita de teste criptografada na pasta `C:\Gestão de Apps Grupo Qu4tro\Backup_72hs_Gestao_Clientes`. O Windows protege os registros pela conta que usa o CRM. Ao atualizar, as operações ainda dentro das 72 horas do diário nativo anterior são copiadas, e a pasta anterior é preservada. Cria atalhos na área de trabalho, no menu Iniciar e na pasta de Inicialização do usuário. Depois de entrar no Windows, o CRM abre automaticamente na tela de login. A manutenção do diário roda pelo Agendador de Tarefas enquanto a conta do Windows está em sessão.

O Windows exige ação do usuário para fixar o ícone. Com o CRM aberto, clique no ícone da barra de tarefas com o botão direito e escolha Fixar na barra de tarefas.

O Desktop desativa o preenchimento automático de senhas, ignora sessões salvas de aberturas anteriores e mantém o limite de 10 horas por login. Esse limite é aplicado no Desktop. A autenticação do Supabase no servidor pertence à etapa separada de migração do login.

## Compilação e verificação

Use Build-Installer.ps1 com o pacote Microsoft.Web.WebView2 versão 1.0.4370.26 já extraído e o caminho do executável a gerar. O comando de diagnóstico --verify-package extrai os arquivos em uma pasta temporária e testa se o Desktop reconhece o runtime, sem instalar atalhos ou agendar tarefas.

Antes da distribuição para a equipe, assine o executável e valide a instalação completa em um terminal piloto. Confirme a abertura automática após novo logon no Windows, a tela de senha, a gravação do diário por uma operação de teste e a renovação da sessão. O pacote de piloto não instala o WebView2 se ele estiver ausente.
