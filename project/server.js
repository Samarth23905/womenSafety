import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import mysql from 'mysql2/promise';
import multer from 'multer';
import bcrypt from 'bcrypt';
import session from 'express-session';
import { exec } from 'child_process';
import fs from 'fs';


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// In-memory diagnostic storage (development only)
let lastSosError = null;

// Set up EJS first
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'view'));

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// Set up session middleware
app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Set to true if using HTTPS
}));

// Multer setup
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    const uploadDir = path.join(__dirname, 'uploads');
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)){
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function(req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  // Accept images only
  if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/)) {
    return cb(new Error('Only image files are allowed!'), false);
  }
  cb(null, true);
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB max file size
  }
});

// DB config
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
};

// Create DB connection pool
const db = mysql.createPool(dbConfig);

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'registration.html'));
});

app.get('/home', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'home.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'registration.html'));
});
app.post('/register', upload.none(), async (req, res) => {
  try {
    console.log('Registration request body:', req.body); // Debug log

    const {
      name,
      password,
      number,
      father_number,
      mother_number, 
      guardian_number,
      guardian2_number
    } = req.body;

    // Validate required fields
    if (!name || !password || !number) {
      return res.status(400).json({
        error: 'Name, password and phone number are required'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Normalize phone numbers
    const normalizePhone = (num) => {
      if (!num) return null;
      num = num.trim().replace(/^0+/, '');
      return num.startsWith('+') ? num : `+91${num}`;
    };

    const sql = `
      INSERT INTO users (
        name, password, number,
        father_number, mother_number,
        guardian_number, guardian2_number
      ) VALUES ( ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      name,
      hashedPassword,
      normalizePhone(number),
      normalizePhone(father_number),
      normalizePhone(mother_number),
      normalizePhone(guardian_number),
      normalizePhone(guardian2_number)
    ];

    const [result] = await db.execute(sql, values);

    // Set session
    req.session.user = {
      id: result.insertId,
      name: name,
    };

    res.redirect('/home');

  } catch (error) {
    console.error('Registration error:', error);
    
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).send('Phone number already registered');
    }
    
    res.status(500).send('Registration failed');
  }
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', async (req, res) => {
  const { number, password } = req.body;
  console.log('Login attempt:', { number });
  try {
    const connection = await mysql.createConnection(dbConfig);
    console.log('Database connected');
    // Normalize login number to match stored format (+91)
    const normalizeLogin = (num) => {
      if (!num) return null;
      const s = String(num).trim();
      if (s.startsWith('+')) return s;
      const cleaned = s.replace(/^0+/, '');
      return cleaned.length === 10 ? `+91${cleaned}` : `+91${cleaned}`;
    };
    const lookupNumber = normalizeLogin(number);
    const [rows] = await connection.execute('SELECT * FROM users WHERE number = ?', [lookupNumber || null]);
    console.log('Query result:', rows.length, 'rows found');
    await connection.end();

    if (rows.length > 0 && await bcrypt.compare(password, rows[0].password)) {
      // Store user data in session
      req.session.user = {
        id: rows[0].id,
        number: rows[0].number,
        name: rows[0].name
      };
      // Render home page with user data
      res.render('main', { user: rows[0] });
    } else {
      res.status(401).send('Invalid number or password');
    }
  } catch (error) {
    console.error('Error logging in user:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/send-sos', async (req, res) => {
  // Check if user is logged in
  if (!req.session.user) {
    return res.status(401).json({ error: 'User not logged in' });
  }

  const { location } = req.body || {};
  const userNumber = req.session.user.number; // Use the logged-in user's phone number

  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);
    console.log('Looking up SOS user number:', userNumber);

    // Look up user by phone number
    const [results] = await connection.execute('SELECT * FROM users WHERE number = ?', [userNumber]);

    if (results.length === 0) {
      await connection.end();
      console.warn('SOS user not found for identifier:', lookup);
      return res.status(404).json({ error: 'User not found. Make sure the identifier (name or email) is correct.' });
    }

    const user = results[0];
    const contacts = [user.father_number, user.mother_number, user.guardian_number, user.guardian2_number].filter(Boolean);

    if (contacts.length === 0) {
      await connection.end();
      return res.status(400).json({ error: 'No contact numbers available for this user' });
    }

    // Create a Google Maps link if latitude and longitude are provided
    let locationLink = '';
    if (location && location.latitude && location.longitude) {
      locationLink = `https://www.google.com/maps?q=${location.latitude},${location.longitude}`;
    }

    const message = locationLink
      ? `🚨 EMERGENCY ALERT from ${user.name}!\nPhone: ${user.number}\nI need help immediately!\nMy location: ${locationLink}\nPlease respond ASAP!`
      : `🚨 EMERGENCY ALERT from ${user.name}!\nPhone: ${user.number}\nI need help immediately! Location unavailable. Please call me ASAP!`;

    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.PHONE_NUMBER_ID;
    // Log presence of credentials (mask token for safety)
    const maskedToken = token ? `${token.slice(0, 8)}...${token.slice(-8)}` : null;
    console.log('WhatsApp credentials loaded? ', { hasToken: !!token, phoneId: phoneId, maskedToken });

    if (!token || !phoneId || token.startsWith('your_') || phoneId.startsWith('your_')) {
      console.warn('WHATSAPP_TOKEN or PHONE_NUMBER_ID not configured or invalid. Simulating SOS send.');
      await connection.end();
      return res.json({ simulated: true, contacts: contacts.map(n => (n.startsWith('+') ? n : `+91${n}`)), message });
    }

    const successes = [];
    const failures = [];

    for (const number of contacts) {
      const formatted = number.startsWith('+') ? number : `+91${number}`;
      try {
        // Choose payload type: native location when lat/lng present, otherwise text
        let payload;
        if (location && location.latitude && location.longitude) {
          payload = {
            messaging_product: 'whatsapp',
            to: formatted.replace('+', ''),
            type: 'location',
            location: {
              latitude: String(location.latitude),
              longitude: String(location.longitude),
              name: `${user.name} - Current location`,
              address: ''
            }
          };
        } else {
          payload = {
            messaging_product: 'whatsapp',
            to: formatted.replace('+', ''),
            type: 'text',
            text: { body: message }
          };
        }
        console.log('Sending WhatsApp message to', formatted, 'payload=', payload);
        const resp = await axios.post(
          `https://graph.facebook.com/v18.0/${phoneId}/messages`,
          payload,
          { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
        );
        console.log('WhatsApp API response status=', resp.status, 'data=', resp.data);
        successes.push({ to: formatted, status: resp.status });
      } catch (err) {
        const status = err.response?.status;
        const errData = err.response?.data;
        const errInfo = errData || err.message || String(err);
        console.error(`Failed to send to ${formatted}: status=${status} error=`, errInfo);
        const isRecipientNotAllowed = errData?.error?.code === 131030;
        failures.push({ to: formatted, status, error: errInfo, recipientNotAllowed: !!isRecipientNotAllowed });
      }
    }

    await connection.end();

    if (successes.length > 0) return res.json({ message: 'SOS send completed', successes, failures });
    return res.status(500).json({ error: 'All sends failed', failures });
  } catch (error) {
    console.error('Error sending SOS:', error);
    // store diagnostic info for the most recent failure (do not store secrets)
    lastSosError = {
      message: error.message || String(error),
      stack: error.stack || null,
      time: new Date().toISOString()
    };
    try { if (connection) await connection.end(); } catch (e) {}
    return res.status(500).json({ error: 'Failed to send SOS', details: lastSosError });
  }
});
// Get current user info
app.get('/api/user', (req, res) => {
  if (req.session.user) {
    res.json(req.session.user);
  } else {
    res.status(401).json({ error: 'Not logged in' });
  }
});

// Logout route
app.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ error: 'Could not log out' });
    }
    res.redirect('/login');
  });
});

