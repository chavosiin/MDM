// Cliente da API REST do Headwind MDM (mesmas chamadas do scripts\alternar-politica.ps1)
import crypto from 'crypto';
import { config } from './config.js';

export class ErroHmdm extends Error {
  constructor(mensagem, status) {
    super(mensagem);
    this.status = status;
  }
}

export async function login(usuario, senha) {
  const hash = crypto.createHash('md5').update(senha, 'utf8').digest('hex').toUpperCase();
  const r = await fetch(`${config.hmdmUrl}/rest/public/jwt/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: usuario, password: hash }),
  });
  if (!r.ok) throw new ErroHmdm('Usuário ou senha inválidos', 401);
  const j = await r.json();
  if (!j.id_token) throw new ErroHmdm('Usuário ou senha inválidos', 401);
  return j.id_token;
}

// Mensagens de erro do Headwind traduzidas para o portal
const MENSAGENS = {
  'error.duplicate.group': 'Já existe um grupo com esse nome',
  'error.duplicate.group.name': 'Já existe um grupo com esse nome',
  'error.notempty.group': 'O grupo ainda tem celulares. Tire os celulares do grupo antes de excluir',
  'error.duplicate.device': 'Já existe um celular com esse número',
  'error.duplicate.device.number': 'Já existe um celular com esse número',
  'error.duplicate.configuration': 'Já existe uma política com esse nome',
  'error.duplicate.configuration.name': 'Já existe uma política com esse nome',
};

// Campos que o Headwind espera ao gravar um aparelho (os demais são calculados por ele)
function dadosDoAparelho(a) {
  return {
    id: a.id, number: a.number, description: a.description,
    configurationId: a.configurationId, groups: a.groups || [],
    imei: a.imei, phone: a.phone,
    custom1: a.custom1, custom2: a.custom2, custom3: a.custom3,
  };
}

export function cliente(token) {
  async function api(metodo, caminho, corpo) {
    const r = await fetch(`${config.hmdmUrl}/rest${caminho}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    if (r.status === 401 || r.status === 403) throw new ErroHmdm('Sessão expirada no servidor MDM', 401);
    if (!r.ok) throw new ErroHmdm(`Servidor MDM respondeu ${r.status} em ${caminho}`, 502);
    const j = await r.json();
    if (j.status && j.status !== 'OK') throw new ErroHmdm(MENSAGENS[j.message] || `Servidor MDM: ${j.message || j.status}`, 400);
    return j.data;
  }

  return {
    aparelhos: async () => (await api('POST', '/private/devices/search', { pageSize: 10000, pageNum: 1 })).devices.items,
    politicas: () => api('GET', '/private/configurations/search'),
    politica: (id) => api('GET', `/private/configurations/${id}`),
    appsDaPolitica: (id) => api('GET', `/private/configurations/applications/${id}`),
    salvarPolitica: (cfg) => api('PUT', '/private/configurations', cfg),
    excluirPolitica: (id) => api('DELETE', `/private/configurations/${id}`),
    grupos: () => api('GET', '/private/groups/search'),
    salvarGrupo: (grupo) => api('PUT', '/private/groups', grupo),
    excluirGrupo: (id) => api('DELETE', `/private/groups/${id}`),
    apps: () => api('GET', '/private/applications/search'),

    // Sem id cria o aparelho; com id altera
    salvarAparelho: (aparelho) => api('PUT', '/private/devices', dadosDoAparelho(aparelho)),
    excluirAparelho: (id) => api('DELETE', `/private/devices/${id}`),

    async trocarPolitica(aparelho, configurationId) {
      await api('PUT', '/private/devices', { ...dadosDoAparelho(aparelho), configurationId });
    },

    push(numero, tipo, payload = '') {
      return api('POST', '/plugins/push/private/send', { scope: 'device', deviceNumber: numero, messageType: tipo, payload });
    },
  };
}

// Sessão da conta de serviço (agendador), renovada quando expira
let tokenServico = null;
export async function servico(fn) {
  if (!tokenServico) tokenServico = await login(config.servicoUsuario, config.servicoSenha);
  try {
    return await fn(cliente(tokenServico));
  } catch (e) {
    if (e.status !== 401) throw e;
    tokenServico = await login(config.servicoUsuario, config.servicoSenha);
    return fn(cliente(tokenServico));
  }
}
