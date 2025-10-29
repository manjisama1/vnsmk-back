# 🚀 Professional Backend Deployment Guide

## 📋 Pre-Deployment Checklist

- [ ] Node.js 20+ installed locally for testing
- [ ] All environment variables configured
- [ ] CORS origins set correctly for your frontend
- [ ] GitHub OAuth credentials (if using admin features)
- [ ] Health check endpoint tested (`/api/health`)
- [ ] Session files API tested with real session data
- [ ] Rate limiting configured appropriately
- [ ] Security headers verified

## 🌐 Render.com Deployment (Recommended)

### Step 1: Prepare Repository
```bash
# Test locally first
cd backend
npm install
npm start    # Should start on port 8080
curl http://localhost:8080/api/health  # Should return OK
```

### Step 2: Create Render Service
1. Go to [render.com](https://render.com) and sign up
2. Click "New +" → "Web Service"
3. Connect your GitHub repository
4. Configure service:
   - **Name**: `vinsmoke-bot-backend`
   - **Root Directory**: `backend` (if monorepo)
   - **Environment**: `Node`
   - **Plan**: `Free` (sleeps after 15min inactivity) or `Starter` ($7/month)
   - **Build Command**: `npm ci --only=production`
   - **Start Command**: `node server.js`

**Free Tier Limitations:**
- Service sleeps after 15 minutes of inactivity
- 512MB RAM, shared CPU
- No custom domains
- 750 hours/month (enough for most use cases)

### Step 3: Environment Variables
Set these in Render dashboard under "Environment":

#### Required Variables (Only 4!)
```bash
FRONTEND_URL=https://your-frontend.vercel.app
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
ADMIN_USER_IDS=111729787
```

**That's it!** NODE_ENV, PORT, CORS, security settings, etc. are all handled automatically.

#### 🔍 How to Find Your GitHub User ID
```bash
# Method 1: GitHub API
curl https://api.github.com/users/your-username

# Method 2: Check your profile URL
# Visit: https://github.com/your-username
# Your ID is in the page source or use browser dev tools

# Method 3: Use the admin panel
# After first login, your ID will be logged in the backend console
```

#### Examples
```bash
# After deploying frontend to Vercel:
FRONTEND_URL=https://vnsmk-front-abc123.vercel.app

# GitHub OAuth (get from GitHub Developer Settings):
GITHUB_CLIENT_ID=Iv1.a1b2c3d4e5f6g7h8
GITHUB_CLIENT_SECRET=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0
```

#### Security & Performance (Recommended)
```bash
TRUST_PROXY=true
REQUEST_TIMEOUT=30000
MAX_REQUEST_SIZE=10mb
RATE_LIMIT_WINDOW=900000
RATE_LIMIT_MAX=100
LOG_LEVEL=info
```

#### OAuth & Admin (Required for admin features)
```bash
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
BACKEND_URL=https://your-backend.onrender.com
ADMIN_USER_IDS=111729787,987654321

# Fallback method (less secure):
# ADMIN_USERS=your-github-username,another-admin-username
```

### Step 4: Deploy & Verify
1. Click "Create Web Service"
2. Wait for deployment (usually 2-5 minutes)
3. Test endpoints:
   ```bash
   # Health check
   curl https://your-backend.onrender.com/api/health
   
   # API info
   curl https://your-backend.onrender.com/
   
   # CORS test (replace with your frontend URL)
   curl -H "Origin: https://your-frontend.com" \
        -H "Access-Control-Request-Method: GET" \
        -X OPTIONS https://your-backend.onrender.com/api/health
   ```

## 🚂 Railway Deployment (Alternative Free Option)

Railway offers $5 free credit monthly (usually enough for small apps):

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```

**Railway Benefits:**
- No sleep time (always on)
- Better performance than Render free
- $5/month free credit
- Easy GitHub integration

## 🌐 Vercel Deployment (Serverless - Free)

For API-only deployment, Vercel offers generous free tier:

1. Install Vercel CLI: `npm i -g vercel`
2. Run `vercel` in backend directory
3. Configure as Node.js project
4. Set environment variables in dashboard

**Vercel Benefits:**
- Serverless (no cold starts for API)
- Global CDN
- Generous free tier
- Automatic HTTPS

## 🐳 Docker Deployment

### Local Docker
```bash
# Build image
docker build -t vinsmoke-backend .

# Run container
docker run -d \
  --name vinsmoke-backend \
  -p 8080:8080 \
  -e NODE_ENV=production \
  -e FRONTEND_URL=https://your-frontend.com \
  vinsmoke-backend

# Check health
curl http://localhost:8080/api/health
```

### Docker Compose
```yaml
# docker-compose.yml
version: '3.8'
services:
  backend:
    build: .
    ports:
      - "8080:8080"
    environment:
      - NODE_ENV=production
      - FRONTEND_URL=https://your-frontend.com
      - TRUST_PROXY=true
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

## ☁️ Cloud Platform Deployment

### AWS ECS/Fargate
1. Push Docker image to ECR
2. Create ECS task definition
3. Set up Application Load Balancer
4. Configure auto-scaling

### Google Cloud Run
```bash
# Build and deploy
gcloud builds submit --tag gcr.io/PROJECT-ID/vinsmoke-backend
gcloud run deploy --image gcr.io/PROJECT-ID/vinsmoke-backend --platform managed
```

### Azure Container Instances
```bash
az container create \
  --resource-group myResourceGroup \
  --name vinsmoke-backend \
  --image your-registry/vinsmoke-backend \
  --ports 8080
```

## 🖥️ VPS/Manual Deployment

### Ubuntu/Debian Setup
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 for process management
sudo npm install -g pm2

# Clone and setup
git clone <your-repo>
cd backend
npm ci --only=production

# Configure environment
cp .env.example .env
nano .env  # Edit with your values

# Start with PM2
pm2 start server.js --name "vinsmoke-backend"
pm2 startup  # Enable auto-start on boot
pm2 save
```

### Nginx Reverse Proxy
```nginx
# /etc/nginx/sites-available/vinsmoke-backend
server {
    listen 80;
    server_name your-backend-domain.com;
    
    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 🧪 Testing Your Deployment

### Automated Testing Script
```bash
#!/bin/bash
API_BASE="https://your-backend.onrender.com"

echo "🧪 Testing Vinsmoke Backend Deployment..."

# Health check
echo "1. Health Check..."
curl -f "$API_BASE/api/health" || exit 1

# API info
echo "2. API Info..."
curl -f "$API_BASE/" || exit 1

# CORS test
echo "3. CORS Test..."
curl -H "Origin: https://your-frontend.com" \
     -H "Access-Control-Request-Method: GET" \
     -X OPTIONS "$API_BASE/api/health" || exit 1

# Rate limiting test
echo "4. Rate Limiting Test..."
for i in {1..5}; do
  curl -s "$API_BASE/api/health" > /dev/null
done

echo "✅ All tests passed!"
```

## 🔧 Performance Optimization

### Production Checklist
- [ ] Enable gzip compression (✅ Built-in)
- [ ] Set up CDN for static assets
- [ ] Configure database connection pooling (if using DB)
- [ ] Enable HTTP/2 on reverse proxy
- [ ] Set up monitoring (New Relic, DataDog, etc.)
- [ ] Configure log aggregation
- [ ] Set up error tracking (Sentry)

### Monitoring Setup
```javascript
// Add to your monitoring service
const healthCheck = setInterval(async () => {
  try {
    const response = await fetch('https://your-backend.com/api/health');
    if (!response.ok) {
      // Alert your team
      console.error('Backend health check failed');
    }
  } catch (error) {
    console.error('Backend unreachable:', error);
  }
}, 60000); // Check every minute
```

## 🚨 Troubleshooting

### Common Issues

1. **Port Issues**
   - Ensure your platform uses PORT environment variable
   - Default is 8080 (cloud standard)

2. **CORS Errors**
   - Verify FRONTEND_URL matches exactly
   - Include protocol (https://)
   - Check for trailing slashes

3. **Rate Limiting Too Strict**
   - Increase RATE_LIMIT_MAX for high-traffic apps
   - Adjust RATE_LIMIT_WINDOW as needed

4. **Memory Issues**
   - Monitor session file storage
   - Implement cleanup for old sessions
   - Consider external storage for large deployments

5. **Health Check Failures**
   - Verify /api/health endpoint responds
   - Check if server binds to 0.0.0.0
   - Ensure proper startup time

### Debug Commands
```bash
# Check logs (Render)
render logs --service your-service-name

# Check Docker logs
docker logs vinsmoke-backend

# Check PM2 logs
pm2 logs vinsmoke-backend

# Test locally with production settings
NODE_ENV=production npm start
```

## 📞 Support

For deployment issues:
1. Check the logs first
2. Verify all environment variables
3. Test endpoints manually
4. Check CORS configuration
5. Verify rate limiting settings

Your backend is now production-ready with enterprise-grade security and performance! 🎉