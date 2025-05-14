# Shopify Node.js Embedded App (Express + MongoDB + Docker)

This is a **public Shopify app** built with:
- Node.js + Express.js
- MongoDB for session storage
- Shopify OAuth authentication
- Embedded Admin Interface (no React, only jQuery)
- Shopify GraphQL API for data access
- Dockerized setup with Nginx SSL reverse proxy

---

## Project Structure

```plaintext
/shopify-app/
├── server.js              # Main Express server
├── Dockerfile             # Node.js service Dockerfile
├── docker-compose.yml     # Compose file (Mongo, App, Nginx)
├── config/                # MongoDB & Shopify settings
├── controllers/           # OAuth and API logic
├── routes/                # Auth and API routes
├── models/                # Mongoose session model
├── utils/                 # Shopify GraphQL helper and middleware
├── public/                # Static files (jQuery frontend)
├── views/                 # Embedded Admin HTML
├── nginx/nginx.conf       # Reverse Proxy and SSL
├── certs/                 # Your SSL certs go here
├── .env                   # Environment variables
└── package.json           # Node dependencies
 # forced commit - for tag