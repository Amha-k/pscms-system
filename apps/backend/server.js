const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
require('dotenv').config();

const app = express();

// Enable CORS for frontend integration
app.use(cors());
app.use(express.json());

// Create MySQL connection pool directly inside server.js
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'turntable.proxy.rlwy.net',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'KxezWsisTgrNhtUAbNxODESxNpVBNSNX',
  database: process.env.DB_NAME || 'railway',
  port: process.env.DB_PORT || 10925, // Use DB_PORT from .env
});

// Optional: simple test endpoint to verify DB connection
app.get('/test-db', async (req, res) => {
  try {
    const [rows] = await pool.query('SHOW TABLES');
    res.json({ success: true, tables: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Routes
const wholesalerRoutes = require('./routes/wholesalers');
const productRoutes = require('./routes/products');
const pharmacyRoutes = require('./routes/pharmacy');
const requestRoutes = require('./routes/requests');
const adminRoutes = require('./routes/admin');

app.use('/api/wholesalers', wholesalerRoutes);
app.use('/api/products', productRoutes);
app.use('/api/pharmacy', pharmacyRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/admin', adminRoutes);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
