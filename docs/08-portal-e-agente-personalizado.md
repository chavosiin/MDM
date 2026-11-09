# 8. Portal MDM e agente Android personalizado

Criado em 20/10/2026. São três peças que trabalham juntas:

| Peça | Onde | Para que serve |
|---|---|---|
| **Portal MDM** | `portal\` → `http://SEU_IP:8090/` | Painel simples: aparelhos, políticas, horários de bloqueio, mapa e histórico |
| **Agente personalizado** | `agente-android\` → `apk\mdm-agente.apk` | App do Headwind **sem os 3 botões laterais** e que **envia a localização a cada ~1 min** |
| **Assinatura do APK** | `assinatura-apk\mdm-agente.jks` + senha no `.env` | Chave que assina o agente. **Faça backup: sem ela você não consegue atualizar o app nos celulares** |

## Portal

Sobe junto com o resto (`.\scripts\iniciar.ps1`). O login é o **mesmo usuário e senha do
painel Headwind**. Reorganizado em 20/10/2026 para ficar mais simples. As abas são estas:

- **Início**: atalhos para as tarefas mais comuns, números do momento (celulares, contato
  recente, localização, bloqueios valendo) e a lista do que precisa de atenção (celular sem
  contato, sem controle total, bateria baixa).
- **Bloquear apps**: bloqueia apps escolhidos em certos dias e horários, sem desinstalar.
  Ver abaixo. **É o jeito recomendado de bloquear apps.**
- **Celulares**: status (último contato, bateria, última posição), troca de política
  direto na lista, botão **Aplicar agora** (o celular busca as mudanças na hora) e botão
  **Tela inicial** (fecha o app aberto).
- **Mapa**: última posição de todos os celulares ou o **trajeto do dia** de um celular.
  Atualiza sozinho a cada 1 minuto. Usa Google Maps se `GOOGLE_MAPS_API_KEY` estiver no `.env`;
  sem a chave, usa OpenStreetMap. Nos dois casos, quem abre o portal precisa de internet.
- **Políticas**: para cada app, escolha **Liberado**, **Escondido**, **Desinstalado** ou
  **Não gerenciado**, depois clique em *Salvar e aplicar*. Também tem a chave **Rastrear
  localização (mapa)**, que precisa estar ligada para o mapa funcionar.
  - *Escondido* só tira o ícone. O app continua abrindo por outros caminhos (ver doc 05).
  - *Desinstalado* remove o app. Ao liberar de novo, o app é reinstalado sem os dados.
    Para bloquear só em alguns horários, use **Bloquear apps**.
- **Troca de política**: opção avançada. Cada regra tem grupo, política de expediente,
  política de fora do expediente, dias e hora de início/fim. Janelas que passam da
  meia-noite (ex.: 22:00–06:00) funcionam. O portal confere a cada minuto e troca a política
  **na virada**. Por isso, uma troca manual feita no meio do expediente vale até a próxima
  virada.
- **Histórico**: quem fez o quê (entradas no portal, trocas, edições, execuções do agendador).

> O agendador do portal **substituiu** os antigos `alternar-politica.ps1` /
> `agendar-politica.ps1`. Em 20/10/2026 eles foram movidos para `backups\legado-20261020\`
> e a tarefa do Windows `MDM-Politica-Horario` foi excluída.

### Bloquear apps por horário (agente 6.42; lista de apps com ícone desde a 6.43)

Diferente da *Troca de política*, que muda a política inteira, aqui você escolhe
**apps específicos** e o horário em que eles ficam bloqueados. O botão **Novo bloqueio**
abre um passo a passo:

1. **Quais apps**: toque nos apps (com ícone). Primeiro vêm os que estão instalados nos
   celulares, depois uma lista de apps populares (YouTube, Instagram, TikTok...).
2. **Quando**: atalhos *Horário comercial*, *Almoço*, *À noite* e *O dia todo*, ou escolha
   os dias e o horário. Início igual ao fim (ex.: 00:00 às 00:00) quer dizer o dia todo.
3. **Em quais celulares**: todos ou um grupo.
4. **Nome** (opcional). No fim, uma frase mostra o que vai acontecer, por exemplo:
   "YouTube e Instagram ficarão bloqueados de segunda a sexta, das 12:00 às 13:00, em
   todos os celulares (4)".

Cada bloqueio vira um cartão com uma chave para ligar e desligar, além de *Editar* e *Excluir*.

- Dentro do horário, o app fica **pausado** pelo Android: o ícone fica cinza e, ao tocar,
  aparece "bloqueado pelo administrador". **Não desinstala e não apaga dados.** Fora do
  horário, o app volta ao normal sozinho.
- O celular baixa as regras do portal a cada minuto, guarda uma cópia e confere a hora
  sozinho. Por isso o bloqueio **continua funcionando sem conexão** com o servidor (testado
  com o portal desligado). Uma regra nova ou alterada só chega quando o celular falar
  com o portal de novo.
- Os celulares (agente 6.43+) enviam a lista de apps instalados com os ícones sempre que
  ela muda (e a cada 6 h). Se um app não aparecer, use "Não achou o app?" e digite o nome do
  pacote (aparece na URL da Play Store: `play.google.com/store/apps/details?id=...`).
  O próprio MDM não pode ser bloqueado.
- Precisa do agente personalizado com **controle total (Device Owner)**.
- Código: `portal/src/bloqueios.js` (regras, tabelas `portal_bloqueio_app`,
  `portal_app_aparelho` e `portal_app_icone`, rotas do agente `GET /api/agente/bloqueios`
  e `POST /api/agente/apps`, assinadas como a localização) e
  `agente-android/.../pro/BloqueioApps.java` (usa `setPackagesSuspended`).

### Liberar a porta 8090 no firewall (uma vez, PowerShell como Administrador)

Os celulares mandam a localização para a porta 8090 do PC:

```powershell
New-NetFirewallRule -DisplayName "Liberar Portal MDM 8090" -Direction Inbound -Protocol TCP -LocalPort 8090 -Action Allow
```

## Agente personalizado (sem botões + localização a cada 1 min)

O que foi alterado no código oficial (`agente-android\`, versão atual 6.49):

- `MainActivity.createLauncherButtons()`: não cria os botões de chave, info e
  atualização (flag `HIDE_MANAGE_BUTTONS` no `app\build.gradle`).
- `ProUtils.processLocation()` (6.49 também envia a altitude; 6.48: envia a posição **mais precisa** do último minuto, para a da
  antena não tomar o lugar da do GPS): na versão grátis essa função era vazia. Agora, a cada
  atualização de GPS (o agente pede uma por minuto), ela envia lat/lon, precisão,
  velocidade e bateria para `http://<servidor>:8090/api/localizacao`. O envio é assinado
  com `PORTAL_SECRET` do `.env`.

