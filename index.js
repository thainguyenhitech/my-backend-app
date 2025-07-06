const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();

app.use(cors()); // Cho phép tất cả origin
app.use(express.json());

// Chỉ sử dụng một kết nối đến mygrandpark
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASS,
  port: parseInt(process.env.DB_PORT || 5432),
});

// API lấy sản phẩm (đã sửa để cố định múi giờ Asia/Ho_Chi_Minh)
app.get('/api/products', async (req, res) => {
  const limit = parseInt(req.query.limit) || 6;
  const categoryId = parseInt(req.query.category_id);
  const subcategoryId = parseInt(req.query.subcategory_id);
  const searchTerm = req.query.search;
  const lastPostTime = req.query.last_post_time || null;
  const date = req.query.date || null;
  const postId = req.query.post_id; // Giữ dạng chuỗi

  try {
    let query = `
      SELECT p.post_id AS id, 
             p.post_product AS product_name, 
             p.minimum_price AS price, 
             p.post_thumbnail,
             p.post_time AT TIME ZONE 'Asia/Ho_Chi_Minh' AS post_time, -- Cố định múi giờ Asia/Ho_Chi_Minh
             u.name AS user_name,
             p.user_id,
             u.phone AS user_phone, 
             u.zalo AS user_zalo, 
             p.post_content, 
             u.address AS user_address, 
             p.post_images AS post_images, 
             c.name AS category_name, 
             ARRAY_AGG(COALESCE(s.name, '')) AS subcategory_names
      FROM posts p
      LEFT JOIN post_subcategories ps ON ps.post_id = p.post_id
      LEFT JOIN subcategories s ON s.id = ps.subcategory_id
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN "user" u ON p.user_id = u.id
    `;
    const params = [];
    let conditions = [];
    let paramIndex = 1;

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
      conditions.push(`s.id = $${paramIndex}`);
      params.push(subcategoryId);
      paramIndex++;
    }

    if (searchTerm && !postId) {
      conditions.push(`
        EXISTS (
          SELECT 1
          FROM jsonb_array_elements(p.post_product) AS product
          WHERE product->>'name' ILIKE $${paramIndex}
        )
      `);
      params.push(`%${searchTerm}%`);
      paramIndex++;
    }

    if (lastPostTime && !isNaN(new Date(lastPostTime).getTime()) && !postId) {
      const formattedLastPostTime = new Date(lastPostTime).toISOString();
      conditions.push(`p.post_time < $${paramIndex}`);
      params.push(formattedLastPostTime);
      paramIndex++;
    }

    if (date && !postId) {
      const [day, month, year] = date.split('/');
      const formattedDate = `${year}-${month}-${day}`;
      conditions.push(`DATE(p.post_time) = $${paramIndex}`);
      params.push(formattedDate);
      paramIndex++;
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += `
      GROUP BY p.post_id, p.post_product, p.minimum_price, p.post_thumbnail, p.post_time, 
               u.name, p.user_id, u.phone, u.zalo, p.post_content, u.address, p.post_images, c.name
      ORDER BY p.post_time DESC
      LIMIT $${paramIndex}
    `;
    params.push(limit);

    console.log('[DEBUG] Query:', query);
    console.log('[DEBUG] Params:', params);

    const result = await pool.query(query, params);
    const products = result.rows.map(row => ({
      ...row,
      product_name: row.product_name || [], // post_product là jsonb, không cần parse
      post_images: row.post_images || [] // post_images là text[], không cần parse
    }));
    res.json(products);
  } catch (error) {
    console.error('Error querying products:', error.message, error.stack);
    res.status(500).json({ error: 'Server error', message: error.message });
  }
});

