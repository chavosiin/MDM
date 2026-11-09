# 1. Instalação (piloto local no Windows)

## Pré-requisitos

- **Docker Desktop** instalado e rodando, com WSL2 habilitado (padrão em instalações recentes).
- PC e celular(es) de teste **na mesma rede Wi-Fi/LAN**.
- Porta **8080** e **31000** livres no PC (verifique se não há outro serviço usando-as).

## Passo 1 — Descobrir o IP do seu PC na rede

```powershell
ipconfig
```

Procure o "Endereço IPv4" do adaptador Wi-Fi (ou Ethernet) que está na mesma rede do
celular. Exemplo: `192.168.1.50`. **Não use `localhost` nem `127.0.0.1`** — o celular
precisa alcançar esse IP pela rede.

> Se o PC muda de IP com frequência (DHCP), considere fixar um IP reservado no
> roteador para não ter que reconfigurar o `.env` toda hora.

## Passo 2 — Configurar o `.env`

```powershell
cd C:\Projetos\MDM
copy .env.example .env
notepad .env
```

Ajuste no mínimo:
- `BASE_DOMAIN` e `LOCAL_IP` → o IP encontrado no passo 1
- `ADMIN_EMAIL` → seu e-mail
- `SQL_PASS` e `SHARED_SECRET` → troque os valores padrão

## Passo 3 — Subir o ambiente

```powershell
.\scripts\iniciar.ps1
```

Na primeira vez, o servidor baixa o `.war` do Headwind MDM, inicializa o banco e gera
as configurações — pode levar de 2 a 5 minutos. Acompanhe com:

```powershell
.\scripts\logs.ps1
```

## Passo 4 — Verificar o acesso

Abra `http://SEU_IP:8080/` no navegador (do próprio PC, para confirmar que subiu).
Depois, no celular, abra o mesmo endereço no navegador para confirmar que a rede
permite o acesso antes de partir para o cadastro do aparelho (próximo documento).

## Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| `docker compose` não é reconhecido | Docker Desktop não está rodando | Abra o Docker Desktop e aguarde o ícone ficar "Running" |
| Porta 8080 já em uso | Outro serviço na porta | Mude `"8080:8080"` para `"8081:8080"` no `docker-compose.yml` e ajuste as URLs |
| Celular não abre a página | Firewall do Windows bloqueando | Libere as portas 8080 e 31000 no Firewall do Windows para redes privadas |
| Painel não conecta ao banco | `.env` não foi carregado | Confirme que `FORCE_RECONFIGURE=true`, suba de novo, depois volte para vazio |

## Do piloto para produção

Este `docker-compose.yml` é deliberadamente simplificado (HTTP, sem certbot, sem
domínio público) para rodar no seu Windows. Quando o piloto validar o processo e for
hora de atender vendedores **fora da rede Wi-Fi da empresa** (usando dados móveis),
o servidor precisa migrar para:

- Um **VPS/servidor Linux** com IP público (AWS, Azure, Oracle Cloud, ou um provedor nacional)
- Um **domínio próprio** (ex.: `mdm.suaempresa.com.br`)
- **HTTPS real**, usando o `docker-compose.yaml` oficial com o serviço `certbot`
  (veja [h-mdm/hmdm-docker](https://github.com/h-mdm/hmdm-docker)) — a diferença
  em relação ao deste projeto é reativar o bloco `certbot:` e trocar `PROTOCOL=https`

Quando chegar nesse ponto, me chame para adaptar o projeto para produção.
