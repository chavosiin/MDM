# 4. Política do vendedor externo — bloqueio de apps

Objetivo: liberar os apps de trabalho (ex.: app de vendas/CRM, WhatsApp Business,
Maps) e ocultar/bloquear os demais (redes sociais, jogos, lojas de apps de terceiros).

Isso é feito editando a **Configuration** `Vendedores Externos - Padrão` criada em
[`02-primeiro-acesso.md`](02-primeiro-acesso.md).

## Aba Applications (aplicativos)

Para cada aplicativo relevante, adicione uma entrada e defina o comportamento:

| Situação | O que configurar |
|---|---|
| App de trabalho que **deve estar instalado** | Adicione o APK em **Applications**, marque **Install**, associe à Configuration |
| App pré-instalado que **deve sumir da tela** | Adicione o pacote (package ID) e desmarque **Show icon** — o ícone some do launcher do MDM, o usuário não consegue abrir |
| App que **deve ser removido** de vez | Marque **Remove** na entrada do app |
| App do sistema que não pode ser removido, mas não deve rodar | Combine "esconder ícone" com as restrições da aba MDM Settings (abaixo) |

> Para achar o **package ID** de um app (ex. `com.instagram.android`), veja na Play
> Store pela URL, ou use `adb shell pm list packages` com o celular conectado ao PC.

## Aba MDM Settings / Restrictions

Dependendo da versão, aqui você encontra opções como:
- Bloquear reset de fábrica pelo usuário
- Bloquear acesso às configurações do Android
- Bloquear instalação de apps fora do MDM
- Definir política de senha/tela de bloqueio

Nem todas essas opções de restrição avançada estão disponíveis na edição Community —
teste na prática com seu aparelho piloto e confira
[`07-limites-community-vs-enterprise.md`](07-limites-community-vs-enterprise.md).

## Aplicando e testando

1. Salve a Configuration.
2. No aparelho piloto, force uma sincronização (normalmente há um botão no app do
   agente, ou aguarde o intervalo configurado).
3. Confirme: os apps de trabalho aparecem, os bloqueados sumiram/não abrem.
4. Ajuste iterativamente — é comum precisar de 2–3 rodadas até o conjunto de apps
   ficar exatamente como o time comercial precisa no dia a dia.

## Escalando para mais vendedores

Depois de validado no piloto:
1. Cadastre os demais aparelhos ([`03-cadastro-de-aparelhos.md`](03-cadastro-de-aparelhos.md)),
   todos no grupo `Vendedores Externos`.
2. Qualquer alteração futura na Configuration se propaga para todos automaticamente
   no próximo ciclo de sincronização — não precisa mexer aparelho por aparelho.

Próximo passo (opcional): restringir por horário de expediente —
[`05-bloqueio-por-horario.md`](05-bloqueio-por-horario.md).