- `Utils.autoGrantRequestedPermissions()`: o próprio agente **sempre** mantém a
  permissão de localização, mesmo quando a política está em "negar localização"
  (`DENYLOCATION`). A regra continua valendo para os outros apps. Sem isso, o agente tirava
  a localização dele mesmo e o mapa ficava vazio (problema encontrado no Moto g54 em
  20/10/2026 e corrigido na versão 6.41).

- `pro/BloqueioApps.java` (6.42): bloqueio de apps por horário, iniciado em `App.onCreate()`. Na 6.43 passou a enviar também a lista de apps instalados, com ícones.
  Na 6.47 os apps bloqueados pelo horário também **somem da tela inicial** (`AppShortcutManager`
  pula os pacotes de `BloqueioApps.ocultosPorHorario()`, e a `MainActivity` redesenha quando o
  Android avisa que um app foi pausado ou liberado). O portal também ganhou o modo
  **"Liberar só no horário"**: ele manda ao celular o resto da semana como janelas de bloqueio
  (`inverterJanela()` em `portalsrcbloqueios.js`), então o agente não precisou mudar para isso.

- `pro/ModoRestrito.java` (6.44): **modo restrito**, ligado quando a política tem o campo
  `allowedClasses` preenchido (só pela API; o painel não mostra esse campo). Com ele:
  - só as telas das Configurações listadas em `allowedClasses` abrem. Qualquer outra tela
    (inclusive a Central de segurança) volta para a tela inicial do MDM, e o controle de
    brilho da barra de cima continua funcionando;
  - todo app com ícone que **não está na política** fica pausado (não abre e não mostra
    notificação). Para liberar um app, coloque ele na política.

  O agente precisa do "Acesso ao uso" para saber qual tela está aberta. É preciso liberar
  uma vez por aparelho, pelo cabo:
  `adb shell appops set com.hmdm.launcher GET_USAGE_STATS allow`.
  Sem isso, os apps continuam pausados, mas as telas das Configurações não são filtradas.

  Usado na política 8 (Moto g54) desde 21/10/2026, com Wi-Fi + Tela liberados:
  `.Settings$WifiSettingsActivity, .Settings$NetworkProviderSettingsActivity,
  .Settings$ConfigureWifiSettingsActivity, .Settings$WifiDetailsSettingsActivity, .wifi.*,
  .panel.*, .Settings$DisplaySettingsActivity, .Settings$AdaptiveBrightnessActivity,
  .Settings$DarkThemeSettingsActivity, .Settings$NightDisplaySettingsActivity,
  .Settings$ScreenTimeoutActivity, com.android.settings.SubSettings`
  (nome começando com ponto = dentro de `com.android.settings`; `.*` no fim = prefixo).
  Cópia da política antes da mudança: `backups\politica-8-antes-20261021.json`.

  Na 6.45 o modo restrito também liga o **modo quiosque do Android** (lock task), sempre que
  a tela inicial do MDM aparece. Com ele, ao puxar a barra de cima aparecem só as
  notificações: os botões rápidos (Wi-Fi, brilho, lanterna, engrenagem) somem. Por isso a
  política 8 ganhou um ícone **Config** na tela inicial (app do tipo "intent" com a ação
  `com.hmdm.launcher.CONFIG`). Ele abre a `ui/ConfigActivity` do agente, que tem só dois
  botões: **Wi-Fi** e **Tela** (brilho, tempo da tela, tema escuro). O ícone das
  Configurações do Android (`com.android.settings`, "Configurar") fica **na política, mas
  oculto**: precisa estar na política para as telas de Wi-Fi e Tela abrirem.

  Na 6.46 o assistente de configuração do Google (`com.google.android.setupwizard`) também
  entrou na lista bloqueada: a notificação "Configuração do Android: toque para concluir"
  abria esse assistente. Desde 21/10/2026 a política 8 também deixa o
  **usuário escolher o tempo da tela** (`manageTimeout = false`).

  O Android **não deixa pausar a Play Store** (`com.android.vending`, instalador do
  sistema). Fora da política, ela só fica sem ícone. Se alguém abrir a loja por um link e
  instalar outro app, esse app é pausado em até 1 minuto, porque não está na política. As
  atualizações automáticas dos apps liberados continuam funcionando.

