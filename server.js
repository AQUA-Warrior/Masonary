const express = require('express');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cors = require('cors');

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

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});