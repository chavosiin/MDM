// Regras de política: troca de política de aparelhos e edição dos apps de uma política
import { registrar } from './db.js';

// Modos de app que o portal oferece, mapeados para os campos do Headwind
// action: 0 = fora da política, 1 = instalar, 2 = remover
export const MODOS_APP = {
  liberado: { action: 1, showIcon: true },
  oculto: { action: 1, showIcon: false },
  bloqueado: { action: 2, showIcon: false },
  fora: { action: 0, showIcon: false },
};

export function modoDoApp(app) {
  if (app.action == 2) return 'bloqueado';
  if (app.action == 1) return app.showIcon ? 'liberado' : 'oculto';
  return 'fora';
}

// Troca a política de uma lista de aparelhos e manda push para aplicarem na hora.
// "foraDeExpediente" também leva o aparelho para a tela inicial do MDM.
export async function aplicarPolitica(api, aparelhos, configurationId, { usuario, motivo, foraDeExpediente = false }) {
  let trocados = 0, jaEstavam = 0;
  const falhas = [];
  for (const a of aparelhos) {
    if (a.configurationId === configurationId) { jaEstavam++; continue; }
    try {
      await api.trocarPolitica(a, configurationId);
      trocados++;
      try { await api.push(a.number, 'configUpdated'); } catch { /* aplica no próximo sync */ }
      if (foraDeExpediente) {
        try { await api.push(a.number, 'runApp', '{"pkg":"com.hmdm.launcher"}'); } catch { /* opcional */ }
      }
    } catch (e) {
      falhas.push(`${a.number}: ${e.message}`);
    }
  }
  const detalhe = `${motivo} - política ${configurationId}: ${trocados} trocado(s), ${jaEstavam} já estava(m), ${falhas.length} falha(s)`
    + (falhas.length ? ` [${falhas.join('; ')}]` : '');
  await registrar(usuario, 'trocar-politica', detalhe);
  return { trocados, jaEstavam, falhas };
}

// Altera o modo de apps de uma política e salva (mesmo formato que o painel do Headwind envia)
export async function salvarAppsDaPolitica(api, configId, alteracoes) {
  const cfg = await api.politica(configId);
  const apps = await api.appsDaPolitica(configId);
  const porId = new Map(apps.map((a) => [a.id, a]));
  for (const { id, modo } of alteracoes) {
    const app = porId.get(id);
    const m = MODOS_APP[modo];
    if (!app || !m) continue;
    if (app.usedVersionId === cfg.mainAppId && m.action !== 1) {
      throw Object.assign(new Error(`"${app.name}" é o app principal da política e não pode ser removido`), { status: 400 });
    }
    app.action = m.action;
    app.showIcon = m.showIcon;
  }
  cfg.applications = apps.filter((a) => a.action != 0);
  return api.salvarPolitica(cfg);
}
