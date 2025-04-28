#!/bin/bash

echo "Creating Shopify App Skeleton..."

# Step 1: Create folders
mkdir -p shopify-app/{config,controllers,models,public/js,routes,utils,views,nginx,certs}
cd shopify-app

# Step 2: Create core files
cat > server.js << 'EOF'
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

app.use(helmet());
app.use(compression());
app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.use(express.static('public'));

app.use('/auth', authRoutes);
app.use('/api', apiRoutes);

app.get('/embedded', (req, res) => {
  res.sendFile(__dirname + '/views/embedded.html');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
EOF

# Step 3: Create config files
cat > config/mongo.js << 'EOF'
const mongoose = require('mongoose');

const connectMongo = async () => {
  await mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  console.log('MongoDB connected');
};

module.exports = connectMongo;
EOF

cat > config/shopify.js << 'EOF'
module.exports = {
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecret: process.env.SHOPIFY_API_SECRET,
  scopes: 'read_products,read_orders',
  apiVersion: '2023-10',
};
EOF

# Step 4: Create routes
cat > routes/auth.js << 'EOF'
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.get('/callback', authController.install);

module.exports = router;
EOF

cat > routes/api.js << 'EOF'
const express = require('express');
const router = express.Router();
const apiController = require('../controllers/apiController');
const verifyRequest = require('../utils/verifyRequest');

router.get('/products', verifyRequest, apiController.getProducts);
router.get('/orders', verifyRequest, apiController.getOrders);

module.exports = router;
EOF

# Step 5: Create controllers
cat > controllers/authController.js << 'EOF'
const axios = require('axios');
const crypto = require('crypto');
const Session = require('../models/session');
const { apiKey, apiSecret } = require('../config/shopify');

const buildHmac = (query) => {
  const sortedQuery = Object.keys(query)
    .filter((key) => key !== 'hmac' && key !== 'signature')
    .sort()
    .map((key) => \`\${key}=\${Array.isArray(query[key]) ? query[key].join(', ') : query[key]}\`)
    .join('&');

  return crypto
    .createHmac('sha256', apiSecret)
    .update(sortedQuery)
    .digest('hex');
};

exports.install = async (req, res) => {
  const { shop, hmac, code } = req.query;
  if (!shop || !hmac || !code) {
    return res.status(400).send('Required parameters missing');
  }

  const generatedHash = buildHmac(req.query);
  if (generatedHash !== hmac) {
    return res.status(400).send('HMAC validation failed');
  }

  const tokenUrl = \`https://\${shop}/admin/oauth/access_token\`;
  try {
    const response = await axios.post(tokenUrl, {
      client_id: apiKey,
      client_secret: apiSecret,
      code,
    });

    const { access_token, scope } = response.data;

    await Session.findOneAndUpdate(
      { shop },
      { accessToken: access_token, scope },
      { upsert: true }
    );

    res.redirect(\`/embedded?shop=\${shop}\`);
  } catch (error) {
    console.error(error);
    res.status(500).send('Error exchanging token');
  }
};
EOF

cat > controllers/apiController.js << 'EOF'
const shopifyGraphql = require('../utils/shopifyGraphql');
const Session = require('../models/session');

exports.getProducts = async (req, res) => {
  const session = await Session.findOne({ shop: req.query.shop });
  if (!session) return res.status(401).send('Unauthorized');

  const query = \`
    {
      products(first: 10) {
        edges {
          node {
            id
            title
            descriptionHtml
          }
        }
      }
    }
  \`;

  const data = await shopifyGraphql(session.shop, session.accessToken, query);
  res.json(data);
};

exports.getOrders = async (req, res) => {
  const session = await Session.findOne({ shop: req.query.shop });
  if (!session) return res.status(401).send('Unauthorized');

  const query = \`
    {
      orders(first: 10) {
        edges {
          node {
            id
            name
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
          }
        }
      }
    }
  \`;

  const data = await shopifyGraphql(session.shop, session.accessToken, query);
  res.json(data);
};
EOF

# Step 6: Create utils
cat > utils/shopifyGraphql.js << 'EOF'
const axios = require('axios');
const { apiVersion } = require('../config/shopify');

const shopifyGraphql = async (shop, accessToken, query) => {
  const response = await axios.post(\`https://\${shop}/admin/api/\${apiVersion}/graphql.json\`, { query }, {
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
  });
  return response.data.data;
};

module.exports = shopifyGraphql;
EOF

cat > utils/verifyRequest.js << 'EOF'
module.exports = (req, res, next) => {
  const { shop } = req.query;
  if (!shop) return res.status(401).send('Missing shop parameter');
  next();
};
EOF

# Step 7: Create models
cat > models/session.js << 'EOF'
const mongoose = require('mongoose');

const SessionSchema = new mongoose.Schema({
  shop: String,
  accessToken: String,
  scope: String,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Session', SessionSchema);
EOF

# Step 8: Create views
cat > views/embedded.html << 'EOF'
<!DOCTYPE html>
<html>
<head>
  <title>Embedded Shopify App</title>
  <script src="https://cdn.jsdelivr.net/npm/jquery"></script>
</head>
<body>
  <h1>Shopify Embedded App</h1>
  <div id="products"></div>

  <script>
    const shop = new URLSearchParams(window.location.search).get('shop');

    $(document).ready(function() {
      $.get(\`/api/products?shop=\${shop}\`, function(data) {
        $('#products').html('<pre>' + JSON.stringify(data, null, 2) + '</pre>');
      });
    });
  </script>
</body>
</html>
EOF

# Step 9: Create nginx config
cat > nginx/nginx.conf << 'EOF'
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name yourdomain.com;

    ssl_certificate /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;

    location / {
        proxy_pass http://app:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
EOF

# Step 10: Create Dockerfile
cat > Dockerfile << 'EOF'
FROM node:18

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
EOF

# Step 11: Create docker-compose
cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  mongo:
    image: mongo:6.0
    container_name: shopify-mongo
    restart: always
    ports:
      - "27017:27017"
    volumes:
      - mongo_data:/data/db

  app:
    build: .
    container_name: shopify-node-app
    restart: always
    env_file:
      - .env
    ports:
      - "3000:3000"
    depends_on:
      - mongo
    volumes:
      - .:/app

  nginx:
    image: nginx:alpine
    container_name: shopify-nginx
    restart: always
    ports:
      - "443:443"
      - "80:80"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - ./certs:/etc/nginx/certs:ro
    depends_on:
      - app

volumes:
  mongo_data:
EOF

# Step 12: Create .env sample
cat > .env << 'EOF'
SHOPIFY_API_KEY=your_api_key
SHOPIFY_API_SECRET=your_api_secret
MONGO_URI=mongodb://mongo:27017/shopify-app
APP_URL=https://yourdomain.com
EOF

# Step 13: Create package.json
cat > package.json << 'EOF'
{
  "name": "shopify-node-express-mongo-app",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "mongoose": "^7.0.5",
    "axios": "^1.4.0",
    "cookie-parser": "^1.4.6",
    "body-parser": "^1.20.2",
    "express-session": "^1.17.3",
    "dotenv": "^16.3.1",
    "crypto": "^1.0.1",
    "compression": "^1.7.4",
    "helmet": "^6.0.1"
  }
}
EOF

echo "✅ Done! Your Shopify app skeleton is ready."
