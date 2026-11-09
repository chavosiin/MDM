// Portal MDM - front-end (JavaScript puro, sem build)
'use strict';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const NOMES_DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MODOS = [
  { id: 'liberado', nome: 'Liberado' },
  { id: 'oculto', nome: 'Escondido' },
  { id: 'bloqueado', nome: 'Desinstalado' },
  { id: 'fora', nome: 'Não gerenciado' },
];

const estado = { aparelhos: [], politicas: [], grupos: [], aba: 'inicio' };

// ---------- Utilidades ----------
async function api(metodo, caminho, corpo) {
  const r = await fetch('/api' + caminho, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : {},
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && caminho !== '/login') { mostrarLogin(); throw new Error(j.erro || 'Faça login'); }
  if (!r.ok) throw new Error(j.erro || `Erro ${r.status}`);
  return j;
}

let timerAviso;
function avisar(msg, erro = false) {
  const el = $('#aviso');
  el.textContent = msg;
  el.classList.toggle('erro-aviso', erro);
  el.hidden = false;
  clearTimeout(timerAviso);
  timerAviso = setTimeout(() => { el.hidden = true; }, erro ? 7000 : 3500);
}

function tempoRelativo(ms) {
  if (!ms) return 'nunca';
  const seg = Math.round((Date.now() - new Date(ms).getTime()) / 1000);
  if (seg < 60) return 'agora';
  if (seg < 3600) return `há ${Math.round(seg / 60)} min`;
  if (seg < 86400) return `há ${Math.round(seg / 3600)} h`;
  return `há ${Math.round(seg / 86400)} dia(s)`;
}

function seloComunicacao(ms) {
  if (!ms) return '<span class="selo cinza">nunca</span>';
  const min = (Date.now() - new Date(ms).getTime()) / 60000;
  const cor = min < 20 ? 'verde' : min < 24 * 60 ? 'amarelo' : 'vermelho';
  return `<span class="selo ${cor}">${tempoRelativo(ms)}</span>`;
}

const dataHora = (v) => new Date(v).toLocaleString('pt-BR');
const hojeIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function opcoes(lista, selecionado, vazio) {
  return (vazio ? `<option value="">${esc(vazio)}</option>` : '')
    + lista.map((o) => `<option value="${o.id}" ${o.id === selecionado ? 'selected' : ''}>${esc(o.nome)}</option>`).join('');
}

// ---------- Login ----------
function mostrarLogin() {
  $('#tela-app').hidden = true;
  $('#tela-login').hidden = false;
  pararMapa();
}

async function entrarNoApp(eu) {
  $('#tela-login').hidden = true;
  $('#tela-app').hidden = false;
  $('#usuario').textContent = eu.usuario;
  if (eu.painelUrl) $('#link-painel').href = eu.painelUrl; else $('#link-painel').hidden = true;
  carregarGoogleMaps(eu.googleMapsKey);
  await carregarBase();
  let aba = 'inicio';
  try { aba = localStorage.getItem('portal_aba2') || 'inicio'; } catch { /* sem armazenamento */ }
  abrirAba(aba);
}

$('#form-login').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target);
  $('#erro-login').textContent = '';
  try {
    await api('POST', '/login', { usuario: f.get('usuario'), senha: f.get('senha') });
    ev.target.reset();
    await entrarNoApp(await api('GET', '/eu'));
  } catch (e) {
    $('#erro-login').textContent = e.message;
  }
});

$('#sair').addEventListener('click', async () => {
  await api('POST', '/logout').catch(() => {});
  mostrarLogin();
});

// ---------- Abas ----------
function abrirAba(aba) {
  if (!$(`[data-painel="${aba}"]`)) aba = 'inicio';
  estado.aba = aba;
  try { localStorage.setItem('portal_aba2', aba); } catch { /* sem armazenamento */ }
  window.scrollTo(0, 0);
  $$('#abas button').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === aba));
  $$('[data-painel]').forEach((p) => { p.hidden = p.dataset.painel !== aba; });
  if (aba === 'mapa') iniciarMapa(); else pararMapa();
  if (aba === 'locais') iniciarLocais();
  ({ inicio: carregarInicio, aparelhos: carregarAparelhos, grupos: carregarGrupos, politicas: carregarPoliticas, bloqueios: carregarBloqueios, historico: carregarHistorico, mapa: () => {}, locais: () => {} })[aba]();
}

// Atualização automática: traz o que foi alterado no painel Headwind (8080) sem recarregar a página.
// Não atualiza enquanto o usuário está editando algo (campo em foco, janela aberta ou alteração não salva).
setInterval(() => {
  if ($('#tela-app').hidden || document.hidden || $$('dialog').some((d) => d.open)) return;
  if (document.activeElement && document.activeElement.matches('select, input')) return;
  if (estado.aba === 'inicio') carregarInicio();
  if (estado.aba === 'aparelhos') carregarAparelhos();
  if (estado.aba === 'grupos') carregarGrupos();
  if (estado.aba === 'bloqueios') carregarBloqueios();
  if (estado.aba === 'historico') carregarHistorico();
  if (estado.aba === 'politicas') {
    carregarPoliticas();
    if (politicaAberta && !politicaAberta.alteracoes.size) recarregarPolitica();
  }
}, 30 * 1000);
$$('#abas button').forEach((b) => b.addEventListener('click', () => abrirAba(b.dataset.aba)));

// Atalhos e links internos: <... data-ir="aba"> ou data-ir="novo-bloqueio"
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-ir]');
  if (!el) return;
  ev.preventDefault();
  if (el.dataset.ir === 'novo-bloqueio') {
    abrirAba('bloqueios');
    abrirDialogoBloqueio(null);
  } else {
    abrirAba(el.dataset.ir);
  }
});

async function carregarBase() {
  const [politicas, grupos] = await Promise.all([api('GET', '/politicas'), api('GET', '/grupos')]);
  estado.politicas = politicas;
  estado.grupos = grupos;
}

// ---------- Aparelhos ----------
async function carregarAparelhos() {
  try {
    estado.aparelhos = await api('GET', '/aparelhos');
    desenharAparelhos();
  } catch (e) { avisar(e.message, true); }
}

function desenharAparelhos() {
  const filtro = $('#filtro-aparelhos').value.trim().toLowerCase();
  const lista = estado.aparelhos.filter((a) => !filtro
    || [a.numero, a.descricao, a.politica, ...a.grupos].join(' ').toLowerCase().includes(filtro));
  $('#lista-aparelhos').innerHTML = lista.map((a) => `
    <tr data-id="${a.id}">
      <td><strong>${esc(a.numero)}</strong><span class="sub">${esc(a.descricao || a.modelo || '')}</span>
        ${a.dono ? '' : '<span class="selo amarelo" title="Sem modo Dono do dispositivo: o controle é limitado">sem controle total</span>'}</td>
      <td>${esc(a.grupos.join(', ') || '-')}</td>
      <td><select class="trocar-politica">${opcoes(estado.politicas, a.politicaId)}</select></td>
      <td>${seloComunicacao(a.ultimaSync)}</td>
      <td>${a.bateria != null ? a.bateria + '%' : '-'}</td>
      <td>${a.localizacao
        ? `<a href="#" class="ver-mapa">${tempoRelativo(a.localizacao.ts)}</a>`
        : '<span class="suave">sem dados</span>'}</td>
      <td><div class="acoes-linha">
        <button class="sincronizar" title="O celular busca as mudanças na hora, sem esperar">Aplicar agora</button>
        <button class="tela-inicial" title="Fecha o app aberto e volta para a tela inicial do MDM">Tela inicial</button>
        <button class="editar-aparelho" title="Descrição, política e grupos do celular">Editar</button>
      </div></td>
    </tr>`).join('') || '<tr><td colspan="7" class="suave">Nenhum aparelho.</td></tr>';
}

$('#filtro-aparelhos').addEventListener('input', desenharAparelhos);
$('#atualizar-aparelhos').addEventListener('click', carregarAparelhos);

$('#lista-aparelhos').addEventListener('change', async (ev) => {
  if (!ev.target.matches('.trocar-politica')) return;
  const id = ev.target.closest('tr').dataset.id;
  const a = estado.aparelhos.find((x) => String(x.id) === id);
  const nova = estado.politicas.find((p) => p.id === Number(ev.target.value));
  if (!confirm(`Trocar "${a.numero}" para a política "${nova.nome}"?\n\nSe o aparelho estiver num horário de bloqueio, a política volta na próxima virada de horário.`)) {
    ev.target.value = a.politicaId;
    return;
  }
  try {
    await api('PUT', `/aparelhos/${id}/politica`, { politicaId: nova.id });
    avisar(`"${a.numero}" agora está em "${nova.nome}"`);
    carregarAparelhos();
  } catch (e) { avisar(e.message, true); ev.target.value = a.politicaId; }
});

