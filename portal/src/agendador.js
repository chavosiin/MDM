// Agendador de horários de bloqueio: a cada minuto verifica as regras e, na virada
// de expediente <-> fora de expediente, troca a política dos aparelhos do grupo.
// Substitui o scripts\agendar-politica.ps1 (não use os dois ao mesmo tempo).
import { pool, registrar } from './db.js';
import { servico } from './hmdm.js';
import { aplicarPolitica } from './politicas.js';
import { config } from './config.js';

const DIAS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Dia da semana (0 = domingo) e minutos do dia no fuso configurado
export function agora(data = new Date()) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: config.fuso, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(data).map((p) => [p.type, p.value]));
  return { dia: DIAS[partes.weekday], minutos: Number(partes.hour) * 60 + Number(partes.minute) };
}

const paraMinutos = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

// Está dentro do expediente? Suporta janela que passa da meia-noite (ex.: 22:00-06:00):
// nesse caso o dia que vale é o do início da janela.
export function dentroDoExpediente(regra, momento = agora()) {
  const ini = paraMinutos(regra.inicio), fim = paraMinutos(regra.fim);
  const { dia, minutos } = momento;
  if (ini < fim) return regra.dias.includes(dia) && minutos >= ini && minutos < fim;
  if (minutos >= ini) return regra.dias.includes(dia);
  return minutos < fim && regra.dias.includes((dia + 6) % 7);
}

export async function aplicarRegra(regra, { forcar = false, usuario = 'agendador' } = {}) {
  const expediente = dentroDoExpediente(regra);
  const estado = expediente ? 'expediente' : 'fora';
  if (!forcar && regra.ultimo_estado === estado) return null;

  const alvo = expediente ? regra.cfg_expediente : regra.cfg_fora;
  const resultado = await servico(async (api) => {
    const aparelhos = (await api.aparelhos()).filter((a) => (a.groups || []).some((g) => g.id === regra.grupo_id));
    return aplicarPolitica(api, aparelhos, alvo, {
      usuario,
      motivo: `Horário "${regra.nome}" (${expediente ? 'início do expediente' : 'fim do expediente'})`,
      foraDeExpediente: !expediente,
    });
  });
  if (resultado.falhas.length === 0) {
    await pool.query('UPDATE portal_horario SET ultimo_estado = $1 WHERE id = $2', [estado, regra.id]);
  }
  return { estado, ...resultado };
}

async function ciclo() {
  try {
    const { rows } = await pool.query('SELECT * FROM portal_horario WHERE ativo ORDER BY id');
    for (const regra of rows) {
      try {
        await aplicarRegra(regra);
      } catch (e) {
        console.error(`Horário ${regra.id}:`, e.message);
        await registrar('agendador', 'erro', `Horário "${regra.nome}": ${e.message}`);
      }
    }
  } catch (e) {
    console.error('Agendador:', e.message);
  }
}

async function limparLocalizacoesAntigas() {
  if (!config.diasGuardarLocalizacao) return;   // 0 = guarda todo o histórico
  try {
    await pool.query(`DELETE FROM portal_localizacao WHERE ts < now() - make_interval(days => $1)`, [config.diasGuardarLocalizacao]);
  } catch (e) {
    console.error('Limpeza de localizações:', e.message);
  }
}

export function iniciarAgendador() {
  setTimeout(ciclo, 5000);
  setInterval(ciclo, 60 * 1000);
  limparLocalizacoesAntigas();
  setInterval(limparLocalizacoesAntigas, 6 * 60 * 60 * 1000);
}
