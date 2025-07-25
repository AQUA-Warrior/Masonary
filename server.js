require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const archiver = require('archiver');

const app = express();
const port = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 * 1024 } // 5GB
});

const USER = { 
  username: (process.env.APP_USERNAME || ''), 
  password: (process.env.APP_PASSWORD || '')
};

const DB_NAME = process.env.DB_NAME || 'themes.db';
const db = new sqlite3.Database(path.join(__dirname, DB_NAME));

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS themes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    is_default INTEGER DEFAULT 0,
    colors TEXT NOT NULL
  )`);
  db.run(`INSERT OR IGNORE INTO themes (name, is_default, colors) VALUES (
    'Default',
    1,
    '{
      "text": "#e7edee",
      "background": "#0a0f10",
      "primary": "#a3c6cb",
      "secondary": "#38686f",
      "accent": "#6cb3be",
      "white": "#ffffff",
      "black": "#000000",
      "delete": "#ff4444",
      "font-family": "Arial, sans-serif",
      "font-size-base": "16px"
    }'
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS image_tags (
    filename TEXT PRIMARY KEY,
    tags TEXT DEFAULT '[]',
    description TEXT DEFAULT '',
    favorite INTEGER DEFAULT 0
  )`);
  db.all("PRAGMA table_info(image_tags)", (err, columns) => {
    if (!columns.some(col => col.name === "description")) {
      db.run("ALTER TABLE image_tags ADD COLUMN description TEXT DEFAULT ''");
    }
    if (!columns.some(col => col.name === "favorite")) {
      db.run("ALTER TABLE image_tags ADD COLUMN favorite INTEGER DEFAULT 0");
    }
  });
});

function authenticateToken(req, res, next) {
  const auth = req.headers['authorization'];
  const token = auth && auth.split(' ')[1];
  if (!token) return res.sendStatus(401);
  jwt.verify(token, SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === USER.username && password === USER.password) {
    const token = jwt.sign({ username }, SECRET, { expiresIn: '1h' });
    res.json({ token });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.post('/api/verify', (req, res) => {
  const { token } = req.body;
  jwt.verify(token, SECRET, (err, user) => {
    if (err) return res.json({ valid: false });
    res.json({ valid: true });
  });
});

app.get('/api/images', (req, res) => {
  fs.readdir(uploadsDir, (err, files) => {
    if (err) return res.json([]);
    const images = files
      .filter(f => /\.(jpg|jpeg|png|gif)$/i.test(f));
    if (images.length === 0) return res.json([]);
    db.all(
      `SELECT filename, tags, favorite FROM image_tags WHERE filename IN (${images.map(() => '?').join(',')})`,
      images,
      (err, rows) => {
        const tagMap = {};
        const favMap = {};
        if (rows) {
          rows.forEach(row => {
            try {
              tagMap[row.filename] = JSON.parse(row.tags);
            } catch {
              tagMap[row.filename] = [];
            }
            favMap[row.filename] = row.favorite === 1;
          });
        }
        const result = images.map(f => {
          let stat;
          try {
            stat = fs.statSync(path.join(uploadsDir, f));
          } catch {
            stat = {};
          }
          return {
            url: `/uploads/${f}`,
            filename: f,
            tags: tagMap[f] || [],
            uploaded: stat.ctimeMs || 0,
            favorite: favMap[f] || false
          };
        });
        res.json(result);
      }
    );
  });
});

app.post('/api/upload', authenticateToken, upload.array('image', 100), (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });
  const urls = req.files.map(f => `/uploads/${f.filename}`);
  res.json({ urls });
});

app.post('/api/images/:filename/tags', authenticateToken, (req, res) => {
  const filename = req.params.filename;
  const { tags } = req.body;
  if (!Array.isArray(tags)) return res.status(400).json({ error: 'Tags must be an array' });
  db.run(
    `INSERT INTO image_tags (filename, tags) VALUES (?, ?)
     ON CONFLICT(filename) DO UPDATE SET tags=excluded.tags`,
    [filename, JSON.stringify(tags)],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    }
  );
});

app.post('/api/images/bulk-tags', authenticateToken, (req, res) => {
  const { filenames, tags } = req.body;
  if (!Array.isArray(filenames) || !Array.isArray(tags)) {
    return res.status(400).json({ error: 'filenames and tags must be arrays' });
  }
  const stmt = db.prepare(
    `INSERT INTO image_tags (filename, tags) VALUES (?, ?)
     ON CONFLICT(filename) DO UPDATE SET tags=excluded.tags`
  );
  for (const filename of filenames) {
    stmt.run(filename, JSON.stringify(tags));
  }
  stmt.finalize(err => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.delete('/api/images/:filename', authenticateToken, (req, res) => {
  const filePath = path.join(uploadsDir, req.params.filename);
  fs.unlink(filePath, err => {
    if (err) return res.status(404).json({ error: 'File not found' });
    db.run('DELETE FROM image_tags WHERE filename = ?', [req.params.filename], () => {
      res.json({ success: true });
    });
  });
});

app.get('/api/themes', (req, res) => {
  db.all('SELECT * FROM themes ORDER BY is_default DESC, name ASC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/themes', (req, res) => {
  const { name, colors } = req.body;
  if (!name || !colors) {
    return res.status(400).json({ error: 'Name and colors are required' });
  }
  db.get('SELECT * FROM themes WHERE name = ?', [name], (err, existing) => {
    if (err) return res.status(500).json({ error: err.message });
    if (existing) return res.status(400).json({ error: 'Theme name already exists' });
    db.run('INSERT INTO themes (name, colors) VALUES (?, ?)',
      [name, JSON.stringify(colors)],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID });
      }
    );
  });
});

app.put('/api/themes/:id', (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  db.get('SELECT is_default FROM themes WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (row && row.is_default) {
      return res.status(400).json({ error: 'Cannot modify default theme' });
    }
    db.run('UPDATE themes SET name = ? WHERE id = ?', [name, id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
  });
});

app.delete('/api/themes/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid theme ID' });
  }
  db.serialize(() => {
    db.get('SELECT * FROM themes WHERE id = ?', [id], (err, theme) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!theme) return res.status(404).json({ error: 'Theme not found' });
      if (theme.is_default) return res.status(400).json({ error: 'Cannot delete default theme' });
      db.run('DELETE FROM themes WHERE id = ?', [id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
      });
    });
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/images-meta/:filename', (req, res) => {
  const filePath = path.join(uploadsDir, req.params.filename);
  fs.stat(filePath, (err, stat) => {
    if (err) return res.status(404).json({ error: 'File not found' });
    db.get(
      'SELECT description FROM image_tags WHERE filename = ?',
      [req.params.filename],
      (dbErr, row) => {
        res.json({
          uploaded: stat.birthtime || stat.ctime,
          description: row && row.description ? row.description : ''
        });
      }
    );
  });
});

app.post('/api/images/:filename/description', authenticateToken, (req, res) => {
  const filename = req.params.filename;
  const { description } = req.body;
  db.run(
    `INSERT INTO image_tags (filename, description) VALUES (?, ?)
     ON CONFLICT(filename) DO UPDATE SET description=excluded.description`,
    [filename, description || ''],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    }
  );
});

app.post('/api/download', (req, res) => {
  const { filenames } = req.body;
  if (!Array.isArray(filenames) || filenames.length === 0) {
    return res.status(400).json({ error: 'No filenames provided' });
  }
  if (filenames.length === 1) {
    const filePath = path.join(uploadsDir, filenames[0]);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    res.download(filePath, filenames[0]);
  } else {
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=images.zip');
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);
    filenames.forEach(filename => {
      const filePath = path.join(uploadsDir, filename);
      if (fs.existsSync(filePath)) {
        archive.file(filePath, { name: filename });
      }
    });
    archive.finalize();
  }
});

app.get('/api/themes/:id/export', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid theme ID' });
  db.get('SELECT * FROM themes WHERE id = ?', [id], (err, theme) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!theme) return res.status(404).json({ error: 'Theme not found' });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=theme-${id}.json`);
    res.send(JSON.stringify({
      name: theme.name,
      colors: typeof theme.colors === 'string' ? JSON.parse(theme.colors) : theme.colors
    }, null, 2));
  });
});

