// Portal MDM - painel simplificado sobre o Headwind MDM
//   - login com o mesmo usuário/senha do painel Headwind
//   - aparelhos (cadastro, edição, troca de política, sincronização) e grupos
//   - apps de cada política (liberado / oculto / bloqueado)
//   - horários de bloqueio automáticos
//   - bloqueio de apps por horário (aplicado pelo agente personalizado)
//   - mapa com a localização enviada pelo agente personalizado a cada ~1 min
import express from 'express';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { pool, criarTabelas, registrar } from './db.js';
import { login, cliente, ErroHmdm } from './hmdm.js';
import { aplicarPolitica, salvarAppsDaPolitica, modoDoApp } from './politicas.js';
import { iniciarAgendador, aplicarRegra, dentroDoExpediente } from './agendador.js';
import { trajetoNasRuas, endereco, marcarSaltos } from './geo.js';
import { validarBloqueio, bloqueioJson, regrasDoAparelho, salvarAppsDoAparelho, listarApps } from './bloqueios.js';

const app = express();
// Limite maior por causa da lista de apps com ícones enviada pelo agente
app.use(express.json({ limit: '8mb' }));
// no-cache: o navegador sempre confere se o portal mudou (evita tela velha depois de uma atualização)
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));

// ---------- Sessões (em memória; reiniciar o portal pede login de novo) ----------
const sessoes = new Map();
const DURACAO_SESSAO_MS = 12 * 60 * 60 * 1000;

function lerCookie(req, nome) {
  const c = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(nome + '='));
  return c ? decodeURIComponent(c.slice(nome.length + 1)) : null;
}

function autenticado(req, res, next) {
  const s = sessoes.get(lerCookie(req, 'portal_sessao'));
  if (!s || s.expira < Date.now()) return res.status(401).json({ erro: 'Faça login' });
  req.usuario = s.usuario;
  req.api = cliente(s.token);
  next();
}

const rota = (fn) => async (req, res) => {
  try {
    res.json(await fn(req, res));
  } catch (e) {
    const status = e instanceof ErroHmdm ? e.status : (e.status || 500);
    if (status === 401) sessoes.delete(lerCookie(req, 'portal_sessao'));
    if (status >= 500) console.error(req.method, req.path, e);
    res.status(status).json({ erro: e.message });
  }
};

const erro = (mensagem, status = 400) => Object.assign(new Error(mensagem), { status });

app.post('/api/login', rota(async (req, res) => {
  const { usuario, senha } = req.body || {};
  if (!usuario || !senha) throw erro('Informe usuário e senha');
  const token = await login(usuario, senha);
  const id = crypto.randomBytes(32).toString('hex');
  sessoes.set(id, { token, usuario, expira: Date.now() + DURACAO_SESSAO_MS });
  res.setHeader('Set-Cookie', `portal_sessao=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${DURACAO_SESSAO_MS / 1000}`);
  await registrar(usuario, 'login', null);
  return { usuario };
}));