Para atualizar o agente (aumente `versionCode`/`versionName` em `agente-android\app\build.gradle` antes):

```powershell
.\scripts\compilar-agente.ps1                       # gera apk\mdm-agente.apk
.\scripts\publicar-agente.ps1 -RemoverAnteriores    # envia ao servidor, coloca em todas as políticas, corrige o checksum
```

Os celulares baixam a versão nova na próxima sincronização. Nas políticas com Push em
"polling", isso pode levar até 15 min.

> ⚠️ **20/10/2026:** no Moto g54, a atualização pelo servidor (6.42 → 6.43) foi baixada,
> mas o Android recusou a instalação: `INSTALL_FAILED_VERIFICATION_FAILURE: Install not
> allowed`. A causa provável é o **Google Play Protect** recusando o app modificado. Pelo cabo
> funciona: `adb install -r apk\mdm-agente.apk` (mantém o controle total, não precisa
> formatar). Enquanto isso não for resolvido, **atualize o agente pelo cabo**.
>
> Também em 20/10/2026 foi corrigido no `publicar-agente.ps1` o nome do arquivo enviado:
> antes era sempre o mesmo, e ao apagar a versão antiga o servidor apagava junto o APK novo
> (o celular recebia erro 404).

### Como colocar o agente novo nos celulares