app.post('/api/themes/import', (req, res) => {
  const { name, colors } = req.body;
  if (!name || !colors) {
    return res.status(400).json({ error: 'Name and colors are required' });
  }
  db.get('SELECT * FROM themes WHERE name = ?', [name], (err, existing) => {
    if (err) return res.status(500).json({ error: err.message });
    if (existing) return res.status(400).json({ error: 'Theme name already exists' });
    db.run('INSERT INTO themes (name, colors) VALUES (?, ?)',
      [name, JSON.stringify(colors)],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID });
      }
    );
  });
});

app.post('/api/images/:filename/favorite', authenticateToken, (req, res) => {
  const filename = req.params.filename;
  db.run(
    `INSERT INTO image_tags (filename, favorite) VALUES (?, 1)
     ON CONFLICT(filename) DO UPDATE SET favorite=1`,
    [filename],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    }
  );
});

app.post('/api/images/:filename/unfavorite', authenticateToken, (req, res) => {
  const filename = req.params.filename;
  db.run(
    `INSERT INTO image_tags (filename, favorite) VALUES (?, 0)
     ON CONFLICT(filename) DO UPDATE SET favorite=0`,
    [filename],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    }
  );
});

app.post('/api/images/bulk-favorite', authenticateToken, (req, res) => {
  const { filenames, favorite } = req.body;
  if (!Array.isArray(filenames) || typeof favorite !== 'boolean') {
    return res.status(400).json({ error: 'filenames must be array, favorite must be boolean' });
  }
  const stmt = db.prepare(
    `INSERT INTO image_tags (filename, favorite) VALUES (?, ?)
     ON CONFLICT(filename) DO UPDATE SET favorite=excluded.favorite`
  );
  for (const filename of filenames) {
    stmt.run(filename, favorite ? 1 : 0);
  }
  stmt.finalize(err => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});