app.post('/api/logout', (req, res) => {
  sessoes.delete(lerCookie(req, 'portal_sessao'));
  res.setHeader('Set-Cookie', 'portal_sessao=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/eu', autenticado, (req, res) => res.json({ usuario: req.usuario, painelUrl: config.painelUrl, googleMapsKey: config.googleMapsKey }));

// ---------- Localização enviada pelos celulares (sem login, com assinatura) ----------
// Assinatura dos pedidos do agente: SHA1(PORTAL_SECRET + aparelho + ts), em maiúsculas
function conferirAssinatura(req, aparelho, ts) {
  const esperado = crypto.createHash('sha1').update(config.segredoAgente + aparelho + ts, 'utf8').digest('hex').toUpperCase();
  const recebido = String(req.headers['x-assinatura'] || '');
  if (!aparelho || !Number(ts) || recebido.length !== esperado.length
      || !crypto.timingSafeEqual(Buffer.from(recebido), Buffer.from(esperado))) {
    throw erro('Assinatura inválida', 403);
  }
}

app.post('/api/localizacao', rota(async (req) => {
  const b = req.body || {};
  const aparelho = String(b.aparelho || '');
  const ts = Number(b.ts);
  conferirAssinatura(req, aparelho, b.ts);
  const lat = Number(b.lat), lon = Number(b.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw erro('Coordenadas inválidas');
  const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
  await pool.query(
    `INSERT INTO portal_localizacao (aparelho, lat, lon, precisao, velocidade, bateria, fonte, ts, altitude)
     VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0), $9)`,
    [aparelho, lat, lon, num(b.precisao), num(b.velocidade), num(b.bateria), b.fonte ? String(b.fonte).slice(0, 20) : null, ts, num(b.altitude)],
  );
  return { ok: true };
}));

// Regras de bloqueio de apps do aparelho (o agente pergunta a cada minuto)
app.get('/api/agente/bloqueios', rota(async (req) => {
  const aparelho = String(req.query.aparelho || '');
  conferirAssinatura(req, aparelho, String(req.query.ts || ''));
  const regras = await regrasDoAparelho(aparelho);
  if (!regras) throw erro('Aparelho não cadastrado', 404);
  return { fuso: config.fuso, regras };
}));

// Lista de apps instalados no aparelho, com ícones (o agente manda quando muda)
app.post('/api/agente/apps', rota(async (req) => {
  const b = req.body || {};
  const aparelho = String(b.aparelho || '');
  conferirAssinatura(req, aparelho, String(b.ts || ''));
  return { ok: true, apps: await salvarAppsDoAparelho(aparelho, b.apps) };
}));

// ---------- Aparelhos ----------
async function ultimasLocalizacoes() {
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (aparelho) aparelho, lat, lon, precisao, velocidade, bateria, ts
    FROM portal_localizacao ORDER BY aparelho, ts DESC`);
  return new Map(rows.map((r) => [r.aparelho, r]));
}

app.get('/api/aparelhos', autenticado, rota(async (req) => {
  const [aparelhos, politicas, locais] = await Promise.all([req.api.aparelhos(), req.api.politicas(), ultimasLocalizacoes()]);
  const nomes = new Map(politicas.map((p) => [p.id, p.name]));
  return aparelhos.map((a) => {
    const loc = locais.get(a.number);
    return {
      id: a.id,
      numero: a.number,
      descricao: a.description,
      grupos: (a.groups || []).map((g) => g.name),
      gruposIds: (a.groups || []).map((g) => g.id),
      imei: a.imei || null,
      telefone: a.phone || null,
      politicaId: a.configurationId,
      politica: nomes.get(a.configurationId) || '-',
      ultimaSync: a.lastUpdate || null,
      modelo: a.info?.model || null,
      android: a.androidVersion || null,
      dono: a.mdmMode === true,
      versaoAgente: a.launcherVersion || null,
      bateria: loc?.bateria ?? a.info?.batteryLevel ?? null,
      localizacao: loc ? { lat: loc.lat, lon: loc.lon, precisao: loc.precisao, velocidade: loc.velocidade, ts: loc.ts } : null,
    };
  });
}));

async function buscarAparelho(api, id) {
  const a = (await api.aparelhos()).find((x) => x.id === Number(id));
  if (!a) throw erro('Aparelho não encontrado', 404);
  return a;
}

app.put('/api/aparelhos/:id/politica', autenticado, rota(async (req) => {
  const a = await buscarAparelho(req.api, req.params.id);
  return aplicarPolitica(req.api, [a], Number(req.body.politicaId), { usuario: req.usuario, motivo: `Troca manual de ${a.number}` });
}));

app.post('/api/aparelhos/:id/sincronizar', autenticado, rota(async (req) => {
  const a = await buscarAparelho(req.api, req.params.id);
  await req.api.push(a.number, 'configUpdated');
  await registrar(req.usuario, 'sincronizar', a.number);
  return { ok: true };
}));

app.post('/api/aparelhos/:id/tela-inicial', autenticado, rota(async (req) => {
  const a = await buscarAparelho(req.api, req.params.id);
  await req.api.push(a.number, 'runApp', '{"pkg":"com.hmdm.launcher"}');
  await registrar(req.usuario, 'tela-inicial', a.number);
  return { ok: true };
}));

// ---------- Cadastro de celulares ----------
async function gruposEscolhidos(api, ids) {
  const escolhidos = new Set((ids || []).map(Number));
  return (await api.grupos()).filter((g) => escolhidos.has(g.id)).map((g) => ({ id: g.id, name: g.name }));
}

function dadosDoFormulario(b) {
  if (!Number(b.politicaId)) throw erro('Escolha a política do celular');
  const texto = (v) => (String(v ?? '').trim() || null);
  return { description: texto(b.descricao) || '', configurationId: Number(b.politicaId), imei: texto(b.imei), phone: texto(b.telefone) };
}

app.post('/api/aparelhos', autenticado, rota(async (req) => {
  const numero = String(req.body.numero || '').trim();
  if (!numero) throw erro('Informe o número (identificação) do celular');
  if (/[\s/?&]/.test(numero)) throw erro('O número não pode ter espaços nem os caracteres / ? &');
  const dados = dadosDoFormulario(req.body);
  await req.api.salvarAparelho({ number: numero, ...dados, groups: await gruposEscolhidos(req.api, req.body.grupos) });
  await registrar(req.usuario, 'cadastrar-aparelho', `${numero} (política ${dados.configurationId})`);
  return { ok: true };
}));

app.put('/api/aparelhos/:id', autenticado, rota(async (req) => {
  const a = await buscarAparelho(req.api, req.params.id);
  const dados = dadosDoFormulario(req.body);
  const trocouPolitica = a.configurationId !== dados.configurationId;
  await req.api.salvarAparelho({ ...a, ...dados, groups: await gruposEscolhidos(req.api, req.body.grupos) });
  if (trocouPolitica) {
    try { await req.api.push(a.number, 'configUpdated'); } catch { /* aplica no próximo sync */ }
  }
  await registrar(req.usuario, 'editar-aparelho', a.number);
  return { ok: true };
}));

app.delete('/api/aparelhos/:id', autenticado, rota(async (req) => {
  const a = await buscarAparelho(req.api, req.params.id);
  await req.api.excluirAparelho(a.id);
  await registrar(req.usuario, 'excluir-aparelho', a.number);
  return { ok: true };
}));

// ---------- Localizações ----------
const DATA = /^\d{4}-\d{2}-\d{2}$/;

// Posições de um aparelho num dia (?data=) ou num período (?de=&ate=), em ordem de horário.
// Período muito grande: vêm as 100 mil mais recentes (~70 dias com uma posição por minuto).
async function posicoes(req) {
  const de = req.query.de || req.query.data, ate = req.query.ate || de;
  if (!DATA.test(de || '') || !DATA.test(ate || '')) throw erro('Informe a data (AAAA-MM-DD)');
  const { rows } = await pool.query(
    `SELECT lat, lon, altitude, precisao, velocidade, bateria, fonte, ts FROM portal_localizacao
     WHERE aparelho = $1 AND ts >= ($3::date)::timestamp AT TIME ZONE $2 AND ts < ($4::date + 1)::timestamp AT TIME ZONE $2
     ORDER BY ts DESC LIMIT 100000`,
    [req.params.numero, config.fuso, de, ate],
  );
  return marcarSaltos(rows.reverse());
}

app.get('/api/localizacoes/:numero', autenticado, rota(posicoes));

// Trajeto encaixado nas ruas (só com os pontos de GPS bons)
app.get('/api/localizacoes/:numero/ruas', autenticado, rota(async (req) => {
  const pontos = await posicoes(req);
  return trajetoNasRuas(`${req.params.numero}|${req.query.de || req.query.data}|${req.query.ate || ''}`, pontos);
}));

// Endereço aproximado de um ponto
app.get('/api/endereco', autenticado, rota(async (req) => {
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw erro('Coordenadas inválidas');
  return { endereco: await endereco(lat, lon) };
}));

// ---------- Políticas ----------
app.get('/api/politicas', autenticado, rota(async (req) => {
  const [politicas, aparelhos] = await Promise.all([req.api.politicas(), req.api.aparelhos()]);
  return politicas.map((p) => ({
    id: p.id, nome: p.name, descricao: p.description,
    aparelhos: aparelhos.filter((a) => a.configurationId === p.id).length,
  }));
}));

app.get('/api/politicas/:id', autenticado, rota(async (req) => {
  const [cfg, apps] = await Promise.all([req.api.politica(req.params.id), req.api.appsDaPolitica(req.params.id)]);
  return {
    id: cfg.id, nome: cfg.name, descricao: cfg.description,
    rastrearLocalizacao: cfg.requestUpdates && cfg.requestUpdates !== 'DONOTTRACK',
    apps: apps.map((a) => ({
      id: a.id, nome: a.name, pacote: a.pkg, sistema: !!a.system,
      principal: a.usedVersionId === cfg.mainAppId, modo: modoDoApp(a),
    })).sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR')),
  };
}));

async function avisarAparelhosDaPolitica(api, configId) {
  const aparelhos = (await api.aparelhos()).filter((a) => a.configurationId === Number(configId));
  for (const a of aparelhos) {
    try { await api.push(a.number, 'configUpdated'); } catch { /* aplica no próximo sync */ }
  }
  return aparelhos.length;
}

app.put('/api/politicas/:id/apps', autenticado, rota(async (req) => {
  const alteracoes = Array.isArray(req.body.apps) ? req.body.apps : [];
  if (!alteracoes.length) throw erro('Nenhuma alteração enviada');
  await salvarAppsDaPolitica(req.api, Number(req.params.id), alteracoes);
  const avisados = await avisarAparelhosDaPolitica(req.api, req.params.id);
  await registrar(req.usuario, 'editar-politica', `Política ${req.params.id}: ${alteracoes.map((a) => `${a.nome || a.id}=${a.modo}`).join(', ')}`);
  return { ok: true, avisados };
}));

app.put('/api/politicas/:id/localizacao', autenticado, rota(async (req) => {
  const cfg = await req.api.politica(req.params.id);
  cfg.applications = (await req.api.appsDaPolitica(req.params.id)).filter((a) => a.action != 0);
  cfg.requestUpdates = req.body.ativo ? 'GPS' : 'DONOTTRACK';
  await req.api.salvarPolitica(cfg);
  const avisados = await avisarAparelhosDaPolitica(req.api, req.params.id);
  await registrar(req.usuario, 'editar-politica', `Política ${cfg.name}: rastrear localização = ${req.body.ativo ? 'sim' : 'não'}`);
  return { ok: true, avisados };
}));

app.delete('/api/politicas/:id', autenticado, rota(async (req) => {
  const id = Number(req.params.id);
  const [cfg, aparelhos] = await Promise.all([req.api.politica(id), req.api.aparelhos()]);
  const usando = aparelhos.filter((a) => a.configurationId === id);
  if (usando.length) throw erro(`A política tem ${usando.length} celular(es) (${usando.map((a) => a.number).join(', ')}). Troque a política deles antes de excluir.`);
  const { rows } = await pool.query('SELECT nome FROM portal_horario WHERE cfg_expediente = $1 OR cfg_fora = $1', [id]);
  if (rows.length) throw erro(`A política é usada na troca por horário "${rows.map((r) => r.nome).join('", "')}". Mude ou exclua a troca antes.`);
  await req.api.excluirPolitica(id);
  await registrar(req.usuario, 'excluir-politica', cfg.name);
  return { ok: true };
}));

// ---------- Grupos ----------
app.get('/api/grupos', autenticado, rota(async (req) => (await req.api.grupos()).map((g) => ({ id: g.id, nome: g.name }))));

// Deixa no grupo exatamente os celulares escolhidos (os outros grupos de cada celular não mudam)
async function vincularAparelhos(api, grupo, ids) {
  const escolhidos = new Set((ids || []).map(Number));
  let alterados = 0;
  for (const a of await api.aparelhos()) {
    const grupos = a.groups || [];
    const esta = grupos.some((g) => g.id === grupo.id);
    if (esta === escolhidos.has(a.id)) continue;
    a.groups = esta ? grupos.filter((g) => g.id !== grupo.id) : [...grupos, { id: grupo.id, name: grupo.name }];
    await api.salvarAparelho(a);
    alterados++;
  }
  return alterados;
}

async function salvarGrupo(req, id) {
  const nome = String(req.body.nome || '').trim();
  if (!nome) throw erro('Informe o nome do grupo');
  if (id) {
    // Ao renomear, o Headwind espera o grupo inteiro (com customerId), como o painel envia
    const atual = (await req.api.grupos()).find((g) => g.id === id);
    if (!atual) throw erro('Grupo não encontrado', 404);
    await req.api.salvarGrupo({ ...atual, name: nome });
  } else {
    await req.api.salvarGrupo({ name: nome });
  }
  const grupo = (await req.api.grupos()).find((g) => (id ? g.id === id : g.name === nome));
  if (!grupo) throw erro('Grupo não encontrado', 404);
  const alterados = await vincularAparelhos(req.api, grupo, req.body.aparelhos);
  await registrar(req.usuario, 'salvar-grupo', `${nome}: ${(req.body.aparelhos || []).length} celular(es)`);
  return { id: grupo.id, alterados };
}

app.post('/api/grupos', autenticado, rota((req) => salvarGrupo(req, null)));
app.put('/api/grupos/:id', autenticado, rota((req) => salvarGrupo(req, Number(req.params.id))));

app.delete('/api/grupos/:id', autenticado, rota(async (req) => {
  const id = Number(req.params.id);
  const grupo = (await req.api.grupos()).find((g) => g.id === id);
  if (!grupo) throw erro('Grupo não encontrado', 404);
  const { rows } = await pool.query(
    `SELECT nome FROM portal_horario WHERE grupo_id = $1 UNION ALL SELECT nome FROM portal_bloqueio_app WHERE grupo_id = $1`, [id]);
  if (rows.length) throw erro(`O grupo é usado em "${rows.map((r) => r.nome).join('", "')}". Mude ou exclua essas regras antes.`);
  // O Headwind não exclui grupo com celulares: primeiro tira os celulares do grupo
  await vincularAparelhos(req.api, grupo, []);
  await req.api.excluirGrupo(id);
  await registrar(req.usuario, 'excluir-grupo', grupo.name);
  return { ok: true };
}));

// ---------- Horários de bloqueio ----------
function validarHorario(b) {
  const hora = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!b.nome?.trim()) throw erro('Informe um nome');
  if (!b.grupoId || !b.cfgExpediente || !b.cfgFora) throw erro('Escolha o grupo e as duas políticas');
  if (Number(b.cfgExpediente) === Number(b.cfgFora)) throw erro('As políticas de expediente e fora do expediente precisam ser diferentes');
  if (!hora.test(b.inicio || '') || !hora.test(b.fim || '') || b.inicio === b.fim) throw erro('Horários inválidos');
  const dias = (b.dias || []).map(Number).filter((d) => d >= 0 && d <= 6);
  if (!dias.length) throw erro('Escolha pelo menos um dia da semana');
  return [b.nome.trim(), Number(b.grupoId), Number(b.cfgExpediente), Number(b.cfgFora), dias, b.inicio, b.fim, b.ativo !== false];
}

const horarioJson = (r) => ({
  id: r.id, nome: r.nome, grupoId: r.grupo_id, cfgExpediente: r.cfg_expediente, cfgFora: r.cfg_fora,
  dias: r.dias, inicio: r.inicio, fim: r.fim, ativo: r.ativo, ultimoEstado: r.ultimo_estado,
  agora: dentroDoExpediente(r) ? 'expediente' : 'fora',
});

app.get('/api/horarios', autenticado, rota(async () => {
  const { rows } = await pool.query('SELECT * FROM portal_horario ORDER BY id');
  return rows.map(horarioJson);
}));

async function salvarEAplicar(req, sql, params) {
  const { rows } = await pool.query(sql, params);
  if (!rows.length) throw erro('Horário não encontrado', 404);
  const regra = rows[0];
  await registrar(req.usuario, 'salvar-horario', `${regra.nome}: ${regra.inicio}-${regra.fim} dias ${regra.dias.join(',')}`);
  if (regra.ativo) await aplicarRegra(regra, { forcar: true, usuario: req.usuario });
  return horarioJson(regra);
}

app.post('/api/horarios', autenticado, rota((req) => salvarEAplicar(req,
  `INSERT INTO portal_horario (nome, grupo_id, cfg_expediente, cfg_fora, dias, inicio, fim, ativo)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, validarHorario(req.body))));

app.put('/api/horarios/:id', autenticado, rota((req) => salvarEAplicar(req,
  `UPDATE portal_horario SET nome=$1, grupo_id=$2, cfg_expediente=$3, cfg_fora=$4, dias=$5, inicio=$6, fim=$7, ativo=$8,
   ultimo_estado=NULL, atualizado=now() WHERE id=$9 RETURNING *`, [...validarHorario(req.body), Number(req.params.id)])));

app.delete('/api/horarios/:id', autenticado, rota(async (req) => {
  const { rows } = await pool.query('DELETE FROM portal_horario WHERE id=$1 RETURNING nome', [Number(req.params.id)]);
  if (rows.length) await registrar(req.usuario, 'excluir-horario', rows[0].nome);
  return { ok: true };
}));

app.post('/api/horarios/:id/aplicar', autenticado, rota(async (req) => {
  const { rows } = await pool.query('SELECT * FROM portal_horario WHERE id=$1', [Number(req.params.id)]);
  if (!rows.length) throw erro('Horário não encontrado', 404);
  return aplicarRegra(rows[0], { forcar: true, usuario: req.usuario });
}));

// ---------- Bloqueio de apps por horário ----------
app.get('/api/apps', autenticado, rota(async (req) => listarApps(await req.api.apps())));

app.get('/api/apps/icone/:pacote', autenticado, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT icone FROM portal_app_icone WHERE pacote = $1', [req.params.pacote]);
    if (!rows.length) return res.status(404).end();
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.end(rows[0].icone);
  } catch (e) {
    res.status(500).end();
  }
});