$('#lista-aparelhos').addEventListener('click', async (ev) => {
  const tr = ev.target.closest('tr');
  if (!tr) return;
  const a = estado.aparelhos.find((x) => String(x.id) === tr.dataset.id);
  if (ev.target.matches('.ver-mapa')) {
    ev.preventDefault();
    abrirAba('mapa');
    $('#mapa-aparelho').value = a.numero;
    atualizarMapa(true);
  } else if (ev.target.matches('.editar-aparelho')) {
    abrirDialogoAparelho(a);
  } else if (ev.target.matches('.sincronizar, .tela-inicial')) {
    const acao = ev.target.matches('.sincronizar') ? 'sincronizar' : 'tela-inicial';
    try {
      await api('POST', `/aparelhos/${a.id}/${acao}`);
      avisar(acao === 'sincronizar' ? `"${a.numero}" vai buscar as mudanças agora` : `"${a.numero}" voltou para a tela inicial`);
    } catch (e) { avisar(e.message, true); }
  }
});

// ---------- Cadastro de celular ----------
let aparelhoEditando = null;

function checksGrupos(marcados) {
  return estado.grupos.map((g) => `
    <label><input type="checkbox" name="grupo" value="${g.id}" ${marcados.includes(g.id) ? 'checked' : ''}> ${esc(g.nome)}</label>`).join('')
    || '<p class="suave">Nenhum grupo cadastrado. Crie na aba Grupos.</p>';
}

async function abrirDialogoAparelho(a) {
  try { await carregarBase(); } catch (e) { avisar(e.message, true); return; }
  aparelhoEditando = a;
  const f = $('#form-aparelho');
  f.reset();
  $('#titulo-aparelho').textContent = a ? `Editar celular ${a.numero}` : 'Novo celular';
  $('#erro-aparelho').textContent = '';
  f.elements.numero.value = a?.numero || '';
  f.elements.numero.disabled = !!a;
  f.elements.descricao.value = a?.descricao || '';
  f.elements.imei.value = a?.imei || '';
  f.elements.telefone.value = a?.telefone || '';
  f.elements.politicaId.innerHTML = opcoes(estado.politicas, a?.politicaId, 'Escolha…');
  $('#aparelho-grupos').innerHTML = checksGrupos(a?.gruposIds || []);
  $('#excluir-aparelho').hidden = !a;
  $('#dialogo-aparelho').showModal();
  (a ? f.elements.descricao : f.elements.numero).focus();
}

$('#novo-aparelho').addEventListener('click', () => abrirDialogoAparelho(null));
$('#cancelar-aparelho').addEventListener('click', () => $('#dialogo-aparelho').close());

$('#form-aparelho').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const corpo = {
    numero: f.elements.numero.value, descricao: f.elements.descricao.value,
    politicaId: Number(f.elements.politicaId.value), imei: f.elements.imei.value, telefone: f.elements.telefone.value,
    grupos: $$('input[name="grupo"]:checked', f).map((c) => Number(c.value)),
  };
  try {
    if (aparelhoEditando) await api('PUT', `/aparelhos/${aparelhoEditando.id}`, corpo);
    else await api('POST', '/aparelhos', corpo);
    $('#dialogo-aparelho').close();
    avisar(aparelhoEditando ? 'Celular salvo' : `Celular "${corpo.numero.trim()}" cadastrado. No celular, informe esse número ao configurar o agente.`);
    carregarAparelhos();
  } catch (e) { $('#erro-aparelho').textContent = e.message; }
});

$('#excluir-aparelho').addEventListener('click', async () => {
  const a = aparelhoEditando;
  if (!confirm(`Excluir o celular "${a.numero}" do MDM?\n\nEle deixa de receber regras e some das listas e do mapa. Para voltar, é preciso cadastrar de novo.`)) return;
  try {
    await api('DELETE', `/aparelhos/${a.id}`);
    $('#dialogo-aparelho').close();
    avisar(`Celular "${a.numero}" excluído`);
    carregarAparelhos();
  } catch (e) { $('#erro-aparelho').textContent = e.message; }
});

// ---------- Grupos ----------
let grupoEditando = null;

async function carregarGrupos() {
  try {
    const [grupos, aparelhos] = await Promise.all([api('GET', '/grupos'), api('GET', '/aparelhos')]);
    estado.grupos = grupos;
    estado.aparelhos = aparelhos;
    $('#lista-grupos').innerHTML = grupos.map((g) => {
      const membros = aparelhos.filter((a) => a.gruposIds.includes(g.id));
      return `
      <div class="cartao grupo" data-id="${g.id}">
        <h3>${esc(g.nome)}</h3>
        <span class="suave">${plural(membros.length, 'celular', 'celulares')}</span>
        <div class="chips">${membros.map((a) => `<span class="chip">${esc(a.numero)}</span>`).join('')}</div>
        <div class="regra-rodape">
          <span class="espaco"></span>
          <button class="editar">Editar e vincular celulares</button>
          <button class="excluir perigo discreto">Excluir</button>
        </div>
      </div>`;
    }).join('') || `
      <div class="cartao vazio">
        <svg><use href="#i-grupo"/></svg>
        <h3>Nenhum grupo ainda</h3>
        <button class="primario grande" id="primeiro-grupo"><svg><use href="#i-mais"/></svg>Criar o primeiro grupo</button>
      </div>`;
  } catch (e) { avisar(e.message, true); }
}

async function abrirDialogoGrupo(g) {
  try { estado.aparelhos = await api('GET', '/aparelhos'); } catch (e) { avisar(e.message, true); return; }
  grupoEditando = g;
  const f = $('#form-grupo');
  f.reset();
  $('#titulo-grupo').textContent = g ? `Editar grupo ${g.nome}` : 'Novo grupo';
  $('#erro-grupo').textContent = '';
  f.elements.nome.value = g?.nome || '';
  $('#grupo-aparelhos').innerHTML = estado.aparelhos.map((a) => `
    <label><input type="checkbox" name="aparelho" value="${a.id}" ${g && a.gruposIds.includes(g.id) ? 'checked' : ''}>
      <span><strong>${esc(a.numero)}</strong> <span class="sub">${esc(a.descricao || '')}${a.grupos.length ? ' · hoje em: ' + esc(a.grupos.join(', ')) : ''}</span></span></label>`).join('')
    || '<p class="suave">Nenhum celular cadastrado.</p>';
  $('#dialogo-grupo').showModal();
  f.elements.nome.focus();
}

$('#novo-grupo').addEventListener('click', () => abrirDialogoGrupo(null));
$('#cancelar-grupo').addEventListener('click', () => $('#dialogo-grupo').close());

$('#form-grupo').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const corpo = { nome: f.elements.nome.value, aparelhos: $$('input[name="aparelho"]:checked', f).map((c) => Number(c.value)) };
  try {
    const r = grupoEditando ? await api('PUT', `/grupos/${grupoEditando.id}`, corpo) : await api('POST', '/grupos', corpo);
    $('#dialogo-grupo').close();
    avisar(`Grupo salvo${r.alterados ? ` · ${plural(r.alterados, 'celular alterado', 'celulares alterados')}` : ''}`);
    carregarGrupos();
  } catch (e) { $('#erro-grupo').textContent = e.message; }
});

$('#lista-grupos').addEventListener('click', async (ev) => {
  if (ev.target.closest('#primeiro-grupo')) { abrirDialogoGrupo(null); return; }
  const cartao = ev.target.closest('.grupo');
  if (!cartao) return;
  const g = estado.grupos.find((x) => x.id === Number(cartao.dataset.id));
  if (ev.target.matches('.editar')) abrirDialogoGrupo(g);
  if (ev.target.matches('.excluir') && confirm(`Excluir o grupo "${g.nome}"?\n\nOs celulares não são excluídos, só saem do grupo.`)) {
    try { await api('DELETE', `/grupos/${g.id}`); avisar('Grupo excluído'); carregarGrupos(); } catch (e) { avisar(e.message, true); }
  }
});

// ---------- Mapa ----------
let mapa, camada, timerMapa;
const PRECISAO_BOA = 60;   // metros: acima disso a posição veio da antena e fica fora da linha do trajeto

