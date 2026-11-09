// Serviços de mapa usados pelo histórico de localização:
//   - encaixar o trajeto nas ruas (map matching do OSRM, serviço público em router.project-osrm.org)
//   - endereço de um ponto (Nominatim, serviço público do OpenStreetMap)
// Os dois são gratuitos e limitados: o portal guarda os resultados e faz poucas chamadas.
import { pool } from './db.js';

const OSRM = process.env.PORTAL_OSRM_URL || 'https://router.project-osrm.org';
const NOMINATIM = process.env.PORTAL_NOMINATIM_URL || 'https://nominatim.openstreetmap.org';
const AGENTE = 'PortalMDM/1.0 (controle de frota interno)';

// Distância em metros entre dois pontos
export function distancia(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(h));
}

// ---------- Pulos de posição ----------
// Com o celular parado (principalmente em lugar fechado), o GPS às vezes manda uma posição a
// quilômetros de distância dizendo ter erro de ±10 m, e depois volta. Cada posição é comparada com
// a mediana das 3 anteriores e 3 seguintes: se estiver longe demais, é marcada como "salto"
// (fica no histórico, mas não entra no trajeto nem nas paradas). Em movimento, a mediana fica em
// cima do próprio ponto, então o trajeto real não é cortado.
const JANELA = 3;
const mediana = (v) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

export function marcarSaltos(pontos) {
  for (let i = 0; i < pontos.length; i++) {
    const vizinhos = pontos.slice(Math.max(0, i - JANELA), i + JANELA + 1);
    if (vizinhos.length < 5) continue;
    const centro = { lat: mediana(vizinhos.map((p) => p.lat)), lon: mediana(vizinhos.map((p) => p.lon)) };
    pontos[i].salto = distancia(centro, pontos[i]) > Math.max(300, 2 * (pontos[i].precisao || 0));
  }
  return pontos;
}

// ---------- Trajeto nas ruas ----------
// Só pontos bons (até ±60 m e sem salto) entram; pontos parados no mesmo lugar viram um só.
// O servidor público do OSRM aceita até 10 pontos por chamada e raio de no máximo ~35 m.
const PRECISAO_MAX = 60;
const POR_CHAMADA = 10;
const cacheRuas = new Map();

function pontosParaRuas(pontos) {
  const bons = [];
  for (const p of pontos) {
    if (p.salto || (p.precisao != null && p.precisao > PRECISAO_MAX)) continue;
    const ultimo = bons[bons.length - 1];
    // menos de 50 m do último ponto = parado (a variação do GPS parado faria a linha dar voltas no quarteirão)
    if (ultimo && distancia(ultimo, p) < 50) continue;
    bons.push(p);
  }
  return bons;
}

async function encaixarTrecho(trecho) {
  const coords = trecho.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const raios = trecho.map((p) => Math.round(Math.min(35, Math.max(15, p.precisao || 20)))).join(';');
  const tempos = trecho.map((p) => Math.round(new Date(p.ts).getTime() / 1000)).join(';');
  const url = `${OSRM}/match/v1/driving/${coords}?geometries=geojson&overview=full&gaps=split&tidy=true`
    + `&radiuses=${raios}&timestamps=${tempos}`;
  const r = await fetch(url, { headers: { 'User-Agent': AGENTE }, signal: AbortSignal.timeout(20000) });
  const j = await r.json();
  if (j.code !== 'Ok') return [];
  return j.matchings.map((m) => m.geometry.coordinates.map(([lon, lat]) => [lat, lon]));
}

// Devolve linhas [[lat, lon], ...] seguindo as ruas. Resultado guardado por aparelho + dia + último ponto.
export async function trajetoNasRuas(chave, pontos) {
  const bons = pontosParaRuas(pontos);
  const id = `${chave}|${bons.length}|${bons[bons.length - 1]?.ts || ''}`;
  if (cacheRuas.has(id)) return cacheRuas.get(id);
  const linhas = [];
  // trechos de até 10 pontos, com 1 ponto repetido para a linha não ter buraco
  for (let i = 0; i < bons.length - 1; i += POR_CHAMADA - 1) {
    const trecho = bons.slice(i, i + POR_CHAMADA);
    if (trecho.length < 2) break;
    try {
      linhas.push(...await encaixarTrecho(trecho));
    } catch (e) {
      console.error('Encaixar nas ruas:', e.message);
    }
  }
  const resultado = { linhas, pontosUsados: bons.length };
  cacheRuas.set(id, resultado);
  if (cacheRuas.size > 200) cacheRuas.delete(cacheRuas.keys().next().value);
  return resultado;
}

// ---------- Endereços ----------
// Guardados no banco (ponto arredondado a ~10 m). O Nominatim pede no máximo 1 chamada por segundo.
let fila = Promise.resolve();
const UF = {
  Acre: 'AC', Alagoas: 'AL', 'Amapá': 'AP', Amazonas: 'AM', Bahia: 'BA', 'Ceará': 'CE', 'Distrito Federal': 'DF',
  'Espírito Santo': 'ES', 'Goiás': 'GO', 'Maranhão': 'MA', 'Mato Grosso': 'MT', 'Mato Grosso do Sul': 'MS',
  'Minas Gerais': 'MG', 'Pará': 'PA', 'Paraíba': 'PB', 'Paraná': 'PR', Pernambuco: 'PE', 'Piauí': 'PI',
  'Rio de Janeiro': 'RJ', 'Rio Grande do Norte': 'RN', 'Rio Grande do Sul': 'RS', 'Rondônia': 'RO', Roraima: 'RR',
  'Santa Catarina': 'SC', 'São Paulo': 'SP', Sergipe: 'SE', Tocantins: 'TO',
};

export async function endereco(lat, lon) {
  const latR = Number(lat.toFixed(4)), lonR = Number(lon.toFixed(4));
  const { rows } = await pool.query('SELECT endereco FROM portal_endereco_v2 WHERE lat = $1 AND lon = $2', [latR, lonR]);
  if (rows.length) return rows[0].endereco;
  const tarefa = fila.then(async () => {
    const url = `${NOMINATIM}/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=pt-BR&lat=${latR}&lon=${lonR}`;
    const r = await fetch(url, { headers: { 'User-Agent': AGENTE }, signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    const a = j.address || {};
    // "Rua X, 123 - Bairro - Cidade/UF - CEP 00000-000". Sem número no mapa: "s/nº"
    const via = a.road || a.pedestrian || a.footway || a.path;
    const rua = via ? `${via}, ${a.house_number || 's/nº'}` : '';
    const bairro = a.suburb || a.neighbourhood || a.quarter;
    const cidade = [a.city || a.town || a.village || a.municipality, UF[a.state]].filter(Boolean).join('/');
    const cep = a.postcode ? `CEP ${a.postcode}` : '';
    const texto = [rua, bairro, cidade, cep].filter(Boolean).join(' - ') || j.display_name || 'Endereço não encontrado';
    await pool.query(
      'INSERT INTO portal_endereco_v2 (lat, lon, endereco) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [latR, lonR, texto]);
    await new Promise((ok) => setTimeout(ok, 1100));
    return texto;
  });
  fila = tarefa.catch(() => {});
  return tarefa;
}
