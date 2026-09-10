-- ==============================================================================
-- PROJETO NOVO: GRUPO QU4TRO — GESTÃO DE CLIENTES
-- BANCO DE DADOS OFICIAL SUPABASE (PostgreSQL 15+)
-- 100% INDEPENDENTE DO BRAVO ANALYTICS
-- ==============================================================================

-- 1. Habilitar extensões necessárias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Tabela de Estabelecimentos do Grupo Qu4tro
CREATE TABLE IF NOT EXISTS establishments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    brand_color VARCHAR(20) DEFAULT '#bf9153',
    theme_deep VARCHAR(20) DEFAULT '#132c39',
    theme_soft VARCHAR(20) DEFAULT '#f8f0e4',
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Inserir as 3 operações iniciais do Grupo Qu4tro
INSERT INTO establishments (slug, name, brand_color, theme_deep, theme_soft)
VALUES 
    ('lena', 'Leña Casa Italiana', '#d67a35', '#2f2b1d', '#f8eee5'),
    ('iconiko', 'Iconiko Cozinha Japonesa', '#9aa7bd', '#0d1830', '#edf1f8'),
    ('cafe', 'Bravo Café', '#8b5d45', '#241916', '#f4ece8')
ON CONFLICT (slug) DO UPDATE 
SET name = EXCLUDED.name, brand_color = EXCLUDED.brand_color, theme_deep = EXCLUDED.theme_deep;

-- 3. Tabela de Clientes (Base Unificada do Grupo Qu4tro)
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(30) UNIQUE NOT NULL,
    email VARCHAR(150),
    first_house VARCHAR(50),
    first_visit DATE DEFAULT CURRENT_DATE,
    last_visit DATE DEFAULT CURRENT_DATE,
    total_visits INT DEFAULT 0,
    visits_lena INT DEFAULT 0,
    visits_iconiko INT DEFAULT 0,
    visits_cafe INT DEFAULT 0,
    source VARCHAR(100) DEFAULT 'Da casa',
    registration_channel VARCHAR(50) DEFAULT 'Recepção',
    preferences TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Índices para buscas ultrarrápidas de clientes por telefone ou nome na recepção
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
CREATE INDEX IF NOT EXISTS idx_customers_last_visit ON customers(last_visit);

-- 4. Tabela de Histórico de Visitas (Check-ins por Estabelecimento)
CREATE TABLE IF NOT EXISTS visits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
    customer_name VARCHAR(150) NOT NULL,
    customer_phone VARCHAR(30) NOT NULL,
    house VARCHAR(50) NOT NULL, -- 'Leña', 'Íconico' ou 'Bravo Café'
    visit_date DATE NOT NULL DEFAULT CURRENT_DATE,
    arrival_time VARCHAR(10),
    people_count INT DEFAULT 1,
    table_number VARCHAR(30),
    source VARCHAR(100),
    status VARCHAR(50) DEFAULT 'Recorrente', -- 'Novo' ou 'Recorrente'
    amount NUMERIC(10,2) DEFAULT 0,
    notes TEXT,
    operator_reception VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visits_customer_id ON visits(customer_id);
CREATE INDEX IF NOT EXISTS idx_visits_date ON visits(visit_date);
CREATE INDEX IF NOT EXISTS idx_visits_house ON visits(house);

-- 5. Tabela de Reservas
CREATE TABLE IF NOT EXISTS reservations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    customer_name VARCHAR(150) NOT NULL,
    customer_phone VARCHAR(30) NOT NULL,
    house VARCHAR(50) NOT NULL,
    reservation_date DATE NOT NULL,
    reservation_time VARCHAR(10),
    people_count INT DEFAULT 2,
    status VARCHAR(50) DEFAULT 'Pendente', -- 'Pendente', 'Confirmada', 'Convertida', 'Cancelada'
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reservations_date ON reservations(reservation_date);
CREATE INDEX IF NOT EXISTS idx_reservations_house ON reservations(house);

-- 6. Tabela de Tags (Segmentação e Preferências)
CREATE TABLE IF NOT EXISTS tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(50) UNIQUE NOT NULL,
    color VARCHAR(20) DEFAULT '#888888',
    created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO tags (name, color)
VALUES 
    ('VIP Ativo', '#d67a35'),
    ('Apreciador de Vinhos', '#8b1e3f'),
    ('Aniversariante do Mês', '#e86a33'),
    ('Mesas Grandes / Família', '#2d6486'),
    ('Restrição Alimentar', '#b64b55'),
    ('Cliente Café Especial', '#8b5d45')
ON CONFLICT (name) DO NOTHING;

-- 7. Configurações de Segurança (Row Level Security - RLS)
ALTER TABLE establishments ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;

-- Políticas de Acesso Permissivo para Uso no Aplicativo (Chave Pública / Anon do Supabase)
CREATE POLICY "Permitir leitura pública de estabelecimentos"
    ON establishments FOR SELECT
    USING (true);

CREATE POLICY "Permitir leitura de clientes"
    ON customers FOR SELECT
    USING (true);

CREATE POLICY "Permitir inserção e atualização de clientes"
    ON customers FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Permitir leitura de visitas"
    ON visits FOR SELECT
    USING (true);

CREATE POLICY "Permitir registro de visitas"
    ON visits FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Permitir leitura e gestão de reservas"
    ON reservations FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Permitir leitura de tags"
    ON tags FOR SELECT
    USING (true);

-- 8. Tabela de Usuários do Sistema
CREATE TABLE IF NOT EXISTS app_users (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    phone VARCHAR(30),
    password VARCHAR(100) NOT NULL,
    role VARCHAR(50) DEFAULT 'Operador',
    houses TEXT[] DEFAULT ARRAY['Leña', 'Íconico', 'Bravo Café'],
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir leitura e gestão de usuários" ON app_users FOR ALL USING (true) WITH CHECK (true);

-- 9. Tabela de Configurações Operacionais
CREATE TABLE IF NOT EXISTS app_settings (
    id VARCHAR(50) PRIMARY KEY DEFAULT 'global',
    reservation_cutoff_time VARCHAR(10) DEFAULT '19:59',
    max_people_per_res INT DEFAULT 8,
    max_reservations_per_day INT DEFAULT 20,
    max_daily_people INT DEFAULT 60,
    restrict_weekends BOOLEAN DEFAULT true,
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir leitura e atualização de configurações" ON app_settings FOR ALL USING (true) WITH CHECK (true);