let usarGoogle = false;

// Carrega o Google Maps quando há chave no .env (GOOGLE_MAPS_API_KEY)
function carregarGoogleMaps(chave) {
  if (!chave || usarGoogle || !L.gridLayer.googleMutant) return;
  usarGoogle = true;
  // O Google chama esta função quando recusa a chave (inválida, sem faturamento, endereço não liberado)
  window.gm_authFailure = () => avisar('O Google recusou a chave do mapa. Confira a GOOGLE_MAPS_API_KEY e as restrições dela.', true);
  const s = document.createElement('script');
  s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(chave)}&language=pt-BR&region=BR`;
  s.async = true;
  document.head.appendChild(s);
}

// Ruas e satélite do Google, com o botão de troca no canto do mapa.
// Sem chave configurada: OpenStreetMap e Esri.
function criarMapa(id) {
  const ruas = usarGoogle
    ? L.gridLayer.googleMutant({ type: 'roadmap' })
    : L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap',
    });
  const satelite = usarGoogle
    ? L.gridLayer.googleMutant({ type: 'hybrid' })
    : L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: 'Imagens &copy; Esri',
    });
  const m = L.map(id).setView([-14.2, -51.9], 4);
  ruas.addTo(m);
  L.control.layers({ Ruas: ruas, 'Satélite': satelite }, null, { position: 'topright' }).addTo(m);
  return m;
}

function iniciarMapa() {
  if (!mapa) {
    mapa = criarMapa('mapa');
    camada = L.layerGroup().addTo(mapa);
    $('#mapa-data').value = hojeIso();
    $('#mapa-aparelho').addEventListener('change', () => atualizarMapa(true));
    $('#mapa-data').addEventListener('change', () => atualizarMapa(true));
    $('#mapa-ruas').addEventListener('change', () => atualizarMapa(false));
  }
  setTimeout(() => mapa.invalidateSize(), 50);
  atualizarMapa(true);
  clearInterval(timerMapa);
  timerMapa = setInterval(() => atualizarMapa(false), 60 * 1000);
}

function pararMapa() { clearInterval(timerMapa); }

function popupAparelho(a, p) {
  return `<strong>${esc(a.numero)}</strong><br>${esc(a.descricao || '')}<br>
    ${dataHora(p.ts)} (${tempoRelativo(p.ts)})<br>
    ${p.velocidade != null ? `Velocidade: ${Math.round(p.velocidade)} km/h<br>` : ''}
    ${p.precisao != null ? `Precisão: ±${Math.round(p.precisao)} m<br>` : ''}
    ${p.bateria != null || a.bateria != null ? `Bateria: ${p.bateria ?? a.bateria}%<br>` : ''}
    Política: ${esc(a.politica)}`;
}

// salto = posição que "pulou" para longe e voltou (marcada pelo portal); fica fora do trajeto e das paradas
const boa = (p) => !p.salto && (p.precisao == null || p.precisao <= PRECISAO_BOA);
const enquadramento = (pontos) => (pontos.some((p) => !p.salto) ? pontos.filter((p) => !p.salto) : pontos).map((p) => [p.lat, p.lon]);
const hora = (ts) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

// Desenha o trajeto: linha pelas ruas (ou ligando só os pontos bons) + um ponto por atualização
async function desenharTrajeto(alvo, numero, consulta, trajeto, seguirRuas, cor = '#1f6feb', marcarInicio = true) {
  let linhas = [];
  if (seguirRuas) {
    try { linhas = (await api('GET', `/localizacoes/${encodeURIComponent(numero)}/ruas?${consulta}`)).linhas; } catch { linhas = []; }
  }
  if (!linhas.length) linhas = [trajeto.filter(boa).map((p) => [p.lat, p.lon])];
  linhas.forEach((l) => L.polyline(l, { color: cor, weight: 5, opacity: .8 }).addTo(alvo));
  trajeto.filter((p) => !p.salto).forEach((p) => {
    L.circleMarker([p.lat, p.lon], boa(p)
      ? { radius: 3, color: cor, weight: 1, fillOpacity: 1 }
      : { radius: 3, color: '#8b949e', weight: 1, fillOpacity: .5, opacity: .5 })
      .bindTooltip(`${hora(p.ts)}${p.precisao != null ? ` · ±${Math.round(p.precisao)} m` : ''}`).addTo(alvo);
  });
  if (!marcarInicio) return;
  L.circleMarker([trajeto[0].lat, trajeto[0].lon], { radius: 7, color: '#1a7f37', fillOpacity: 1 })
    .bindTooltip('Início ' + hora(trajeto[0].ts)).addTo(alvo);
}

async function atualizarMapa(enquadrar) {
  try {
    estado.aparelhos = await api('GET', '/aparelhos');
    const sel = $('#mapa-aparelho');
    const atual = sel.value;
    sel.innerHTML = '<option value="">Todos os celulares (última posição)</option>'
      + estado.aparelhos.map((a) => `<option value="${esc(a.numero)}">${esc(a.numero)}${a.descricao ? ' — ' + esc(a.descricao) : ''}</option>`).join('');
    sel.value = atual;
    $('#mapa-data').disabled = !atual;
    $('#mapa-ruas').disabled = !atual;

    if (!atual) {
      camada.clearLayers();
      const com = estado.aparelhos.filter((a) => a.localizacao);
      const pontos = com.map((a) => {
        const p = a.localizacao;
        L.marker([p.lat, p.lon], { title: a.numero }).bindPopup(popupAparelho(a, p))
          .bindTooltip(a.numero, { permanent: true, direction: 'top', offset: [-15, -12] }).addTo(camada);
        if (p.precisao > PRECISAO_BOA) L.circle([p.lat, p.lon], { radius: p.precisao, color: '#8b949e', weight: 1, fillOpacity: .08 }).addTo(camada);
        return [p.lat, p.lon];
      });
      $('#mapa-info').textContent = `${com.length} de ${estado.aparelhos.length} aparelho(s) com localização · atualizado ${new Date().toLocaleTimeString('pt-BR')}`;
      if (enquadrar && pontos.length) mapa.fitBounds(pontos, { padding: [40, 40], maxZoom: 15 });
      return;
    }

    const a = estado.aparelhos.find((x) => x.numero === atual);
    const consulta = `data=${$('#mapa-data').value}`;
    const trajeto = await api('GET', `/localizacoes/${encodeURIComponent(atual)}?${consulta}`);
    if (!trajeto.length) {
      camada.clearLayers();
      $('#mapa-info').textContent = 'Sem posições neste dia.';
      return;
    }
    // monta numa camada nova e troca no fim, para o mapa não piscar enquanto busca as ruas
    const nova = L.layerGroup();
    await desenharTrajeto(nova, atual, consulta, trajeto, $('#mapa-ruas').checked);
    const ultimo = trajeto[trajeto.length - 1];
    L.marker([ultimo.lat, ultimo.lon]).bindPopup(popupAparelho(a, ultimo)).addTo(nova);
    camada.clearLayers();
    nova.eachLayer((l) => l.addTo(camada));
    const bons = trajeto.filter(boa).length;
    $('#mapa-info').textContent = `${trajeto.length} posição(ões), ${bons} com GPS · última ${tempoRelativo(ultimo.ts)}`;
    if (enquadrar) mapa.fitBounds(enquadramento(trajeto), { padding: [40, 40], maxZoom: 16 });
  } catch (e) { avisar(e.message, true); }
}

// ---------- Histórico de localização ----------
let mapaLocais, camadaLocais, marcadorLocal, locais = [];

function distanciaM(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(h));
}

// Junta posições seguidas no mesmo lugar numa "parada" (3 min ou mais). O resto vira uma linha por atualização.
function agruparLocais(pontos, cadaUma) {
  if (cadaUma) return pontos.map((p) => ({ tipo: 'ponto', inicio: p.ts, fim: p.ts, ponto: p }));
  const grupos = [];
  let atual = null;
  for (const p of pontos.filter((x) => !x.salto)) {
    const centro = atual && (atual.pontos.find(boa) || atual.pontos[0]);
    const raio = Math.max(80, Math.min(p.precisao || 0, 200));
    if (atual && distanciaM(centro, p) <= raio) {
      atual.pontos.push(p);
      atual.fim = p.ts;
      if (boa(p) && !boa(atual.ponto)) atual.ponto = p;
    } else {
      atual = { inicio: p.ts, fim: p.ts, ponto: p, pontos: [p] };
      grupos.push(atual);
    }
  }
  // A posição pela antena "pula" com o celular parado: junta grupos vizinhos no mesmo lugar
  // e também um ponto solto (um pulo) entre dois grupos no mesmo lugar.
  const juntar = (a, b) => {
    a.pontos.push(...b.pontos);
    a.fim = b.fim;
    if (boa(b.ponto) && !boa(a.ponto)) a.ponto = b.ponto;
  };
  const juntos = [];
  for (const g of grupos) {
    const a = juntos[juntos.length - 1], antes = juntos[juntos.length - 2];
    if (a && distanciaM(a.ponto, g.ponto) <= 150) {
      juntar(a, g);
    } else if (antes && a.pontos.length === 1 && distanciaM(antes.ponto, g.ponto) <= 150) {
      juntos.pop();
      juntar(antes, a);
      juntar(antes, g);
    } else {
      juntos.push(g);
    }
  }
  return juntos.flatMap((g) => (new Date(g.fim) - new Date(g.inicio) >= 3 * 60000
    ? [{ ...g, tipo: 'parada' }]
    : g.pontos.map((p) => ({ tipo: 'movimento', inicio: p.ts, fim: p.ts, ponto: p }))));
}

function duracao(ms) {
  const min = Math.round(ms / 60000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

// Cores dos celulares no mapa quando aparecem todos juntos
const CORES_CELULARES = ['#1f6feb', '#cf222e', '#1a7f37', '#8250df', '#bf3989', '#bc4c00', '#0a7d8c', '#6e7781'];
const corDoCelular = (numero) => CORES_CELULARES[Math.max(0, estado.aparelhos.findIndex((a) => a.numero === numero)) % CORES_CELULARES.length];
const nomeCelular = (numero) => {
  const a = estado.aparelhos.find((x) => x.numero === numero);
  return a?.descricao ? `${a.numero} — ${a.descricao}` : numero;
};

function iniciarLocais() {
  if (!mapaLocais) {
    mapaLocais = criarMapa('mapa-locais');
    camadaLocais = L.layerGroup().addTo(mapaLocais);
    $('#locais-de').value = hojeIso();
    $('#locais-ate').value = hojeIso();
    ['#locais-aparelho', '#locais-de', '#locais-ate', '#locais-todas', '#locais-precisao'].forEach((s) => $(s).addEventListener('change', carregarLocais));
  }
  setTimeout(() => mapaLocais.invalidateSize(), 50);
  carregarLocais();
}

// Um celular ou todos: lista com as localizações mais recentes primeiro + trajeto de cada um no mapa
async function carregarLocais() {
  try {
    estado.aparelhos = await api('GET', '/aparelhos');
    const sel = $('#locais-aparelho');
    const atual = sel.value;
    sel.innerHTML = '<option value="">Todos os celulares</option>'
      + estado.aparelhos.map((a) => `<option value="${esc(a.numero)}">${esc(a.numero)}${a.descricao ? ' — ' + esc(a.descricao) : ''}</option>`).join('');
    sel.value = estado.aparelhos.some((a) => a.numero === atual) ? atual : '';
    const alvos = sel.value ? [sel.value] : estado.aparelhos.map((a) => a.numero);
    if (!alvos.length) { $('#locais-resumo').textContent = 'Nenhum celular cadastrado.'; return; }

    const de = $('#locais-de').value;
    if ($('#locais-ate').value < de) $('#locais-ate').value = de;
    const consulta = `de=${de}&ate=${$('#locais-ate').value}`;
    $('#locais-resumo').textContent = 'Carregando…';
    // filtro de precisão: só as posições com erro até o valor escolhido
    const limite = Number($('#locais-precisao').value) || Infinity;
    const porCelular = await Promise.all(alvos.map(async (numero) => ({
      numero,
      pontos: (await api('GET', `/localizacoes/${encodeURIComponent(numero)}?${consulta}`))
        .filter((p) => limite === Infinity || (p.precisao != null && p.precisao <= limite)),
    })));
    const cadaUma = $('#locais-todas').checked;
    locais = porCelular
      .flatMap(({ numero, pontos }) => agruparLocais(pontos, cadaUma).map((g) => ({ ...g, aparelho: numero })))
      .sort((a, b) => new Date(b.inicio) - new Date(a.inicio));
    desenharListaLocais(porCelular, !sel.value);

    camadaLocais.clearLayers();
    marcadorLocal = null;
    const comPontos = porCelular.filter((c) => c.pontos.length);
    for (const { numero, pontos } of comPontos) {
      const cor = sel.value ? '#1f6feb' : corDoCelular(numero);
      await desenharTrajeto(camadaLocais, numero, consulta, pontos, true, cor, !!sel.value);
      locais.filter((g) => g.aparelho === numero && g.tipo === 'parada').forEach((g) => {
        L.circleMarker([g.ponto.lat, g.ponto.lon], { radius: 8, color: '#bf8700', fillColor: '#f2cc60', fillOpacity: 1 })
          .bindTooltip(`${sel.value ? '' : esc(numero) + ': '}Parado ${hora(g.inicio)}–${hora(g.fim)}`).addTo(camadaLocais);
      });
      // última localização do celular, com o nome sempre visível
      const ultimo = [...pontos].reverse().find((p) => !p.salto) || pontos[pontos.length - 1];
      L.marker([ultimo.lat, ultimo.lon], { title: numero, zIndexOffset: 1000 })
        .bindTooltip(`${esc(numero)} · ${hora(ultimo.ts)}`, { permanent: true, direction: 'top', offset: [-15, -12] })
        .addTo(camadaLocais);
    }
    const todos = comPontos.flatMap((c) => c.pontos);
    if (todos.length) mapaLocais.fitBounds(enquadramento(todos), { padding: [30, 30], maxZoom: 16 });
  } catch (e) { avisar(e.message, true); }
}

function desenharListaLocais(porCelular, todosCelulares) {
  const pontos = porCelular.flatMap((c) => c.pontos);
  const paradas = locais.filter((g) => g.tipo === 'parada').length;
  const gps = pontos.filter(boa).length;
  const saltos = pontos.filter((p) => p.salto).length;
  let resumo = pontos.length
    ? `${plural(pontos.length, 'atualização', 'atualizações')} (${gps} com GPS${saltos ? `, ${saltos} descartadas por pulo do sinal` : ''}) · ${plural(paradas, 'parada', 'paradas')}`
    : 'Sem posições neste período.';
  // Com todos os celulares: quadro com a última localização de cada um
  if (todosCelulares) {
    resumo += `<ul class="ultimas">${porCelular.map(({ numero, pontos: pts }) => {
      const u = [...pts].reverse().find((p) => !p.salto) || pts[pts.length - 1];
      return `<li data-numero="${esc(numero)}" ${u ? '' : 'class="sem"'}>
        <span class="bolinha" style="background:${corDoCelular(numero)}"></span>
        <b>${esc(nomeCelular(numero))}</b>
        <span class="suave">${u ? `última às ${hora(u.ts)} (${tempoRelativo(u.ts)})` : 'sem posição no período'}</span>
      </li>`;
    }).join('')}</ul>`;
  }
  $('#locais-resumo').innerHTML = resumo;

  let diaAnterior = '';
  $('#locais-itens').innerHTML = locais.map((g, i) => {
    const dia = new Date(g.inicio).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
    const cabecalho = dia !== diaAnterior ? `<li class="dia-locais">${esc(dia)}</li>` : '';
    diaAnterior = dia;
    const p = g.ponto;
    const titulo = g.tipo === 'parada'
      ? `<b>Parado</b> ${duracao(new Date(g.fim) - new Date(g.inicio))}`
      : g.tipo === 'movimento' ? `Em movimento${p.velocidade ? ` · ${Math.round(p.velocidade)} km/h` : ''}` : p.salto ? '<span class="suave">Posição incerta (pulo do sinal)</span>' : 'Atualização';
    return `${cabecalho}<li class="local ${g.tipo}" data-i="${i}">
      <span class="local-hora">${hora(g.inicio)}${g.fim !== g.inicio ? `<br><span class="suave">até ${hora(g.fim)}</span>` : ''}</span>
      <span class="local-texto">
        ${todosCelulares ? `<span class="local-celular"><span class="bolinha" style="background:${corDoCelular(g.aparelho)}"></span>${esc(g.aparelho)}</span>` : ''}
        <span>${titulo}</span>
        <span class="endereco suave" data-lat="${p.lat}" data-lon="${p.lon}">${g.tipo === 'parada' ? 'buscando endereço…' : '<a href="#" class="ver-endereco">ver endereço</a>'}</span>
        <span class="suave pequeno">Lat ${p.lat.toFixed(6)} · Lon ${p.lon.toFixed(6)}${p.altitude != null ? ` · Alt ${Math.round(p.altitude)} m` : ''}</span>
        <span class="suave pequeno">${p.precisao != null ? `Precisão ±${Math.round(p.precisao)} m` : ''}${p.fonte ? ` · ${p.fonte === 'gps' ? 'GPS' : 'antena'}` : ''}${p.bateria != null ? ` · bateria ${p.bateria}%` : ''}</span>
      </span>
    </li>`;
  }).join('');
  buscarEnderecosDasParadas();
}

// Endereços das paradas mais recentes, um por vez (o serviço de endereços aceita 1 pedido por segundo)
async function buscarEnderecosDasParadas() {
  const lista = $('#locais-itens');
  for (const el of $$('.local.parada .endereco', lista).slice(0, 40)) {
    if (!lista.contains(el)) return;     // a lista foi redesenhada
    await mostrarEndereco(el);
  }
  $$('.local.parada .endereco', lista).slice(40).forEach((el) => { el.innerHTML = '<a href="#" class="ver-endereco">ver endereço</a>'; });
}

async function mostrarEndereco(el) {
  try {
    const r = await api('GET', `/endereco?lat=${el.dataset.lat}&lon=${el.dataset.lon}`);
    el.textContent = r.endereco;
  } catch { el.textContent = 'endereço indisponível'; }
}

$('#locais-itens').addEventListener('click', (ev) => {
  const li = ev.target.closest('.local');
  if (!li) return;
  if (ev.target.matches('.ver-endereco')) {
    ev.preventDefault();
    const el = ev.target.parentElement;
    el.textContent = 'buscando…';
    mostrarEndereco(el);
  }
  $$('#locais-itens .local').forEach((x) => x.classList.toggle('ativa', x === li));
  const g = locais[Number(li.dataset.i)];
  const p = g.ponto;
  if (marcadorLocal) marcadorLocal.remove();
  marcadorLocal = L.marker([p.lat, p.lon]).addTo(mapaLocais)
    .bindPopup(`<strong>${esc(nomeCelular(g.aparelho))}</strong><br>${dataHora(g.inicio)}${g.fim !== g.inicio ? ` até ${hora(g.fim)}` : ''}`
      + `<br>Lat ${p.lat.toFixed(6)}, Lon ${p.lon.toFixed(6)}${p.altitude != null ? `<br>Altitude: ${Math.round(p.altitude)} m` : ''}`
      + `${p.precisao != null ? `<br>Precisão: ±${Math.round(p.precisao)} m` : ''}`).openPopup();
  mapaLocais.setView([p.lat, p.lon], Math.max(mapaLocais.getZoom(), 17));
});

// Clicar num celular do quadro "última localização" filtra a tela por ele
$('#locais-resumo').addEventListener('click', (ev) => {
  const li = ev.target.closest('.ultimas li[data-numero]');
  if (!li) return;
  $('#locais-aparelho').value = li.dataset.numero;
  carregarLocais();
});

// Atalhos de período: hoje, últimos 7 / 30 dias ou todo o histórico
$('.periodos').addEventListener('click', (ev) => {
  const botao = ev.target.closest('[data-periodo]');
  if (!botao) return;
  const dias = botao.dataset.periodo;
  $('#locais-ate').value = hojeIso();
  $('#locais-de').value = dias === 'tudo' ? '2020-01-01'
    : new Date(Date.now() - Number(dias) * 86400000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  carregarLocais();
});

$('#locais-csv').addEventListener('click', () => {
  if (!locais.length) { avisar('Nada para baixar neste período.', true); return; }
  const linhas = [['Celular', 'Início', 'Fim', 'Situação', 'Latitude', 'Longitude', 'Altitude (m)', 'Precisão (m)', 'Fonte', 'Velocidade (km/h)', 'Bateria (%)', 'Endereço']];
  $$('#locais-itens .local').forEach((li) => {
    const g = locais[Number(li.dataset.i)];
    const p = g.ponto;
    const end = li.querySelector('.endereco').textContent;
    linhas.push([g.aparelho, dataHora(g.inicio), dataHora(g.fim), g.tipo === 'parada' ? 'Parado' : g.tipo === 'movimento' ? 'Em movimento' : 'Atualização',
      p.lat, p.lon, p.altitude != null ? Math.round(p.altitude) : '', p.precisao != null ? Math.round(p.precisao) : '', p.fonte || '', p.velocidade != null ? Math.round(p.velocidade) : '',
      p.bateria ?? '', /ver endereço|buscando/.test(end) ? '' : end]);
  });
  const csv = '﻿' + linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  link.download = `localizacoes-${$('#locais-aparelho').value || 'todos'}-${$('#locais-de').value}-a-${$('#locais-ate').value}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
});