// Test route to preview SOS payload without sending to WhatsApp
app.get('/send-sos-test', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  const userNumber = req.session.user.number;
  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute('SELECT * FROM users WHERE number = ?', [userNumber]);
    await connection.end();
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const user = rows[0];
    const contacts = [user.father_number, user.mother_number, user.guardian_number, user.guardian2_number].filter(Boolean).map(n => (n.startsWith('+') ? n : `+91${n}`));
    // Create a sample location link (dummy) for preview
    const locationLink = `https://www.google.com/maps?q=12.9716,77.5946`;
    const message = `🚨 EMERGENCY ALERT from ${user.name}!\nPhone: ${user.number}\nI need help immediately!\nMy location: ${locationLink}\nPlease respond ASAP!`;
    const payloads = contacts.map(to => ({ to, messaging_product: 'whatsapp', type: 'text', text: { body: message } }));
    return res.json({ simulated: true, contacts, message, payloads });
  } catch (err) {
    try { if (connection) await connection.end(); } catch (e) {}
    console.error('Error in /send-sos-test', err);
    return res.status(500).json({ error: 'Failed to prepare test payload', details: err.message || err });
  }
});
app.post('/ai/chatbot', async (req, res) => {
  const { message } = req.body;
  const userType = 'Student'; // You can customize this later

  const pythonCommand = `python3 chatbot.py "${message}" "${userType}"`;

  exec(pythonCommand, (error, stdout, stderr) => {
    if (error) {
      console.error('Chatbot error:', error);
      return res.status(500).json({ reply: 'Sorry, something went wrong.' });
    }
    res.json({ reply: stdout.trim() });
  });
});

