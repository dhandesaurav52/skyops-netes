# Stage 1: Build the static Go binary
FROM golang:1.22-alpine AS builder

ARG VERSION=v1.5.1

WORKDIR /src

# Install CA certificates for secure HTTPS transport
RUN apk add --no-cache ca-certificates git

# Copy dependency manifests
COPY go.mod go.sum* ./
RUN go mod download

# Copy agent source code
COPY . .

# Compile self-contained, statically linked binary for target architecture
RUN CGO_ENABLED=0 go build \
    -trimpath \
    -ldflags="-s -w -X main.Version=${VERSION}" \
    -o /out/skyops-agent \
    ./cmd/skyops-agent

# Stage 2: Minimal non-root runtime container
FROM gcr.io/distroless/static-debian12:nonroot

WORKDIR /

# Copy compiled binary from builder stage
COPY --from=builder /out/skyops-agent /skyops-agent

# Ensure non-root user (uid 65532: distroless nonroot user)
USER 65532:65532

ENTRYPOINT ["/skyops-agent"]