// ---------- Políticas ----------
let politicaAberta = null;

async function carregarPoliticas() {
  try {
    estado.politicas = await api('GET', '/politicas');
    $('#lista-politicas').innerHTML = estado.politicas.map((p) => `
      <li data-id="${p.id}" class="com-acao ${politicaAberta?.id === p.id ? 'ativa' : ''}">
        <span class="nome-item">${esc(p.nome)}<span class="sub">${p.aparelhos} aparelho(s)</span></span>
        <button class="excluir-item perigo discreto" title="${p.aparelhos ? 'Troque a política dos celulares antes de excluir' : 'Excluir esta política'}">Excluir</button>
      </li>`).join('');
  } catch (e) { avisar(e.message, true); }
}

$('#lista-politicas').addEventListener('click', (ev) => {
  const li = ev.target.closest('li');
  if (!li) return;
  if (ev.target.closest('.excluir-item')) excluirPolitica(Number(li.dataset.id));
  else abrirPolitica(Number(li.dataset.id));
});

async function excluirPolitica(id) {
  const p = estado.politicas.find((x) => x.id === id);
  if (p.aparelhos) { avisar(`A política "${p.nome}" tem ${plural(p.aparelhos, 'celular', 'celulares')}. Troque a política deles em Celulares antes de excluir.`, true); return; }
  if (!confirm(`Excluir a política "${p.nome}"?\n\nIsso não pode ser desfeito.`)) return;
  try {
    await api('DELETE', `/politicas/${id}`);
    avisar(`Política "${p.nome}" excluída`);
    if (politicaAberta?.id === id) {
      politicaAberta = null;
      $('#detalhe-politica').innerHTML = '<p class="suave">← Escolha uma política na lista.</p>';
    }
    carregarPoliticas();
  } catch (e) { avisar(e.message, true); }
}

