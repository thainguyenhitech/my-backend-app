const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const compression = require('compression');

const app = express();

app.use(cors());
app.use(express.json());
app.use(compression());

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASS,
  port: parseInt(process.env.DB_PORT || 5432),
  max: 20,
  idleTimeoutMillis: 30000,
});

// ✅ /api/products - Đã tối ưu
app.get('/api/products', async (req, res) => {
  const limit = parseInt(req.query.limit) || 6;
  const categoryId = parseInt(req.query.category_id);
  const subcategoryId = parseInt(req.query.subcategory_id);
  const searchTerm = req.query.search;
  const date = req.query.date;
  const lastPostTime = req.query.last_post_time;
  const postId = req.query.post_id;
  const fields = req.query.fields;

  try {
    const params = [];
    const conditions = [];
    let paramIndex = 1;

    if (date) {
      conditions.push(`p.post_time::date = TO_DATE($${paramIndex}, 'DD/MM/YYYY')`);
      params.push(date);
      paramIndex++;
    }

    if (postId) {
      conditions.push(`p.post_id::text = $${paramIndex}`);
      params.push(postId);
      paramIndex++;
    } else {
      if (categoryId) {
        conditions.push(`p.category_id = $${paramIndex}`);
        params.push(categoryId);
        paramIndex++;
      }

      if (subcategoryId) {
        conditions.push(`i.subcategory_id = $${paramIndex}`);
        params.push(subcategoryId);
        paramIndex++;
      }

      if (searchTerm) {
        conditions.push(`i.name ILIKE $${paramIndex}`);
        params.push(`%${searchTerm}%`);
        paramIndex++;
      }

      if (lastPostTime) {
        conditions.push(`p.post_time < $${paramIndex}`);
        params.push(lastPostTime);
        paramIndex++;
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const baseQuery = `
      WITH filtered_posts AS (
        SELECT p.*
        FROM posts p
        ${whereClause}
        ORDER BY p.post_time DESC
        LIMIT $${paramIndex}
      )
    `;

    params.push(limit);

    let selectFields = `
      p.post_id AS id,
      p.minimum_price AS price,
      TRIM(p.post_thumbnail) AS post_thumbnail,
      p.post_time,
      ARRAY_AGG(DISTINCT jsonb_build_object(
        'name', i.name,
        'price', i.price,
        'description', i.description,
        'subcategory_id', i.subcategory_id
      )) AS product_name
    `;

    let joins = `
      LEFT JOIN post_product_items i ON i.post_id = p.post_id
    `;

    let groupBy = `
      GROUP BY p.post_id, p.minimum_price, p.post_thumbnail, p.post_time
    `;

    if (fields !== 'minimal' || postId) {
      selectFields += `,
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

      joins += `
        LEFT JOIN "user" u ON p.user_id = u.id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN post_subcategories ps ON ps.post_id = p.post_id
        LEFT JOIN subcategories s ON ps.subcategory_id = s.id
      `;

      groupBy += `,
        u.name, p.user_id, u.phone, u.zalo, p.post_content, u.address, p.post_images, c.name
      `;
    }

    const finalQuery = `
      ${baseQuery}
      SELECT ${selectFields}
      FROM filtered_posts p
      ${joins}
      ${groupBy}
      ORDER BY p.post_time DESC
    `;

    const result = await pool.query(finalQuery, params);

    const products = result.rows.map(row => {
      const product = {
        id: row.id,
        price: row.price,
        post_thumbnail: row.post_thumbnail,
        post_time: row.post_time,
        product_name: row.product_name || [],
      };
      if (fields !== 'minimal' || postId) {
        Object.assign(product, {
          user_name: row.user_name,
          user_id: row.user_id,
          user_phone: row.user_phone,
          user_zalo: row.user_zalo,
          post_content: row.post_content,
          user_address: row.user_address,
          post_images: row.post_images || [],
          category_name: row.category_name,
          subcategory_names: row.subcategory_names || [],
        });
      }
      return product;
    });

    res.set('Cache-Control', 'public, max-age=300');
    res.json(products);
  } catch (error) {
    console.error('Error querying products:', error.message, error.stack);
    res.status(500).json({ error: 'Server error', message: error.message });
  }
});

// ✅ Các endpoint còn lại giữ nguyên logic
// 👉 Bạn có thể copy paste lại các hàm từ code gốc như:
/*
app.get('/api/categories', async (req, res) => { ... });
app.get('/api/sports', async (req, res) => { ... });
app.get('/api/areas', async (req, res) => { ... });
...v.v...
*/

// ✅ Server start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend server running on http://0.0.0.0:${PORT}`);
});