// API để lấy category_name và subcategory_name (giữ nguyên)
app.get('/api/categories', async (req, res) => {
  const categoryId = parseInt(req.query.category_id);
  const subcategoryId = parseInt(req.query.subcategory_id);

  try {
    let categoryName = null;
    let subcategoryName = null;

    if (categoryId) {
      const categoryQuery = `
        SELECT name
        FROM categories
        WHERE id = $1
      `;
      const categoryResult = await pool.query(categoryQuery, [categoryId]);
      if (categoryResult.rows.length > 0) {
        categoryName = categoryResult.rows[0].name;
      }
    }

    if (subcategoryId) {
      const subcategoryQuery = `
        SELECT s.name AS subcategory_name, c.name AS category_name
        FROM subcategories s
        JOIN categories c ON s.category_id = c.id
        WHERE s.id = $1
      `;
      const subcategoryResult = await pool.query(subcategoryQuery, [subcategoryId]);
      if (subcategoryResult.rows.length > 0) {
        subcategoryName = subcategoryResult.rows[0].subcategory_name;
        categoryName = subcategoryResult.rows[0].category_name;
      }
    }

    res.json({
      category_name: categoryName || 'Danh Mục',
      subcategory_name: subcategoryName || null
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Server error');
  }
});

// API lấy danh sách môn thể thao (Sport) - Chuyển sang dùng pool
app.get('/api/sports', async (req, res) => {
  try {
    const query = `
      SELECT id, name
      FROM sport
      ORDER BY name ASC
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).send('Server error');
  }
});

// API lấy danh sách sub-area theo môn thể thao - Chuyển sang dùng pool
app.get('/api/sports/:sportId/sub-areas', async (req, res) => {
  const sportId = parseInt(req.params.sportId);

  if (!sportId) {
    return res.status(400).send('Sport ID is required');
  }

  try {
    const query = `
      SELECT sa.id, sa.name AS sub_area_name, a.name AS area_name, sa.description, sa.hotline, ssa.link
      FROM sub_area sa
      JOIN area a ON sa.area_id = a.id
      JOIN sport_sub_area ssa ON sa.id = ssa.sub_area_id
      JOIN sport s ON ssa.sport_id = s.id
      WHERE s.id = $1
      ORDER BY sa.name ASC
    `;
    const result = await pool.query(query, [sportId]);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).send('Server error');
  }
});

// API lấy danh sách sub-area theo area - Chuyển sang dùng pool
app.get('/api/sub-areas/area/:areaId', async (req, res) => {
  const areaId = parseInt(req.params.areaId);

  if (!areaId) {
    return res.status(400).send('Area ID is required');
  }

  try {
    const query = `
      SELECT sa.id, sa.name AS sub_area_name, a.name AS area_name, sa.description, sa.hotline
      FROM sub_area sa
      JOIN area a ON sa.area_id = a.id
      WHERE a.id = $1
      ORDER BY 
        CASE 
          WHEN sa.name ~ 'S\\d+\\.\\d+' THEN 
            SPLIT_PART(sa.name, 'S', 2)::float
          WHEN sa.name ~ 'S\\d+[-_]\\d+' THEN 
            REPLACE(SPLIT_PART(sa.name, 'S', 2), '-', '.')::float
          ELSE 
            999999
        END ASC,
        sa.name ASC
    `;
    const result = await pool.query(query, [areaId]);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).send('Server error');
  }
});

// API lấy danh sách cửa hàng theo sub_area - Chuyển sang dùng pool
app.get('/api/stores/sub-area/:subAreaId', async (req, res) => {
  const subAreaId = parseInt(req.params.subAreaId);

  if (!subAreaId) {
    return res.status(400).send('Sub Area ID is required');
  }

  try {
    const query = `
      SELECT s.id, s.name, s.sub_area_id, sa.name AS sub_area_name, a.name AS area_name, s.description, s.status, s.address
      FROM store s
      JOIN sub_area sa ON s.sub_area_id = sa.id
      JOIN area a ON sa.area_id = a.id
      WHERE sa.id = $1
      ORDER BY s.name ASC
    `;
    const result = await pool.query(query, [subAreaId]);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).send('Server error');
  }
});

// API lấy danh sách security theo ward_id - Chuyển sang dùng pool
app.get('/api/security/by-ward', async (req, res) => {
  try {
    const query = `
      SELECT id, name, hotline, address, link
      FROM security
      WHERE ward_id IS NOT NULL
      ORDER BY name ASC
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).send('Server error');
  }
});

// API lấy danh sách security theo area_id - Chuyển sang dùng pool
app.get('/api/security/by-area', async (req, res) => {
  try {
    const query = `
      SELECT s.id, s.name, s.hotline, s.address, s.link, a.name AS area_name
      FROM security s
      JOIN area a ON s.area_id = a.id
      WHERE s.area_id IS NOT NULL
      ORDER BY s.name ASC
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).send('Server error');
  }
});

// API lấy danh sách medical theo ward_id - Chuyển sang dùng pool
app.get('/api/medical/by-ward', async (req, res) => {
  try {
    const query = `
      SELECT id, name, hotline, address, link
      FROM medical
      WHERE ward_id IS NOT NULL
      ORDER BY name ASC
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).send('Server error');
  }
});

// API lấy danh sách medical theo area_id - Chuyển sang dùng pool
app.get('/api/medical/by-area', async (req, res) => {
  try {
    const query = `
      SELECT m.id, m.name, m.hotline, m.address, m.link, a.name AS area_name
      FROM medical m
      JOIN area a ON m.area_id = a.id
      WHERE m.area_id IS NOT NULL
      ORDER BY m.name ASC
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).send('Server error');
  }
});

// API lấy danh sách tất cả area - Chuyển sang dùng pool
app.get('/api/areas', async (req, res) => {
  try {
    const query = `
      SELECT id, name AS area_name
      FROM area
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).send('Server error');
  }
});

// Khởi động server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend server running on http://0.0.0.0:${PORT}`);
});
