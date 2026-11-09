# 3. Cadastro de aparelhos (enrollment)

Existem dois caminhos, dependendo do aparelho e de quanto controle você precisa.

## Caminho A — Modo "Device Owner" via QR Code (recomendado)

Dá controle total (bloqueio remoto, restrições de sistema, modo quiosque). Exige
**aparelho resetado de fábrica** (sem conta Google configurada ainda) e Android 7+.

1. No painel: **Configurations**, abra `Vendedores Externos - Padrão` e gere o
   **QR code de provisionamento** (opção "Enroll"/"QR code" da tela de configuração).
2. No celular **recém-resetado**, na tela de boas-vindas do Android, **toque 6 vezes**
   em um ponto vazio da tela — isso abre o leitor de QR do provisionamento do Android.
3. Conecte o celular ao **Wi-Fi**.
4. **Escaneie o QR code** gerado no passo 1.
5. O Android baixa e instala o agente do Headwind MDM automaticamente e concede a ele
   o papel de **Device Owner**.
6. Conceda as permissões solicitadas pelo agente.
7. Quando pedido, informe o **ID do dispositivo** (o padrão sugerido é algo como
   `h0001` — use um padrão próprio, ex. `vendedor-joao`).
8. O aparelho aparece em **Devices** no painel em poucos minutos. Arraste-o (ou edite
   o registro) para o grupo `Vendedores Externos`.

> Fabricantes/versões que **não suportam** esse fluxo de QR (Android 6 ou anterior,
> ou certas versões antigas de EMUI da Huawei/Xiaomi): use o Caminho B.

## Caminho B — Instalação via APK (Device Admin)

Controle mais limitado (não é Device Owner) — útil como fallback, mas evite para a
frota principal se o Caminho A funcionar no seu modelo de aparelho.

1. No celular, baixe o APK do agente Headwind MDM (o mesmo `CLIENT_VERSION`
   configurado no `.env`) — o link fica disponível no painel, em **Configurations**.
2. Instale o APK manualmente (ative "Instalar de fontes desconhecidas" se pedido).
3. Abra o app e informe o endereço do servidor (`http://SEU_IP:8080/`) e o
   ID do dispositivo.
4. Conceda os acessos solicitados (Admin do dispositivo, notificações, etc.).
5. Confirme que o aparelho aparece em **Devices** no painel.

## Depois do cadastro

- Renomeie o dispositivo no painel para algo identificável (nome do vendedor).
- Confirme que ele está no grupo `Vendedores Externos` (para herdar a Configuration
  certa).
- Em **Devices → (abra o aparelho)**, confira o intervalo de sincronização (a cada
  quanto tempo ele consulta o servidor por novidades) — para o piloto, reduza para
  5–15 minutos, assim você vê o efeito das mudanças de política rapidamente.

Próximo passo: montar a política de restrição —
[`04-politica-vendedor-externo.md`](04-politica-vendedor-externo.md).
