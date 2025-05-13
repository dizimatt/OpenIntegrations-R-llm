require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const connectMongo = require('./config/mongo');
const compression = require('compression');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');

const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const llmRoutes = require('./routes/llm');

const app = express();

connectMongo();

// Set up EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet({
  contentSecurityPolicy: false,
  frameguard: false,
}));

// Set proper headers for Shopify iframe embedding
app.use((req, res, next) => {
  const shop = req.query.shop;
  if (shop) {
    res.setHeader('Content-Security-Policy', `frame-ancestors https://${shop} https://admin.shopify.com;`);
  } else {
    res.setHeader('Content-Security-Policy', `frame-ancestors https://admin.shopify.com;`);
  }
  res.setHeader('X-Frame-Options', 'ALLOWALL');
  next();
});

app.use(compression());
app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.use(express.static('public'));

app.use('/auth', authRoutes);
app.use('/api', apiRoutes);
app.use('/api/llm', llmRoutes);

// Render the embedded dashboard using EJS
app.get('/embedded', (req, res) => {
  console.log('Incoming /embedded request query:', req.query);
  const shop = req.query.shop;
  
  if (!shop) {
    return res.status(400).send('Missing shop parameter');
  }
  
  // Render the EJS template and pass the shop parameter
  res.render('embedded', { shop });
});

app.get('/', (req, res) => {
  const { shop } = req.query;
  if (!shop) {
    return res.status(400).send('Missing shop parameter');
  }
  console.log('shop %s:', shop);
  res.redirect('/embedded?shop=' + shop);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));