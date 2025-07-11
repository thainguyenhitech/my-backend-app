const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASS,
  port: parseInt(process.env.DB_PORT || 5432),
});

app.get('/api/products', async (req, res) => {
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

    let query = `
      SELECT 
        p.post_id AS id, 
        p.minimum_price AS price, 
        p.post_thumbnail,
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
      LEFT JOIN "user" u ON p.user_id = u.id
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN post_subcategories ps ON ps.post_id = p.post_id
      LEFT JOIN subcategories s ON ps.subcategory_id = s.id
      LEFT JOIN post_product_items i ON i.post_id = p.post_id
    `;

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

    if (searchTerm && !postId) {
      conditions.push(`i.name ILIKE $${paramIndex}`);
      params.push(`%${searchTerm}%`);
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

    if (lastPostTime && !postId) {
      conditions.push(`p.post_time < $${paramIndex}`);
      params.push(lastPostTime);
      paramIndex++;
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

    const result = await pool.query(query, params);

    const products = result.rows.map(row => ({
      ...row,
      product_name: row.product_name || [],
      post_images: row.post_images || []
    }));

    res.set('Cache-Control', 'public, max-age=300');
    res.json(products);
  } catch (error) {
    console.error('Error querying products:', error.message, error.stack);
    res.status(500).json({ error: 'Server error', message: error.message });
  }
});

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

    res.set('Cache-Control', 'public, max-age=3600');
    res.json({
      category_name: categoryName || 'Danh Mục',
      subcategory_name: subcategoryName || null
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Server error');
  }
});

app.get('/api/sports', async (req, res) => {
  try {
    const query = `
      SELECT id, name
      FROM sport
      ORDER BY name ASC
    `;
    const result = await pool.query(query);
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).send('Server error');
  }
});

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
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).send('Server error');
  }
});

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
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).send('Server error');
  }
});

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
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).send('Server error');
  }
});

app.get('/api/security/by-ward', async (req, res) => {
  try {
    const query = `
      SELECT id, name, hotline, address, link
      FROM security
      WHERE ward_id IS NOT NULL
      ORDER BY name ASC
    `;
    const result = await pool.query(query);
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).send('Server error');
  }
});

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
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).send('Server error');
  }
});

app.get('/api/medical/by-ward', async (req, res) => {
  try {
    const query = `
      SELECT id, name, hotline, address, link
      FROM medical
      WHERE ward_id IS NOT NULL
      ORDER BY name ASC
    `;
    const result = await pool.query(query);
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).send('Server error');
  }
});

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
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).send('Server error');
  }
});

app.get('/api/areas', async (req, res) => {
  try {
    const query = `
      SELECT id, name AS area_name
      FROM area
    `;
    const result = await pool.query(query);
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).send('Server error');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend server running on http://0.0.0.0:${PORT}`);
});
