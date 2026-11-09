// Bloqueio de apps por horário.
// O portal só guarda as regras. Quem bloqueia é o agente personalizado: ele baixa as regras
// do aparelho (GET /api/agente/bloqueios), guarda uma cópia e confere a cada minuto, usando
// o relógio do celular. Dentro da janela, o app fica "pausado" (setPackagesSuspended):
// o ícone fica cinza, o app não abre, mas continua instalado e com os dados.
// Como a cópia fica no celular, o bloqueio funciona mesmo sem conexão com o servidor.
// Início igual ao fim (ex.: 00:00 às 00:00) quer dizer "o dia todo".
import { pool } from './db.js';
import { servico } from './hmdm.js';
import { dentroDoExpediente } from './agendador.js';

// Apps que nunca podem ser pausados (o próprio MDM e partes do sistema)
export const PACOTES_PROTEGIDOS = ['com.hmdm.launcher', 'android', 'com.android.systemui'];

const erro = (mensagem, status = 400) => Object.assign(new Error(mensagem), { status });

export function validarBloqueio(b) {
  const hora = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!b.nome?.trim()) throw erro('Informe um nome');
  const pacotes = [...new Set((b.pacotes || []).map((p) => String(p).trim()).filter(Boolean))];
  if (!pacotes.length) throw erro('Escolha pelo menos um app');
  const invalido = pacotes.find((p) => !PACOTE_VALIDO.test(p));
  if (invalido) throw erro(`Nome de pacote inválido: ${invalido}`);
  const protegido = pacotes.find((p) => PACOTES_PROTEGIDOS.includes(p));
  if (protegido) throw erro(`O app ${protegido} não pode ser bloqueado`);
  if (!hora.test(b.inicio || '') || !hora.test(b.fim || '')) throw erro('Horários inválidos');
  const dias = [...new Set((b.dias || []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];
  if (!dias.length) throw erro('Escolha pelo menos um dia da semana');
  const grupoId = b.grupoId ? Number(b.grupoId) : null;
  const modo = b.modo === 'liberar' ? 'liberar' : 'bloquear';
  return [b.nome.trim(), grupoId, pacotes, dias, b.inicio, b.fim, b.ativo !== false, modo];
}

export const bloqueioJson = (r) => ({
  id: r.id, nome: r.nome, grupoId: r.grupo_id, pacotes: r.pacotes, dias: r.dias,
  inicio: r.inicio, fim: r.fim, ativo: r.ativo, modo: r.modo,
  agora: r.ativo && dentroDoExpediente(r) === (r.modo !== 'liberar') ? 'bloqueado' : 'liberado',
});

// Apps conhecidos, oferecidos mesmo que ainda não apareçam em nenhum celular
export const APPS_POPULARES = [
  ['YouTube', 'com.google.android.youtube'], ['Instagram', 'com.instagram.android'],
  ['TikTok', 'com.zhiliaoapp.musically'], ['Facebook', 'com.facebook.katana'],
  ['WhatsApp', 'com.whatsapp'], ['WhatsApp Business', 'com.whatsapp.w4b'],
  ['Messenger', 'com.facebook.orca'], ['Kwai', 'com.kwai.video'], ['Telegram', 'org.telegram.messenger'],
  ['X (Twitter)', 'com.twitter.android'], ['Threads', 'com.instagram.barcelona'], ['Pinterest', 'com.pinterest'],
  ['Snapchat', 'com.snapchat.android'], ['Discord', 'com.discord'], ['Netflix', 'com.netflix.mediaclient'],
  ['Prime Video', 'com.amazon.avod.thirdpartyclient'], ['Disney+', 'com.disney.disneyplus'],
  ['Globoplay', 'com.globo.globotv'], ['Spotify', 'com.spotify.music'], ['Twitch', 'tv.twitch.android.app'],
  ['Chrome', 'com.android.chrome'], ['Play Store', 'com.android.vending'], ['Shopee', 'com.shopee.br'],
  ['Mercado Livre', 'com.mercadolibre'], ['Free Fire', 'com.dts.freefireth'], ['Roblox', 'com.roblox.client'],
  ['Candy Crush', 'com.king.candycrushsaga'],
].map(([nome, pacote]) => ({ nome, pacote }));

const PACOTE_VALIDO = /^[A-Za-z][\w]*(\.[A-Za-z_][\w]*)+$/;

// Grava a lista de apps que o agente mandou (substitui a anterior do aparelho)
export async function salvarAppsDoAparelho(aparelho, apps) {
  const lista = (Array.isArray(apps) ? apps : []).filter((a) => a && PACOTE_VALIDO.test(a.pacote || '')).slice(0, 1000);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('DELETE FROM portal_app_aparelho WHERE aparelho = $1', [aparelho]);
    for (const a of lista) {
      await db.query('INSERT INTO portal_app_aparelho (aparelho, pacote, nome) VALUES ($1, $2, $3)',
        [aparelho, a.pacote, String(a.nome || a.pacote).slice(0, 100)]);
      if (typeof a.icone === 'string' && a.icone.length < 200000) {
        await db.query(
          `INSERT INTO portal_app_icone (pacote, icone) VALUES ($1, decode($2, 'base64'))
           ON CONFLICT (pacote) DO UPDATE SET icone = EXCLUDED.icone, atualizado = now()`,
          [a.pacote, a.icone],
        );
      }
    }
    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
  return lista.length;
}

// Apps para escolher no bloqueio: primeiro os que estão nos celulares (com ícone),
// depois os do servidor MDM (não-sistema) e os populares
export async function listarApps(appsDoServidor) {
  const { rows } = await pool.query(`
    SELECT a.pacote, min(a.nome) AS nome, count(*)::int AS aparelhos, bool_or(i.pacote IS NOT NULL) AS icone
    FROM portal_app_aparelho a LEFT JOIN portal_app_icone i ON i.pacote = a.pacote
    GROUP BY a.pacote`);
  const mapa = new Map(rows.map((r) => [r.pacote, r]));
  const extras = [
    // apps do servidor MDM, menos os do sistema e os módulos internos do Headwind (com.hmdm.*)
    ...appsDoServidor.filter((a) => !a.system && a.pkg && !a.pkg.startsWith('com.hmdm.')).map((a) => ({ nome: a.name, pacote: a.pkg })),
    ...APPS_POPULARES,
  ];
  for (const a of extras) {
    if (!mapa.has(a.pacote)) mapa.set(a.pacote, { ...a, aparelhos: 0, icone: false });
  }
  for (const p of PACOTES_PROTEGIDOS) mapa.delete(p);
  const instalado = (a) => (a.aparelhos > 0 ? 1 : 0);
  return [...mapa.values()].sort((x, y) => instalado(y) - instalado(x) || x.nome.localeCompare(y.nome, 'pt-BR'));
}

// Grupos de cada aparelho, guardados por 1 minuto (os celulares perguntam a cada minuto)
let cacheAparelhos = { ate: 0, mapa: new Map() };
async function gruposDoAparelho(numero) {
  if (cacheAparelhos.ate < Date.now()) {
    const aparelhos = await servico((api) => api.aparelhos());
    cacheAparelhos = {
      ate: Date.now() + 60 * 1000,
      mapa: new Map(aparelhos.map((a) => [a.number, (a.groups || []).map((g) => g.id)])),
    };
  }
  return cacheAparelhos.mapa.get(numero);
}

// Regras ativas que valem para um aparelho (as do grupo dele e as de "todos os aparelhos")
export async function regrasDoAparelho(numero) {
  const grupos = await gruposDoAparelho(numero);
  if (!grupos) return null;
  const { rows } = await pool.query(
    'SELECT pacotes, dias, inicio, fim, modo FROM portal_bloqueio_app WHERE ativo AND (grupo_id IS NULL OR grupo_id = ANY($1)) ORDER BY id',
    [grupos],
  );
  return rows.flatMap((r) => (r.modo === 'liberar'
    ? inverterJanela(r)
    : [{ pacotes: r.pacotes, dias: r.dias, inicio: r.inicio, fim: r.fim }]));
}

const paraMinutos = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const paraHora = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// "Liberar só no horário": o agente só entende janelas de bloqueio, então o portal manda o
// resto da semana como bloqueio, em janelas que não passam da meia-noite.
// Ex.: liberar seg a sex 08:00-18:00 vira bloquear seg a sex 00:00-08:00 e 18:00-00:00, e sáb/dom o dia todo.
export function inverterJanela(r) {
  const ini = paraMinutos(r.inicio), fim = paraMinutos(r.fim);
  const janelas = new Map(); // "inicio-fim" -> dias
  for (let dia = 0; dia < 7; dia++) {
    const livres = [];
    if (r.dias.includes(dia)) livres.push(ini < fim ? [ini, fim] : [ini, 1440]);
    if (ini >= fim && r.dias.includes((dia + 6) % 7)) livres.push([0, fim]);
    livres.sort((x, y) => x[0] - y[0]);
    let cursor = 0;
    for (const [a, b] of [...livres, [1440, 1440]]) {
      if (a > cursor) {
        const chave = `${paraHora(cursor)}-${paraHora(a)}`;
        janelas.set(chave, [...(janelas.get(chave) || []), dia]);
      }
      cursor = Math.max(cursor, b);
    }
  }
  return [...janelas].map(([chave, dias]) => {
    const [inicio, fimJanela] = chave.split('-');
    return { pacotes: r.pacotes, dias, inicio, fim: fimJanela };
  });
}