app.post('/location', upload.single('area_img'), async (req, res) => {
  const { location: locationName, surrounding, rating, description, latitude, longitude } = req.body || {};
  const file = req.file; // multer stores uploaded file here

  // Basic validation
  if (!locationName || String(locationName).trim() === '') {
    return res.status(400).send('Location name is required');
  }

  // Ensure uploads directory exists
  try {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  } catch (e) {
    console.warn('Could not ensure uploads directory exists', e);
  }

  // Build stored image path (relative path)
  let areaImagePath = null;
  if (file && file.path) {
    areaImagePath = file.path.replace(/\\/g, '/');
  }

  // created_by if logged in
  const createdBy = req.session?.user?.id || null;

  // Normalize latitude/longitude if present
  let lat = null, lon = null;
  if (latitude) {
    const p = parseFloat(String(latitude));
    if (!Number.isNaN(p)) lat = p;
  }
  if (longitude) {
    const q = parseFloat(String(longitude));
    if (!Number.isNaN(q)) lon = q;
  }

  // Insert into database
  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);
    const insertSql = `INSERT INTO locations (location_name, area_img, surrounding, rating, description, latitude, longitude, created_by, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`;
    const insertParams = [
      locationName,
      areaImagePath,
      surrounding || null,
      rating ? parseInt(rating, 10) : null,
      description || null,
      lat,
      lon,
      createdBy
    ];
    await connection.execute(insertSql, insertParams);
    await connection.end();

    // On success, redirect to home (or you can render a success page)
    return res.redirect('/home');
  } catch (err) {
    console.error('Error saving location to DB:', err);
    try { if (connection) await connection.end(); } catch (e) {}
    return res.status(500).send('Failed to save location');
  }
});

// Render server-side list of predicted/added locations (flashmobs)
app.get('/ai_predicted', async (req, res) => {
  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);
    const sql = `SELECT l.id, l.location_name, l.area_img, l.description, l.surrounding, l.rating, l.latitude, l.longitude, l.created_at, u.id AS user_id, u.name AS user_name, u.number AS user_number
                 FROM locations l
                 LEFT JOIN users u ON l.created_by = u.id
                 ORDER BY l.created_at DESC`;
    const [rows] = await connection.execute(sql);
    await connection.end();
    // Render EJS view with locations
    return res.render('ai_predicted', { locations: rows });
  } catch (err) {
    try { if (connection) await connection.end(); } catch (e) {}
    console.error('Error fetching locations for ai_predicted:', err);
    return res.status(500).send('Failed to load locations');
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

