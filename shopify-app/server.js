require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const connectMongo = require('./config/mongo');
const compression = require('compression');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');

const app = express();

connectMongo();

//app.use(helmet());
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

/*
app.get('/embedded', (req, res) => {
  res.sendFile(__dirname + '/views/embedded.html');
});
*/

app.get('/embedded', (req, res) => {
  console.log('Incoming /embedded request query:', req.query);
  const shop = req.query.shop;
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Shopify Embedded App</title>
        <script src="https://cdn.jsdelivr.net/npm/jquery"></script>
      </head>
      <body>
        <h1>Shopify Embedded App</h1>
        <h2>Shop URL: ${shop}</h2>

        <div id="products">Loading products...</div>
        <div id="orders">Loading orders...</div>

        <script>
          const shop = '${shop}';

          $(document).ready(function() {
            if (!shop) {
              alert('Missing shop parameter');
              return;
            }

            $.get('/api/products?shop=' + shop, function(data) {
              $('#products').html('<h2>Products</h2><pre>' + JSON.stringify(data, null, 2) + '</pre>');
            }).fail(function(err) {
              console.error('API call failed:', err);
              $('#products').html('<p>Failed to load products.</p>');
            });
            $.get('/api/orders?shop=' + shop, function(data) {
              $('#orders').html('<h2>Orders</h2><pre>' + JSON.stringify(data, null, 2) + '</pre>');
            }).fail(function(err) {
              console.error('API call failed:', err);
              $('#orders').html('<p>Failed to load orders.</p>');
            });
          });
        </script>
      </body>
    </html>
  `);
});

app.get('/', (req, res) => {
  const { shop } = req.query;
  if (!shop) {
    return res.status(400).send('Missing shop parameter');
  }
  console.log('shop %s:', shop);
  res.redirect(`/embedded?shop=${shop}`);
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
