app.get('/api/products', async (req, res) => {
  const limit = parseInt(req.query.limit) || 6;
  const categoryId = parseInt(req.query.category_id);
  const subcategoryId = parseInt(req.query.subcategory_id);
  const searchTerm = req.query.search;
  const date = req.query.date || null;
  const lastPostTime = req.query.last_post_time;
  const postId = req.query.post_id;

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
        u.name AS user_name,
        p.user_id,
        u.phone AS user_phone, 
        u.zalo AS user_zalo, 
        p.post_content, 
        u.address AS user_address, 
        p.post_images, 
        c.name AS category_name, 
        ARRAY_AGG(DISTINCT COALESCE(s.name, '')) AS subcategory_names,
        ARRAY_AGG(
          jsonb_build_object(
            'name', i.name,
            'price', i.price,
            'description', i.description,
            'subcategory_id', i.subcategory_id
          )
        ) AS product_name
      FROM posts p
      LEFT JOIN "user" u ON p.user_id = u.id
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN post_subcategories ps ON ps.post_id = p.post_id
      LEFT JOIN subcategories s ON ps.subcategory_id = s.id
      LEFT JOIN post_product_items i ON i.post_id = p.post_id
    `;

    // Điều kiện lọc
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
      GROUP BY p.post_id, p.minimum_price, p.post_thumbnail, p.post_time, 
               u.name, p.user_id, u.phone, u.zalo, p.post_content, 
               u.address, p.post_images, c.name
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

    res.json(products);
  } catch (error) {
    console.error('Error querying products:', error.message, error.stack);
    res.status(500).json({ error: 'Server error', message: error.message });
  }
});