async function abrirPolitica(id) {
  $$('#lista-politicas li').forEach((li) => li.classList.toggle('ativa', Number(li.dataset.id) === id));
  const el = $('#detalhe-politica');
  el.innerHTML = '<p class="suave">Carregando…</p>';
  try {
    politicaAberta = await api('GET', `/politicas/${id}`);
    politicaAberta.alteracoes = new Map();
    desenharPolitica();
  } catch (e) { el.innerHTML = `<p class="erro">${esc(e.message)}</p>`; }
}

// Recarrega a política aberta sem piscar a tela (usado pela atualização automática)
async function recarregarPolitica() {
  try {
    const nova = await api('GET', `/politicas/${politicaAberta.id}`);
    if (politicaAberta.alteracoes.size) return;
    nova.alteracoes = new Map();
    politicaAberta = nova;
    desenharPolitica();
  } catch { /* tenta de novo no próximo ciclo */ }
}

function desenharPolitica() {
  const p = politicaAberta;
  const mostrarSistema = $('#mostrar-sistema')?.checked || false;
  const busca = ($('#busca-app')?.value || '').toLowerCase();
  const apps = p.apps.filter((a) => (mostrarSistema || !a.sistema || a.modo !== 'fora' || p.alteracoes.has(a.id))
    && (!busca || (a.nome + a.pacote).toLowerCase().includes(busca)));
  $('#detalhe-politica').innerHTML = `
    <div class="cabecalho-politica">
      <h3>${esc(p.nome)}</h3>
      <label class="check" title="Liga o envio da posição do celular para o mapa"><input type="checkbox" id="rastrear" ${p.rastrearLocalizacao ? 'checked' : ''}> Rastrear localização (mapa)</label>
      <button id="excluir-politica" class="perigo discreto" title="Só dá para excluir política sem celulares">Excluir política</button>
    </div>
    ${p.descricao ? `<p class="suave">${esc(p.descricao)}</p>` : ''}
    <ul class="legenda">
      <li><b>Liberado</b>: o app aparece e abre normalmente.</li>
      <li><b>Escondido</b>: o app continua instalado, mas o ícone some da tela.</li>
      <li><b>Desinstalado</b>: o MDM remove o app do celular. Se liberar de novo, ele volta sem os dados.</li>
      <li><b>Não gerenciado</b>: o MDM não mexe no app.</li>
      <li>Para bloquear um app <b>só em alguns horários</b>, sem desinstalar, use <a href="#" data-ir="bloqueios">Bloquear apps</a>.</li>
    </ul>
    <div class="barra">
      <input id="busca-app" type="search" placeholder="Buscar app" value="${esc(busca)}">
      <label class="check"><input type="checkbox" id="mostrar-sistema" ${mostrarSistema ? 'checked' : ''}> Mostrar todos os apps do sistema</label>
    </div>
    <div class="tabela-rolagem"><table>
      <thead><tr><th>App</th><th>Situação</th></tr></thead>
      <tbody>${apps.map((a) => {
        const modo = p.alteracoes.get(a.id) || a.modo;
        return `<tr data-app="${a.id}" class="${p.alteracoes.has(a.id) ? 'alterado' : ''}">
          <td><strong>${esc(a.nome)}</strong>${a.principal ? ' <span class="selo cinza">app principal</span>' : ''}<span class="sub">${esc(a.pacote)}</span></td>
          <td><div class="modo">${MODOS.map((m) => `<button data-modo="${m.id}" class="${m.id === modo ? 'sel' : ''}"
            ${a.principal && m.id !== 'liberado' && m.id !== 'oculto' ? 'disabled' : ''}>${m.nome}</button>`).join('')}</div></td>
        </tr>`;
      }).join('') || '<tr><td colspan="2" class="suave">Nenhum app.</td></tr>'}</tbody>
    </table></div>
    <div class="rodape-politica">
      <span class="suave">${p.alteracoes.size ? `${p.alteracoes.size} alteração(ões) não salva(s)` : ''}</span>
      <button id="descartar-politica" class="discreto" ${p.alteracoes.size ? '' : 'disabled'}>Descartar</button>
      <button id="salvar-politica" class="primario" ${p.alteracoes.size ? '' : 'disabled'}>Salvar e aplicar</button>
    </div>`;
}

