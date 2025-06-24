const express = require('express');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const port = 3000;
const SECRET = 'abc';

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

const USER = { username: 'abc', password: 'abc' }; // remove later

const db = new sqlite3.Database(path.join(__dirname, 'themes.db'));

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
      .filter(f => /\.(jpg|jpeg|png|gif)$/i.test(f))
      .sort((a, b) => {
        const aTime = fs.statSync(path.join(uploadsDir, a)).ctimeMs;
        const bTime = fs.statSync(path.join(uploadsDir, b)).ctimeMs;
        return bTime - aTime;
      })
      .map(f => `/uploads/${f}`);
    res.json(images);
  });
});

app.post('/api/upload', authenticateToken, upload.array('image', 100), (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });
  const urls = req.files.map(f => `/uploads/${f.filename}`);
  res.json({ urls });
});

app.delete('/api/images/:filename', authenticateToken, (req, res) => {
  const filePath = path.join(uploadsDir, req.params.filename);
  fs.unlink(filePath, err => {
    if (err) return res.status(404).json({ error: 'File not found' });
    res.json({ success: true });
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

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});