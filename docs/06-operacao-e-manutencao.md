# 6. Operação do dia a dia

## Monitoramento

- **Devices**: veja status online/offline, último contato, nível de bateria e
  versão do app instalado em cada aparelho.
- Aparelhos que não sincronizam há muito tempo geralmente indicam: sem Wi-Fi/dados,
  bateria zerada, ou o usuário desinstalou/desativou o agente (só possível se não
  estiver em modo Device Owner).

## Ações remotas comuns

No registro do aparelho (**Devices → abrir o aparelho**):
- **Lock** — bloqueia a tela remotamente
- **Wipe** — apaga o aparelho remotamente (uso em caso de perda/roubo — irreversível,
  confirme antes)
- **Reset password** — força redefinição de senha/PIN
- **Reboot** (se suportado no modelo) — reinicia o aparelho remotamente

## Atualizando apps nos aparelhos

1. **Applications**: suba a nova versão do APK.
2. Associe à Configuration correspondente (ou marque "atualizar automaticamente" se
   essa opção existir na versão instalada).
3. Os aparelhos recebem a atualização no próximo ciclo de sincronização.

## Backup

Rotina recomendada (semanal, ou antes de qualquer atualização do Headwind MDM):

```powershell
.\scripts\backup.ps1
```

Isso gera um dump do PostgreSQL + cópia dos arquivos em `volumes\work`, em
`backups\<data>\`. Guarde essa pasta fora do PC (ex. copiar para um HD externo ou
storage da empresa) — não depende do Docker para ser lida.

## Restaurando um backup

```powershell
.\scripts\restaurar.ps1 -Pasta ".\backups\20260911-093000"
```

## Atualizando a versão do Headwind MDM

1. Faça backup antes (`.\scripts\backup.ps1`).
2. No painel, normalmente há uma opção de "verificar atualização"/"check updates"
   (menu de administração) — isso baixa a nova versão.
3. **A atualização só é aplicada com reinício "de verdade" do container**, não com
   um simples `restart`:
   ```powershell
   docker compose down
   docker compose up -d
   ```
4. Confirme nos logs (`.\scripts\logs.ps1`) que subiu sem erros e teste o login.

## Parando o ambiente (sem perder dados)

```powershell
.\scripts\parar.ps1
```

Os dados ficam em `volumes\` (ignorado pelo `.gitignore`, mas persistente em disco).
Para voltar a rodar depois: `.\scripts\iniciar.ps1`.
