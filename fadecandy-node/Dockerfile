ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.19
FROM ${BUILD_FROM}

ENV LANG=C.UTF-8 \
    PATH=/usr/local/bin:/usr/bin:/bin

# Install Node.js, USB libraries, and runtime tools
RUN apk add --no-cache nodejs npm libusb eudev tzdata

WORKDIR /usr/src/app

# Install production dependencies first for better layer caching
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --production; fi

# Copy application source
COPY src ./src

# s6 overlay service definitions
COPY rootfs /
RUN chmod +x /etc/services.d/fadecandy/run \
    && chmod +x /etc/cont-init.d/10-usb-perms

CMD ["/init"]