$('#detalhe-politica').addEventListener('input', (ev) => {
  if (ev.target.id === 'busca-app') {
    const pos = ev.target.selectionStart;
    desenharPolitica();
    const b = $('#busca-app'); b.focus(); b.setSelectionRange(pos, pos);
  }
});

$('#detalhe-politica').addEventListener('change', async (ev) => {
  if (ev.target.id === 'mostrar-sistema') desenharPolitica();
  if (ev.target.id === 'rastrear') {
    const ativo = ev.target.checked;
    try {
      const r = await api('PUT', `/politicas/${politicaAberta.id}/localizacao`, { ativo });
      politicaAberta.rastrearLocalizacao = ativo;
      avisar(`Rastreamento ${ativo ? 'ligado' : 'desligado'} · ${r.avisados} aparelho(s) avisado(s)`);
    } catch (e) { ev.target.checked = !ativo; avisar(e.message, true); }
  }
});

$('#detalhe-politica').addEventListener('click', async (ev) => {
  const p = politicaAberta;
  const botaoModo = ev.target.closest('.modo button');
  if (botaoModo) {
    const app = p.apps.find((a) => a.id === Number(botaoModo.closest('tr').dataset.app));
    const modo = botaoModo.dataset.modo;
    if (modo === app.modo) p.alteracoes.delete(app.id); else p.alteracoes.set(app.id, modo);
    desenharPolitica();
  } else if (ev.target.id === 'excluir-politica') {
    excluirPolitica(p.id);
  } else if (ev.target.id === 'descartar-politica') {
    p.alteracoes.clear();
    desenharPolitica();
  } else if (ev.target.id === 'salvar-politica') {
    const bloqueios = [...p.alteracoes].filter(([, m]) => m === 'bloqueado').length;
    const msg = `Salvar ${p.alteracoes.size} alteração(ões) em "${p.nome}"? Os aparelhos nesta política recebem na hora.`
      + (bloqueios ? `\n\nAtenção: ${bloqueios} app(s) serão DESINSTALADOS dos aparelhos.` : '');
    if (!confirm(msg)) return;
    ev.target.disabled = true;
    try {
      const apps = [...p.alteracoes].map(([id, modo]) => ({ id, modo, nome: p.apps.find((a) => a.id === id)?.nome }));
      const r = await api('PUT', `/politicas/${p.id}/apps`, { apps });
      avisar(`Política salva · ${r.avisados} aparelho(s) avisado(s)`);
      abrirPolitica(p.id);
    } catch (e) { avisar(e.message, true); ev.target.disabled = false; }
  }
});

// ---------- Textos amigáveis ----------
const juntar = (lista) => (lista.length <= 1 ? lista.join('') : `${lista.slice(0, -1).join(', ')} e ${lista[lista.length - 1]}`);
const maiuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);

function textoDias(dias) {
  const d = [...dias].map(Number).sort();
  const chave = d.join(',');
  if (d.length === 7) return 'todos os dias';
  if (chave === '1,2,3,4,5') return 'de segunda a sexta';
  if (chave === '1,2,3,4,5,6') return 'de segunda a sábado';
  if (chave === '0,6') return 'nos fins de semana';
  const nomes = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const ordem = [1, 2, 3, 4, 5, 6, 0].filter((x) => d.includes(x)).map((x) => nomes[x]);
  return ordem.length === 1 ? `só ${ordem[0]}` : juntar(ordem);
}

function textoHora(inicio, fim) {
  if (inicio === fim) return 'o dia todo';
  return fim < inicio ? `das ${inicio} às ${fim} do dia seguinte` : `das ${inicio} às ${fim}`;
}

const contarCelulares = (grupoId) => {
  if (!grupoId) return estado.aparelhos.length;
  const nome = estado.grupos.find((g) => g.id === grupoId)?.nome;
  return estado.aparelhos.filter((a) => a.grupos.includes(nome)).length;
};
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

function textoQuem(grupoId) {
  if (!grupoId) return `todos os celulares (${contarCelulares(null)})`;
  const g = estado.grupos.find((x) => x.id === grupoId);
  return `celulares do grupo ${g ? g.nome : '#' + grupoId} (${contarCelulares(grupoId)})`;
}

// ---------- Apps (nome e ícone) ----------
let appsConhecidos = null;
const appPorPacote = (pacote) => appsConhecidos?.find((a) => a.pacote === pacote);
const nomeDoApp = (pacote) => appPorPacote(pacote)?.nome || pacote;

function iconeApp(pacote) {
  const a = appPorPacote(pacote);
  if (a?.icone) return `<img class="icone-app" src="/api/apps/icone/${encodeURIComponent(pacote)}" alt="" loading="lazy">`;
  let cor = 0;
  for (const c of pacote) cor = (cor * 31 + c.charCodeAt(0)) % 360;
  return `<span class="icone-app letra" style="background:hsl(${cor} 50% 45%)">${esc(nomeDoApp(pacote).trim().charAt(0).toUpperCase())}</span>`;
}

const chipApp = (pacote) => `<span class="chip">${iconeApp(pacote)}${esc(nomeDoApp(pacote))}</span>`;

// ---------- Início ----------
let regrasBloqueio = [];

