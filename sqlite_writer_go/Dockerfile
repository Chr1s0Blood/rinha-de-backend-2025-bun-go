# Build stage
FROM golang:1.24.3-alpine AS builder

WORKDIR /app

# Install build dependencies for SQLite (CGO required)
RUN apk add --no-cache gcc musl-dev sqlite-dev

# Copy go mod files
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy source code
COPY src/ ./src/

# Build the application with CGO enabled
RUN CGO_ENABLED=1 GOOS=linux go build -a -installsuffix cgo -o main ./src/main.go

# Runtime stage
FROM alpine:latest

# Install SQLite runtime
RUN apk --no-cache add sqlite

WORKDIR /root/

# Copy the binary from builder stage
COPY --from=builder /app/main .

# Create .env file if needed (optional)
# COPY .env .

CMD ["./main"]
