# 5. Restrição por horário de expediente

## O que a edição Community faz "de fábrica"

A interface do Headwind MDM Community **não tem um seletor nativo de "bloquear este
app das 18h às 8h"**. O que existe nativamente é uma Configuration fixa: os apps
liberados/bloqueados valem o tempo todo, até você trocar a Configuration do aparelho.

## Abordagem recomendada: duas Configurations + troca automática

> ✅ **Testado ponta a ponta em 16/10/2026** (Headwind 5.40.1-os, agente 6.37, emulador
> Android 15 em modo Device Owner): a troca de política foi aplicada em ~20 s via push,
> nos dois sentidos.
>
> **Desde 20/10/2026 a troca automática é feita pelo Portal MDM** (aba *Horários de
> bloqueio*, ver [doc 08](08-portal-e-agente-personalizado.md)). Os scripts antigos
> `alternar-politica.ps1` / `agendar-politica.ps1` foram aposentados (cópia em
> `backups\legado-20261020\`).

No Headwind a política fica **no aparelho** (`configurationId`), não no grupo. O grupo
serve só para escolher quais aparelhos serão trocados.

1. Crie uma segunda Configuration, `Vendedores Externos - Fora de Expediente`. O jeito
   mais fácil: no painel completo, em **Configurations**, use **Copy** na política normal.
   Depois, na aba **Políticas** do portal, marque como *Sem ícone* ou *Bloqueado* os apps
   que não devem funcionar fora do horário.
2. Coloque todos os aparelhos dos vendedores no grupo `Vendedor Externo`.
3. No portal, aba **Horários de bloqueio** → **Novo horário**: escolha o grupo, as duas
   políticas, os dias e o horário. Ao salvar, a política certa para este momento é
   aplicada na hora. Depois disso, o portal troca sozinho em cada virada. Se o PC estava
   desligado na virada, ele corrige assim que voltar.

### Como ficou no piloto (app SuperFood)

- O app `com.superfood.mobile` está cadastrado em **Applications** e é **instalado pelo
  MDM** nas duas políticas. O que muda é só o **Show icon**: visível das 08h às 22h,
  oculto fora disso. O app nunca é desinstalado, então login e dados ficam preservados.
- Os apps padrão (Telefone, Contatos, Mensagens, Maps, Chrome) ficam visíveis nas duas.
- Na virada para "Fora de Expediente", o script também manda o aparelho para a tela
  inicial, tirando o SuperFood da frente se ele estiver aberto.
- **Para trocar o APK**: suba a nova versão em **Applications** (mesmo pacote) e os
  aparelhos atualizam na próxima sincronização.

### Limitações encontradas no teste

- **Ocultar o ícone não impede o app de rodar.** O app some do launcher do MDM, mas
  se for aberto por outro caminho (link, notificação, atalho) ele abre normalmente.
  O caminho mais óbvio para o vendedor é a **engrenagem da barra de notificações**,
  que abre as Configurações do Android. A opção `Block status bar` **não teve efeito**
  fora do modo quiosque. Para bloquear de verdade, as opções são: modo quiosque,
  remover o app (`Remove`, só para apps que não são do sistema) ou o plano pago.
- **Quem estava com o app aberto pode reabri-lo pela tela de Recentes** depois das 22h.
  O MDM tira o app da frente, mas ele continua em Recentes. Como o SuperFood é um app
  próprio, a trava definitiva é ele mesmo (ou a API dele) recusar uso fora do horário.
- O PC com o servidor precisa estar **ligado** às 8h e às 18h (o agendador roda nele).
  Se o aparelho estiver sem rede na hora da troca, ele aplica na próxima sincronização.
- Esse é um **workaround de infraestrutura**, não um recurso documentado do produto.
  Monitore se continua funcionando após atualizações do Headwind MDM.

### Teste no celular físico (Moto g54 5G, Android 15) — 16/10/2026

- **Modo "Administrador do dispositivo"** (instalação comum, sem reset): o MDM só esconde
  ícones; o usuário sai do launcher normalmente. Não serve para controle.
- **Modo "Dono do dispositivo" (Device Owner)** é obrigatório para controle. Dois caminhos:
  1. Reset de fábrica + QR code (`/rest/public/qr/<qrCodeKey>?deviceId=<n>`). A
     Configuration precisa ter o **Headwind MDM como "main app"** (`mainAppId`), senão o
     QR sai vazio.
  2. Sem reset, via USB: depuração USB ligada, **nenhuma conta no aparelho** (Google,
     WhatsApp, Meet e a conta interna "Números de serviço" da Motorola — esta só sai com
     `pm uninstall -k --user 0 com.motorola.contacts.preloadcontacts`, revertido depois
     com `cmd package install-existing`), e então
     `adb shell dpm set-device-owner com.hmdm.launcher/.AdminReceiver`.
     Depois: `cmd package set-home-activity com.hmdm.launcher/.ui.MainActivity`.
- Como Device Owner, as restrições da política foram aplicadas (bloqueio de reset de
  fábrica, modo seguro, desinstalar/instalar apps, data/hora etc.) e o push chega em ~2 s.
- **Ocultar ícone (Show icon) não bloqueia**: o app continua abrindo por outros caminhos.
- **Modo quiosque não funciona na edição Community**: com `kioskMode=true` (tanto com o
  launcher quanto com um app único como app principal) o agente 6.37-os não entra em
  Lock Task. É recurso do plano pago.
- **O que bloqueia de verdade na Community**: na política "Fora de Expediente", marcar o
  app com ação **Remove** (`action=2`). Testado: o app foi desinstalado em ~3 s, sem
  pergunta ao usuário, e reinstalado sozinho em ~9 s ao voltar para "Expediente".
  **Custo:** cada reinstalação apaga os dados do app (o vendedor precisa logar de novo
  todo dia).
- **Painel de notificações (arrastar para baixo)**: `Block status bar` não tem efeito sem
  quiosque. O que dá para fazer é travar os controles: `no_config_tethering`,
  `no_airplane_mode`, `no_config_location`, `no_config_mobile_networks`, `no_config_vpn`.
  `lockSafeSettings=true` faz o agente fechar o painel assim que ele abre.
- ⚠️ **Não usar `no_config_brightness` em Motorola (Android 15)**: com o brilho travado,
  abrir o painel derruba a SystemUI da Motorola (`CalledFromWrongThreadException` em
  `BrightnessSliderView.setAdminBlocker`) e, após algumas quedas seguidas, o aparelho
  reinicia. Testado e revertido em 16/10/2026.
- **Janela de ~40 s sem travas**: a cada troca de política o agente libera todas as
  restrições e as reaplica uma a uma (~40 s no Moto g54). Nesse intervalo os controles
  ficam livres.

## Alternativa: avaliar o plano Enterprise/Cloud

Se "bloquear app por horário" for um requisito rígido (não um nice-to-have), vale a
pena orçar o [Headwind MDM Premium/Enterprise](https://h-mdm.com/) antes de investir
tempo de engenharia no workaround acima — pode já vir pronto lá. Ver comparação em
[`07-limites-community-vs-enterprise.md`](07-limites-community-vs-enterprise.md).
