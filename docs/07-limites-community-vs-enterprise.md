# 7. Community vs. Enterprise — o que é grátis, o que provavelmente não é

O Headwind MDM é open source, mas o site oficial vende um plano **Enterprise/Premium**
com recursos adicionais. As duas fontes oficiais que consultei para montar este
projeto **não concordam totalmente entre si** sobre onde fica exatamente a linha —
então trate a tabela abaixo como "melhor estimativa a validar no seu piloto", não
como garantia.

## Confirmado como disponível na Community (open source, grátis)

- Instalar/atualizar/remover aplicativos remotamente
- Ocultar o ícone de um app (efetivamente impede o uso sem desinstalar)
- Bloqueio de aplicativos indesejados — a matriz de recursos do site (h-mdm.com)
  lista "Blocking unwanted applications" como suportado a partir do Android 4+,
  sem marcar como recurso pago
- Inventário de aparelhos, status, bateria, última sincronização
- Bloqueio remoto de tela e wipe remoto
- Modo quiosque de aplicativo único, a partir de Android 6 (documentado em
  [h-mdm.com/kiosk-mode](https://h-mdm.com/kiosk-mode/) como configuração padrão do
  painel — embora uma página de review antiga afirme o contrário; **valide na prática**)
- Cadastro via QR code (Device Owner) e via APK (Device Admin)

## Provavelmente Enterprise/Premium (não incluso na instalação Docker deste projeto)

- Rastreamento de localização (GPS) contínuo
- Relatórios com foto (comprovação de visita/entrega)
- Controle remoto de tela (ver e operar a tela do aparelho em tempo real)
- Filtragem de tráfego web / bloqueio de sites
- Restrições avançadas de acesso a configurações do Android além do básico
- Integração com firmware OEM (Samsung Knox, etc.)
- **Bloqueio de app por horário/agenda automática** — não encontrei essa opção
  documentada nem na versão grátis nem paga; o workaround proposto em
  [`05-bloqueio-por-horario.md`](05-bloqueio-por-horario.md) (duas políticas + troca
  agendada via API) é a alternativa

## O que fazer com essa incerteza

1. Rode o piloto local deste projeto.
2. Teste especificamente os dois requisitos que você mencionou — **bloqueio de apps**
   (deve funcionar na Community, segundo a documentação) e **restrição por horário**
   (não é nativo; use o workaround ou avalie o plano pago).
3. Se algum recurso Enterprise for indispensável, [fale com a Headwind MDM](https://h-mdm.com/)
   para orçar antes de escalar o piloto para toda a frota — evita descobrir a
   limitação só depois de já ter cadastrado 50 aparelhos.

## Fontes consultadas

- [h-mdm.com](https://h-mdm.com/) — página inicial, seção de recursos e planos
- [h-mdm.com/headwind-mdm-capabilities](https://h-mdm.com/headwind-mdm-capabilities/) — matriz de recursos por versão do Android / modo de instalação
- [h-mdm.com/kiosk-mode](https://h-mdm.com/kiosk-mode/) — configuração do modo quiosque
- [h-mdm.com/quick-start](https://h-mdm.com/quick-start/) — fluxo de cadastro de aparelho
- [github.com/h-mdm/hmdm-docker](https://github.com/h-mdm/hmdm-docker) — instalação oficial via Docker
