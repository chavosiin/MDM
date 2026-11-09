# 2. Primeiro acesso ao painel

## Login inicial

Acesse `http://SEU_IP:8080/`.

- Usuário: `admin`
- Senha: `admin`

O sistema deve pedir para trocar a senha no primeiro login. **Troque e guarde em um
gerenciador de senhas** — esse usuário tem acesso total ao MDM (inclusive comando de
apagar/bloquear aparelhos remotamente).

> Se `admin`/`admin` não funcionar, veja os logs (`.\scripts\logs.ps1`) logo após a
> primeira inicialização — algumas versões geram e imprimem uma senha aleatória no
> log de start.

## Idioma

No menu de perfil (canto superior direito), verifique se há opção de idioma
Português — nem toda versão traz tradução completa; se não houver, o painel funciona
normalmente em inglês.

## Conhecendo o menu

| Menu | Para que serve |
|---|---|
| **Devices** | Lista de aparelhos cadastrados, status, último contato, bateria |
| **Configurations** | Políticas: quais apps instalar/remover/ocultar, restrições, modo quiosque |
| **Applications** | Catálogo de APKs que o servidor pode empurrar para os aparelhos |
| **Groups** | Agrupamento de aparelhos (ex.: "Vendedores Externos", "Depósito") — cada grupo usa uma Configuration |
| **Users** | Contas de acesso ao painel (para sua equipe de TI/suporte) |
| **Plugins** | Recursos adicionais instaláveis (alguns são Enterprise) |

## Passo a passo desta primeira configuração

1. **Groups → Add group**: crie o grupo `Vendedores Externos`.
2. **Configurations → Add configuration**: crie `Vendedores Externos - Padrão`
   (você vai detalhar o conteúdo dela em
   [`04-politica-vendedor-externo.md`](04-politica-vendedor-externo.md)).
3. Associe a Configuration criada ao Group `Vendedores Externos` (campo dentro da
   tela do grupo ou da configuração, dependendo da versão).
4. **Users**: se outras pessoas da equipe vão operar o MDM, crie um usuário para
   cada uma em vez de compartilhar o `admin`.

Com isso pronto, o próximo passo é cadastrar (enrolar) o primeiro aparelho —
[`03-cadastro-de-aparelhos.md`](03-cadastro-de-aparelhos.md).
