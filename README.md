# MDM — Controle de Celulares (Headwind MDM)

Projeto para instalar e operar o **Headwind MDM** (plataforma open source de MDM para
Android) em modo **piloto local**, via Docker Desktop no Windows, para controlar
celulares de **vendedores externos**: bloqueio de aplicativos, restrição por horário
de funcionamento e gestão geral da frota (inventário, bloqueio/wipe remoto, apps).

> ⚠️ **Leia primeiro [`docs/07-limites-community-vs-enterprise.md`](docs/07-limites-community-vs-enterprise.md).**
> O Headwind MDM tem uma edição **Community (grátis/open source)** e uma **Enterprise
> (paga)**. Algumas coisas que parecem óbvias — tela de restrição de configurações,
> bloqueio de app *só* em certos horários, localização, controle remoto de tela — são
> Enterprise ou exigem um workaround. Esse documento evita que você monte o piloto
> inteiro e descubra depois que um requisito não existe na versão grátis.

## O que é este projeto

Não é o código do Headwind MDM (isso é o projeto oficial, baixado como imagem Docker).
É o **empacotamento para o seu ambiente**: `docker-compose.yml` ajustado para rodar
local no Windows, scripts PowerShell de operação (subir, parar, backup, restaurar) e
documentação em português cobrindo o fluxo ponta a ponta — instalação → cadastro de
aparelho → política do vendedor externo → operação do dia a dia.

## Arquitetura (piloto local)

```
┌─────────────────────────────┐        Wi-Fi/LAN         ┌──────────────────┐
│  Seu PC Windows (Docker)     │◄─────────────────────────┤ Celular Android  │
│                              │   HTTP :8080 (painel)     │ (agente Headwind)│
│  ┌────────────┐  ┌────────┐ │   TCP  :31000 (sync)      └──────────────────┘
│  │ hmdm (Tomcat)├─►│Postgres│ │
│  └────────────┘  └────────┘ │
└─────────────────────────────┘
```

O servidor roda no seu PC; os celulares (na mesma rede Wi-Fi/LAN) se conectam pelo
IP local do PC. É um arranjo válido para **piloto e homologação**. Para produção
real (vendedores fora da rede da empresa, usando dados móveis), o servidor precisa
estar num VPS/nuvem com domínio e HTTPS — ver observação em
[`docs/01-instalacao.md`](docs/01-instalacao.md#do-piloto-para-producao).

## Pré-requisitos

- Windows 11 com **Docker Desktop** (WSL2 habilitado)
- Um celular Android físico (Android 7+ recomendado) para o piloto
- PC e celular na mesma rede Wi-Fi

## Início rápido

```powershell
cd C:\Projetos\MDM
copy .env.example .env
notepad .env          # ajuste BASE_DOMAIN / LOCAL_IP para o IP do seu PC (veja docs/01)
.\scripts\iniciar.ps1
```

Depois acesse `http://SEU_IP:8080/` no navegador. Login inicial: `admin` / `admin`
(o sistema força troca de senha no primeiro acesso).

## Estrutura do projeto

```
MDM/
├── docker-compose.yml       # orquestração (Postgres + Headwind MDM), modo HTTP local
├── .env.example             # variáveis de configuração (copiar para .env)
├── scripts/
│   ├── iniciar.ps1          # sobe o ambiente
│   ├── parar.ps1            # para o ambiente
│   ├── logs.ps1             # acompanha logs do servidor
│   ├── backup.ps1           # dump do banco + arquivos enviados
│   ├── restaurar.ps1        # restaura um backup
│   └── compilar-agente.ps1  # compila o agente Android personalizado (apk\mdm-agente.apk)
├── portal/                  # Portal MDM (porta 8090): aparelhos, políticas, horários, mapa
├── agente-android/          # código do agente Android personalizado
├── assinatura-apk/          # chave que assina o agente (FAZER BACKUP)
└── docs/
    ├── 01-instalacao.md
    ├── 02-primeiro-acesso.md
    ├── 03-cadastro-de-aparelhos.md
    ├── 04-politica-vendedor-externo.md
    ├── 05-bloqueio-por-horario.md
    ├── 06-operacao-e-manutencao.md
    ├── 07-limites-community-vs-enterprise.md
    └── 08-portal-e-agente-personalizado.md
```

> Os antigos `alternar-politica.ps1` / `agendar-politica.ps1` foram substituídos pela aba
> **Horários de bloqueio** do portal. Uma cópia ficou em `backups\legado-20261020\`.

## Portal e agente personalizado

- **Portal MDM** em `http://SEU_IP:8090/`: aparelhos (cadastrar, editar, excluir), grupos
  (cadastrar e vincular celulares), apps de cada política (e excluir política sem celulares),
  horário de uso dos apps (bloquear no horário ou liberar só no horário), mapa com a localização
  (trajeto pelas ruas e satélite), histórico de locais (paradas, endereço e horário, com planilha) e histórico. Login com o mesmo usuário do
  painel Headwind.
- **Agente Android personalizado** (`apk\mdm-agente.apk`): sem os 3 botões laterais e
  enviando a localização a cada ~1 minuto. Recompile com `.\scripts\compilar-agente.ps1`.

Detalhes, instalação nos celulares e limites em
[`docs/08-portal-e-agente-personalizado.md`](docs/08-portal-e-agente-personalizado.md).

## Roteiro de leitura sugerido

1. [`docs/07-limites-community-vs-enterprise.md`](docs/07-limites-community-vs-enterprise.md) — o que dá e o que não dá para fazer na versão grátis
2. [`docs/01-instalacao.md`](docs/01-instalacao.md) — subir o servidor
3. [`docs/02-primeiro-acesso.md`](docs/02-primeiro-acesso.md) — configurar o painel
4. [`docs/03-cadastro-de-aparelhos.md`](docs/03-cadastro-de-aparelhos.md) — enrolar o primeiro celular
5. [`docs/04-politica-vendedor-externo.md`](docs/04-politica-vendedor-externo.md) — bloquear apps
6. [`docs/05-bloqueio-por-horario.md`](docs/05-bloqueio-por-horario.md) — restringir por horário de expediente
7. [`docs/06-operacao-e-manutencao.md`](docs/06-operacao-e-manutencao.md) — dia a dia, backup, updates

## Fontes oficiais usadas neste projeto

- [h-mdm/hmdm-docker](https://github.com/h-mdm/hmdm-docker) — instalação Docker oficial
- [h-mdm/hmdm-server](https://github.com/h-mdm/hmdm-server) — código-fonte do servidor
- [h-mdm.com/quick-start](https://h-mdm.com/quick-start/) — cadastro de aparelho
- [h-mdm.com/headwind-mdm-capabilities](https://h-mdm.com/headwind-mdm-capabilities/) — recursos por versão do Android / modo de instalação
- [h-mdm.com/kiosk-mode](https://h-mdm.com/kiosk-mode/) — modo quiosque
