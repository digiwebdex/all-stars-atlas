#!/bin/bash
# Seven Trip Backend Setup Script
# Run this on your VPS: bash setup.sh

set -e

echo "🚀 Setting up Seven Trip Backend..."

# Install Node.js 20 if not present
if ! command -v node &> /dev/null; then
  echo "📦 Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "📦 Node.js version: $(node -v)"
echo "📦 npm version: $(npm -v)"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Create uploads directory
mkdir -p uploads

# Install PM2 globally
if ! command -v pm2 &> /dev/null; then
  echo "📦 Installing PM2..."
  sudo npm install -g pm2
fi

# Start with PM2
echo "🚀 Starting server with PM2..."
pm2 delete seventrip-api 2>/dev/null || true
pm2 start server.js --name seventrip-api
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true

echo ""
echo "✅ Backend is running!"
echo "📍 API: http://localhost:3001/api/health"
echo ""
echo "🔧 Now update Nginx to proxy /api to port 3001:"
echo "   Add this to your Nginx server block:"
echo ""
echo "   location /api {"
echo "       proxy_pass http://127.0.0.1:3001;"
echo "       proxy_http_version 1.1;"
echo "       proxy_set_header Upgrade \$http_upgrade;"
echo "       proxy_set_header Connection 'upgrade';"
echo "       proxy_set_header Host \$host;"
echo "       proxy_set_header X-Real-IP \$remote_addr;"
echo "       proxy_cache_bypass \$http_upgrade;"
echo "   }"
echo ""
echo "   Then: sudo nginx -t && sudo systemctl reload nginx"
echo ""
echo "🔑 Login credentials:"
echo "   Admin: admin@seventrip.net / Admin@123456"
echo "   User:  rahim@gmail.com / User@123456"
