db = db.getSiblingDB('admin');
db.createUser({
    user: 'exporter',
    pwd: 'exporterpass',
    roles: [
        { role: 'clusterMonitor', db: 'admin' },
        { role: 'read', db: 'local' }
    ]
});
db = db.getSiblingDB('testdb');
db.createUser({
    user: 'testuser',
    pwd: 'testpass',
    roles: [
        { role: 'readWrite', db: 'testdb' }
    ]
});
db.createCollection('users');
db.createCollection('orders');
db.createCollection('products');
db.users.insertMany([
    {
        username: 'user1',
        email: 'user1@example.com',
        firstName: 'John',
        lastName: 'Doe',
        createdAt: new Date(),
        updatedAt: new Date()
    },
    {
        username: 'user2',
        email: 'user2@example.com',
        firstName: 'Jane',
        lastName: 'Smith',
        createdAt: new Date(),
        updatedAt: new Date()
    },
    {
        username: 'user3',
        email: 'user3@example.com',
        firstName: 'Bob',
        lastName: 'Johnson',
        createdAt: new Date(),
        updatedAt: new Date()
    },
    {
        username: 'user4',
        email: 'user4@example.com',
        firstName: 'Alice',
        lastName: 'Williams',
        createdAt: new Date(),
        updatedAt: new Date()
    },
    {
        username: 'user5',
        email: 'user5@example.com',
        firstName: 'Charlie',
        lastName: 'Brown',
        createdAt: new Date(),
        updatedAt: new Date()
    }
]);
const users = db.users.find().toArray();
db.products.insertMany([
    { name: 'Laptop', price: 999.99, category: 'Electronics', stock: 50 },
    { name: 'Mouse', price: 29.99, category: 'Electronics', stock: 200 },
    { name: 'Keyboard', price: 79.99, category: 'Electronics', stock: 150 },
    { name: 'Monitor', price: 299.99, category: 'Electronics', stock: 75 },
    { name: 'Headphones', price: 149.99, category: 'Electronics', stock: 100 }
]);
const products = db.products.find().toArray();
db.orders.insertMany([
    {
        userId: users[0]._id,
        products: [
            { productId: products[0]._id, quantity: 1, price: products[0].price }
        ],
        totalAmount: 999.99,
        status: 'completed',
        orderDate: new Date(),
        updatedAt: new Date()
    },
    {
        userId: users[0]._id,
        products: [
            { productId: products[1]._id, quantity: 2, price: products[1].price },
            { productId: products[2]._id, quantity: 1, price: products[2].price }
        ],
        totalAmount: 139.97,
        status: 'pending',
        orderDate: new Date(),
        updatedAt: new Date()
    },
    {
        userId: users[1]._id,
        products: [
            { productId: products[3]._id, quantity: 1, price: products[3].price }
        ],
        totalAmount: 299.99,
        status: 'shipped',
        orderDate: new Date(),
        updatedAt: new Date()
    },
    {
        userId: users[2]._id,
        products: [
            { productId: products[4]._id, quantity: 1, price: products[4].price }
        ],
        totalAmount: 149.99,
        status: 'completed',
        orderDate: new Date(),
        updatedAt: new Date()
    }
]);
db.users.createIndex({ username: 1 }, { unique: true });
db.users.createIndex({ email: 1 }, { unique: true });
db.orders.createIndex({ userId: 1 });
db.orders.createIndex({ status: 1 });
db.orders.createIndex({ orderDate: -1 });
db.products.createIndex({ category: 1 });
db.products.createIndex({ name: 1 });
db.setProfilingLevel(2, { slowms: 0 });
print('MongoDB test database initialized successfully');