async function carregarInicio() {
  try {
    const [aparelhos, regras, apps] = await Promise.all([
      api('GET', '/aparelhos'), api('GET', '/bloqueios-app'), appsConhecidos || api('GET', '/apps'),
    ]);
    estado.aparelhos = aparelhos;
    regrasBloqueio = regras;
    appsConhecidos = apps;
    const minutos = (ms) => (ms ? (Date.now() - new Date(ms).getTime()) / 60000 : Infinity);
    const online = aparelhos.filter((a) => minutos(a.ultimaSync) < 20).length;
    const comLocal = aparelhos.filter((a) => a.localizacao && minutos(a.localizacao.ts) < 60).length;
    const ativos = regras.filter((r) => r.ativo && r.agora === 'bloqueado');

    $('#inicio-numeros').innerHTML = [
      [aparelhos.length, 'celulares cadastrados', 'aparelhos'],
      [online, 'falaram com o servidor nos últimos 20 min', 'aparelhos'],
      [comLocal, 'enviaram localização na última hora', 'mapa'],
      [ativos.length, ativos.length === 1 ? 'bloqueio valendo agora' : 'bloqueios valendo agora', 'bloqueios'],
    ].map(([n, texto, aba]) => `<button class="numero" data-ir="${aba}"><strong>${n}</strong><span>${texto}</span></button>`).join('');

    $('#inicio-bloqueios').innerHTML = ativos.length
      ? ativos.map((r) => `
        <div class="linha-inicio">
          <div class="chips">${r.pacotes.map(chipApp).join('')}</div>
          <span class="suave">${r.modo === 'liberar' ? `liberado só ${textoHora(r.inicio, r.fim)}` : r.inicio === r.fim ? 'o dia todo' : `até ${r.fim}`} · ${esc(textoQuem(r.grupoId))}</span>
        </div>`).join('')
      : `<p class="suave">Nenhum app bloqueado neste momento.</p>
         <button class="primario" data-ir="novo-bloqueio"><svg><use href="#i-mais"/></svg>Criar um bloqueio</button>`;

    const alertas = [];
    for (const a of aparelhos) {
      const m = minutos(a.ultimaSync);
      if (m === Infinity) alertas.push([a, 'nunca falou com o servidor', 'cinza']);
      else if (m > 24 * 60) alertas.push([a, `sem contato ${tempoRelativo(a.ultimaSync)}`, 'vermelho']);
      if (!a.dono) alertas.push([a, 'sem controle total: bloqueios e várias regras não funcionam', 'amarelo']);
      if (a.bateria != null && a.bateria < 20 && m < 60) alertas.push([a, `bateria baixa (${a.bateria}%)`, 'amarelo']);
    }
    $('#inicio-alertas').innerHTML = alertas.length
      ? alertas.map(([a, texto, cor]) => `
        <div class="linha-inicio"><strong>${esc(a.numero)}</strong> <span class="selo ${cor}">${esc(texto)}</span></div>`).join('')
      : '<p class="suave">Tudo certo com os celulares.</p>';
  } catch (e) { avisar(e.message, true); }
}

// ---------- Bloqueio de apps por horário ----------
let appsMarcados = new Set();
let bloqueioEditando = null;

async function carregarBloqueios() {
  try {
    const [regras, apps, aparelhos] = await Promise.all([
      api('GET', '/bloqueios-app'), appsConhecidos || api('GET', '/apps'), api('GET', '/aparelhos'),
    ]);
    regrasBloqueio = regras;
    appsConhecidos = apps;
    estado.aparelhos = aparelhos;
    $('#lista-bloqueios').innerHTML = regras.map((b) => `
      <div class="cartao regra ${b.ativo ? '' : 'desligada'}" data-id="${b.id}">
        <div class="regra-topo">
          <h3>${esc(b.nome)}</h3>
          <label class="chave" title="${b.ativo ? 'Ligado: clique para desligar' : 'Desligado: clique para ligar'}">
            <input type="checkbox" class="ligar" ${b.ativo ? 'checked' : ''}><span></span></label>
        </div>
        <div class="chips">${b.pacotes.map(chipApp).join('')}</div>
        <p class="regra-linha"><svg><use href="#i-relogio"/></svg>${b.modo === 'liberar' ? '<b>Liberado só</b>' : '<b>Bloqueado</b>'} ${textoDias(b.dias)}, ${textoHora(b.inicio, b.fim)}</p>
        <p class="regra-linha"><svg><use href="#i-celular"/></svg>${esc(maiuscula(textoQuem(b.grupoId)))}</p>
        <div class="regra-rodape">
          ${!b.ativo ? '<span class="selo cinza">Desligado</span>'
            : b.agora === 'bloqueado' ? '<span class="selo vermelho">Bloqueado agora</span>' : '<span class="selo verde">Liberado agora</span>'}
          <span class="espaco"></span>
          <button class="editar">Editar</button>
          <button class="excluir perigo discreto">Excluir</button>
        </div>
      </div>`).join('') || `
      <div class="cartao vazio">
        <svg><use href="#i-cadeado"/></svg>
        <h3>Nenhum bloqueio ainda</h3>
        <p class="suave">Crie um bloqueio para impedir que apps como YouTube ou Instagram sejam usados em certos horários.</p>
        <button class="primario grande" data-ir="novo-bloqueio"><svg><use href="#i-mais"/></svg>Criar o primeiro bloqueio</button>
      </div>`;
  } catch (e) { avisar(e.message, true); }
}

function blocoApps(titulo, lista) {
  if (!lista.length) return '';
  return `<div class="titulo-grupo-apps">${titulo}</div><div class="tiles">${lista.map((a) => `
    <button type="button" class="tile ${appsMarcados.has(a.pacote) ? 'sel' : ''}" data-pacote="${esc(a.pacote)}" title="${esc(a.pacote)}">
      ${iconeApp(a.pacote)}
      <span class="tile-nome">${esc(a.nome)}</span>
      <span class="tile-sub">${a.aparelhos ? plural(a.aparelhos, 'celular', 'celulares') : 'não visto ainda'}</span>
      <svg class="tile-check"><use href="#i-check"/></svg>
    </button>`).join('')}</div>`;
}

function desenharAppsBloqueio() {
  const termo = $('#busca-app-bloqueio').value.trim().toLowerCase();
  const lista = (appsConhecidos || []).filter((a) => !termo || a.nome.toLowerCase().includes(termo) || a.pacote.includes(termo));
  const instalados = lista.filter((a) => a.aparelhos > 0);
  const outros = lista.filter((a) => !a.aparelhos);
  const nenhumInstalado = !(appsConhecidos || []).some((a) => a.aparelhos > 0);
  $('#lista-apps-bloqueio').innerHTML = (lista.length
    ? blocoApps('Instalados nos celulares', instalados) + blocoApps('Outros apps conhecidos', outros)
    : '<p class="suave">Nenhum app com esse nome. Veja “Não achou o app?” abaixo.</p>')
    + (nenhumInstalado && !termo ? '<p class="suave nota">Os celulares ainda não enviaram a lista de apps instalados. Ela chega sozinha em alguns minutos depois que o celular atualiza para o agente 6.43.</p>' : '');
}

function pacotesExtras() {
  return $('#form-bloqueio').elements.extras.value.split(/[\s,;]+/).filter(Boolean);
}

function desenharEscolhidos() {
  const todos = [...appsMarcados];
  $('#apps-escolhidos').innerHTML = todos.length
    ? todos.map((p) => `<button type="button" class="chip removivel" data-remover="${esc(p)}" title="Tirar da lista">${iconeApp(p)}${esc(nomeDoApp(p))}<span class="x">×</span></button>`).join('')
    : '<span class="suave">Nenhum app escolhido. Toque nos apps abaixo.</span>';
}

const PRESETS = {
  comercial: { dias: [1, 2, 3, 4, 5], inicio: '08:00', fim: '18:00' },
  almoco: { dias: [1, 2, 3, 4, 5], inicio: '12:00', fim: '13:00' },
  noite: { dias: [0, 1, 2, 3, 4, 5, 6], inicio: '22:00', fim: '06:00' },
  sempre: { dias: [0, 1, 2, 3, 4, 5, 6], inicio: '00:00', fim: '00:00' },
};

function lerFormBloqueio() {
  const f = $('#form-bloqueio');
  return {
    pacotes: [...new Set([...appsMarcados, ...pacotesExtras()])],
    dias: $$('input[name="dia"]:checked', f).map((c) => Number(c.value)),
    inicio: f.elements.inicio.value, fim: f.elements.fim.value,
    grupoId: f.elements.grupoId.value ? Number(f.elements.grupoId.value) : null,
    modo: f.elements.modo.value,
  };
}

