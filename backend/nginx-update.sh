# Update Nginx to proxy API requests to Node.js backend
# Run: sudo bash nginx-update.sh

NGINX_CONF="/etc/nginx/sites-available/default"

# Backup
sudo cp $NGINX_CONF ${NGINX_CONF}.bak

# Write new config
sudo tee $NGINX_CONF > /dev/null << 'NGINX'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name seventrip.net www.seventrip.net;

    root /root/projects/all-stars-atlas/dist;
    index index.html;

    # API proxy to Node.js backend
    location /api {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }

    # Serve uploaded files
    location /uploads {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
NGINX

# Test and reload
sudo nginx -t && sudo systemctl reload nginx
echo "✅ Nginx updated! API requests will now proxy to port 3001."
