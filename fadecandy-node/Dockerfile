ARG BUILD_FROM
FROM ${BUILD_FROM}

# Install Node.js, USB libs, and build tooling (linux-headers required for linux/magic.h in node-usb)
RUN apk add --no-cache \
    nodejs npm \
    g++ build-base linux-headers \
    libusb libusb-dev eudev eudev-dev tzdata libmagic libftdi1

WORKDIR /usr/src/app

# Install production dependencies first for better layer caching
COPY package*.json ./
RUN npm install

# Copy application source
COPY src ./src

EXPOSE 7890

# s6 overlay service definitions
COPY rootfs /
RUN chmod +x /etc/services.d/fadecandy/run \
    && chmod +x /etc/cont-init.d/10-usb-perms

