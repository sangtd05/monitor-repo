CREATE USER exporter WITH PASSWORD 'exporterpass';
GRANT pg_monitor TO exporter;
CREATE SCHEMA IF NOT EXISTS test_schema;
CREATE TABLE IF NOT EXISTS test_schema.users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS test_schema.orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES test_schema.users(id),
    order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    total_amount DECIMAL(10, 2),
    status VARCHAR(20) DEFAULT 'pending'
);
CREATE INDEX idx_users_username ON test_schema.users(username);
CREATE INDEX idx_users_email ON test_schema.users(email);
CREATE INDEX idx_orders_user_id ON test_schema.orders(user_id);
CREATE INDEX idx_orders_status ON test_schema.orders(status);
INSERT INTO test_schema.users (username, email) VALUES
    ('user1', 'user1@example.com'),
    ('user2', 'user2@example.com'),
    ('user3', 'user3@example.com'),
    ('user4', 'user4@example.com'),
    ('user5', 'user5@example.com');
INSERT INTO test_schema.orders (user_id, total_amount, status) VALUES
    (1, 99.99, 'completed'),
    (1, 149.50, 'pending'),
    (2, 75.00, 'completed'),
    (3, 200.00, 'shipped'),
    (4, 50.25, 'completed'),
    (5, 125.75, 'pending');
CREATE OR REPLACE FUNCTION test_schema.get_user_order_count(p_user_id INTEGER)
RETURNS INTEGER AS $$
DECLARE
    order_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO order_count
    FROM test_schema.orders
    WHERE user_id = p_user_id;
    
    RETURN order_count;
END;
$$ LANGUAGE plpgsql;
GRANT USAGE ON SCHEMA test_schema TO testuser;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA test_schema TO testuser;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA test_schema TO testuser;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA test_schema TO testuser;
DO $$
BEGIN
    RAISE NOTICE 'PostgreSQL test database initialized successfully';
END $$;