O agente novo é assinado com **a nossa chave**, não com a do Headwind. O Android **não
deixa atualizar** um app instalado com outra assinatura, então **os celulares já
cadastrados precisam ser cadastrados de novo** (reset de fábrica + QR code).

**No servidor (feito em 20/10/2026):** a versão 6.40 (`mdm-agente.apk`) foi enviada para
*Headwind MDM* (`com.hmdm.launcher`) e colocada em todas as políticas como app principal.
O QR code de cadastro já baixa o agente novo.

> ⚠️ Ao enviar uma versão nova no futuro, o painel deixa o checksum vazio. O Android
> exige esse checksum em Base64 *URL-safe* (sem `+`, `/` e `=`). Se o QR falhar com erro de
> checksum, grave o valor certo:
> `openssl dgst -sha256 -binary volumes/work/files/mdm-agente.apk | base64 | tr '+/' '-_' | tr -d '='`
> → coluna `apkhash` da tabela `applicationversions`.

**Opção 1: QR code** (precisa de reset de fábrica)

1. Celular: reset de fábrica → na tela de boas-vindas, toque 6 vezes no mesmo ponto → leia
   o QR code da política (painel → Configurations → QR code).
2. Quando o app pedir, **permita a localização "o tempo todo"**.

**Opção 2: pelo cabo USB** (também precisa de reset de fábrica, mas não precisa de QR)

O agente antigo é *Device Owner* e o Android **não deixa remover um Device Owner pelo
cabo** (`dpm remove-active-admin` só funciona com apps de teste). O app antigo também não
tem nenhuma opção para se desligar. Por isso, **para trocar do agente antigo para o novo,
o reset de fábrica é obrigatório**. Depois do reset dá para fazer tudo pelo cabo, sem QR:

```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
# No celular, depois do reset: pule a conta Google, ative Opções do desenvolvedor + Depuração USB
& $adb devices                                   # deve listar o aparelho como "device"
& $adb install C:\Projetos\MDM\apk\mdm-agente.apk
& $adb shell dpm set-device-owner com.hmdm.launcher/.AdminReceiver
& $adb shell cmd package set-home-activity com.hmdm.launcher/.ui.MainActivity
```

Depois, abra o app no celular e informe o endereço do servidor (`http://10.10.1.51:8080`)
e o número do aparelho. Requisitos do `set-device-owner`: nenhuma conta no aparelho (ver
as dicas da Motorola no doc 05).

**Daqui para frente não precisa mais de reset:** os celulares com o agente novo recebem
as próximas versões normalmente pelo servidor, desde que compiladas com a mesma chave
(`assinatura-apk\`).

Em cada política usada pelos vendedores, ligue **Rastrear localização** (portal, aba
Políticas).

## Limites (seja realista)

- **A localização só chega com o celular conectado ao servidor.** Com o servidor neste
  PC, isso significa na **mesma rede Wi-Fi**. Para acompanhar vendedores na rua, o servidor
  (Headwind + portal) precisa ir para um VPS com domínio e HTTPS (ver doc 01). Depois
  disso, recompile o agente com `MDM_LOCATION_URL=https://seu-dominio/...` no `.env`, ou
  deixe vazio para usar `host-do-servidor:8090`.
- "A cada 1 minuto" é o que o agente pede ao Android. Com o celular parado ou em economia
  de bateria, o Android pode espaçar as atualizações.
- As posições ficam guardadas por 90 dias (`PORTAL_DIAS_LOCALIZACAO`). Avise os vendedores
  que a localização é monitorada (LGPD).
- O portal usa HTTP, sem criptografia. Serve para a rede interna. Na internet, coloque-o
  atrás de HTTPS.