function atualizarFrase() {
  const v = lerFormBloqueio();
  const chave = (x) => `${[...x.dias].sort().join(',')}|${x.inicio}|${x.fim}`;
  $$('.presets button').forEach((b) => b.classList.toggle('sel', chave(PRESETS[b.dataset.preset]) === chave(v)));
  let frase;
  if (!v.pacotes.length) frase = '<span class="suave">Escolha pelo menos um app no passo 1.</span>';
  else if (!v.dias.length) frase = '<span class="suave">Escolha pelo menos um dia no passo 2.</span>';
  else if (!v.inicio || !v.fim) frase = '<span class="suave">Preencha o horário no passo 2.</span>';
  else {
    const nomes = v.pacotes.map(nomeDoApp);
    const varios = nomes.length > 1;
    frase = v.modo === 'liberar'
      ? `<b>${esc(juntar(nomes))}</b> só ${varios ? 'poderão' : 'poderá'} ser ${varios ? 'usados' : 'usado'} `
        + `${textoDias(v.dias)}, ${textoHora(v.inicio, v.fim)}, em ${esc(textoQuem(v.grupoId))}. Fora disso, ${varios ? 'ficam bloqueados' : 'fica bloqueado'}.`
      : `<b>${esc(juntar(nomes))}</b> ${varios ? 'ficarão bloqueados' : 'ficará bloqueado'} `
        + `${textoDias(v.dias)}, ${textoHora(v.inicio, v.fim)}, em ${esc(textoQuem(v.grupoId))}.`;
  }
  $('#frase-bloqueio').innerHTML = frase;
}

async function abrirDialogoBloqueio(b) {
  try {
    [appsConhecidos, estado.aparelhos] = await Promise.all([api('GET', '/apps'), api('GET', '/aparelhos')]);
  } catch (e) { avisar(e.message, true); return; }
  bloqueioEditando = b;
  const f = $('#form-bloqueio');
  f.reset();
  $('#titulo-bloqueio').textContent = b ? 'Editar bloqueio' : 'Novo bloqueio';
  $('#erro-bloqueio').textContent = '';
  f.elements.grupoId.innerHTML = `<option value="">Todos os celulares (${contarCelulares(null)})</option>`
    + estado.grupos.map((g) => `<option value="${g.id}" ${g.id === b?.grupoId ? 'selected' : ''}>Grupo ${esc(g.nome)} (${plural(contarCelulares(g.id), 'celular', 'celulares')})</option>`).join('');
  const conhecidos = new Set(appsConhecidos.map((a) => a.pacote));
  appsMarcados = new Set((b?.pacotes || []).filter((p) => conhecidos.has(p)));
  const valores = b || { ...PRESETS.comercial, nome: '' };
  f.elements.nome.value = valores.nome || '';
  f.elements.inicio.value = valores.inicio;
  f.elements.fim.value = valores.fim;
  f.elements.modo.value = b?.modo || 'bloquear';
  $$('input[name="dia"]', f).forEach((c) => { c.checked = valores.dias.includes(Number(c.value)); });
  const extras = (b?.pacotes || []).filter((p) => !conhecidos.has(p));
  f.elements.extras.value = extras.join(', ');
  f.querySelector('details').open = extras.length > 0;
  desenharAppsBloqueio();
  desenharEscolhidos();
  atualizarFrase();
  $('#dialogo-bloqueio').showModal();
  $('#lista-apps-bloqueio').scrollTop = 0;
  $('#busca-app-bloqueio').focus();
}

$('#busca-app-bloqueio').addEventListener('input', desenharAppsBloqueio);
$('#busca-app-bloqueio').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ev.preventDefault(); });

$('#lista-apps-bloqueio').addEventListener('click', (ev) => {
  const tile = ev.target.closest('.tile');
  if (!tile) return;
  const p = tile.dataset.pacote;
  if (appsMarcados.has(p)) appsMarcados.delete(p); else appsMarcados.add(p);
  tile.classList.toggle('sel', appsMarcados.has(p));
  desenharEscolhidos();
  atualizarFrase();
});

$('#apps-escolhidos').addEventListener('click', (ev) => {
  const chip = ev.target.closest('[data-remover]');
  if (!chip) return;
  appsMarcados.delete(chip.dataset.remover);
  $$('#lista-apps-bloqueio .tile').forEach((t) => t.classList.toggle('sel', appsMarcados.has(t.dataset.pacote)));
  desenharEscolhidos();
  atualizarFrase();
});

$('#form-bloqueio').addEventListener('click', (ev) => {
  const botao = ev.target.closest('[data-preset]');
  if (!botao) return;
  const p = PRESETS[botao.dataset.preset];
  const f = $('#form-bloqueio');
  f.elements.inicio.value = p.inicio;
  f.elements.fim.value = p.fim;
  $$('input[name="dia"]', f).forEach((c) => { c.checked = p.dias.includes(Number(c.value)); });
  atualizarFrase();
});

$('#form-bloqueio').addEventListener('input', atualizarFrase);
$('#form-bloqueio').addEventListener('change', atualizarFrase);
$('#novo-bloqueio').addEventListener('click', () => abrirDialogoBloqueio(null));
$('#cancelar-bloqueio').addEventListener('click', () => $('#dialogo-bloqueio').close());

$('#form-bloqueio').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const v = lerFormBloqueio();
  const nomeAuto = `${v.modo === 'liberar' ? 'Horário de' : 'Bloquear'} ${juntar(v.pacotes.map(nomeDoApp))}`.slice(0, 80);
  const corpo = { ...v, nome: f.elements.nome.value.trim() || nomeAuto, ativo: bloqueioEditando ? bloqueioEditando.ativo : true };
  try {
    if (bloqueioEditando) await api('PUT', `/bloqueios-app/${bloqueioEditando.id}`, corpo);
    else await api('POST', '/bloqueios-app', corpo);
    $('#dialogo-bloqueio').close();
    avisar('Bloqueio salvo. Os celulares aplicam em até 1 minuto.');
    carregarBloqueios();
  } catch (e) { $('#erro-bloqueio').textContent = e.message; }
});

$('#lista-bloqueios').addEventListener('change', async (ev) => {
  if (!ev.target.matches('.ligar')) return;
  const b = regrasBloqueio.find((x) => x.id === Number(ev.target.closest('.regra').dataset.id));
  const ativo = ev.target.checked;
  try {
    await api('PUT', `/bloqueios-app/${b.id}`, { ...b, ativo });
    avisar(ativo ? `"${b.nome}" ligado. Vale em até 1 minuto.` : `"${b.nome}" desligado. Os apps voltam ao normal em até 1 minuto.`);
    carregarBloqueios();
  } catch (e) { ev.target.checked = !ativo; avisar(e.message, true); }
});

$('#lista-bloqueios').addEventListener('click', async (ev) => {
  const cartao = ev.target.closest('.regra');
  if (!cartao) return;
  const b = regrasBloqueio.find((x) => x.id === Number(cartao.dataset.id));
  if (ev.target.matches('.editar')) abrirDialogoBloqueio(b);
  if (ev.target.matches('.excluir') && confirm(`Excluir o bloqueio "${b.nome}"?\n\nOs apps voltam ao normal em até 1 minuto.`)) {
    try { await api('DELETE', `/bloqueios-app/${b.id}`); avisar('Bloqueio excluído'); carregarBloqueios(); } catch (e) { avisar(e.message, true); }
  }
});

// ---------- Histórico ----------
const NOMES_ACOES = {
  'login': 'Entrou no portal', 'trocar-politica': 'Troca de política', 'sincronizar': 'Aplicar agora', 'tela-inicial': 'Tela inicial',
  'editar-politica': 'Política editada', 'salvar-horario': 'Troca por horário salva', 'excluir-horario': 'Troca por horário excluída',
  'salvar-bloqueio-app': 'Bloqueio de app salvo', 'excluir-bloqueio-app': 'Bloqueio de app excluído', 'erro': 'Erro',
  'cadastrar-aparelho': 'Celular cadastrado', 'editar-aparelho': 'Celular editado', 'excluir-aparelho': 'Celular excluído',
  'salvar-grupo': 'Grupo salvo', 'excluir-grupo': 'Grupo excluído', 'excluir-politica': 'Política excluída',
};

async function carregarHistorico() {
  try {
    const linhas = await api('GET', '/historico');
    $('#lista-historico').innerHTML = linhas.map((l) => `
      <tr><td>${dataHora(l.quando)}</td><td>${esc(l.usuario || '-')}</td>
        <td>${esc(NOMES_ACOES[l.acao] || l.acao)}</td><td>${esc(l.detalhe || '')}</td></tr>`).join('')
      || '<tr><td colspan="4" class="suave">Nada registrado ainda.</td></tr>';
  } catch (e) { avisar(e.message, true); }
}
$('#atualizar-historico').addEventListener('click', carregarHistorico);

// ---------- Início ----------
api('GET', '/eu').then(entrarNoApp).catch(() => mostrarLogin());
