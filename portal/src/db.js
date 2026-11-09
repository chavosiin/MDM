// Tabelas próprias do portal, no mesmo banco do Headwind (prefixo portal_)
import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({ ...config.db, max: 5 });

export async function criarTabelas() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS portal_localizacao (
      id          bigserial PRIMARY KEY,
      aparelho    text NOT NULL,
      lat         double precision NOT NULL,
      lon         double precision NOT NULL,
      precisao    real,
      velocidade  real,
      bateria     integer,
      fonte       text,
      ts          timestamptz NOT NULL,
      recebido    timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS portal_localizacao_aparelho_ts ON portal_localizacao (aparelho, ts DESC);
    ALTER TABLE portal_localizacao ADD COLUMN IF NOT EXISTS altitude real;   -- metros (agente 6.49+)

    CREATE TABLE IF NOT EXISTS portal_horario (
      id              serial PRIMARY KEY,
      nome            text NOT NULL,
      grupo_id        integer NOT NULL,
      cfg_expediente  integer NOT NULL,
      cfg_fora        integer NOT NULL,
      dias            integer[] NOT NULL,
      inicio          text NOT NULL,
      fim             text NOT NULL,
      ativo           boolean NOT NULL DEFAULT true,
      ultimo_estado   text,
      atualizado      timestamptz NOT NULL DEFAULT now()
    );

    -- Bloqueio de apps por horário: dentro da janela o agente "pausa" os apps (setPackagesSuspended)
    CREATE TABLE IF NOT EXISTS portal_bloqueio_app (
      id          serial PRIMARY KEY,
      nome        text NOT NULL,
      grupo_id    integer,               -- NULL = todos os aparelhos
      pacotes     text[] NOT NULL,
      dias        integer[] NOT NULL,
      inicio      text NOT NULL,
      fim         text NOT NULL,
      ativo       boolean NOT NULL DEFAULT true,
      atualizado  timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE portal_bloqueio_app ADD COLUMN IF NOT EXISTS modo text NOT NULL DEFAULT 'bloquear';

    -- Apps instalados em cada aparelho (enviados pelo agente) e os ícones deles
    CREATE TABLE IF NOT EXISTS portal_app_aparelho (
      aparelho    text NOT NULL,
      pacote      text NOT NULL,
      nome        text NOT NULL,
      atualizado  timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (aparelho, pacote)
    );
    CREATE TABLE IF NOT EXISTS portal_app_icone (
      pacote      text PRIMARY KEY,
      icone       bytea NOT NULL,
      atualizado  timestamptz NOT NULL DEFAULT now()
    );

    -- Endereços já consultados (ponto arredondado a ~10 m), para não perguntar de novo ao Nominatim
    DROP TABLE IF EXISTS portal_endereco;
    CREATE TABLE IF NOT EXISTS portal_endereco_v2 (
      lat       double precision NOT NULL,
      lon       double precision NOT NULL,
      endereco  text NOT NULL,
      PRIMARY KEY (lat, lon)
    );

    CREATE TABLE IF NOT EXISTS portal_log (
      id       bigserial PRIMARY KEY,
      quando   timestamptz NOT NULL DEFAULT now(),
      usuario  text,
      acao     text NOT NULL,
      detalhe  text
    );
  `);
}

export async function registrar(usuario, acao, detalhe) {
  try {
    await pool.query('INSERT INTO portal_log (usuario, acao, detalhe) VALUES ($1, $2, $3)', [usuario, acao, detalhe]);
  } catch (e) {
    console.error('Falha ao gravar log:', e.message);
  }
}
