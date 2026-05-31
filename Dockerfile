FROM node:18-alpine

WORKDIR /app

# Copy package files first
COPY package.json ./

# Install dependencies with taobao mirror
RUN npm config set registry https://registry.npmmirror.com && npm install --omit=dev

# Copy source code
COPY src/ ./src/
COPY public/ ./public/

# Create data directory structure
RUN mkdir -p /app/data/db /app/data/md /app/data/config

# Expose port
EXPOSE 3090

# Auth configuration (set AUTH_PASSWORD to enable login)
ENV AUTH_PASSWORD=
ENV SESSION_SECRET=md-viewer-session-secret

# Start the application
CMD ["node", "src/index.js"]
