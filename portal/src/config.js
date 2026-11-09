// Configuração do portal, vinda das variáveis de ambiente (docker-compose lê do .env)

function obrigatoria(nome) {
  const v = process.env[nome];
  if (!v) throw new Error(`Variável de ambiente ${nome} não definida`);
  return v;
}

export const config = {
  porta: Number(process.env.PORTAL_PORT || 8090),
  // Endereço interno do Headwind (rede do Docker) e o endereço que o navegador usa
  hmdmUrl: (process.env.HMDM_INTERNAL_URL || 'http://hmdm:8080').replace(/\/$/, ''),
  painelUrl: (process.env.MDM_API_URL || '').replace(/\/$/, ''),
  // Conta usada pelo agendador de horários (roda sem ninguém logado)
  servicoUsuario: obrigatoria('MDM_API_USER'),
  servicoSenha: obrigatoria('MDM_API_PASS'),
  segredoAgente: obrigatoria('PORTAL_SECRET'),
  // Chave do Google Maps (vazia = mapa do OpenStreetMap). Vai para o navegador: restrinja no Google Cloud.
  googleMapsKey: process.env.GOOGLE_MAPS_API_KEY || '',
  fuso: process.env.PORTAL_FUSO || 'America/Sao_Paulo',
  // Dias que o histórico de localização fica guardado (0 = guarda tudo, nunca apaga)
  diasGuardarLocalizacao: Number(process.env.PORTAL_DIAS_LOCALIZACAO || 0),
  db: {
    host: process.env.SQL_HOST || 'postgresql',
    user: obrigatoria('SQL_USER'),
    password: obrigatoria('SQL_PASS'),
    database: obrigatoria('SQL_BASE'),
  },
};