app.get('/api/bloqueios-app', autenticado, rota(async () => {
  const { rows } = await pool.query('SELECT * FROM portal_bloqueio_app ORDER BY id');
  return rows.map(bloqueioJson);
}));

async function salvarBloqueio(req, sql, params) {
  const { rows } = await pool.query(sql, params);
  if (!rows.length) throw erro('Bloqueio não encontrado', 404);
  const r = rows[0];
  const dias = [1, 2, 3, 4, 5, 6, 0].filter((d) => r.dias.includes(d)).map((d) => ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][d]).join(', ');
  const hora = r.inicio === r.fim ? 'o dia todo' : `${r.inicio} às ${r.fim}`;
  const modo = r.modo === 'liberar' ? 'liberado só' : 'bloqueado';
  await registrar(req.usuario, 'salvar-bloqueio-app', `${r.nome} (${r.pacotes.join(', ')}): ${modo} ${dias}, ${hora}${r.ativo ? '' : ' (desligado)'}`);
  return bloqueioJson(r);
}

app.post('/api/bloqueios-app', autenticado, rota((req) => salvarBloqueio(req,
  `INSERT INTO portal_bloqueio_app (nome, grupo_id, pacotes, dias, inicio, fim, ativo, modo)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, validarBloqueio(req.body))));

app.put('/api/bloqueios-app/:id', autenticado, rota((req) => salvarBloqueio(req,
  `UPDATE portal_bloqueio_app SET nome=$1, grupo_id=$2, pacotes=$3, dias=$4, inicio=$5, fim=$6, ativo=$7, modo=$8, atualizado=now()
   WHERE id=$9 RETURNING *`, [...validarBloqueio(req.body), Number(req.params.id)])));

app.delete('/api/bloqueios-app/:id', autenticado, rota(async (req) => {
  const { rows } = await pool.query('DELETE FROM portal_bloqueio_app WHERE id=$1 RETURNING nome', [Number(req.params.id)]);
  if (rows.length) await registrar(req.usuario, 'excluir-bloqueio-app', rows[0].nome);
  return { ok: true };
}));

// ---------- Histórico ----------
app.get('/api/historico', autenticado, rota(async () => {
  const { rows } = await pool.query('SELECT quando, usuario, acao, detalhe FROM portal_log ORDER BY id DESC LIMIT 300');
  return rows;
}));

// ---------- Início ----------
async function iniciar() {
  for (let tentativa = 1; ; tentativa++) {
    try {
      await criarTabelas();
      break;
    } catch (e) {
      if (tentativa >= 30) throw e;
      console.log(`Aguardando banco de dados (${e.message})...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  iniciarAgendador();
  app.listen(config.porta, () => console.log(`Portal MDM ouvindo na porta ${config.porta}`));
}

iniciar().catch((e) => { console.error(e); process.exit(1); });
