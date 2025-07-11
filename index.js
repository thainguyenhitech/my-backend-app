const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const compression = require('compression');

const app = express();

app.use(cors());
app.use(express.json());
app.use(compression());
app.set('etag', 'strong');

const DB_CONFIG = {
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'mygrandpark',
  password: process.env.DB_PASS || '',
  port: parseInt(process.env.DB_PORT || 5432),
  max: 10,
  idleTimeoutMillis: 30000
};
console.log('DB Config:', DB_CONFIG);

const pool = new Pool(DB_CONFIG);

let dbConnected = false;
const connectWithRetry = async (retries = 5, interval = 5000) => {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query('SELECT NOW()');
      console.log('Database connected successfully');
      dbConnected = true;
      return;
    } catch (err) {
      console.error(`Database connection attempt ${i + 1} failed:`, err.message);
      if (i < retries - 1) await new Promise(resolve => setTimeout(resolve, interval));
    }
  }
  console.error('Database connection failed after retries, APIs may fail');
};
connectWithRetry();

pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client:', err.message, err.stack);
  dbConnected = false;
});

app.get('/api/products', async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({ error: 'Service unavailable', message: 'Database not connected' });
  }

  const startRequest = Date.now();
  const limit = parseInt(req.query.limit) || 6;
  const categoryId = parseInt(req.query.category_id);
  const subcategoryId = parseInt(req.query.subcategory_id);
  const searchTerm = req.query.search;
  const date = req.query.date || null;
  const lastPostTime = req.query.last_post_time;
  const postId = req.query.post_id;
  const fields = req.query.fields;

  try {
    const params = [];
    const conditions = [];
    let paramIndex = 1;

    let query;
    if (fields === 'minimal' && !postId) {
      query = `
        SELECT 
          p.post_id AS id, 
          p.minimum_price AS price, 
          TRIM(p.post_thumbnail) AS post_thumbnail, 
          p.post_time,
          COALESCE(ARRAY_AGG(i.name) FILTER (WHERE i.name IS NOT NULL), ARRAY[]::text[]) AS product_name
        FROM posts p
        LEFT JOIN post_product_items i ON i.post_id = p.post_id
      `;
      if (searchTerm) {
        conditions.push(`i.name ILIKE $${paramIndex}`);
        params.push(`%${searchTerm}%`);
        paramIndex++;
      }
    } else {
      query = `
        SELECT 
          p.post_id AS id, 
          p.minimum_price AS price, 
          TRIM(p.post_thumbnail) AS post_thumbnail, 
          p.post_time,
          ARRAY_AGG(
            jsonb_build_object(
              'name', i.name,
              'price', i.price,
              'description', i.description,
              'subcategory_id', i.subcategory_id
            )
          ) AS product_name
      `;
      if (fields !== 'minimal' || postId) {
        query += `,
          u.name AS user_name,
          p.user_id,
          u.phone AS user_phone, 
          u.zalo AS user_zalo, 
          p.post_content, 
          u.address AS user_address, 
          p.post_images, 
          c.name AS category_name, 
          ARRAY_AGG(DISTINCT COALESCE(s.name, '')) AS subcategory_names
        `;
      }

      query += `
        FROM posts p
        LEFT JOIN post_product_items i ON i.post_id = p.post_id
      `;
      if (fields !== 'minimal' || postId) {
        query += `
          LEFT JOIN "user" u ON p.user_id = u.id
          LEFT JOIN categories c ON p.category_id = c.id
          LEFT JOIN post_subcategories ps ON ps.post_id = p.post_id
          LEFT JOIN subcategories s ON ps.subcategory_id = s.id
        `;
      }
    }

    if (postId) {
      conditions.push(`p.post_id::text = $${paramIndex}`);
      params.push(postId);
      paramIndex++;
    }

    if (categoryId && !postId) {
      conditions.push(`p.category_id = $${paramIndex}`);
      params.push(categoryId);
      paramIndex++;
    }

    if (subcategoryId && !postId) {
      conditions.push(`i.subcategory_id = $${paramIndex}`);
      params.push(subcategoryId);
      paramIndex++;
    }

    if (date && !postId) {
      const [day, month, year] = date.split('/');
      const startDateUTC = new Date(`${year}-${month}-${day}T00:00:00Z`);
      const endDateUTC = new Date(`${year}-${month}-${day}T23:59:59Z`);
      startDateUTC.setHours(startDateUTC.getHours() - 7);
      endDateUTC.setHours(endDateUTC.getHours() - 7);

      conditions.push(`p.post_time >= $${paramIndex} AND p.post_time <= $${paramIndex + 1}`);
      params.push(startDateUTC.toISOString());
      params.push(endDateUTC.toISOString());
      paramIndex += 2;
    }

    if (lastPostTime && !postId && !isNaN(new Date(lastPostTime))) {
      conditions.push(`p.post_time < $${paramIndex}`);
      params.push(lastPostTime);
      paramIndex++;
    } else if (lastPostTime) {
      console.log(`[DEBUG] Invalid last_post_time: ${lastPostTime}`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(' AND ');
    }

    query += `
      GROUP BY p.post_id, p.minimum_price, p.post_thumbnail, p.post_time
    `;
    if (fields !== 'minimal' || postId) {
      query += `, u.name, p.user_id, u.phone, u.zalo, p.post_content, u.address, p.post_images, c.name`;
    }

    query += `
      ORDER BY p.post_time DESC
      LIMIT $${paramIndex}
    `;
    params.push(limit);

    console.log('[DEBUG] Query:', query);
    console.log('[DEBUG] Params:', params);

    const startQuery = Date.now();
    const result = await pool.query(query, params);
    console.log(`[DEBUG] Query execution time: ${Date.now() - startQuery}ms`);
    console.log(`[DEBUG] Total request time: ${Date.now() - startRequest}ms`);
    console.log(`[DEBUG] Products returned: ${result.rows.length}`);

    const products = result.rows.map(row => {
      const product = {
        id: row.id,
        price: row.price,
        post_thumbnail: row.post_thumbnail,
        post_time: row.post_time,
        product_name: row.product_name || []
      };
      if (fields !== 'minimal' || postId) {
        product.user_name = row.user_name;
        product.user_id = row.user_id;
        product.user_phone = row.user_phone;
        product.user_zalo = row.user_zalo;
        product.post_content = row.post_content;
        product.user_address = row.user_address;
        product.post_images = row.post_images || [];
        product.category_name = row.category_name;
        product.subcategory_names = row.subcategory_names || [];
      }
      return product;
    });

    if (products.length === 0) {
      console.log(`[DEBUG] No products found for last_post_time: ${lastPostTime}, params:`, params);
    }

    res.set('Cache-Control', 'public, max-age=60');
    res.json(products);
  } catch (error) {
    console.error('Error querying products:', error.message, error.stack);
    res.status(500).json({ error: 'Server error', message: error.message });
  }
});

// ... (giữ nguyên các endpoint khác)

let PORT = process.env.PORT || 3000;
const startServer = (port) => {
  app.listen(port, () => {
    console.log(`Backend server running on http://0.0.0.0:${port}`);
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is in use, trying ${port + 1}`);
      startServer(port + 1);
    } else {
      console.error('Server error:', err.message, err.stack);
      process.exit(-1);
    }
  });
};
startServer(PORT);
